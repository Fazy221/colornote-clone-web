import Dexie from 'dexie';
import { decryptNoteContent, getNoteCiphertext } from '../utils/crypto';

export const db = new Dexie('ColorNoteWebDB');

db.version(1).stores({
  // Notes table — indexed fields listed here, all other fields stored but not indexed
  notes: [
    '++id',         // auto-increment local id
    'uuid',         // ColorNote UUID (for dedup on import)
    'type',         // 'text' | 'checklist'
    'colorIndex',   // 0-9
    'state',        // 'normal' | 'archived' | 'trash'
    'folderId',     // ColorNote folder id
    'calendarDate', // YYYY-MM-DD string, null if none
    'modifiedAt',   // ms timestamp
    'createdAt',    // ms timestamp
    'encrypted',    // 0 | 1
    'importance',   // 0 | 1 (pinned)
  ].join(', '),

  // App settings (key-value)
  settings: 'key',
});

// Changes the cloud hasn't confirmed yet (see sync/outbox.js).
db.version(2).stores({
  outbox: 'key',
});

// Each note as this device last saw it in the cloud, { uuid, doc }, like the phone's base column. A
// merge compares with it to tell what changed in the cloud from what changed here (see sync/merge.js).
db.version(3).stores({
  bases: 'uuid',
});

// Version history of each note (see utils/versions.js). `synced` is 0 until the cloud has the version.
db.version(4).stores({
  versions: 'id, noteUuid, [noteUuid+at], synced',
});

// A hidden note (the `hidden` field, 0 or 1 like the phone's; a note that never had it is not hidden).
// Hidden notes stay out of every list, the calendar and Search, unless the "Show hidden notes" setting
// is on (lists, calendar) or "Search hidden notes" is (Search). They are always reachable from the
// Hidden page, which the logo on Home opens. The phone does the same (NoteSummary.hidden).
export const isHidden = (n) => !!n?.hidden;

// Reads the two settings the lists need, both off until turned on.
// (The phone may have stored the switch as the text "true", so both count.)
const isOn = (v) => v === true || v === 'true';
export async function hiddenPrefs() {
  return {
    showHidden: isOn(await getSetting('showHiddenNotes', false)),
    searchHidden: isOn(await getSetting('searchHiddenNotes', false)),
  };
}

// Helper: get all notes in a state, sorted by modifiedAt desc
export async function getNotesByState(state = 'normal', { includeHidden = false } = {}) {
  const notes = await db.notes
    .where('state').equals(state)
    .reverse()
    .sortBy('modifiedAt');
  return includeHidden ? notes : notes.filter(n => !isHidden(n));
}

// Helper: the hidden notes (not the trashed ones), pinned first then newest, for the Hidden page.
export async function getHiddenNotes() {
  const notes = (await db.notes.toArray()).filter(n => isHidden(n) && n.state !== 'trash');
  return notes.sort((a, b) => ((b.importance === 1) - (a.importance === 1)) || ((b.modifiedAt || 0) - (a.modifiedAt || 0)));
}

// Helper: notes that belong to a folder (anything but the trash), pinned first then newest.
export async function getNotesInFolder(folderId, { includeHidden = false } = {}) {
  const notes = await db.notes.where('folderId').equals(folderId).toArray();
  return notes
    .filter(n => n.state !== 'trash' && (includeHidden || !isHidden(n)))
    .sort((a, b) => ((b.importance === 1) - (a.importance === 1)) || ((b.modifiedAt || 0) - (a.modifiedAt || 0)));
}

// Helper: how many notes each folder holds (trash and the real app's system folder excluded).
export async function getFolderCounts({ includeHidden = false } = {}) {
  const counts = {};
  await db.notes.where('folderId').above(0).each(n => {
    if (n.state === 'trash' || n.folderId === 256 || (!includeHidden && isHidden(n))) return;
    counts[n.folderId] = (counts[n.folderId] || 0) + 1;
  });
  return counts;
}

// Helper: get notes for a specific calendar date (excludes trashed/archived)
export async function getNotesByDate(dateStr, { includeHidden = false } = {}) {
  const notes = await db.notes
    .where('calendarDate').equals(dateStr)
    .toArray();
  return notes.filter(n => n.state === 'normal' && (includeHidden || !isHidden(n)));
}

// Helper: full-text search across title + note.
// Locked notes always match on title. Matching inside their decrypted body
// text is opt-in via options.includeLockedContent (see the "Search inside
// locked notes" setting) — off by default, matching ColorNote's own
// behavior of keeping locked content out of reach until unlocked. Even when
// on, the note list never shows a content preview for locked notes, so a
// match only reveals that the note exists, not what it says.
export async function searchNotes(query, options = {}) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const includeLockedContent = !!options.includeLockedContent;

  const includeHidden = !!options.includeHidden;
  // Title only: the note's text, list items and locked content are not looked at (the Android app's
  // repo.search(titleOnly) does the same).
  const titleOnly = !!options.titleOnly;
  const notes = (await db.notes.where('state').equals('normal').toArray()).filter(n => includeHidden || !isHidden(n));

  const results = await Promise.all(notes.map(async (n) => {
    if ((n.title || '').toLowerCase().includes(q)) return n;
    if (titleOnly) return null;

    if (n.encrypted === 1) {
      if (!includeLockedContent) return null;
      const ct = getNoteCiphertext(n);
      if (!ct) return null;
      try {
        const plaintext = await decryptNoteContent(ct);
        return plaintext.toLowerCase().includes(q) ? n : null;
      } catch {
        return null; // corrupt/undecryptable — skip rather than fail the whole search
      }
    }

    if ((n.note || '').toLowerCase().includes(q)) return n;
    if ((n.items || []).some(item => (item.text || '').toLowerCase().includes(q))) return n;
    return null;
  }));

  return results.filter(Boolean);
}

// Helper: get a setting value
export async function getSetting(key, defaultValue = null) {
  const row = await db.settings.get(key);
  return row ? row.value : defaultValue;
}

// Helper: set a setting value
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
