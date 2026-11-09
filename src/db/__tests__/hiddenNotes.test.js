import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  db, isHidden, hiddenPrefs, getNotesByState, getHiddenNotes, getNotesInFolder, getFolderCounts,
  getNotesByDate, searchNotes,
} from '../database';

// Invented notes only. The table is faked: there is no IndexedDB in the test run.
const n = (id, o = {}) => ({
  id, uuid: `u${id}`, title: `Note ${id}`, note: `body ${id}`, type: 'text', state: 'normal',
  importance: 0, folderId: 0, modifiedAt: 1000 + id, encrypted: 0, ...o,
});

function fakeNotes(rows) {
  const pick = (field, value) => rows.filter(r => r[field] === value);
  vi.spyOn(db.notes, 'toArray').mockImplementation(async () => rows.map(r => ({ ...r })));
  vi.spyOn(db.notes, 'where').mockImplementation((field) => ({
    equals: (value) => ({
      reverse: () => ({ sortBy: async () => pick(field, value).sort((a, b) => b.modifiedAt - a.modifiedAt) }),
      toArray: async () => pick(field, value),
    }),
    above: (min) => ({
      each: async (fn) => rows.filter(r => r[field] > min).forEach(fn),
    }),
  }));
}

afterEach(() => vi.restoreAllMocks());

describe('hidden notes', () => {
  it('counts only a set hidden field; a note that never had one is visible', () => {
    expect(isHidden(n(1))).toBe(false);
    expect(isHidden(n(1, { hidden: 0 }))).toBe(false);
    expect(isHidden(n(1, { hidden: 1 }))).toBe(true);
  });

  it('keeps hidden notes out of the lists unless the setting is on', async () => {
    fakeNotes([n(1), n(2, { hidden: 1 }), n(3, { hidden: 0 })]);
    expect((await getNotesByState('normal')).map(x => x.id).sort()).toEqual([1, 3]);
    expect((await getNotesByState('normal', { includeHidden: true })).map(x => x.id).sort()).toEqual([1, 2, 3]);
  });

  it('also keeps them out of archive, folders, folder counts and the calendar day', async () => {
    fakeNotes([
      n(1, { state: 'archived', hidden: 1 }), n(2, { state: 'archived' }),
      n(3, { folderId: 5, hidden: 1 }), n(4, { folderId: 5 }),
      n(5, { calendarDate: '2026-11-09', hidden: 1 }), n(6, { calendarDate: '2026-11-09' }),
    ]);
    expect((await getNotesByState('archived')).map(x => x.id)).toEqual([2]);
    expect((await getNotesInFolder(5)).map(x => x.id)).toEqual([4]);
    expect((await getNotesInFolder(5, { includeHidden: true })).map(x => x.id).sort()).toEqual([3, 4]);
    expect(await getFolderCounts()).toEqual({ 5: 1 });
    expect(await getFolderCounts({ includeHidden: true })).toEqual({ 5: 2 });
    expect((await getNotesByDate('2026-11-09')).map(x => x.id)).toEqual([6]);
    expect((await getNotesByDate('2026-11-09', { includeHidden: true })).map(x => x.id).sort()).toEqual([5, 6]);
  });

  it('lists hidden notes of every kind on the Hidden page, pinned first, never the trashed ones', async () => {
    fakeNotes([
      n(1, { hidden: 1 }),
      n(2, { hidden: 1, type: 'checklist' }),
      n(3, { hidden: 1, calendarDate: '2026-11-09' }),
      n(4, { hidden: 1, importance: 1, modifiedAt: 1 }),
      n(5, { hidden: 1, state: 'trash' }),
      n(6),
    ]);
    expect((await getHiddenNotes()).map(x => x.id)).toEqual([4, 3, 2, 1]);
  });

  it('search skips hidden notes unless asked to include them', async () => {
    fakeNotes([n(1, { title: 'Garden plan' }), n(2, { title: 'Garden secret', hidden: 1 })]);
    expect((await searchNotes('garden')).map(x => x.id)).toEqual([1]);
    expect((await searchNotes('garden', { includeHidden: true })).map(x => x.id).sort()).toEqual([1, 2]);
  });

  it('title-only search leaves out notes that match only in their text or list items', async () => {
    fakeNotes([
      n(1, { title: 'Garden plan' }),
      n(2, { title: 'Shopping', note: 'buy a garden hose' }),
      n(3, { title: 'Chores', type: 'checklist', items: [{ text: 'water the garden', checked: false }] }),
    ]);
    expect((await searchNotes('garden')).map(x => x.id).sort()).toEqual([1, 2, 3]);
    expect((await searchNotes('garden', { titleOnly: true })).map(x => x.id)).toEqual([1]);
  });

  it('reads both switches as off until turned on, from a boolean or the text "true"', async () => {
    const store = {};
    vi.spyOn(db.settings, 'get').mockImplementation(async (k) => (k in store ? { key: k, value: store[k] } : undefined));
    expect(await hiddenPrefs()).toEqual({ showHidden: false, searchHidden: false });
    store.showHiddenNotes = true;
    store.searchHiddenNotes = 'true';
    expect(await hiddenPrefs()).toEqual({ showHidden: true, searchHidden: true });
    store.showHiddenNotes = 'false';
    store.searchHiddenNotes = false;
    expect(await hiddenPrefs()).toEqual({ showHidden: false, searchHidden: false });
  });
});
