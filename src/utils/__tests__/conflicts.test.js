import { describe, it, expect } from 'vitest';
import {
  diffLines, isConflictCopy, noteText, pairConflicts, planResolution, sideBySide, stripPrefix,
} from '../conflicts';

// Invented notes only.
let nextId = 1;
const note = (uuid, extra = {}) => ({
  id: nextId++, uuid, title: 'Invented', type: 'text', note: 'invented text', state: 'normal',
  createdAt: 1000, modifiedAt: 2000, ...extra,
});

describe('which notes are copies', () => {
  it('a copy is a note whose title starts with "[conflict] "', () => {
    expect(isConflictCopy(note('a', { title: '[conflict] Invented' }))).toBe(true);
    expect(isConflictCopy(note('a', { title: 'Invented [conflict] ' }))).toBe(false);
    expect(isConflictCopy(note('a', { title: null }))).toBe(false);
    expect(stripPrefix('[conflict] [conflict] Invented')).toBe('[conflict] Invented');
    expect(stripPrefix(null)).toBe('');
  });
});

describe('pairing copies with their notes', () => {
  it('a copy that names its note is paired with it, whatever the titles', () => {
    const original = note('a', { title: 'Renamed since' });
    const copy = note('c', { title: '[conflict] Invented', conflictOf: 'a' });
    expect(pairConflicts([original, copy])).toEqual([{ copy, original, matchedBy: 'link' }]);
  });

  it('a copy whose named note is in the trash has no note', () => {
    const original = note('a', { state: 'trash' });
    const copy = note('c', { title: '[conflict] Invented', conflictOf: 'a' });
    expect(pairConflicts([original, copy])[0]).toMatchObject({ original: null });
  });

  it('a copy made on the phone is paired by title', () => {
    const original = note('a', { title: 'Shopping' });
    const other = note('b', { title: 'Something else' });
    const copy = note('c', { title: '[conflict] Shopping' });
    expect(pairConflicts([other, copy, original])).toEqual([{ copy, original, matchedBy: 'title' }]);
  });

  it('among notes with the same title it picks the same creation date, then type, then nearest edit', () => {
    const sameDay = note('a', { title: 'Diary', createdAt: 5000, modifiedAt: 9000 });
    const nearer = note('b', { title: 'Diary', createdAt: 6000, modifiedAt: 3001 });
    const copy = note('c', { title: '[conflict] Diary', createdAt: 5000, modifiedAt: 3000 });
    expect(pairConflicts([nearer, sameDay, copy])[0]).toMatchObject({ original: sameDay, matchedBy: 'guess' });

    const list = note('d', { title: 'Plan', type: 'checklist', createdAt: 1, modifiedAt: 3000 });
    const text = note('e', { title: 'Plan', type: 'text', createdAt: 2, modifiedAt: 1000 });
    const copy2 = note('f', { title: '[conflict] Plan', type: 'text', createdAt: 3, modifiedAt: 3000 });
    expect(pairConflicts([list, text, copy2])[0].original).toBe(text);
  });

  it('copies in the trash are left out, and so are notes in the trash as partners', () => {
    const trashed = note('a', { title: 'Invented', state: 'trash' });
    const oldCopy = note('b', { title: '[conflict] Invented', state: 'trash' });
    const copy = note('c', { title: '[conflict] Invented' });
    expect(pairConflicts([trashed, oldCopy, copy])).toEqual([{ copy, original: null, matchedBy: null }]);
  });

  it('a copy is never paired with another copy, and the newest copies come first', () => {
    const older = note('a', { title: '[conflict] Invented', modifiedAt: 1000 });
    const newer = note('b', { title: '[conflict] [conflict] Invented', modifiedAt: 3000 });
    expect(pairConflicts([older, newer]).map(p => [p.copy.uuid, p.original])).toEqual([['b', null], ['a', null]]);
  });
});

describe('the text compared', () => {
  it('is the note text, or checklist lines, and nothing for a locked note', () => {
    expect(noteText(note('a', { note: 'one\ntwo' }))).toBe('one\ntwo');
    expect(noteText(note('a', { type: 'checklist', items: [{ text: 'milk', checked: true }, { text: 'eggs', checked: false }] })))
      .toBe('[V] milk\n[ ] eggs');
    expect(noteText(note('a', { encrypted: 1 }))).toBeNull();
    expect(noteText(note('a', { note: null }))).toBe('');
  });
});

describe('the differences', () => {
  const kinds = (d) => d.map(l => `${l.kind[0]}:${l.text}`);

  it('marks lines only in the first as removed and only in the second as added', () => {
    expect(kinds(diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne'))).toEqual(['s:a', 'r:b', 'a:B', 's:c', 's:d', 'a:e']);
  });

  it('finds lines moved apart by an insertion', () => {
    expect(kinds(diffLines('one\ntwo\nthree', 'zero\none\ntwo\nnew\nthree'))).toEqual(['a:zero', 's:one', 's:two', 'a:new', 's:three']);
  });

  it('handles empty and equal texts', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(kinds(diffLines('', 'x'))).toEqual(['a:x']);
    expect(kinds(diffLines('x', ''))).toEqual(['r:x']);
    expect(kinds(diffLines('x\ny', 'x\ny'))).toEqual(['s:x', 's:y']);
  });

  it('every line of both texts appears, in order', () => {
    const a = 'p\nq\nr\ns\nt\nu';
    const b = 'q\nx\ns\nt\ny\nu\nz';
    const d = diffLines(a, b);
    expect(d.filter(l => l.kind !== 'added').map(l => l.text).join('\n')).toBe(a);
    expect(d.filter(l => l.kind !== 'removed').map(l => l.text).join('\n')).toBe(b);
  });

  it('lays the lines out in two columns, pairing changed lines that sit together', () => {
    const rows = sideBySide(diffLines('a\nb\nc', 'a\nB\nB2\nc'));
    expect(rows.map(r => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'], ['b', 'B'], [null, 'B2'], ['c', 'c'],
    ]);
  });
});

describe('what each choice changes', () => {
  const original = note('a', { id: 1, title: 'Invented', note: 'kept here', colorIndex: 2 });
  const copy = note('c', { id: 2, title: '[conflict] Invented title', note: 'kept there', type: 'text', colorIndex: 5, conflictOf: 'a' });

  it('keeping the note puts the copy in the trash', () => {
    expect(planResolution(original, copy, 'note')).toEqual({ updates: [], trash: [2] });
  });

  it('keeping the copy swaps the two versions, so the one not kept goes to the trash', () => {
    const { updates, trash } = planResolution(original, copy, 'copy');
    expect(updates[0]).toEqual({ id: 1, changes: expect.objectContaining({ title: 'Invented title', note: 'kept there' }) });
    expect(updates[1]).toEqual({ id: 2, changes: expect.objectContaining({ title: '[conflict] Invented', note: 'kept here' }) });
    expect(updates[0].changes).not.toHaveProperty('colorIndex');
    expect(trash).toEqual([2]);
  });

  it('keeping both makes the copy an ordinary note', () => {
    expect(planResolution(original, copy, 'both')).toEqual({
      updates: [{ id: 2, changes: { title: 'Invented title', conflictOf: null } }], trash: [],
    });
  });

  it('a copy with no note can be kept as a note or put in the trash', () => {
    expect(planResolution(null, copy, 'copy').updates).toEqual([{ id: 2, changes: { title: 'Invented title', conflictOf: null } }]);
    expect(planResolution(null, copy, 'note')).toEqual({ updates: [], trash: [2] });
  });
});
