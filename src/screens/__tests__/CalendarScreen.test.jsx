import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../db/database', () => ({
  db: { notes: { filter: () => ({ toArray: async () => [] }) } },
  hiddenPrefs: async () => ({ showHidden: false, searchHidden: false }),
  isHidden: (n) => !!n?.hidden,
}));
vi.mock('../../components/layout/BottomNav', () => ({ default: () => null }));

import CalendarScreen from '../CalendarScreen';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const label = (offset) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

describe('the calendar screen', () => {
  it('steps the month with the arrow keys and returns to this month from the top bar', () => {
    render(<MemoryRouter><CalendarScreen /></MemoryRouter>);
    expect(screen.getByText(label(0))).toBeTruthy();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(label(1))).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(label(2))).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText(label(-1))).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Go to this month'));
    expect(screen.getByText(label(0))).toBeTruthy();
  });

  it('jumps back to this month on T, but not while typing', () => {
    render(<MemoryRouter><><input data-testid="field" /><CalendarScreen /></></MemoryRouter>);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 't' });
    expect(screen.getByText(label(2))).toBeTruthy();
    fireEvent.keyDown(window, { key: 't' });
    expect(screen.getByText(label(0))).toBeTruthy();
  });

  it('leaves the arrow keys alone while typing in a field', () => {
    render(<MemoryRouter><><input data-testid="field" /><CalendarScreen /></></MemoryRouter>);
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'ArrowRight' });
    expect(screen.getByText(label(0))).toBeTruthy();
  });

  it('opens the date picker from the month title and turns to the month chosen', async () => {
    render(<MemoryRouter><CalendarScreen /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Pick a month'));
    fireEvent.click(screen.getByLabelText('Next month'));
    fireEvent.click(screen.getByLabelText('Next month'));
    fireEvent.click(screen.getByText('OK'));
    expect(screen.getByText(label(2))).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('OK')).toBeNull());
  });

  it('leaves the month alone when the picker is cancelled', () => {
    render(<MemoryRouter><CalendarScreen /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Pick a month'));
    fireEvent.click(screen.getByLabelText('Next month'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText(label(0))).toBeTruthy();
  });
});
