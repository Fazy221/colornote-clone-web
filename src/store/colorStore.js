import { create } from 'zustand';
import { getSetting, setSetting } from '../db/database';

// Default color names, matching Faizan's actual ColorNote setup (verified
// against the real app's color list). Index 0 (None/White) intentionally has
// no name — it's a blank swatch, not a named category, same as in the real
// app's Color menu.
export const DEFAULT_COLOR_NAMES = [
  '',
  'Dreams, Love',      // 1 Red
  'Dates Related',     // 2 Orange
  'To Do',             // 3 Yellow
  'Thoughts',          // 4 Green
  'Life',              // 5 Blue
  'Review',            // 6 Purple
  'Stories',           // 7 Dark
  'Editing Tips',      // 8 Gray
  'To Download List',  // 9 Light
];

// Single source of truth for color names — shared by the Color filter modal
// (HomeScreen) and the per-note ColorPicker, so renaming a color in one place
// shows up everywhere, matching how the real app treats color names as a
// single global list rather than a per-screen label.
const useColorStore = create((set, get) => ({
  colorNames: DEFAULT_COLOR_NAMES,
  showColorCounts: false,
  loaded: false,

  loadColorSettings: async () => {
    if (get().loaded) return;
    const [names, showCounts] = await Promise.all([
      getSetting('colorNames', null),
      getSetting('showColorCounts', false),
    ]);
    set({
      colorNames: Array.isArray(names) && names.length === 10 ? names : DEFAULT_COLOR_NAMES,
      showColorCounts: !!showCounts,
      loaded: true,
    });
  },

  setColorNames: async (names) => {
    set({ colorNames: names });
    await setSetting('colorNames', names);
  },

  toggleShowColorCounts: async () => {
    const next = !get().showColorCounts;
    set({ showColorCounts: next });
    await setSetting('showColorCounts', next);
  },
}));

export default useColorStore;
