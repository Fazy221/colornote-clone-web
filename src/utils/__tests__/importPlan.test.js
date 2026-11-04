// @vitest-environment node
// Node, for WebCrypto in contentUuid.
import { describe, it, expect } from 'vitest';
import { planImport, noteFromFile, contentUuid } from '../importPlan';

// Invented notes only.
const ours = (extra = {}) => ({
  id: 7, uuid: 'u-1', legacyId: 3, title: 'Invented title', type: 'text', note: 'made up body', items: null,
  encrypted: 0, format: '', colorIndex: 2, folderId: 0, state: 'normal', importance: 0,
  calendarDate: '2026-01-05', reminderType: 0, reminderRepeat: 0, reminderTime: null,
  reminderRepeatEnds: 0, reminderDismissedAt: null, tags: '', createdAt: 1000, modifiedAt: 5000, ...extra,
});
// As noteFromFile gives it: no styling, reminder time, repeat end or dismissal.
const fromFile = (extra = {}) => {
  const { id: _id, format: _f, reminderTime: _t, reminderRepeatEnds: _e, reminderDismissedAt: _d, ...rest } = ours();
  return { ...rest, ...extra };
};
const copyUuid = async (loser) => `copy-${loser.uuid}-${loser.modifiedAt}`;
const plan = (file, rows) => planImport(file, rows, copyUuid);

describe('planImport', () => {
  it('adds a note this app does not have', async () => {
    const { report, adds, updates } = await plan([fromFile({ uuid: 'new' })], [ours()]);
    expect(adds.map(n => n.uuid)).toEqual(['new']);
    expect(updates).toEqual([]);
    expect(report).toMatchObject({ added: 1, notInFile: 1 });
  });

  it('writes nothing when the file holds what is here already', async () => {
    const { report, adds, updates } = await plan([fromFile()], [ours()]);
    expect(adds).toEqual([]);
    expect(updates).toEqual([]);
    expect(report.unchanged).toBe(1);
  });

  it('takes newer text from the file and keeps the text here as a [conflict] copy', async () => {
    const { report, adds, updates } = await plan([fromFile({ note: 'newer in file', modifiedAt: 6000 })], [ours()]);
    expect(updates[0].changes).toEqual({ note: 'newer in file', modifiedAt: 6000 });
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ uuid: 'copy-u-1-5000', title: '[conflict] Invented title', note: 'made up body', state: 'normal' });
    expect(report).toMatchObject({ replaced: 1, conflictCopies: 1 });
  });

  it('keeps newer text here and copies the file’s text', async () => {
    const { report, adds, updates } = await plan([fromFile({ note: 'older in file', modifiedAt: 4000 })], [ours()]);
    expect(updates).toEqual([]);
    expect(adds[0]).toMatchObject({ title: '[conflict] Invented title', note: 'older in file' });
    expect(report).toMatchObject({ keptOurs: 1, conflictCopies: 1 });
  });

  it('on a tie with different text the file wins, so importing it again changes nothing', async () => {
    const first = await plan([fromFile({ note: 'same date, other words' })], [ours()]);
    expect(first.updates[0].changes).toEqual({ note: 'same date, other words' });
    const after = { ...ours(), ...first.updates[0].changes };
    const again = await plan([fromFile({ note: 'same date, other words' })], [after, { ...first.adds[0], id: 8 }]);
    expect(again.updates).toEqual([]);
    expect(again.adds).toEqual([]);
  });

  it('does not make the same copy twice', async () => {
    const existingCopy = { ...ours(), id: 9, uuid: 'copy-u-1-5000' };
    const { adds, report } = await plan([fromFile({ note: 'newer in file', modifiedAt: 6000 })], [ours(), existingCopy]);
    expect(adds).toEqual([]);
    expect(report.conflictCopies).toBe(0);
  });

  it('keeps the pin and dismissal here, and fields the file does not carry', async () => {
    const here = ours({ importance: 1, reminderDismissedAt: 4500, reminderTime: 9999, reminderRepeatEnds: 8888, format: 'b:0-3' });
    const { updates } = await plan([fromFile({ title: 'newer title', importance: 0, modifiedAt: 6000 })], [here]);
    expect(updates[0].changes).toEqual({ title: 'newer title', modifiedAt: 6000 });
  });

  it('drops styling here when the file wins with a different body, since it would not fit', async () => {
    const { updates } = await plan([fromFile({ note: 'newer in file', modifiedAt: 6000 })], [ours({ format: 'b:0-3' })]);
    expect(updates[0].changes).toEqual({ note: 'newer in file', format: '', modifiedAt: 6000 });
  });

  it('a conflict copy holds no date or reminder and keeps no old-app id', async () => {
    const here = ours({ reminderType: 16, reminderRepeat: 48, reminderTime: 9999, importance: 1 });
    const { adds } = await plan([fromFile({ note: 'newer in file', modifiedAt: 6000 })], [here]);
    expect(adds[0]).toMatchObject({ calendarDate: null, reminderType: 0, reminderRepeat: 0, reminderTime: null, importance: 0 });
    expect(adds[0].legacyId).toBeUndefined();
    expect(adds[0].id).toBeUndefined();
  });

  it('a note hidden in the file gets hidden here; one hidden here stays hidden', async () => {
    const hidden = await plan([fromFile({ state: 'archived' })], [ours()]);
    expect(hidden.updates[0].changes).toEqual({ state: 'archived' });
    expect(hidden.report.stateFixed).toBe(1);

    const stays = await plan([fromFile()], [ours({ state: 'trash' })]);
    expect(stays.updates).toEqual([]);
    expect(stays.report.stateKept).toBe(1);
  });

  it('takes a newer calendar date along with newer details, and keeps one set here when the file is older', async () => {
    const newer = await plan([fromFile({ calendarDate: '2026-02-01', modifiedAt: 6000 })], [ours()]);
    expect(newer.updates[0].changes).toEqual({ calendarDate: '2026-02-01', modifiedAt: 6000 });
    expect(newer.report.detailsTaken).toBe(1);

    const older = await plan([fromFile({ calendarDate: '2025-12-01', modifiedAt: 4000 })], [ours()]);
    expect(older.updates).toEqual([]);
    expect(older.report.detailsKept).toBe(1);
  });
});

describe('noteFromFile', () => {
  it('maps the parser output and leaves out what it does not carry', () => {
    const n = noteFromFile({
      id: 'u-9', legacyId: 4, title: 'Invented', type: 'text', note: 'made up', colorIndex: 1, state: 'normal',
      encrypted: false, folderId: 0, importance: 0, calendarDate: new Date(2026, 0, 5, 12).getTime(),
      reminderType: 16, reminderRepeat: 0, tags: '', createdAt: 100, modifiedAt: 200,
    });
    expect(n).toMatchObject({ uuid: 'u-9', calendarDate: '2026-01-05', encrypted: 0, modifiedAt: 200 });
    for (const f of ['format', 'reminderTime', 'reminderRepeatEnds', 'reminderDismissedAt', 'id']) expect(f in n).toBe(false);
  });
});

describe('contentUuid', () => {
  it('is a uuid that depends on the text and date, and not on anything else', async () => {
    const a = await contentUuid(ours());
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await contentUuid(ours({ importance: 1, colorIndex: 5 }))).toBe(a);
    expect(await contentUuid(ours({ note: 'other words' }))).not.toBe(a);
    expect(await contentUuid(ours({ modifiedAt: 5001 }))).not.toBe(a);
  });
});
