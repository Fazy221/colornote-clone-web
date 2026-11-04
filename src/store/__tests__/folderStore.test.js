import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory stand-ins for the local settings table, the cloud and the note store.
const h = vi.hoisted(() => ({ local: {}, cloud: {}, pushed: [], cleared: [] }));

vi.mock('../../db/database', () => ({
  getSetting: async (key, def = null) => (key in h.local ? h.local[key] : def),
  setSetting: async (key, value) => { h.local[key] = value; },
  getFolderCounts: async () => ({ 1000: 2 }),
}));
vi.mock('../../sync/notesSync', () => ({
  syncSetting: async (key, value) => { h.local[key] = value; h.cloud[key] = value; h.pushed.push(key); },
  pullSetting: async (key) => { if (key in h.cloud) h.local[key] = h.cloud[key]; },
}));
vi.mock('../noteStore', () => ({
  default: { getState: () => ({ clearFolder: async (id) => { h.cleared.push(id); } }) },
}));

import useFolderStore from '../folderStore';

beforeEach(() => {
  h.local = {}; h.cloud = {}; h.pushed = []; h.cleared = [];
  useFolderStore.setState({ folders: [], counts: {}, sort: 'color', loaded: false });
});

describe('folderStore', () => {
  it('adds folders with ids from 1000 and writes the list to the cloud setting', async () => {
    const first = await useFolderStore.getState().addFolder('Sample work');
    const second = await useFolderStore.getState().addFolder('Sample home');
    expect([first, second]).toEqual([1000, 1001]);
    expect(h.cloud.folders).toEqual([
      { id: 1000, name: 'Sample work', color: 0, icon: 0 },
      { id: 1001, name: 'Sample home', color: 0, icon: 0 },
    ]);
  });

  it('edits the cloud copy, so a folder the phone added meanwhile is kept', async () => {
    await useFolderStore.getState().addFolder('Sample work');
    h.cloud.folders = [...h.cloud.folders, { id: 1001, name: 'Added on the phone', color: 3, icon: 2 }];
    await useFolderStore.getState().renameFolder(1000, 'Renamed');
    expect(h.cloud.folders.map(f => f.name)).toEqual(['Renamed', 'Added on the phone']);
  });

  it('sets colour and icon', async () => {
    const id = await useFolderStore.getState().addFolder('Sample work');
    await useFolderStore.getState().setFolderStyle(id, 4, 6);
    expect(h.cloud.folders[0]).toMatchObject({ color: 4, icon: 6 });
  });

  it('deleting a folder frees its notes and removes it from the list', async () => {
    const id = await useFolderStore.getState().addFolder('Sample work');
    await useFolderStore.getState().addFolder('Sample home');
    await useFolderStore.getState().deleteFolder(id);
    expect(h.cleared).toEqual([id]);
    expect(h.cloud.folders.map(f => f.name)).toEqual(['Sample home']);
    expect(useFolderStore.getState().counts).toEqual({ 1000: 2 });
  });

  it('keeps the sort order on this device only', async () => {
    await useFolderStore.getState().setSort('alpha');
    expect(h.local.folderSort).toBe('alpha');
    expect(h.pushed).toEqual([]);
    useFolderStore.setState({ sort: 'color' });
    await useFolderStore.getState().load();
    expect(useFolderStore.getState().sort).toBe('alpha');
  });
});
