import { create } from 'zustand';

// Just tracks which note's reminder popup (if any) is currently showing.
// Kept separate from noteStore since this is purely transient UI state,
// not persisted data.
const useReminderPopupStore = create((set) => ({
  activeNoteUuid: null,
  show: (uuid) => set({ activeNoteUuid: uuid }),
  hide: () => set({ activeNoteUuid: null }),
}));

export default useReminderPopupStore;
