import { describe, it, expect } from 'vitest';
import { diffText, diffItems, diffVersions, countChanges, MAX_CELLS } from './versionDiff';
import { previousOf } from './versions';

const names = { color: (i) => ['None', 'Red', 'Blue'][i] ?? `c${i}`, folder: (id) => (id ? `F${id}` : 'No folder'), date: (ms) => `d${ms}` };
const v = (o = {}) => ({
  id: 'a', at: 1, kind: 'edit', type: 'text', title: 'Trip', note: 'we went to the sea', items: null,
  encrypted: 0, colorIndex: 0, folderId: 0, format: null, modifiedAt: 100, ...o,
});
const joined = (segs, kind) => segs.filter(s => s.kind === kind).map(s => s.text).join('|');

describe('diffText', () => {
  it('marks only the words that changed', () => {
    const d = diffText('we went to the sea', 'we went to the river today');
    expect(joined(d, 'del')).toBe('sea');
    expect(joined(d, 'add')).toBe('river today');
    expect(d.map(s => s.text).join('')).toContain('we went to the ');
  });

  it('shows a removed sentence as removed and a new one as added', () => {
    expect(diffText('one two', 'one')).toEqual([{ kind: 'same', text: 'one' }, { kind: 'del', text: ' two' }]);
    expect(diffText('', 'new')).toEqual([{ kind: 'add', text: 'new' }]);
    expect(diffText('old', '')).toEqual([{ kind: 'del', text: 'old' }]);
  });

  it('puts the removed words before the added ones where they replace each other', () => {
    const d = diffText('a red b', 'a blue b');
    expect(d.map(s => s.kind)).toEqual(['same', 'del', 'add', 'same']);
  });

  it('returns one unchanged segment, and nothing for two empty texts', () => {
    expect(diffText('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
    expect(diffText('', null)).toEqual([]);
  });

  it('keeps joined segments equal to the new text (without removed ones) and to the old (without added ones)', () => {
    const a = 'line one\nline two\nline three';
    const b = 'line one\nline 2\nline three\nline four';
    const d = diffText(a, b);
    expect(d.filter(s => s.kind !== 'del').map(s => s.text).join('')).toBe(b);
    expect(d.filter(s => s.kind !== 'add').map(s => s.text).join('')).toBe(a);
  });

  it('falls back to lines, then to a whole replace, on a huge text', () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_CELLS)) + 50 }, (_, i) => `w${i}`);
    const a = big.join(' ');
    const b = big.map((w, i) => (i % 2 ? `x${w}` : w)).join(' ');
    const d = diffText(a, b);
    expect(d.filter(s => s.kind !== 'del').map(s => s.text).join('')).toBe(b);
    expect(d.filter(s => s.kind !== 'add').map(s => s.text).join('')).toBe(a);
  });
});

describe('diffItems', () => {
  const list = (...rows) => ({ type: 'checklist', items: rows.map(([text, checked]) => ({ text, checked })) });

  it('finds added, removed and ticked rows', () => {
    const rows = diffItems(list(['milk', false], ['eggs', false], ['tea', true]), list(['milk', true], ['tea', true], ['jam', false]));
    expect(rows.map(r => `${r.status}:${r.text}`)).toEqual(['toggled:milk', 'removed:eggs', 'same:tea', 'added:jam']);
    expect(rows[0].checked).toBe(true);
    expect(rows[1].checked).toBe(false);
  });

  it('treats a text note as an empty list', () => {
    expect(diffItems(v(), list(['x', false]))).toEqual([{ text: 'x', checked: false, status: 'added' }]);
  });
});

describe('diffVersions', () => {
  it('highlights nothing when there is no earlier version', () => {
    const d = diffVersions(null, v(), names);
    expect(d.compared).toBe(false);
    expect(d.changes).toBe(0);
    expect(d.body).toEqual([{ kind: 'same', text: 'we went to the sea' }]);
  });

  it('diffs the title, the text and the colour, folder and date', () => {
    const d = diffVersions(v(), v({ title: 'Trip 2', note: 'we went to the lake', colorIndex: 2, folderId: 7, modifiedAt: 200 }), names);
    expect(joined(d.title, 'add')).toBe(' 2');
    expect(joined(d.body, 'del')).toBe('sea');
    expect(d.meta).toEqual([
      { label: 'Colour', from: 'None', to: 'Blue' },
      { label: 'Folder', from: 'No folder', to: 'F7' },
      { label: 'Modified date', from: 'd100', to: 'd200' },
    ]);
    expect(d.changes).toBe(countChanges(d.title) + countChanges(d.body) + 3);
  });

  it('reports no differences for equal versions', () => {
    const d = diffVersions(v(), v({ id: 'b', at: 2 }), names);
    expect(d.changes).toBe(0);
    expect(d.meta).toEqual([]);
  });

  it('diffs a checklist', () => {
    const a = v({ type: 'checklist', note: '', items: [{ text: 'milk', checked: false }] });
    const b = v({ type: 'checklist', note: '', items: [{ text: 'milk', checked: true }, { text: 'tea', checked: false }] });
    const d = diffVersions(a, b, names);
    expect(d.body).toBeNull();
    expect(d.items.map(r => r.status)).toEqual(['toggled', 'added']);
    expect(d.changes).toBe(2);
  });

  it('counts a change of type once, with the new content all new', () => {
    const d = diffVersions(v(), v({ type: 'checklist', note: '', items: [{ text: 'a', checked: false }] }), names);
    expect(d.meta).toEqual([{ label: 'Type', from: 'Text', to: 'Checklist' }]);
    expect(d.items).toEqual([{ text: 'a', checked: false, status: 'added' }]);
  });

  it('never compares or shows the content of a locked note, but still compares the rest', () => {
    const d = diffVersions(
      v({ encrypted: 1, note: 'U2FsdGVkX1+aaa' }),
      v({ encrypted: 1, note: 'U2FsdGVkX1+bbb', title: 'Trip 2', colorIndex: 1 }),
      names,
    );
    expect(d.content).toBe('locked');
    expect(d.body).toBeNull();
    expect(d.items).toBeNull();
    expect(JSON.stringify(d)).not.toContain('U2FsdGVk');
    expect(joined(d.title, 'add')).toBe(' 2');
    expect(d.meta).toEqual([{ label: 'Colour', from: 'None', to: 'Red' }]);
  });

  it('does not compare against ciphertext when the lock was taken off', () => {
    const d = diffVersions(v({ encrypted: 1, note: 'U2FsdGVkX1+aaa' }), v(), names);
    expect(d.content).toBe('was-locked');
    expect(d.body).toEqual([{ kind: 'same', text: 'we went to the sea' }]);
    expect(d.meta).toEqual([{ label: 'Lock', from: 'Locked', to: 'Not locked' }]);
  });

  it('notes a change of formatting only', () => {
    const d = diffVersions(v({ format: null }), v({ format: '[[0,3,"b"]]' }), names);
    expect(d.meta).toEqual([{ label: 'Formatting', from: null, to: null }]);
  });
});

describe('previousOf', () => {
  it('finds the version saved just before, and null for the oldest', () => {
    const list = [v({ id: 'c', at: 30 }), v({ id: 'a', at: 10 }), v({ id: 'b', at: 20 })];
    expect(previousOf(list, list[0]).id).toBe('b');
    expect(previousOf(list, list[2]).id).toBe('a');
    expect(previousOf(list, list[1])).toBeNull();
  });
});
