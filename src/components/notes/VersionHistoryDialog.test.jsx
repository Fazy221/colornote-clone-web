import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ versions: [], current: null, restore: vi.fn(), pulled: true }));

vi.mock('../../db/database', () => ({ db: { notes: { get: async () => h.current } } }));
vi.mock('../../db/versionLog', () => ({ listVersions: async () => h.versions }));
vi.mock('../../sync/notesSync', () => ({ pullVersions: async () => h.pulled }));
vi.mock('../../store/noteStore', () => ({
  default: (sel) => sel({ restoreVersion: h.restore }),
}));

vi.mock('../../store/colorStore', () => ({ default: (sel) => sel({ colorNames: ['', 'Red'] }) }));
vi.mock('../../store/folderStore', () => ({ default: (sel) => sel({ folders: [] }) }));

import VersionHistoryDialog from './VersionHistoryDialog';

const at = (d, hr) => new Date(2026, 10, d, hr, 0).getTime();
const v = (id, when, o = {}) => ({
  id, at: when, kind: 'edit', device: 'web', changed: ['note'], title: 'Trip', type: 'text', note: `text ${id}`,
  encrypted: 0, colorIndex: 0, folderId: 0, format: null, items: null, modifiedAt: when, ...o,
});

const open = (props = {}) => render(
  <VersionHistoryDialog open noteId={1} noteUuid="n1" onClose={vi.fn()} onRestored={vi.fn()} {...props} />,
);

beforeEach(() => {
  h.versions = [v('a', at(4, 20)), v('b', at(4, 9)), v('c', at(3, 8))];
  h.current = { id: 1, uuid: 'n1', ...v('a', at(4, 20)) };
  h.restore.mockReset().mockResolvedValue(true);
  h.pulled = true;
});

describe('VersionHistoryDialog', () => {
  it('groups edits by day with a count, the newest day open', async () => {
    open();
    expect(await screen.findByText('2 edits')).toBeTruthy();
    expect(screen.getByText('1 edit')).toBeTruthy();
    expect(screen.getByText('text a')).toBeTruthy();
    expect(screen.getByText('text b')).toBeTruthy();
    // The older day is collapsed.
    expect(screen.getByRole('button', { name: /November 3, 2026/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the version the note is at now, and offers Restore on the others', async () => {
    open();
    await screen.findByText('2 edits');
    expect(screen.getAllByText('Current')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1);
  });

  it('never shows the content of a locked note', async () => {
    h.versions = [v('a', at(4, 20), { encrypted: 1, note: 'U2FsdGVkX1+secret' })];
    h.current = { id: 1, ...h.versions[0] };
    open();
    expect(await screen.findByText(/Locked note, content not shown/)).toBeTruthy();
    expect(screen.queryByText(/U2FsdGVk/)).toBeNull();
  });

  it('opens a read-only preview of a version, which can lead to Restore', async () => {
    open();
    await screen.findByText('2 edits');
    await userEvent.click(screen.getByRole('button', { name: /View 9:00 AM/ }));
    const preview = (await screen.findByText('Read-only')).closest('[role="dialog"]');
    expect(preview.querySelector('ins').textContent).toBe('b');
    expect(preview.querySelector('del').textContent).toBe('c');
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    expect(await screen.findByText('Restore this version?')).toBeTruthy();
    expect(h.restore).not.toHaveBeenCalled();
  });

  it('says so when there is no history yet', async () => {
    h.versions = [];
    open();
    expect(await screen.findByText(/No earlier versions yet/)).toBeTruthy();
  });

  it('asks before restoring, then restores and reports it', async () => {
    const onRestored = vi.fn();
    const onClose = vi.fn();
    open({ onRestored, onClose });
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(h.restore).not.toHaveBeenCalled();
    const confirm = await screen.findByText('Restore this version?');
    await userEvent.click(within(confirm.closest('[role="dialog"]')).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(h.restore).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'b' })));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('says it is showing this device only when the cloud could not be reached', async () => {
    h.pulled = false;
    open();
    expect(await screen.findByText(/Offline: showing what this device has/)).toBeTruthy();
  });
});
