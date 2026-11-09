import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ cloud: null, applied: [] }));

vi.mock('../../db/database', () => ({
  getSetting: async (key, def = null) => (key === 'folders' && h.cloud ? h.cloud : def),
  setSetting: async () => {},
  getFolderCounts: async () => ({ 1000: 3, 1001: 1 }),
  hiddenPrefs: async () => ({ showHidden: false, searchHidden: false }),
}));
vi.mock('../../sync/notesSync', () => ({
  syncSetting: async () => {},
  pullSetting: async () => {},
}));
vi.mock('../../store/noteStore', () => ({
  default: Object.assign(() => ({}), {
    getState: () => ({
      clearFolder: async () => {},
      applyColorToFolder: async (...args) => { h.applied.push(args); },
    }),
  }),
}));

import FoldersScreen from '../FoldersScreen';
import useFolderStore from '../../store/folderStore';

const renderScreen = () => render(<MemoryRouter><FoldersScreen /></MemoryRouter>);

beforeEach(() => {
  h.applied = [];
  h.cloud = [
    { id: 1000, name: 'Sample work', color: 4, icon: 4 },
    { id: 1001, name: 'Sample home', color: 0, icon: 0 },
    { id: 1002, name: 'Sample trip', color: 2, icon: 7 },
  ];
  useFolderStore.setState({ folders: [], counts: {}, sort: 'color', loaded: false });
});

describe('FoldersScreen', () => {
  it('lists the folders by colour with their note counts', async () => {
    renderScreen();
    const rows = await screen.findAllByTestId('folder-row');
    expect(rows.map(r => within(r).getByText(/^Sample/).textContent)).toEqual(['Sample trip', 'Sample work', 'Sample home']);
    expect(await within(rows[1]).findByText('3')).toBeTruthy();
    expect(within(rows[0]).getByText('0')).toBeTruthy();
  });

  it('says so when there are no folders', async () => {
    h.cloud = [];
    renderScreen();
    expect(await screen.findByText('No folders')).toBeTruthy();
  });

  it('applies the folder colour to its notes after confirming', async () => {
    renderScreen();
    const rows = await screen.findAllByTestId('folder-row');
    fireEvent.click(within(rows[1]).getByLabelText('Folder options'));
    fireEvent.click(await screen.findByText('Apply folder color'));
    fireEvent.click(await screen.findByText('OK'));
    expect(h.applied).toEqual([[1000, 4]]);
  });

  it('does not offer "Apply folder color" for a folder with no colour', async () => {
    renderScreen();
    const rows = await screen.findAllByTestId('folder-row');
    fireEvent.click(within(rows[2]).getByLabelText('Folder options'));
    expect(await screen.findByText('Rename')).toBeTruthy();
    expect(screen.queryByText('Apply folder color')).toBeNull();
  });
});
