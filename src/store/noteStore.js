import { create } from 'zustand';
import { db, getNotesByState, searchNotes, getSetting } from '../db/database';
import { pushNote, pushNoteDeletion, syncSetting } from '../sync/notesSync';
import { BUMP_FIELDS, planEditorSave, sameValue } from '../utils/noteFields';
import { ENDED_REMINDER, hasLiveReminder } from '../utils/reminders';
import { noteFromFile, planImport } from '../utils/importPlan';
import { planResolution } from '../utils/conflicts';

const ENDED_FIELDS = ['state', ...Object.keys(ENDED_REMINDER)];

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

  // Writes only the fields that differ from what is stored, and bumps
  // modifiedAt only when content, colour or folder changed. Nothing different,
  // nothing written.
  updateNote: async (id, changes) => {
    const current = await db.notes.get(id);
    if (!current) return;
    const fields = Object.keys(changes).filter(f => f !== 'modifiedAt' && !sameValue(changes[f], current[f]));
    if (!fields.length) return;
    const patch = Object.fromEntries(fields.map(f => [f, changes[f]]));
    if (fields.some(f => BUMP_FIELDS.includes(f))) {
      patch.modifiedAt = Math.max(Date.now(), (current.modifiedAt || 0) + 1);
    }
    await db.notes.update(id, patch);
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id), Object.keys(patch));
  },

  // Saves what the note editor holds (see planEditorSave). Returns the note's
  // id, which is new if the note was deleted elsewhere while it was open.
  saveEdited: async (id, base, edited) => {
    let copy = null;
    let fields = null;
    let savedId = id;
    await db.transaction('rw', db.notes, async () => {
      const current = await db.notes.get(id);
      const plan = planEditorSave({
        base, edited, current: current || null, now: Date.now(), newUuid: () => crypto.randomUUID(),
      });
      if (plan.revive) {
        savedId = await db.notes.add(plan.revive);
        fields = null;
      } else if (plan.changes) {
        if (plan.conflictCopy) copy = { ...plan.conflictCopy, id: await db.notes.add(plan.conflictCopy) };
        await db.notes.update(id, plan.changes);
        fields = Object.keys(plan.changes);
      } else {
        savedId = null;
      }
    });
    if (savedId === null) return id;
    await get().loadNotes(get().activeState);
    if (copy) pushNote(copy);
    pushNote(await db.notes.get(savedId), fields ?? undefined);
    return savedId;
  },

  // Move to trash — organizational, not a content edit, so modifiedAt is
  // left untouched (matches the real app: trashing/restoring a note doesn't
  // bump its modified date there either).
  trashNote: async (id) => {
    await db.notes.update(id, { state: 'trash' });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id), ['state']);
  },

  // Archive — same reasoning as trashNote. endReminder: the owner agreed to
  // end a live reminder (see liveReminderIds), as the phone asks before archiving.
  archiveNote: async (id, endReminder = false) => {
    await get().archiveNotes([id], endReminder ? [id] : []);
  },

  // Restore from trash/archive → normal — same reasoning as trashNote.
  restoreNote: async (id) => {
    await db.notes.update(id, { state: 'normal' });
    await get().loadNotes(get().activeState);
    pushNote(await db.notes.get(id), ['state']);
  },

  // A choice made on the conflicts screen (see planResolution in utils/conflicts.js). Each step is an
  // ordinary edit, synced like any other.
  resolveConflict: async (original, copy, choice) => {
    const { updates, trash } = planResolution(original, copy, choice);
    for (const u of updates) await get().updateNote(u.id, u.changes);
    for (const id of trash) await get().trashNote(id);
  },

  // Permanently delete
  deleteNotePermanently: async (id) => {
    const note = await db.notes.get(id);
    await db.notes.delete(id);
    await get().loadNotes(get().activeState);
    if (note?.uuid) pushNoteDeletion(note.uuid);
  },

  // Duplicate. The copy is a new note, so it carries no id from the old app.
  duplicateNote: async (id) => {
    const original = await db.notes.get(id);
    if (!original) return;
    const { id: _id, uuid: _uuid, legacyId: _legacyId, conflictOf: _conflictOf, ...rest } = original;
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
    pushNote(await db.notes.get(id), ['importance']);
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
  // The notes among ids whose reminder would still ring or show. Archiving
  // them asks first, as on the phone.
  liveReminderIds: async (ids) => {
    if (!ids.length) return [];
    const now = Date.now();
    return (await db.notes.where('id').anyOf(ids).toArray()).filter(n => hasLiveReminder(n, now)).map(n => n.id);
  },

  // endReminderFor: notes whose reminder ends with the archive (the phone's
  // archiveWithoutReminder), so un-archiving doesn't bring it back. Their
  // calendar date stays.
  archiveNotes: async (ids, endReminderFor = []) => {
    if (!ids.length) return;
    const ending = ids.filter(id => endReminderFor.includes(id));
    const plain = ids.filter(id => !endReminderFor.includes(id));
    await db.transaction('rw', db.notes, async () => {
      if (plain.length) await db.notes.where('id').anyOf(plain).modify({ state: 'archived' });
      if (ending.length) await db.notes.where('id').anyOf(ending).modify({ state: 'archived', ...ENDED_REMINDER });
    });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray())
      .forEach(n => pushNote(n, ending.includes(n.id) ? ENDED_FIELDS : ['state']));
  },

  trashNotes: async (ids) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ state: 'trash' });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(n => pushNote(n, ['state']));
  },

  setColorForNotes: async (ids, colorIndex) => {
    if (!ids.length) return;
    // Notes already that colour keep their date.
    const changed = (await db.notes.where('id').anyOf(ids).toArray()).filter(n => n.colorIndex !== colorIndex).map(n => n.id);
    if (!changed.length) return;
    await db.notes.where('id').anyOf(changed).modify({ colorIndex, modifiedAt: Date.now() });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(changed).toArray()).forEach(n => pushNote(n, ['colorIndex', 'modifiedAt']));
  },

  setPinForNotes: async (ids, pinned) => {
    if (!ids.length) return;
    await db.notes.where('id').anyOf(ids).modify({ importance: pinned ? 1 : 0 });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(ids).toArray()).forEach(n => pushNote(n, ['importance']));
  },

  // Folder changes bump modifiedAt, like on the phone, so the other side
  // takes the newer copy.
  setFolderForNotes: async (ids, folderId) => {
    if (!ids.length) return;
    // Notes already in that folder keep their date.
    const changed = (await db.notes.where('id').anyOf(ids).toArray()).filter(n => (n.folderId || 0) !== folderId).map(n => n.id);
    if (!changed.length) return;
    await db.notes.where('id').anyOf(changed).modify({ folderId, modifiedAt: Date.now() });
    await get().loadNotes(get().activeState);
    (await db.notes.where('id').anyOf(changed).toArray()).forEach(n => pushNote(n, ['folderId', 'modifiedAt']));
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
  // The same rules as the phone's import (see importPlan.js): the newer
  // version wins, text that loses becomes a [conflict] copy, pins and
  // dismissals stay, and a note hidden on either side stays hidden.
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

    const now = Date.now();
    const fileNotes = notes.filter(n => n.folderId !== 256 && n.id).map(n => noteFromFile(n, now));

    // Planned outside the transaction: the copy ids come from WebCrypto, and
    // a Dexie 3 transaction ends when it awaits anything else.
    const plan = await planImport(fileNotes, await db.notes.toArray());
    const addedIds = [];
    const updated = [];
    await db.transaction('rw', db.notes, async () => {
      for (const n of plan.adds) {
        if (!(await db.notes.where('uuid').equals(n.uuid).first())) addedIds.push(await db.notes.add(n));
      }
      // Only the fields that differ, so the date moves only when the file's
      // newer text was taken. A note sync changed meanwhile is left alone.
      for (const u of plan.updates) {
        const row = await db.notes.get(u.id);
        if (!row || !sameValue(row, u.base)) continue;
        await db.notes.update(u.id, u.changes);
        updated.push(u);
      }
    });

    await get().loadNotes(get().activeState);

    if (addedIds.length) {
      (await db.notes.where('id').anyOf(addedIds).toArray()).forEach(n => pushNote(n));
    }
    if (updated.length) {
      const fieldsById = new Map(updated.map(u => [u.id, Object.keys(u.changes)]));
      (await db.notes.where('id').anyOf([...fieldsById.keys()]).toArray())
        .forEach(n => pushNote(n, fieldsById.get(n.id)));
    }

    return plan.report;
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
