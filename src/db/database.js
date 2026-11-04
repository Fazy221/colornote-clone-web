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

// Helper: get all notes in a state, sorted by modifiedAt desc
export async function getNotesByState(state = 'normal') {
  return db.notes
    .where('state').equals(state)
    .reverse()
    .sortBy('modifiedAt');
}

// Helper: notes that belong to a folder (anything but the trash), pinned first then newest.
export async function getNotesInFolder(folderId) {
  const notes = await db.notes.where('folderId').equals(folderId).toArray();
  return notes
    .filter(n => n.state !== 'trash')
    .sort((a, b) => ((b.importance === 1) - (a.importance === 1)) || ((b.modifiedAt || 0) - (a.modifiedAt || 0)));
}

// Helper: how many notes each folder holds (trash and the real app's system folder excluded).
export async function getFolderCounts() {
  const counts = {};
  await db.notes.where('folderId').above(0).each(n => {
    if (n.state === 'trash' || n.folderId === 256) return;
    counts[n.folderId] = (counts[n.folderId] || 0) + 1;
  });
  return counts;
}

// Helper: get notes for a specific calendar date (excludes trashed/archived)
export async function getNotesByDate(dateStr) {
  const notes = await db.notes
    .where('calendarDate').equals(dateStr)
    .toArray();
  return notes.filter(n => n.state === 'normal');
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

  const notes = await db.notes.where('state').equals('normal').toArray();

  const results = await Promise.all(notes.map(async (n) => {
    if ((n.title || '').toLowerCase().includes(q)) return n;

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
