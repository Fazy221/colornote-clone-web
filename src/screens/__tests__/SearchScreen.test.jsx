import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const h = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('../../store/noteStore', () => ({ default: () => ({ searchNotes: h.search }) }));
vi.mock('../../components/layout/BottomNav', () => ({ default: () => null }));
vi.mock('../../components/notes/NoteCard', () => ({
  default: ({ note, onPress }) => <button onClick={onPress}>{note.title}</button>,
}));

import SearchScreen from '../SearchScreen';

// Invented notes only.
function Opened() {
  return <p>editor opened, find: {String(useLocation().state?.find ?? 'none')}</p>;
}
const show = () => render(
  <MemoryRouter initialEntries={['/search']}>
    <Routes>
      <Route path="/search" element={<SearchScreen />} />
      <Route path="/note/:id" element={<Opened />} />
    </Routes>
  </MemoryRouter>,
);
const type = (text) => fireEvent.change(screen.getByPlaceholderText('Search notes…'), { target: { value: text } });

beforeEach(() => {
  localStorage.clear();
  h.search.mockReset();
  h.search.mockResolvedValue([{ id: 7, title: 'Garden plan' }]);
});

describe('SearchScreen', () => {
  it('searches the whole note by default and opens a result with the word to find', async () => {
    show();
    type('hose');
    fireEvent.click(await screen.findByText('Garden plan'));
    expect(h.search).toHaveBeenLastCalledWith('hose', { titleOnly: false });
    expect(await screen.findByText('editor opened, find: hose')).toBeTruthy();
  });

  it('searches again with titles only when the "Tt" button is on, and opens results without Find', async () => {
    show();
    type('garden');
    await screen.findByText('Garden plan');
    const tt = screen.getByLabelText('Title only');
    expect(tt.getAttribute('aria-pressed')).toBe('false');
    // "Tt" sits to the left of the clear cross.
    const clear = screen.getByLabelText('Clear');
    expect(tt.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(tt);
    expect(tt.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(h.search).toHaveBeenLastCalledWith('garden', { titleOnly: true }));
    fireEvent.click(await screen.findByText('Garden plan'));
    expect(await screen.findByText('editor opened, find: none')).toBeTruthy();
    expect(localStorage.getItem('searchTitleOnly')).toBe('1');
  });
});
