import { create } from 'zustand';
import { getSetting } from '../db/database';

// Only 1-4 are ever offered in the UI, but a stored/passed value could in
// theory be anything (corrupt IndexedDB row, future bad input) — clamp to a
// safe integer 1-4 so `gridTemplateColumns: repeat(n, ...)` can never receive
// NaN or an out-of-range count.
function clampColumns(n) {
  const num = Math.round(Number(n));
  if (!Number.isFinite(num)) return 1;
  return Math.min(4, Math.max(1, num));
}

// 'fixed' keeps every screen in a centred column on a wide screen; 'fluid' fills the window.
export const pageWidthOf = (value) => (value === 'fluid' ? 'fluid' : 'fixed');

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

  // One short message at the bottom of the window (see App), for what was just done.
  toast: null,
  showToast: (message) => set({ toast: { message, key: Date.now() } }),
  clearToast: () => set({ toast: null }),

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

  // Page width on a wide screen (see PageFrame). Fixed is the default.
  pageWidth: 'fixed',
  setPageWidth: (value) => set({ pageWidth: pageWidthOf(value) }),
  loadPageWidth: async () => set({ pageWidth: pageWidthOf(await getSetting('pageWidth', 'fixed')) }),

  // Home screen grid view (desktop only — mobile is always forced to the
  // single-column list, which is what the real app looks like anyway).
  // Ephemeral for the session: starts from the persisted "default desktop
  // view" setting the first time it's needed, but switching it on Home
  // afterward only affects the current session, not the saved default —
  // that's changed explicitly from Settings.
  //
  // gridColumnsInitialized doubles as a race guard, not just a "ran once"
  // flag: initHomeGridColumns() awaits a real IndexedDB read (getSetting),
  // which isn't instant. If the user opens the view menu and picks a
  // column count while that read is still in flight, setHomeGridColumns()
  // now also marks initialized=true — so when the pending read resolves
  // afterward, initHomeGridColumns() re-checks the flag and bails instead
  // of unconditionally overwriting homeGridColumns with the (now stale)
  // persisted default. Without this, a click that landed before the
  // settings read finished got silently clobbered a moment later, which
  // looked exactly like "picked a grid view and it snapped back to list."
  homeGridColumns: 1,
  gridColumnsInitialized: false,
  setHomeGridColumns: (n) => set({ homeGridColumns: clampColumns(n), gridColumnsInitialized: true }),
  initHomeGridColumns: async () => {
    if (get().gridColumnsInitialized) return;
    const def = await getSetting('defaultDesktopView', 1);
    // Re-check after the await: a manual setHomeGridColumns() call may have
    // already run (and set gridColumnsInitialized) while this was pending.
    if (get().gridColumnsInitialized) return;
    set({ homeGridColumns: clampColumns(def), gridColumnsInitialized: true });
  },
}));

export default useUIStore;
