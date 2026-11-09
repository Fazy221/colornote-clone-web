import { describe, it, expect } from 'vitest';
import { describePending } from './pendingChanges';

describe('describePending', () => {
  const notes = new Map([
    ['a', { title: 'Shopping' }],
    ['b', { title: 'Secret', encrypted: 1 }],
  ]);

  it('names the note and the fields waiting', () => {
    const rows = describePending([{ key: 'note:a', uuid: 'a', fields: ['title', 'importance'], deleted: false }], notes);
    expect(rows).toEqual([{ key: 'note:a', kind: 'note', title: 'Shopping', what: 'Changed: title, pin' }]);
  });

  it('says whole note, deleted, and hides locked titles', () => {
    const rows = describePending([
      { key: 'note:a', uuid: 'a', fields: null, deleted: false },
      { key: 'note:b', uuid: 'b', fields: null, deleted: true },
      { key: 'note:gone', uuid: 'gone', fields: ['note'], deleted: false },
    ], notes);
    expect(rows.map(r => [r.title, r.what])).toEqual([
      ['Shopping', 'Whole note (new or copied)'],
      ['Locked note', 'Deleted'],
      ['(note no longer here)', 'Changed: text'],
    ]);
  });

  it('lists settings after notes', () => {
    const rows = describePending([
      { key: 'setting:showHiddenNotes', setting: 'showHiddenNotes' },
      { key: 'note:a', uuid: 'a', fields: ['colorIndex'], deleted: false },
    ], notes);
    expect(rows.map(r => r.kind)).toEqual(['note', 'setting']);
    expect(rows[1].title).toBe('Show hidden notes');
  });
});
