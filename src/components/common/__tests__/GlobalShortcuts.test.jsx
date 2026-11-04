import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../../db/database', () => ({ getSetting: async (_k, d) => d }));

import GlobalShortcuts from '../GlobalShortcuts';
import useUIStore from '../../../store/uiStore';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
const mount = (start = '/') => render(
  <MemoryRouter initialEntries={[start]}>
    <GlobalShortcuts /><input data-testid="field" /><Where />
  </MemoryRouter>
);
const press = (init, target = window) => fireEvent.keyDown(target, init);
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => useUIStore.setState({ toast: null, shortcutsOpen: false }));

describe('global shortcuts', () => {
  it('Ctrl+Alt+N opens a new text note and says so', () => {
    mount();
    press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    expect(where()).toBe('/note/new?type=text');
    expect(useUIStore.getState().toast.message).toBe('Shortcut Done: New text note');
  });

  it('Ctrl+Alt+L opens a new checklist, even from inside a field', () => {
    mount();
    press({ key: 'l', code: 'KeyL', ctrlKey: true, altKey: true }, screen.getByTestId('field'));
    expect(where()).toBe('/note/new?type=checklist');
    expect(useUIStore.getState().toast.message).toBe('Shortcut Done: New checklist');
  });

  it('/ opens Search, but is left alone while typing; Ctrl+K works anywhere', () => {
    mount();
    press({ key: '/', code: 'Slash' }, screen.getByTestId('field'));
    expect(where()).toBe('/');
    press({ key: '/', code: 'Slash' });
    expect(where()).toBe('/search');
    expect(useUIStore.getState().toast.message).toBe('Shortcut Done: Search');
  });

  it('Ctrl+K opens Search from inside a field', () => {
    mount('/folders');
    press({ key: 'k', code: 'KeyK', ctrlKey: true }, screen.getByTestId('field'));
    expect(where()).toBe('/search');
  });

  it('G then a letter goes to that screen; a late second key does nothing', () => {
    vi.useFakeTimers();
    try {
      mount();
      press({ key: 'g', code: 'KeyG' });
      press({ key: 'c', code: 'KeyC' });
      expect(where()).toBe('/calendar');
      expect(useUIStore.getState().toast.message).toBe('Shortcut Done: Calendar');
      press({ key: 'g', code: 'KeyG' });
      vi.advanceTimersByTime(1500);
      press({ key: 'm', code: 'KeyM' });
      expect(where()).toBe('/calendar');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not toast when already on that screen', () => {
    mount('/search');
    press({ key: '/', code: 'Slash' });
    expect(useUIStore.getState().toast).toBe(null);
  });

  it('? opens and closes the cheat sheet', () => {
    mount();
    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(useUIStore.getState().shortcutsOpen).toBe(true);
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
    press({ key: '?', code: 'Slash', shiftKey: true });
    expect(useUIStore.getState().shortcutsOpen).toBe(false);
  });
});
