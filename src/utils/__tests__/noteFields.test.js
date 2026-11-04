import { describe, it, expect } from 'vitest';
import { planEditorSave, sameContent, pick } from '../noteFields';

// Invented notes only.
const stored = (extra = {}) => ({
  id: 7, uuid: 'u-1', title: 'Invented title', type: 'text', note: 'made up body', items: null,
  encrypted: 0, format: '', colorIndex: 2, folderId: 0, state: 'normal', importance: 0,
  calendarDate: '2026-01-05', reminderType: 16, reminderRepeat: 0, reminderDismissedAt: null,
  createdAt: 1000, modifiedAt: 5000, ...extra,
});
// What the editor hands over: the content group plus colour and folder.
const held = (note, extra = {}) => ({
  ...pick(note, ['title', 'type', 'note', 'items', 'encrypted', 'format']),
  colorIndex: note.colorIndex, folderId: note.folderId, ...extra,
});
let n = 0;
const plan = (base, edited, current, now = 9000) => planEditorSave({ base, edited, current, now, newUuid: () => `new-${++n}` });

describe('planEditorSave', () => {
  it('writes nothing for a note that was only looked at', () => {
    const base = stored();
    expect(plan(base, held(base), base).changes).toBeNull();
  });

  it('writes the edited text with a newer date, and nothing it did not touch', () => {
    const base = stored();
    const { changes, conflictCopy } = plan(base, held(base, { note: 'edited here' }), base);
    expect(changes).toMatchObject({ note: 'edited here', modifiedAt: 9000 });
    expect(Object.keys(changes)).not.toContain('importance');
    expect(Object.keys(changes)).not.toContain('calendarDate');
    expect(Object.keys(changes)).not.toContain('colorIndex');
    expect(conflictCopy).toBeNull();
  });

  it('keeps a pin, calendar date and dismissal set elsewhere while the note was open', () => {
    const base = stored();
    const current = stored({ importance: 1, calendarDate: '2026-02-01', reminderDismissedAt: 7000 });
    const { changes } = plan(base, held(base, { title: 'edited here' }), current);
    for (const f of ['importance', 'calendarDate', 'reminderDismissedAt', 'state']) {
      expect(f in changes).toBe(false);
    }
  });

  it('keeps text changed elsewhere as a [conflict] copy when both sides edited it', () => {
    const base = stored();
    const current = stored({ note: 'edited on the phone', modifiedAt: 8000 });
    const { changes, conflictCopy } = plan(base, held(base, { note: 'edited here' }), current);
    expect(changes.note).toBe('edited here');
    expect(conflictCopy).toMatchObject({ title: '[conflict] Invented title', note: 'edited on the phone', modifiedAt: 8000 });
    expect(conflictCopy.uuid).not.toBe('u-1');
    expect(conflictCopy.id).toBeUndefined();
  });

  it('does not touch text changed elsewhere when only the colour was changed here', () => {
    const base = stored();
    const current = stored({ note: 'edited on the phone', modifiedAt: 8000 });
    const { changes, conflictCopy } = plan(base, held(base, { colorIndex: 5 }), current);
    expect(changes).toEqual({ colorIndex: 5, modifiedAt: 9000 });
    expect(conflictCopy).toBeNull();
  });

  it('makes no copy when the other side made the same edit', () => {
    const base = stored();
    const current = stored({ note: 'same words' });
    expect(plan(base, held(base, { note: 'same words' }), current).changes).toBeNull();
  });

  it('dates the save after the stored copy even when this clock is behind', () => {
    const base = stored({ modifiedAt: 20000 });
    expect(plan(base, held(base, { note: 'edited here' }), base, 9000).changes.modifiedAt).toBe(20001);
  });

  it('moves ciphertext with its flag', () => {
    const base = stored({ encrypted: 1, note: 'cipher-a' });
    const { changes } = plan(base, held(base, { note: 'cipher-b' }), base);
    expect(changes).toMatchObject({ note: 'cipher-b', encrypted: 1 });
  });

  it('brings back a note deleted elsewhere as a new one when its text was edited here', () => {
    const base = stored();
    const { revive } = plan(base, held(base, { note: 'edited here' }), null);
    expect(revive).toMatchObject({ note: 'edited here', modifiedAt: 9000, createdAt: 9000 });
    expect(revive.uuid).not.toBe('u-1');
    expect(revive.id).toBeUndefined();
  });

  it('lets a note deleted elsewhere go when nothing was edited here', () => {
    const base = stored();
    const result = plan(base, held(base), null);
    expect(result.revive).toBeUndefined();
    expect(result.changes).toBeNull();
  });
});

describe('sameContent', () => {
  it('treats empty, missing and null styling as the same', () => {
    expect(sameContent(stored({ format: '' }), stored({ format: undefined }))).toBe(true);
    expect(sameContent(stored(), stored({ encrypted: false }))).toBe(true);
  });
});
