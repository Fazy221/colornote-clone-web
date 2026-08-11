import { create } from 'zustand';
import { getSetting } from '../db/database';

const useUIStore = create((set, get) => ({
  // Color filter on home screen (null = all)
  colorFilter: null,
  setColorFilter: (color) => set({ colorFilter: color === get().colorFilter ? null : color }),
  clearColorFilter: () => set({ colorFilter: null }),

  // Sort order
  sortOrder: 'modified', // 'modified' | 'created' | 'title' | 'color'
  setSortOrder: (order) => set({ sortOrder: order }),

  // Sort bar visible on home
  sortBarVisible: false,
  toggleSortBar: () => set(s => ({ sortBarVisible: !s.sortBarVisible })),

  // Multi-select mode
  selectedIds: new Set(),
  selectionMode: false,
  toggleSelect: (id) => set(s => {
    const next = new Set(s.selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selectedIds: next, selectionMode: next.size > 0 };
  }),
  clearSelection: () => set({ selectedIds: new Set(), selectionMode: false }),
  selectAll: (ids) => set({ selectedIds: new Set(ids), selectionMode: true }),

  // Master password (in-memory only, never persisted)
  masterPassword: null,
  setMasterPassword: (pw) => set({ masterPassword: pw }),
  clearMasterPassword: () => set({ masterPassword: null }),

  // Add note dialog type
  addDialogOpen: false,
  openAddDialog: () => set({ addDialogOpen: true }),
  closeAddDialog: () => set({ addDialogOpen: false }),

  // Theme
  darkMode: false,
  toggleDarkMode: () => set(s => ({ darkMode: !s.darkMode })),

  // Home screen grid view (desktop only — mobile is always forced to the
  // single-column list, which is what the real app looks like anyway).
  // Ephemeral for the session: starts from the persisted "default desktop
  // view" setting the first time it's needed, but switching it on Home
  // afterward only affects the current session, not the saved default —
  // that's changed explicitly from Settings.
  homeGridColumns: 1,
  gridColumnsInitialized: false,
  setHomeGridColumns: (n) => set({ homeGridColumns: n }),
  initHomeGridColumns: async () => {
    if (get().gridColumnsInitialized) return;
    const def = await getSetting('defaultDesktopView', 1);
    set({ homeGridColumns: Number(def) || 1, gridColumnsInitialized: true });
  },
}));

export default useUIStore;
