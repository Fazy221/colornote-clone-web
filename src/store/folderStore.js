import { create } from 'zustand';
import { getSetting, setSetting, getFolderCounts } from '../db/database';
import { syncSetting, pullSetting } from '../sync/notesSync';
import useNoteStore from './noteStore';
import { parseFolders, nextFolderId, FOLDER_SORTS } from '../utils/folders';

// The folder list is one setting ("folders") that the Android app rewrites
// whole, so every change here first re-reads the cloud copy, edits that, and
// writes it back. The sort order is a per-device view choice and stays local.
const useFolderStore = create((set, get) => ({
  folders: [],
  counts: {},
  sort: 'color',
  loaded: false,

  load: async ({ pull = false } = {}) => {
    if (pull) await pullSetting('folders');
    const [saved, sort] = await Promise.all([getSetting('folders', null), getSetting('folderSort', 'color')]);
    set({ folders: parseFolders(saved), sort: FOLDER_SORTS[sort] ? sort : 'color', loaded: true });
  },

  loadCounts: async () => set({ counts: await getFolderCounts() }),

  setSort: async (sort) => {
    set({ sort });
    await setSetting('folderSort', sort);
  },

  // Edits a fresh copy of the list; returns whatever `edit` returns.
  _change: async (edit) => {
    await get().load({ pull: true });
    const before = get().folders;
    const { list, result } = edit(before);
    set({ folders: list });
    await syncSetting('folders', list);
    return result;
  },

  addFolder: (name) => get()._change(folders => {
    const id = nextFolderId(folders);
    return { list: [...folders, { id, name, color: 0, icon: 0 }], result: id };
  }),

  renameFolder: (id, name) => get()._change(folders => ({
    list: folders.map(f => (f.id === id ? { ...f, name } : f)),
  })),

  setFolderStyle: (id, color, icon) => get()._change(folders => ({
    list: folders.map(f => (f.id === id ? { ...f, color, icon } : f)),
  })),

  deleteFolder: async (id) => {
    await useNoteStore.getState().clearFolder(id);
    await get()._change(folders => ({ list: folders.filter(f => f.id !== id) }));
    await get().loadCounts();
  },
}));

export default useFolderStore;
