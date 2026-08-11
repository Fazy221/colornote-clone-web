import { create } from 'zustand';
import { db, getNotesByState, searchNotes, getSetting, setSetting } from '../db/database';
import { formatCalendarDate } from '../utils/dateUtils';

const useNoteStore = create((set, get) => ({
  notes: [],
  loading: false,
  activeState: 'normal', // 'normal' | 'archived' | 'trash'

  // ─── Load ─────────────────────────────────────────────────────────────────
  loadNotes: async (state = 'normal') => {
    set({ loading: true, activeState: state });
    try {
      const notes = await getNotesByState(state);
      set({ notes, loading: false });
    } catch (e) {
      console.error('loadNotes error:', e);
      set({ loading: false });
    }
  },

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  createNote: async (noteData) => {
    const now = Date.now();
    const uuid = crypto.randomUUID();
    const id = await db.notes.add({
      uuid,
      title: '',
      type: 'text',
      note: '',
      items: null,
      colorIndex: 0,
      state: 'normal',
      encrypted: 0,
      folderId: 0,
      importance: 0,
      calendarDate: null,
      reminderType: 0,
      reminderRepeat: 0,
      tags: '',
      createdAt: now,
      modifiedAt: now,
      ...noteData,
    });
    await get().loadNotes('normal');
    return id;
  },

  updateNote: async (id, changes) => {
    await db.notes.update(id, {
      ...changes,
      modifiedAt: Date.now(),
    });
    await get().loadNotes(get().activeState);
  },

  // Move to trash — organizational, not a content edit, so modifiedAt is
  // left untouched (matches the real app: trashing/restoring a note doesn't
  // bump its modified date there either).
  trashNote: async (id) => {
    await db.notes.update(id, { state: 'trash' });
    await get().loadNotes(get().activeState);
  },

  // Archive — same reasoning as trashNote.
  archiveNote: async (id) => {
    await db.notes.update(id, { state: 'archived' });
    await get().loadNotes(get().activeState);
  },

  // Restore from trash/archive → normal — same reasoning as trashNote.
  restoreNote: async (id) => {
    await db.notes.update(id, { state: 'normal' });
    await get().loadNotes(get().activeState);
  },

  // Permanently delete
  deleteNotePermanently: async (id) => {
    await db.notes.delete(id);
    await get().loadNotes(get().activeState);
  },

  // Duplicate
  duplicateNote: async (id) => {
    const original = await db.notes.get(id);
    if (!original) return;
    const { id: _id, uuid: _uuid, ...rest } = original;
    const now = Date.now();
    await db.notes.add({ ...rest, uuid: crypto.randomUUID(), createdAt: now, modifiedAt: now });
    await get().loadNotes('normal');
  },

  // Toggle pin/importance — organizational (just reordering, not editing
  // content), so modifiedAt is left untouched. Same as trash/archive/restore.
  togglePin: async (id) => {
    const note = await db.notes.get(id);
    if (!note) return;
    await db.notes.update(id, { importance: note.importance ? 0 : 1 });
    await get().loadNotes(get().activeState);
  },

  // ─── Bulk ops (multi-select action bar) ────────────────────────────────────
  // NOTE: this project pins dexie@^3.2.7, which predates Table.bulkUpdate()
  // (added in Dexie 4). where().anyOf().modify() is the 3.x-compatible way
  // to patch many rows in one query and is what all four helpers use below.
  //
  // archiveNotes/trashNotes/setPinForNotes are organizational moves, so they
  // don't touch modifiedAt (same reasoning as the single-note versions above).
  // setColorForNotes is left touching modifiedAt — changing a note's color
  // wasn't part of what's confirmed about the real app's behavior, so it's
  // treated as a content-ish edit rather than assumed. Flag if that should
  // change too.
  archiveNotes: async (ids) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ state: 'archived' });
    await get().loadNotes(get().activeState);
  },

  trashNotes: async (ids) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ state: 'trash' });
    await get().loadNotes(get().activeState);
  },

  setColorForNotes: async (ids, colorIndex) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ colorIndex, modifiedAt: Date.now() });
    await get().loadNotes(get().activeState);
  },

  setPinForNotes: async (ids, pinned) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ importance: pinned ? 1 : 0 });
    await get().loadNotes(get().activeState);
  },

  // ─── Import from parsed notes.json ────────────────────────────────────────
  importFromJson: async (jsonData) => {
    const notes = jsonData.notes || [];

    // ColorNote's system notes live in folderId 256. Most of them we discard,
    // but "name_master_password" holds BACKUP_SECRET_KEY — the value that lets
    // us genuinely verify a user-entered master password (see crypto.js,
    // Algorithm 2). Capture it into settings before filtering the rest out.
    const verifierNote = notes.find(n => n.folderId === 256 && n.title === 'name_master_password');
    if (verifierNote?.note) {
      await setSetting('masterPasswordVerifier', verifierNote.note);
    }

    // Filter out ColorNote system notes
    const realNotes = notes.filter(n => n.folderId !== 256);

    // Deduplicate by uuid
    const existing = await db.notes.toArray();
    const existingUuids = new Set(existing.map(n => n.uuid));
    const toAdd = realNotes.filter(n => !existingUuids.has(n.id));

    // Map from our parsed schema to DB schema
    const mapped = toAdd.map(n => ({
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
      createdAt: n.createdAt || Date.now(),
      modifiedAt: n.modifiedAt || Date.now(),
    }));

    await db.notes.bulkAdd(mapped);
    await get().loadNotes('normal');
    return { imported: mapped.length, skipped: realNotes.length - mapped.length };
  },

  // ─── Get single note ───────────────────────────────────────────────────────
  getNoteById: async (id) => {
    return db.notes.get(Number(id));
  },

  // ─── Search ───────────────────────────────────────────────────────────────
  searchNotes: async (query) => {
    const includeLockedContent = await getSetting('searchLockedContent', false);
    return searchNotes(query, { includeLockedContent });
  },
}));

export default useNoteStore;
