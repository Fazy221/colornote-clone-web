import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ saved: {} }));
vi.mock('../../../db/database', () => ({
  getSetting: vi.fn(async (key, fallback) => (key in h.saved ? h.saved[key] : fallback)),
  setSetting: vi.fn(),
}));

import useUIStore from '../../../store/uiStore';
import PageFrame from '../PageFrame';

const show = () => render(<PageFrame><p>Invented screen</p></PageFrame>);
const column = () => screen.getByTestId('page-frame').firstChild;

beforeEach(() => {
  h.saved = {};
  useUIStore.setState({ pageWidth: 'fixed' });
});

describe('the page width', () => {
  it('is a centred 880px column by default', async () => {
    await useUIStore.getState().loadPageWidth();
    show();
    expect(screen.getByTestId('page-frame').dataset.width).toBe('fixed');
    const style = getComputedStyle(column());
    expect(style.maxWidth).toBe('880px');
    expect(style.transform).toBe('translateZ(0)');
    expect(screen.getByText('Invented screen')).toBeTruthy();
  });

  it('fills the window when set to full width, without remounting the screen', async () => {
    show();
    const before = screen.getByText('Invented screen');
    h.saved.pageWidth = 'fluid';
    await act(() => useUIStore.getState().loadPageWidth());
    expect(screen.getByTestId('page-frame').dataset.width).toBe('fluid');
    expect(getComputedStyle(column()).maxWidth).not.toBe('880px');
    expect(screen.getByText('Invented screen')).toBe(before);
  });

  it('treats an unknown saved value as the default', async () => {
    h.saved.pageWidth = 'something else';
    await useUIStore.getState().loadPageWidth();
    expect(useUIStore.getState().pageWidth).toBe('fixed');
    useUIStore.getState().setPageWidth('fluid');
    expect(useUIStore.getState().pageWidth).toBe('fluid');
  });
});
