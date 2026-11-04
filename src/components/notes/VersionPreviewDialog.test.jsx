import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VersionPreviewDialog from './VersionPreviewDialog';

const v = (o = {}) => ({
  id: 'b', at: new Date(2026, 10, 4, 9, 0).getTime(), kind: 'edit', device: 'web', changed: ['note'], title: 'Trip',
  type: 'text', note: 'we went to the lake', items: null, encrypted: 0, colorIndex: 0, folderId: 0, format: null,
  modifiedAt: new Date(2026, 10, 4).getTime(), ...o,
});
const before = v({ id: 'a', at: new Date(2026, 10, 3, 9, 0).getTime(), note: 'we went to the sea' });
const now = v({ id: 'c', note: 'we went to the lake today' });

const show = (props = {}) => render(
  <VersionPreviewDialog
    open version={v()} previous={before} current={now} isCurrent={false} colorNames={['', 'Red']} folders={[{ id: 7, name: 'Trips' }]}
    onClose={vi.fn()} onRestore={vi.fn()} {...props}
  />,
);

describe('VersionPreviewDialog', () => {
  it('is read-only: no inputs, and says so', () => {
    show();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')).toHaveLength(0);
  });

  it('marks added words as inserted and removed words as deleted, against the version before', () => {
    show();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('del').textContent).toBe('sea');
    expect([...dialog.querySelectorAll('ins')].some(e => e.textContent === 'lake')).toBe(true);
    expect(screen.getByText('2 changes')).toBeTruthy();
  });

  it('can compare with the note as it is now, showing what Restore would change', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'What Restore would change' }));
    const dialog = screen.getByRole('dialog');
    // Now has "today" extra: restoring this version takes it away.
    expect([...dialog.querySelectorAll('del')].some(e => e.textContent.trim() === 'today')).toBe(true);
  });

  it('starts on the current note when there is no earlier version, and says why', () => {
    show({ previous: null });
    expect(screen.getByRole('button', { name: 'What this edit changed' }).disabled).toBe(true);
    expect(screen.getByRole('dialog').querySelector('del')).toBeTruthy();
  });

  it('says there is nothing to compare for the current version of a first edit', () => {
    show({ previous: null, isCurrent: true });
    expect(screen.getByText(/first saved version/)).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore this version/ })).toBeNull();
  });

  it('lists a changed colour and folder', () => {
    show({ version: v({ colorIndex: 1, folderId: 7 }) });
    expect(screen.getByText('Colour')).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
    expect(screen.getByText('Trips')).toBeTruthy();
  });

  it('shows a checklist with ticked, added and removed rows', () => {
    const a = v({ id: 'a', type: 'checklist', note: '', items: [{ text: 'milk', checked: false }, { text: 'eggs', checked: false }] });
    const b = v({ type: 'checklist', note: '', items: [{ text: 'milk', checked: true }, { text: 'tea', checked: false }] });
    show({ version: b, previous: a, current: b });
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('now ticked')).toBeTruthy();
    expect(dialog.querySelector('del').textContent).toContain('eggs');
    expect([...dialog.querySelectorAll('ins')].some(e => e.textContent.includes('tea'))).toBe(true);
  });

  it('never shows locked content, only that it is locked', () => {
    const locked = v({ encrypted: 1, note: 'U2FsdGVkX1+secret' });
    show({ version: locked, previous: v({ id: 'a', encrypted: 1, note: 'U2FsdGVkX1+other' }), current: locked });
    expect(screen.getByText('Locked note, content not shown')).toBeTruthy();
    expect(document.body.textContent).not.toContain('U2FsdGVk');
  });

  it('hands the version to Restore, and closes', async () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    show({ onRestore, onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
