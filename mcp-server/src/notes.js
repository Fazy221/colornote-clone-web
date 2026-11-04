// What the tools return: Firestore documents turned into plain notes, filtered, searched and counted.
// Pure functions with no Firestore in them, so the tests can feed them invented notes.
//
// Rules shared with the apps (CLAUDE.md, "Both apps"): a locked note has `encrypted: 1`, its text is
// ciphertext (text notes in `note`, checklists in items[0].text), titles are plain; state is
// normal / archived / trash; importance 1 is pinned; folderId 0 is "no folder".

import { decryptNoteContent, getNoteCiphertext } from './crypto.js';

export const DEFAULT_COLOR_NAMES = [
  '', 'Dreams, Love', 'Dates Related', 'To Do', 'Thoughts', 'Life', 'Review', 'Stories', 'Editing Tips', 'To Download List',
];

const COLOUR_LABELS = ['None', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Dark', 'Gray', 'Light'];

// A Firestore number, Timestamp or ISO string as epoch milliseconds (0 when absent).
export function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

const pad = (n) => String(n).padStart(2, '0');

// Local calendar day, YYYY-MM-DD (the same day the apps show).
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

function parseChecklist(text) {
  return text.split('\n').filter((l) => l.trim()).map((line) => {
    if (line.startsWith('[V] ')) return { text: line.slice(4), checked: true };
    if (line.startsWith('[ ] ')) return { text: line.slice(4), checked: false };
    return { text: line, checked: false };
  });
}

const renderChecklist = (items) => items.map((i) => `${i.checked ? '[x]' : '[ ]'} ${i.text}`).join('\n');

// The readable content of a note or version: { text, items, decryptError }.
export function readContent(note) {
  const locked = note.encrypted === 1 || note.encrypted === true;
  const isChecklist = note.type === 'checklist';
  if (!locked) {
    if (isChecklist) {
      const items = (note.items ?? []).map((i) => ({ text: String(i?.text ?? ''), checked: !!i?.checked }));
      return { text: renderChecklist(items), items };
    }
    return { text: String(note.note ?? ''), items: null };
  }
  const ct = getNoteCiphertext(note);
  if (!ct) return { text: '', items: isChecklist ? [] : null };
  try {
    const plain = decryptNoteContent(ct);
    if (isChecklist) {
      const items = parseChecklist(plain);
      return { text: renderChecklist(items), items };
    }
    return { text: plain, items: null };
  } catch {
    return { text: '', items: null, decryptError: 'Could not decrypt (corrupt data?)' };
  }
}

// ctx: { folders: [{id, name, color, icon}], colorNames: string[] }
export function toNote(uuid, data, ctx = {}) {
  const folders = ctx.folders ?? [];
  const names = Array.isArray(ctx.colorNames) && ctx.colorNames.length === 10 ? ctx.colorNames : DEFAULT_COLOR_NAMES;
  const colorIndex = Number.isInteger(data.colorIndex) ? data.colorIndex : 0;
  const folderId = Number(data.folderId ?? 0);
  const folder = folderId ? folders.find((f) => f.id === folderId) : null;
  const content = readContent(data);
  const createdAt = toMillis(data.createdAt);
  const modifiedAt = toMillis(data.modifiedAt);
  return {
    uuid,
    title: String(data.title ?? ''),
    type: data.type === 'checklist' ? 'checklist' : 'text',
    state: data.state ?? 'normal',
    locked: data.encrypted === 1 || data.encrypted === true,
    pinned: data.importance === 1,
    color: { index: colorIndex, label: COLOUR_LABELS[colorIndex] ?? String(colorIndex), name: names[colorIndex] || null },
    folder: folderId ? { id: folderId, name: folder?.name ?? null } : null,
    createdAt: iso(createdAt),
    createdDate: createdAt ? dayOf(createdAt) : null,
    modifiedAt: iso(modifiedAt),
    modifiedDate: modifiedAt ? dayOf(modifiedAt) : null,
    calendarDate: data.calendarDate ?? null,
    reminder: data.reminderTime ? { time: iso(toMillis(data.reminderTime)), type: data.reminderType ?? 0, repeat: data.reminderRepeat ?? 0 } : null,
    text: content.text,
    items: content.items,
    decryptError: content.decryptError ?? null,
    _created: createdAt,
    _modified: modifiedAt,
  };
}

const clip = (s, max) => (s.length > max ? s.slice(0, max) + '…' : s);

// A note without its full text: for lists.
export function summarise(note, previewLength = 160) {
  const { text, items, _created, _modified, ...rest } = note;
  return { ...rest, preview: clip(text.replace(/\s+/g, ' ').trim(), previewLength), length: text.length };
}

// The full note: what the owner would read in the editor.
export function fullNote(note) {
  const { _created, _modified, ...rest } = note;
  return rest;
}

// Filters: state ('normal' by default, 'any' for all), type, colorIndex, folderId, folder (name), locked, pinned,
// calendarDate, modifiedFrom/modifiedTo/createdFrom/createdTo (YYYY-MM-DD, inclusive, local days),
// sort ('modified' | 'created' | 'title'), order ('desc' | 'asc'), limit, offset.
export function filterNotes(notes, f = {}) {
  const list = selectNotes(notes, f);
  const offset = Math.max(0, f.offset ?? 0);
  const limit = Math.min(Math.max(1, f.limit ?? 50), 200);
  return { total: list.length, offset, limit, notes: list.slice(offset, offset + limit) };
}

// The filtered and sorted notes, not paged.
export function selectNotes(notes, f = {}) {
  const state = f.state ?? 'normal';
  const inRange = (ms, from, to) => {
    if (!from && !to) return true;
    if (!ms) return false;
    const day = dayOf(ms);
    return (!from || day >= from) && (!to || day <= to);
  };
  const folderName = f.folder?.toLowerCase();
  let list = notes.filter((n) =>
    (state === 'any' || n.state === state) &&
    (f.type == null || n.type === f.type) &&
    (f.colorIndex == null || n.color.index === f.colorIndex) &&
    (f.folderId == null || (n.folder?.id ?? 0) === f.folderId) &&
    (folderName == null || (n.folder?.name ?? '').toLowerCase() === folderName) &&
    (f.locked == null || n.locked === f.locked) &&
    (f.pinned == null || n.pinned === f.pinned) &&
    (f.calendarDate == null || n.calendarDate === f.calendarDate) &&
    inRange(n._modified, f.modifiedFrom, f.modifiedTo) &&
    inRange(n._created, f.createdFrom, f.createdTo));

  const dir = f.order === 'asc' ? 1 : -1;
  const sort = f.sort ?? 'modified';
  return list.sort((a, b) => {
    const diff = sort === 'title' ? a.title.localeCompare(b.title)
      : sort === 'created' ? a._created - b._created
        : a._modified - b._modified;
    return diff * dir || a.uuid.localeCompare(b.uuid);
  });
}

// Every word of the query must appear in the title or the text (case-insensitive). Locked notes are searched
// by their decrypted text, in memory only.
export function searchNotes(notes, query, f = {}) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { total: 0, offset: 0, limit: 0, results: [] };
  const hits = selectNotes(notes, { ...f, sort: 'modified', order: 'desc' }).filter((n) => {
    const hay = `${n.title}\n${n.text}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const offset = Math.max(0, f.offset ?? 0);
  const limit = Math.min(Math.max(1, f.limit ?? 20), 100);
  const results = hits.slice(offset, offset + limit).map((n) => {
    const { preview, ...rest } = summarise(n, 0);
    return { ...rest, snippets: snippetsOf(n, terms) };
  });
  return { total: hits.length, offset, limit, results };
}

function snippetsOf(note, terms, max = 3, radius = 70) {
  const out = [];
  const lower = note.text.toLowerCase();
  let from = 0;
  while (out.length < max) {
    let at = -1;
    for (const t of terms) {
      const i = lower.indexOf(t, from);
      if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    if (at === -1) break;
    const start = Math.max(0, at - radius);
    const end = Math.min(note.text.length, at + radius);
    out.push((start > 0 ? '…' : '') + note.text.slice(start, end).replace(/\s+/g, ' ') + (end < note.text.length ? '…' : ''));
    from = end;
  }
  if (!out.length && terms.some((t) => note.title.toLowerCase().includes(t))) out.push('(match in the title)');
  return out;
}

// Counts of notes by state, type, colour, folder, year and lock.
export function noteStats(notes) {
  const live = notes.filter((n) => n.state === 'normal');
  const colourKey = (n) => `${n.color.index} ${n.color.label}${n.color.name ? ` (${n.color.name})` : ''}`;
  const created = notes.map((n) => n._created).filter(Boolean);
  return {
    total: notes.length,
    byState: countBy(notes, (n) => n.state),
    normalNotes: {
      count: live.length,
      byType: countBy(live, (n) => n.type),
      locked: live.filter((n) => n.locked).length,
      pinned: live.filter((n) => n.pinned).length,
      byColour: countBy(live, colourKey),
      byFolder: countBy(live, (n) => (n.folder ? `${n.folder.id} ${n.folder.name ?? '(unknown folder)'}` : 'no folder')),
      byYearModified: countBy(live, (n) => (n._modified ? dayOf(n._modified).slice(0, 4) : 'unknown')),
    },
    oldestCreated: created.length ? iso(Math.min(...created)) : null,
    newestModified: iso(Math.max(0, ...notes.map((n) => n._modified))),
  };
}

function countBy(list, pick) {
  const counts = {};
  for (const n of list) {
    const k = pick(n);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

// A version document as a plain object, with locked text decrypted like a note's.
export function toVersion(id, data, ctx = {}) {
  const note = toNote('', data, ctx);
  const at = toMillis(data.at);
  return {
    id,
    at: iso(at),
    day: at ? dayOf(at) : null,
    kind: data.kind ?? 'edit',
    device: data.device ?? 'web',
    changed: Array.isArray(data.changed) ? data.changed : [],
    title: note.title,
    type: note.type,
    locked: note.locked,
    color: note.color,
    folder: note.folder,
    modifiedAt: note.modifiedAt,
    text: note.text,
    items: note.items,
    decryptError: note.decryptError,
    _at: at,
  };
}

// Newest first, grouped by local day (newest day first), the way the apps show them.
export function groupVersions(versions) {
  const sorted = [...versions].sort((a, b) => b._at - a._at);
  const days = new Map();
  for (const v of sorted) {
    const { _at, ...rest } = v;
    const key = v.day ?? 'unknown';
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(rest);
  }
  return [...days.entries()].map(([day, list]) => ({ day, count: list.length, versions: list }));
}
