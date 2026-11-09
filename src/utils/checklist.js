// Checklist rows, with one level of sub-items. The list stays flat: [{ text, checked, level? }], and a
// row with level 1 belongs to the nearest level-0 row above it. A level-0 row has no `level` key at
// all, so lists made before sub-items existed are stored exactly as they were (and compare equal).
// The same rules as the Android app (ui/Logic.kt).

export const blankRow = (level = 0) => (level ? { text: '', checked: false, level: 1 } : { text: '', checked: false });

export const levelOf = (row) => (row?.level === 1 ? 1 : 0);

// A row with its level written the one way it is stored: 1, or no key.
function withLevel(row, level) {
  const { level: _drop, ...rest } = row;
  return level ? { ...rest, level: 1 } : rest;
}

// Locked notes keep the list as text, one row a line, sub-items indented by two spaces.
export function serializeItems(items) {
  return (items || [])
    .map(i => `${levelOf(i) ? '  ' : ''}${i.checked ? '[V]' : '[ ]'} ${i.text}`)
    .join('\n');
}

export function parseChecklistStr(str) {
  const lines = (str || '').split('\n').filter(l => l.trim());
  if (!lines.length) return [blankRow()];
  const rows = lines.map(line => {
    const child = line.startsWith('  ');
    const body = child ? line.slice(2) : line;
    let row;
    if (body.startsWith('[V] ')) row = { text: body.slice(4), checked: true };
    else if (body.startsWith('[ ] ')) row = { text: body.slice(4), checked: false };
    else row = { text: line, checked: false };
    return withLevel(row, child && row.text !== line ? 1 : 0);
  });
  return fixLevels(rows);
}

// No row deeper than 1, and a sub-item never first (it would have no parent).
export function fixLevels(rows) {
  let hasParent = false;
  return (rows || []).map(r => {
    const lvl = levelOf(r) && hasParent ? 1 : 0;
    if (!lvl) hasParent = true;
    return withLevel(r, lvl);
  });
}

// A row with nothing in it is never stored. Sub-items of an emptied parent become ordinary rows.
export function cleanItems(list) {
  const out = [];
  let parentKept = false;
  for (const r of list || []) {
    const lvl = levelOf(r);
    if (!lvl) parentKept = r.text.trim() !== '';
    if (!r.text.trim()) continue;
    out.push(withLevel(r, lvl && parentKept ? 1 : 0));
  }
  return fixLevels(out);
}

// Index of the last row that belongs to the parent at `idx` (idx itself when it has no sub-items).
export function blockEnd(items, idx) {
  let end = idx;
  while (end + 1 < items.length && levelOf(items[end + 1]) === 1) end++;
  return end;
}

// The parent a row belongs to (itself for a parent).
export function parentIndex(items, idx) {
  let i = idx;
  while (i > 0 && levelOf(items[i]) === 1) i--;
  return i;
}

// A new row after row `idx`: a sub-item when Enter is pressed inside a sub-item, else a new parent
// placed after the sub-items of the row. Returns { items, focus }.
export function insertAfter(items, idx) {
  if (levelOf(items[idx]) === 1) {
    return { items: [...items.slice(0, idx + 1), blankRow(1), ...items.slice(idx + 1)], focus: idx + 1 };
  }
  const at = blockEnd(items, idx) + 1;
  return { items: [...items.slice(0, at), blankRow(), ...items.slice(at)], focus: at };
}

// A new sub-item at the end of the parent's sub-items.
export function addChild(items, parentIdx) {
  const p = parentIndex(items, parentIdx);
  const at = blockEnd(items, p) + 1;
  return { items: [...items.slice(0, at), blankRow(1), ...items.slice(at)], focus: at };
}

// A new parent at the very end of the list.
export function addParentAtEnd(items) {
  return { items: [...items, blankRow()], focus: items.length };
}

// Removes the row; a parent takes its sub-items with it. The last remaining row is cleared instead.
export function removeRow(items, idx) {
  const end = levelOf(items[idx]) === 0 ? blockEnd(items, idx) : idx;
  const left = [...items.slice(0, idx), ...items.slice(end + 1)];
  if (!left.length) return { items: [blankRow()], focus: 0 };
  return { items: left, focus: Math.max(0, idx - 1) };
}
