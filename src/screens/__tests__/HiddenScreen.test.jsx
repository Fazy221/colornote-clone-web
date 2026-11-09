import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => ({ notes: [], settings: {}, setHidden: vi.fn(), setPin: vi.fn(), trash: vi.fn() }));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => h.notes }));
vi.mock('../../db/database', () => ({
  getHiddenNotes: async () => h.notes,
  getSetting: async (k, d = null) => (k in h.settings ? h.settings[k] : d),
}));
vi.mock('../../store/noteStore', () => ({
  default: () => ({ setHiddenForNotes: h.setHidden, setPinForNotes: h.setPin, trashNotes: h.trash }),
}));
vi.mock('../../components/notes/NoteCard', () => ({
  default: ({ note, selected, onPress, onLongPress }) => (
    <div>
      <button onClick={onPress}>{note.title}</button>
      <button onClick={onLongPress} aria-label={`select ${note.title}`}>{selected ? 'picked' : 'pick'}</button>
    </div>
  ),
}));
vi.mock('../../components/common/MasterPasswordDialog', () => ({
  default: ({ open, onSuccess }) => (open ? <button onClick={onSuccess}>Unlock</button> : null),
}));

import HiddenScreen from '../HiddenScreen';

// Invented notes only.
const note = (id, title, o = {}) => ({ id, title, type: 'text', hidden: 1, importance: 0, ...o });
const show = () => render(
  <MemoryRouter initialEntries={['/hidden']}>
    <Routes>
      <Route path="/hidden" element={<HiddenScreen />} />
      <Route path="/note/:id" element={<p>editor opened</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  h.notes = [note(1, 'Garden plan'), note(2, 'Packing list', { type: 'checklist' })];
  h.settings = {};
  vi.clearAllMocks();
});

describe('HiddenScreen', () => {
  it('opens straight away when no master password is set, and says so', async () => {
    show();
    expect(await screen.findByText('Garden plan')).toBeTruthy();
    expect(screen.getByText('Packing list')).toBeTruthy();
    expect(screen.getByTestId('hidden-unprotected')).toBeTruthy();
  });

  it('keeps the notes behind the password when one is set', async () => {
    h.settings.masterPasswordVerifier = 'x';
    show();
    const unlock = await screen.findByText('Unlock');
    expect(screen.queryByText('Garden plan')).toBeNull();
    fireEvent.click(unlock);
    expect(await screen.findByText('Garden plan')).toBeTruthy();
    expect(screen.queryByTestId('hidden-unprotected')).toBeNull();
  });

  it('opens a note on tap', async () => {
    show();
    fireEvent.click(await screen.findByText('Garden plan'));
    expect(await screen.findByText('editor opened')).toBeTruthy();
  });

  it('unhides the selected notes from the selection bar', async () => {
    show();
    await screen.findByText('Garden plan');
    fireEvent.click(screen.getByLabelText('select Garden plan'));
    fireEvent.click(await screen.findByText('Unhide'));
    await waitFor(() => expect(h.setHidden).toHaveBeenCalledWith([1], false));
  });

  it('shows an empty state with no hidden notes', async () => {
    h.notes = [];
    show();
    expect(await screen.findByText('No hidden notes')).toBeTruthy();
  });
});
