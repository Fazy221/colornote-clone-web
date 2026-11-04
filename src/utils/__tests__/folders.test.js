import { describe, it, expect } from 'vitest';
import { parseFolders, nextFolderId, sortFolders, folderIconIndex, FIRST_FOLDER_ID } from '../folders';

describe('parseFolders', () => {
  it('reads the list the Android app writes', () => {
    expect(parseFolders([{ id: 1000, name: 'Sample work', color: 4, icon: 4 }]))
      .toEqual([{ id: 1000, name: 'Sample work', color: 4, icon: 4 }]);
  });

  it('reads a JSON string of the list', () => {
    expect(parseFolders('[{"id":1001,"name":"Sample home","color":6,"icon":3}]')).toHaveLength(1);
  });

  it('drops entries without an id or name and clamps bad colours and icons', () => {
    const folders = parseFolders([
      null, 'x', { id: 'abc', name: 'No id' }, { id: 1002 },
      { id: 1003, name: 'Odd', color: 42, icon: -3 },
    ]);
    expect(folders).toEqual([{ id: 1003, name: 'Odd', color: 0, icon: 0 }]);
  });

  it('gives an empty list for anything else', () => {
    expect(parseFolders(null)).toEqual([]);
    expect(parseFolders('not json')).toEqual([]);
    expect(parseFolders({ id: 1 })).toEqual([]);
  });
});

describe('nextFolderId', () => {
  it('starts at 1000, clear of the real app ids, and goes on from the highest', () => {
    expect(nextFolderId([])).toBe(FIRST_FOLDER_ID);
    expect(nextFolderId([{ id: 16 }, { id: 256 }])).toBe(FIRST_FOLDER_ID);
    expect(nextFolderId([{ id: 1000 }, { id: 1004 }])).toBe(1005);
  });
});

describe('sortFolders', () => {
  const folders = [
    { id: 1, name: 'beta', color: 0 },
    { id: 2, name: 'Alpha', color: 5 },
    { id: 3, name: 'gamma', color: 2 },
  ];
  it('by colour follows the colour squares with no colour last', () => {
    expect(sortFolders(folders, {}, 'color').map(f => f.id)).toEqual([3, 2, 1]);
  });
  it('alphabetically ignores case', () => {
    expect(sortFolders(folders, {}, 'alpha').map(f => f.id)).toEqual([2, 1, 3]);
  });
  it('by count puts the fullest first, then by name', () => {
    expect(sortFolders(folders, { 1: 3, 3: 3, 2: 1 }, 'count').map(f => f.id)).toEqual([1, 3, 2]);
  });
});

describe('folderIconIndex', () => {
  it('stays inside the nine icons', () => {
    expect(folderIconIndex(-1)).toBe(0);
    expect(folderIconIndex(4)).toBe(4);
    expect(folderIconIndex(99)).toBe(8);
  });
});
