// "[conflict]" copies: what they are paired with, how two versions differ, and what each choice on
// the review screen changes. Pure functions, no database.
//
// A copy is made when the text of a note was edited on two devices before they synced (here, on
// the phone, or by importing a backup). Copies made by this app name their note in `conflictOf`.
// The phone's copies don't (yet), so those are paired by title: the copy's title is "[conflict] "
// plus the note's title, and it keeps the note's creation date.

import { CONTENT_FIELDS, pick } from './noteFields';

export const CONFLICT_PREFIX = '[conflict] ';

export const isConflictCopy = (note) => typeof note?.title === 'string' && note.title.startsWith(CONFLICT_PREFIX);

// The title without one "[conflict] " in front.
export const stripPrefix = (title) => (
  typeof title === 'string' && title.startsWith(CONFLICT_PREFIX) ? title.slice(CONFLICT_PREFIX.length) : (title || '')
);

const closeness = (copy) => (n) => [
  n.createdAt === copy.createdAt ? 0 : 1,
  n.type === copy.type ? 0 : 1,
  Math.abs((n.modifiedAt || 0) - (copy.modifiedAt || 0)),
];
const byCloseness = (key) => (a, b) => {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
};

// Every copy not in the trash, with the note it was made from:
//   { copy, original, matchedBy }
//   original:  the note, or null when it can't be found (deleted, or renamed since)
//   matchedBy: 'link' (the copy names it), 'title' (one note has that title), or 'guess' (several
//              do, and the closest was picked)
// Newest copies first.
export function pairConflicts(notes) {
  const byUuid = new Map();
  const byTitle = new Map();
  const copies = [];
  for (const n of notes) {
    if (n.uuid) byUuid.set(n.uuid, n);
    if (n.state === 'trash') continue;
    if (isConflictCopy(n)) { copies.push(n); continue; }
    const t = n.title || '';
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(n);
  }

  return copies
    .map((copy) => {
      if (copy.conflictOf) {
        const linked = byUuid.get(copy.conflictOf);
        const original = linked && linked.state !== 'trash' && linked.uuid !== copy.uuid ? linked : null;
        return { copy, original, matchedBy: original ? 'link' : null };
      }
      const candidates = byTitle.get(stripPrefix(copy.title)) || [];
      if (!candidates.length) return { copy, original: null, matchedBy: null };
      const best = [...candidates].sort(byCloseness(closeness(copy)))[0];
      return { copy, original: best, matchedBy: candidates.length === 1 ? 'title' : 'guess' };
    })
    .sort((a, b) => (b.copy.modifiedAt || 0) - (a.copy.modifiedAt || 0));
}

// The note's text as lines to compare; a checklist becomes "[V] done" / "[ ] to do" lines.
// null for a locked note, whose text is not shown here.
export function noteText(note) {
  if (!note || note.encrypted === 1 || note.encrypted === true) return null;
  if (note.type === 'checklist') {
    return (note.items || []).map(i => `${i.checked ? '[V]' : '[ ]'} ${i.text || ''}`).join('\n');
  }
  return note.note || '';
}

const splitLines = (text) => (text === '' ? [] : text.split('\n'));

// Above this many line pairs the middle part is shown as all removed then all added, which is
// still correct, only less precise.
const MAX_CELLS = 4_000_000;

// The lines of `a` and `b` as one list: { kind: 'same' | 'removed' | 'added', text }. "removed":
// only in a; "added": only in b. Longest common subsequence, after setting aside the lines both
// start and end with.
export function diffLines(a, b) {
  const x = splitLines(a);
  const y = splitLines(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) { endX--; endY--; }

  const head = x.slice(0, start).map(text => ({ kind: 'same', text }));
  const tail = x.slice(endX).map(text => ({ kind: 'same', text }));
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  const n = mx.length;
  const m = my.length;

  let middle;
  if (!n || !m || n * m > MAX_CELLS) {
    middle = [...mx.map(text => ({ kind: 'removed', text })), ...my.map(text => ({ kind: 'added', text }))];
  } else {
    // lcs[i][j]: the longest common run of mx[i..] and my[j..].
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = mx[i] === my[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (mx[i] === my[j]) { middle.push({ kind: 'same', text: mx[i] }); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { middle.push({ kind: 'removed', text: mx[i] }); i++; }
      else { middle.push({ kind: 'added', text: my[j] }); j++; }
    }
    while (i < n) middle.push({ kind: 'removed', text: mx[i++] });
    while (j < m) middle.push({ kind: 'added', text: my[j++] });
  }
  return [...head, ...middle, ...tail];
}

// The same diff as rows of two columns, for side by side: { left, right }, each { kind, text } or
// null for an empty cell. Lines only on one side are paired up row by row where they sit together.
export function sideBySide(diff) {
  const rows = [];
  let removed = [];
  let added = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push({ left: removed[k] || null, right: added[k] || null });
    }
    removed = [];
    added = [];
  };
  for (const line of diff) {
    if (line.kind === 'removed') removed.push(line);
    else if (line.kind === 'added') added.push(line);
    else { flush(); rows.push({ left: line, right: line }); }
  }
  flush();
  return rows;
}

// What a choice changes: { updates: [{ id, changes }], trash: [id] }, applied in that order.
//   'note': keep the note as it is; the copy goes to the Trash.
//   'copy': the note takes the copy's version; its own version moves into the copy, which goes to
//           the Trash. Either way the version not kept is in the Trash, and can be restored.
//   'both': keep both; the copy loses its "[conflict]" title and becomes an ordinary note.
// With no note to pair with, 'note' puts the copy in the Trash and 'copy' and 'both' keep it as an
// ordinary note.
export function planResolution(original, copy, choice) {
  const release = { id: copy.id, changes: { title: stripPrefix(copy.title), conflictOf: null } };
  if (choice === 'both' || (choice === 'copy' && !original)) return { updates: [release], trash: [] };
  if (choice === 'note') return { updates: [], trash: [copy.id] };
  if (choice !== 'copy') throw new Error(`Unknown choice: ${choice}`);
  return {
    updates: [
      { id: original.id, changes: { ...pick(copy, CONTENT_FIELDS), title: stripPrefix(copy.title) } },
      { id: copy.id, changes: { ...pick(original, CONTENT_FIELDS), title: CONFLICT_PREFIX + (original.title || '') } },
    ],
    trash: [copy.id],
  };
}
