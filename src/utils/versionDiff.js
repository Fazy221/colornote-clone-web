// What changed between two versions of a note, for the read-only preview. The phone does the same
// (VersionDiff.kt), so the two screens highlight the same words: change one, change the other
// (CLAUDE.md, "Both apps").
//
// diffVersions(from, to) says what it took to get from `from` to `to`:
//   added   = in `to` only      removed = in `from` only
// The preview uses it two ways: from = the version before, to = this version ("what this edit
// changed"), and from = the note now, to = this version ("what Restore would change").
//
// Locked notes keep ciphertext in their versions, so their content is never compared or shown; the
// title, colour, folder and date still are.

import { sameValue } from './noteFields';

// Longest tables we are willing to build. Past it the diff falls back to whole lines, then to
// "everything removed, everything added", so a huge note can never freeze the screen.
export const MAX_CELLS = 4_000_000;

const isLocked = (v) => v?.encrypted === 1 || v?.encrypted === true;

// Edit script between two arrays of strings: [{ kind: 'same'|'add'|'del', i, j }] (i into a, j into b),
// with the deletions of a changed stretch before its additions. null when the middle is too big.
function diffOps(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }

  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  const ops = [];
  for (let k = 0; k < start; k += 1) ops.push({ kind: 'same', i: k, j: k });

  // lcs[x][y] = length of the longest common run of a[start+x..] and b[start+y..].
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let x = n - 1; x >= 0; x -= 1) {
    for (let y = m - 1; y >= 0; y -= 1) {
      lcs[x * w + y] = a[start + x] === b[start + y]
        ? lcs[(x + 1) * w + y + 1] + 1
        : Math.max(lcs[(x + 1) * w + y], lcs[x * w + y + 1]);
    }
  }
  let x = 0;
  let y = 0;
  let dels = [];
  let adds = [];
  const flush = () => { ops.push(...dels, ...adds); dels = []; adds = []; };
  while (x < n || y < m) {
    if (x < n && y < m && a[start + x] === b[start + y]) {
      flush();
      ops.push({ kind: 'same', i: start + x, j: start + y });
      x += 1; y += 1;
    } else if (y >= m || (x < n && lcs[(x + 1) * w + y] >= lcs[x * w + y + 1])) {
      dels.push({ kind: 'del', i: start + x, j: -1 });
      x += 1;
    } else {
      adds.push({ kind: 'add', i: -1, j: start + y });
      y += 1;
    }
  }
  flush();

  for (let k = 0; k < a.length - endA; k += 1) ops.push({ kind: 'same', i: endA + k, j: endB + k });
  return ops;
}

const words = (s) => s.match(/\s+|\S+/g) || [];
const lines = (s) => s.match(/[^\n]*\n|[^\n]+/g) || [];

// Joins neighbours of the same kind: [{ kind, text }].
function toSegments(ops, aTokens, bTokens) {
  const out = [];
  for (const op of ops) {
    const text = op.kind === 'add' ? bTokens[op.j] : aTokens[op.i];
    const last = out[out.length - 1];
    if (last && last.kind === op.kind) last.text += text;
    else out.push({ kind: op.kind, text });
  }
  return out;
}

// Word-level segments from `from` to `to`. Whitespace is compared too, but a change that is only
// whitespace still shows (as an empty-looking add or remove), so the count of changes stays honest.
export function diffText(from, to) {
  const a = from || '';
  const b = to || '';
  if (a === b) return b ? [{ kind: 'same', text: b }] : [];
  for (const split of [words, lines]) {
    const at = split(a);
    const bt = split(b);
    const ops = diffOps(at, bt);
    if (ops) return toSegments(ops, at, bt);
  }
  return [...(a ? [{ kind: 'del', text: a }] : []), ...(b ? [{ kind: 'add', text: b }] : [])];
}

const asItems = (v) => (v?.type === 'checklist' && Array.isArray(v.items) ? v.items : []);

// Checklist rows from `from` to `to`, in order: { text, checked, status }, where status is
// 'same', 'added', 'removed', or 'toggled' (same text, ticked or unticked since). `checked` is the
// state in `to` (in `from` for a removed row).
export function diffItems(from, to) {
  const a = asItems(from);
  const b = asItems(to);
  const at = a.map(i => i.text || '');
  const bt = b.map(i => i.text || '');
  const ops = diffOps(at, bt);
  if (!ops) {
    return [
      ...a.map(i => ({ text: i.text || '', checked: !!i.checked, status: 'removed' })),
      ...b.map(i => ({ text: i.text || '', checked: !!i.checked, status: 'added' })),
    ];
  }
  return ops.map(op => {
    if (op.kind === 'del') return { text: at[op.i], checked: !!a[op.i].checked, status: 'removed' };
    if (op.kind === 'add') return { text: bt[op.j], checked: !!b[op.j].checked, status: 'added' };
    const was = !!a[op.i].checked;
    const now = !!b[op.j].checked;
    return { text: bt[op.j], checked: now, status: was === now ? 'same' : 'toggled' };
  });
}

// How many separate changes a list of segments or rows holds (a run of added words is one).
export const countChanges = (parts) => (parts || []).filter(p => (p.kind ?? p.status) !== 'same').length;

// Everything the preview shows for `to`, set against `from`.
//   names: { color(index), folder(id), date(ms) } turn raw values into the words shown
//   from:  null when there is nothing to compare with (the first version): nothing is highlighted
// Returns {
//   title:   segments,
//   body:    segments for a text note, else null,
//   items:   rows for a checklist, else null,
//   meta:    [{ label, from, to }] colour, folder, date, type and lock changes (from/to null: "changed"),
//   content: 'shown' | 'locked' (to is locked, no content) | 'was-locked' (from was locked: not compared),
//   compared: whether there was a `from`,
//   changes: number of separate changes,
// }
export function diffVersions(from, to, names) {
  const locked = isLocked(to);
  const fromLocked = isLocked(from);
  const base = from || null;
  const plain = (text) => (text ? [{ kind: 'same', text }] : []);

  const title = base ? diffText(base.title, to.title) : plain(to.title);

  let content = 'shown';
  if (locked) content = 'locked';
  else if (fromLocked) content = 'was-locked';
  const compareContent = !!base && content === 'shown';

  // A change of type compares against nothing: the old kind of content has no words in common.
  const sameType = !base || base.type === to.type;
  const src = compareContent && sameType ? base : null;
  let body = null;
  let items = null;
  if (content !== 'locked') {
    if (to.type === 'checklist') {
      items = compareContent
        ? diffItems(src, to)
        : asItems(to).map(i => ({ text: i.text || '', checked: !!i.checked, status: 'same' }));
    } else {
      body = compareContent ? diffText(src?.note, to.note) : plain(to.note);
    }
  }

  const meta = [];
  if (base) {
    if (!sameValue(base.type, to.type)) meta.push({ label: 'Type', from: base.type === 'checklist' ? 'Checklist' : 'Text', to: to.type === 'checklist' ? 'Checklist' : 'Text' });
    if (!sameValue(base.encrypted, to.encrypted)) meta.push({ label: 'Lock', from: fromLocked ? 'Locked' : 'Not locked', to: locked ? 'Locked' : 'Not locked' });
    if (!sameValue(base.colorIndex, to.colorIndex)) meta.push({ label: 'Colour', from: names.color(base.colorIndex), to: names.color(to.colorIndex) });
    if (!sameValue(base.folderId, to.folderId)) meta.push({ label: 'Folder', from: names.folder(base.folderId), to: names.folder(to.folderId) });
    if (!sameValue(base.modifiedAt, to.modifiedAt)) meta.push({ label: 'Modified date', from: names.date(base.modifiedAt), to: names.date(to.modifiedAt) });
    if (!sameValue(base.format, to.format) && content === 'shown') meta.push({ label: 'Formatting', from: null, to: null });
  }

  const changes = countChanges(title) + countChanges(body) + countChanges(items) + meta.length;
  return { title, body, items, meta, content, compared: !!base, changes };
}
