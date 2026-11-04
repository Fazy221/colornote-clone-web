import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Invented notes only.
const h = vi.hoisted(() => ({ notes: [], resolveConflict: null }));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => h.notes }));
vi.mock('../../db/database', () => ({ db: {} }));
vi.mock('../../store/noteStore', () => ({
  default: (selector) => selector({ resolveConflict: h.resolveConflict }),
}));

import ConflictsScreen from '../ConflictsScreen';

const show = () => render(<MemoryRouter><ConflictsScreen /></MemoryRouter>);

beforeEach(() => {
  h.resolveConflict = vi.fn(async () => {});
  h.notes = [
    { id: 1, uuid: 'a', title: 'Invented list', type: 'text', note: 'first\nsecond', state: 'normal', modifiedAt: 2000 },
    { id: 2, uuid: 'c', title: '[conflict] Invented list', type: 'text', note: 'first\nchanged', state: 'normal', modifiedAt: 1000, conflictOf: 'a' },
    { id: 3, uuid: 'x', title: 'Unrelated', type: 'text', note: 'other', state: 'normal', modifiedAt: 1500 },
  ];
});

describe('the conflicts screen', () => {
  it('lists each copy, then compares it with its note and applies the choice', async () => {
    show();
    expect(screen.queryByText('Unrelated')).toBeNull();
    fireEvent.click(screen.getByText('Invented list'));

    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByText('changed')).toBeTruthy();
    fireEvent.click(screen.getByText("Keep the copy's version"));
    await waitFor(() => expect(h.resolveConflict).toHaveBeenCalledTimes(1));
    const [original, copy, choice] = h.resolveConflict.mock.calls[0];
    expect([original.uuid, copy.uuid, choice]).toEqual(['a', 'c', 'copy']);
    await waitFor(() => expect(screen.queryByText("Keep the copy's version")).toBeNull());
  });

  it('does not show the text of locked notes', () => {
    h.notes[1] = { ...h.notes[1], encrypted: 1, note: 'ciphertext' };
    show();
    fireEvent.click(screen.getByText('Invented list'));
    expect(screen.getByText(/Locked notes aren't shown here/)).toBeTruthy();
    expect(screen.queryByText('ciphertext')).toBeNull();
    expect(screen.getByText('Keep both')).toBeTruthy();
  });

  it('says so when there is nothing to review', () => {
    h.notes = h.notes.filter(n => n.uuid !== 'c');
    show();
    expect(screen.getByText('No conflicts')).toBeTruthy();
  });
});
