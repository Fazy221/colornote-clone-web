// Version history of a note: the rules, with no database in them. The Android app follows the same
// rules (NoteVersions.kt), because both write to the same cloud collection,
//   users/{uid}/notes/{noteUuid}/versions/{versionId}
//
// A version is the note as it stood after one edit (or a run of edits close together), plus what that
// edit changed. Locked notes are kept as they are stored, ciphertext included.

import { CONTENT_FIELDS, sameValue } from './noteFields';

// What a version remembers. Pin, state, calendar date and reminders are not edits to the note's
// writing, so they are not kept (and never bump the date either).
export const VERSION_FIELDS = [...CONTENT_FIELDS, 'colorIndex', 'folderId', 'modifiedAt'];

// Edits made on the same device within this long of the last one join that version, so typing for a
// minute does not leave a hundred of them.
export const COALESCE_MS = 5 * 60 * 1000;

// The oldest versions beyond this go.
export const MAX_VERSIONS = 200;

export const DEVICE = 'web';

// The plain values of a note that a version keeps; a missing field is null (Firestore refuses undefined).
export function snapshotOf(note) {
  return Object.fromEntries(VERSION_FIELDS.map(f => [f, note?.[f] === undefined ? null : note[f]]));
}

// Which kept fields differ between two notes or versions.
export function changedFields(before, after) {
  return VERSION_FIELDS.filter(f => !sameValue(before?.[f], after?.[f]));
}

const hasText = (n) => !!((n?.title || '').trim() || (n?.note || '').trim() || (n?.items || []).length);

// What to do when `after` was saved over `before`.
//   history: the note's versions, newest first
//   Returns null when nothing worth keeping changed, else
//   { baseline: snapshot | null, replace: version | null, entry: {...} }
//     baseline: the note as it was, to keep first because it has no history yet (nothing for a
//               note that was still empty)
//     replace:  the version to overwrite, when this edit joins it
//     entry:    the fields of the version to write
export function planVersion({ before, after, history, now, kind = 'edit', device = DEVICE }) {
  const changed = changedFields(before, after);
  if (!changed.length) return null;
  const last = history[0] || null;
  const baseline = !last && before && hasText(before) ? snapshotOf(before) : null;

  const joins = kind === 'edit' && last && last.kind === 'edit' && last.device === device
    && now - last.at <= COALESCE_MS;
  if (joins) {
    // One version for the run: everything it changed since the version before it.
    const previous = history[1] || null;
    const since = previous ? changedFields(previous, after) : [...new Set([...last.changed, ...changed])];
    return { baseline, replace: last, entry: { ...snapshotOf(after), at: now, kind, device, changed: since.length ? since : changed } };
  }
  return { baseline, replace: null, entry: { ...snapshotOf(after), at: now, kind, device, changed } };
}

// The "baseline" entry for a note's first history: sits just before its first real edit.
export function baselineEntry(snapshot, firstAt) {
  return { ...snapshot, at: Math.min(snapshot.modifiedAt || firstAt, firstAt) - 1, kind: 'baseline', device: DEVICE, changed: [] };
}

// Newest first, then in days (by the local calendar, newest day first).
// Returns [{ day: 'YYYY-MM-DD', versions: [...] }]
export function groupByDay(versions) {
  const days = new Map();
  for (const v of [...versions].sort((a, b) => b.at - a.at)) {
    const d = new Date(v.at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(v);
  }
  return [...days].map(([day, list]) => ({ day, versions: list }));
}

const LABELS = {
  title: 'Title', note: 'Text', items: 'Checklist', type: 'Type', encrypted: 'Lock', format: 'Formatting',
  colorIndex: 'Colour', folderId: 'Folder', modifiedAt: 'Date',
};

// Short names for what a version changed, in a fixed order, text and checklist counted once.
export function changeLabels(version) {
  if (version.kind === 'baseline') return ['Original'];
  if (version.kind === 'restore') return ['Restored'];
  const seen = [];
  for (const f of version.changed || []) {
    const label = LABELS[f];
    if (label && !seen.includes(label)) seen.push(label);
  }
  return seen.length ? seen : ['Edited'];
}

// The line shown under a version; empty for a locked note so ciphertext is never displayed.
export function versionPreview(version, max = 140) {
  if (version.encrypted === 1 || version.encrypted === true) return '';
  const raw = version.type === 'checklist' && Array.isArray(version.items)
    ? version.items.map(i => `${i.checked ? '✓' : '☐'} ${i.text}`).join('  ')
    : (version.note || '');
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// What restoring a version writes back to the note: exactly what it kept.
export function restorePatch(version, current) {
  const patch = {};
  for (const f of VERSION_FIELDS) {
    if (!sameValue(version[f], current?.[f])) patch[f] = version[f] === undefined ? null : version[f];
  }
  return patch;
}

// The versions that go: the oldest beyond MAX_VERSIONS. The oldest of all (the baseline) is kept.
export function toPrune(versionsNewestFirst) {
  if (versionsNewestFirst.length <= MAX_VERSIONS) return [];
  const oldest = versionsNewestFirst[versionsNewestFirst.length - 1];
  const keep = versionsNewestFirst.slice(0, MAX_VERSIONS - (oldest.kind === 'baseline' ? 1 : 0));
  const kept = new Set(keep.map(v => v.id));
  if (oldest.kind === 'baseline') kept.add(oldest.id);
  return versionsNewestFirst.filter(v => !kept.has(v.id));
}
