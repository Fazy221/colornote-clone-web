// What importing a notes.json would do to the notes here, decided without touching anything. The same
// rules as the Android app's ImportPlan.kt (planImport):
//
// - Text never disappears. When a note's text differs, the version not kept becomes a "[conflict]"
//   copy. One file can't show which side edited since they last matched, so this holds for every
//   such note.
// - File and app are matched by uuid, and the newer modifiedAt wins. On a tie with different text the
//   file wins, so importing it again changes nothing.
// - Pins and dismissals are always kept from here: they don't bump modifiedAt.
// - A note hidden (archived or trashed) in the file gets hidden here; one hidden here stays hidden.
// - Notes the file doesn't have are left alone.
//
// notes.json (from parse-colornote.js) carries no styling and no reminder time, repeat end or
// dismissal. A field the file doesn't carry keeps its value here, whichever side wins.
import { formatCalendarDate } from './dateUtils';
import { normalise, sameValue } from './noteFields';
import { ENDED_REMINDER } from './reminders';

// The words alone: a file carries no styling, so format isn't compared.
const TEXT_FIELDS = ['title', 'type', 'note', 'items', 'encrypted'];
const sameText = (a, b) => TEXT_FIELDS.every(f => sameValue(a[f], b[f]));

// Fields this app keeps from here whatever the file says, or that only the date decides.
const KEPT_HERE = ['state', 'importance', 'reminderDismissedAt', 'modifiedAt', 'format'];

// Fields parse-colornote.js doesn't write today; taken from the file only when it has them.
const OPTIONAL = ['format', 'reminderTime', 'reminderRepeatEnds', 'reminderDismissedAt'];

const CONFLICT_PREFIX = '[conflict] ';

// One note of notes.json in this app's shape.
export function noteFromFile(n, now = Date.now()) {
  const note = {
    uuid: n.id,
    legacyId: n.legacyId,
    title: n.title || '',
    type: n.type || 'text',
    note: n.note || '',
    items: n.items || null,
    colorIndex: n.colorIndex ?? 0,
    state: n.state || 'normal',
    encrypted: n.encrypted ? 1 : 0,
    folderId: n.folderId || 0,
    importance: n.importance || 0,
    calendarDate: n.calendarDate ? formatCalendarDate(n.calendarDate) : null,
    reminderType: n.reminderType || 0,
    reminderRepeat: n.reminderRepeat || 0,
    tags: n.tags || '',
    createdAt: n.createdAt || now,
    modifiedAt: n.modifiedAt || now,
  };
  for (const f of OPTIONAL) if (n[f] !== undefined) note[f] = n[f];
  if (note.legacyId === undefined) delete note.legacyId;
  return note;
}

// A copy's uuid comes from what it holds, so importing the same file twice adds nothing the second time.
export async function contentUuid(note) {
  const key = JSON.stringify([note.uuid, note.modifiedAt || 0, ...TEXT_FIELDS.map(f => normalise(note[f]))]);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Follows the note's list, and holds no date or reminder, so it can't show twice on the calendar.
function conflictCopy(loser, state, uuid) {
  const { id: _id, legacyId: _legacyId, ...rest } = loser;
  return {
    ...rest,
    ...ENDED_REMINDER,
    uuid,
    title: `${CONFLICT_PREFIX}${loser.title || ''}`,
    state,
    importance: 0,
    calendarDate: null,
  };
}

// fileNotes: from noteFromFile. rows: every note here. copyUuid: async (loser) => uuid.
// Returns { report, adds, updates: [{ id, uuid, base, changes }] }. Counts only in the report, so it
// can be shown. Every file note lands in exactly one of added, unchanged, detailsTaken, detailsKept,
// replaced or keptOurs.
export async function planImport(fileNotes, rows, copyUuid = contentUuid) {
  const byUuid = new Map(rows.map(r => [r.uuid, r]));
  const adds = [];
  const updates = [];
  const planned = new Set();
  const report = {
    fileNotes: fileNotes.length, added: 0, unchanged: 0, detailsTaken: 0, detailsKept: 0,
    replaced: 0, keptOurs: 0, conflictCopies: 0, stateFixed: 0, stateKept: 0, notInFile: 0,
  };

  for (const backup of fileNotes) {
    const ours = byUuid.get(backup.uuid);
    if (!ours) {
      if (planned.has(backup.uuid)) continue; // the same note twice in one file
      planned.add(backup.uuid);
      adds.push(backup);
      report.added++;
      continue;
    }

    const same = sameText(ours, backup);
    const fileAt = backup.modifiedAt || 0;
    const oursAt = ours.modifiedAt || 0;
    const takeBackup = same ? fileAt > oursAt : fileAt >= oursAt;

    let state = ours.state;
    if (backup.state !== ours.state) {
      if (ours.state === 'normal') { state = backup.state; report.stateFixed++; } else { report.stateKept++; }
    }

    const winner = takeBackup ? { ...ours, ...backup } : ours;
    const merged = {
      ...winner,
      state,
      importance: ours.importance ?? 0,
      reminderDismissedAt: ours.reminderDismissedAt ?? null,
      // Styling goes with the words. A file without styling keeps it here for
      // the same body, and drops it for a different body it wins with.
      format: !takeBackup ? ours.format
        : !backup.format && sameValue(backup.note, ours.note) ? ours.format
          : (backup.format ?? ''),
    };

    if (!same && takeBackup) report.replaced++;
    else if (!same) report.keptOurs++;
    else if (takeBackup) report.detailsTaken++;
    else if (Object.keys(backup).some(f => !KEPT_HERE.includes(f) && !sameValue(backup[f], ours[f]))) report.detailsKept++;
    else report.unchanged++;

    if (!same) {
      const loser = takeBackup ? ours : backup;
      const uuid = await copyUuid(loser);
      if (!byUuid.has(uuid) && !planned.has(uuid)) {
        planned.add(uuid);
        adds.push(conflictCopy(loser, state, uuid));
        report.conflictCopies++;
      }
    }

    const changes = {};
    for (const f of Object.keys(merged)) {
      if (f !== 'id' && f !== 'uuid' && !sameValue(merged[f], ours[f])) changes[f] = merged[f] === undefined ? null : merged[f];
    }
    if (Object.keys(changes).length) updates.push({ id: ours.id, uuid: ours.uuid, base: ours, changes });
  }

  const inFile = new Set(fileNotes.map(n => n.uuid));
  report.notInFile = rows.filter(r => !inFile.has(r.uuid)).length;
  return { report, adds, updates };
}
