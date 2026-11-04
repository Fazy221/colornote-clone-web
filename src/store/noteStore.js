import { create } from 'zustand';
import { db, getNotesByState, searchNotes, getSetting } from '../db/database';
import { formatCalendarDate } from '../utils/dateUtils';
import { pushNote, pushNoteDeletion, syncSetting } from '../sync/notesSync';

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
    pushNote(await db.notes.get(id));
    return id;
  },

  updateNote: async (id, changes) => {
    await db.notes.update(id, {
      ...changes,
      modifiedAt: Date.now(),
    });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id));
  },

  // Move to trash — organizational, not a content edit, so modifiedAt is
  // left untouched (matches the real app: trashing/restoring a note doesn't
  // bump its modified date there either).
  trashNote: async (id) => {
    await db.notes.update(id, { state: 'trash' });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id));
  },

  // Archive — same reasoning as trashNote.
  archiveNote: async (id) => {
    await db.notes.update(id, { state: 'archived' });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id));
  },

  // Restore from trash/archive → normal — same reasoning as trashNote.
  restoreNote: async (id) => {
    await db.notes.update(id, { state: 'normal' });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id));
  },

  // Permanently delete
  deleteNotePermanently: async (id) => {
    const note = await db.notes.get(id);
    await db.notes.delete(id);
    await get().loadNotes(get().activeState);
    if (note?.uuid) pushNoteDeletion(note.uuid);
  },

  // Duplicate
  duplicateNote: async (id) => {
    const original = await db.notes.get(id);
    if (!original) return;
    const { id: _id, uuid: _uuid, ...rest } = original;
    const now = Date.now();
    const newId = await db.notes.add({ ...rest, uuid: crypto.randomUUID(), createdAt: now, modifiedAt: now });
    await get().loadNotes('normal');
    pushNote(await db.notes.get(newId));
  },

  // Toggle pin/importance — organizational (just reordering, not editing
  // content), so modifiedAt is left untouched. Same as trash/archive/restore.
  togglePin: async (id) => {
    const note = await db.notes.get(id);
    if (!note) return;
    await db.notes.update(id, { importance: note.importance ? 0 : 1 });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id));
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
  //
  // Each helper re-reads the affected rows after modify() and pushes them
  // individually — modify() itself doesn't hand back the updated docs.
  archiveNotes: async (ids) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ state: 'archived' });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(pushNote);
  },

  trashNotes: async (ids) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ state: 'trash' });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(pushNote);
  },

  setColorForNotes: async (ids, colorIndex) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ colorIndex, modifiedAt: Date.now() });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(pushNote);
  },

  setPinForNotes: async (ids, pinned) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ importance: pinned ? 1 : 0 });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(pushNote);
  },

  // Folder changes bump modifiedAt, like on the phone, so the other side
  // takes the newer copy.
  setFolderForNotes: async (ids, folderId) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ folderId, modifiedAt: Date.now() });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(pushNote);
  },

  // Deleting a folder keeps its notes; they just belong to no folder any more.
  clearFolder: async (folderId) => {
    const ids = await db.notes.where('folderId').equals(folderId).primaryKeys();
    await get().setFolderForNotes(ids, 0);
  },

  // Gives the notes in the folder (trash excluded) its colour, once.
  applyColorToFolder: async (folderId, colorIndex) => {
    const notes = await db.notes.where('folderId').equals(folderId).toArray();
    await get().setColorForNotes(notes.filter(n => n.state !== 'trash').map(n => n.id), colorIndex);
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
      await syncSetting('masterPasswordVerifier', verifierNote.note);
    }

    // Filter out ColorNote system notes
    const realNotes = notes.filter(n => n.folderId !== 256);

    // Split into new notes (add) vs. already-imported notes. For the latter,
    // only patch calendarDate — re-importing shouldn't clobber anything the
    // user has since edited in the app (title, note, color, state, etc.).
    // This lets a corrected notes.json (e.g. after a parser fix) repair
    // calendarDate on notes that are already in the DB.
    const existing = await db.notes.toArray();
    const existingByUuid = new Map(existing.map(n => [n.uuid, n]));

    const toAdd = [];
    const toPatch = [];

    for (const n of realNotes) {
      const match = existingByUuid.get(n.id);
      const calendarDate = n.calendarDate ? formatCalendarDate(n.calendarDate) : null;
      if (!match) {
        toAdd.push(n);
      } else if (calendarDate !== (match.calendarDate ?? null)) {
        toPatch.push({ id: match.id, calendarDate });
      }
    }

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

    await db.transaction('rw', db.notes, async () => {
      if (mapped.length) await db.notes.bulkAdd(mapped);
      // Organizational patch, not a content edit — modifiedAt left untouched
      // (same reasoning as trash/archive/pin above).
      for (const { id, calendarDate } of toPatch) {
        await db.notes.update(id, { calendarDate });
      }
    });

    await get().loadNotes('normal');

    // Mirror the import to the cloud too — both newly-added notes and any
    // calendarDate patches on notes that were already synced.
    if (mapped.length) {
      const addedUuids = mapped.map(n => n.uuid);
      (await db.notes.where('uuid').anyOf(addedUuids).toArray()).forEach(pushNote);
    }
    if (toPatch.length) {
      (await db.notes.where('id').anyOf(toPatch.map(p => p.id)).toArray()).forEach(pushNote);
    }

    return {
      imported: mapped.length,
      patched: toPatch.length,
      skipped: realNotes.length - mapped.length - toPatch.length,
    };
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
