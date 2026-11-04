// Folders — shared with the Android app through the "folders" setting
// (users/{uid}/meta/appSettings) and each note's `folderId`.
//
// The setting is a list of { id, name, color, icon }:
//   id    number; 0 means "no folder". The Android app hands out ids from 1000
//         up, clear of the ids the original ColorNote used (0, 16 and 256).
//   color a note colour index 0-9 (0 = none)
//   icon  an index into FOLDER_ICON_COUNT icons (see FolderGlyph)
// Keep this shape identical on both sides: either app rewrites the whole list.

export const FIRST_FOLDER_ID = 1000;
export const FOLDER_ICON_COUNT = 9;
export const FOLDER_SORTS = {
  color: 'by color',
  alpha: 'alphabetically',
  count: 'by number of notes',
};

// Accepts the stored list, or a JSON string of one; anything malformed is dropped.
export function parseFolders(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const folders = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const id = Number(entry.id);
    if (!Number.isFinite(id) || typeof entry.name !== 'string') continue;
    const color = Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 9 ? entry.color : 0;
    const icon = Number.isInteger(entry.icon) && entry.icon >= 0 ? entry.icon : 0;
    folders.push({ id, name: entry.name, color, icon });
  }
  return folders;
}

export function nextFolderId(folders) {
  return Math.max(FIRST_FOLDER_ID - 1, ...folders.map(f => f.id)) + 1;
}

// By colour the folders go in the order of the colour squares, the ones with none last.
export function sortFolders(folders, counts, sort) {
  const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const list = [...folders];
  if (sort === 'alpha') return list.sort(byName);
  if (sort === 'count') return list.sort((a, b) => ((counts[b.id] || 0) - (counts[a.id] || 0)) || byName(a, b));
  const rank = f => (f.color === 0 ? 10 : f.color);
  return list.sort((a, b) => (rank(a) - rank(b)) || byName(a, b));
}

export function folderIconIndex(index) {
  return Math.min(Math.max(Number(index) || 0, 0), FOLDER_ICON_COUNT - 1);
}
