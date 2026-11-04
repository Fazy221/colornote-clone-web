import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// ── Fake ~300 notes so batching/growth logic actually has something to do ──
function makeNotes(n) {
  const notes = [];
  for (let i = 0; i < n; i++) {
    notes.push({
      id: i + 1,
      title: `Note ${i + 1}`,
      note: 'Some preview text',
      type: 'text',
      colorIndex: i % 10,
      importance: 0,
      state: 'normal',
      modifiedAt: Date.now() - i * 1000,
      createdAt: Date.now() - i * 1000,
    });
  }
  return notes;
}
const FAKE_NOTES = makeNotes(300);

// ── Mock noteStore so we don't need real IndexedDB/Dexie ──
vi.mock('../../store/noteStore', () => ({
  default: (selector) => {
    const state = {
      notes: FAKE_NOTES,
      loading: false,
      activeState: 'normal',
      loadNotes: vi.fn(),
      archiveNotes: vi.fn(),
      trashNotes: vi.fn(),
      setColorForNotes: vi.fn(),
      setPinForNotes: vi.fn(),
      setFolderForNotes: vi.fn(),
      liveReminderIds: vi.fn(async () => []),
    };
    return selector ? selector(state) : state;
  },
}));

// ── Mock database.js settings (colorStore/uiStore/SettingsScreen use these) ──
vi.mock('../../db/database', () => ({
  getSetting: vi.fn(async (key, def) => def),
  setSetting: vi.fn(async () => {}),
}));

// The sync icon reads the outbox from IndexedDB, which these tests don't have.
vi.mock('../../components/layout/SyncStatus', () => ({ default: () => null }));
vi.mock('../../components/layout/ConflictsButton', () => ({ default: () => null }));

import HomeScreen from '../HomeScreen';

// ── Fake IntersectionObserver — jsdom doesn't implement one, and we also
// want to manually fire intersection entries to test the growth logic
// without depending on real layout geometry (jsdom has none). ──
class FakeIntersectionObserver {
  constructor(cb, options) {
    this.cb = cb;
    this.options = options;
    this.observed = new Set();
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el) { this.observed.add(el); }
  unobserve(el) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); FakeIntersectionObserver.instances = FakeIntersectionObserver.instances.filter(i => i !== this); }
  // test helper: pretend the sentinel scrolled into view
  fireIntersecting() {
    this.cb([{ isIntersecting: true, target: [...this.observed][0] }]);
  }
}
FakeIntersectionObserver.instances = [];

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  // Force MUI's useMediaQuery('(min-width:900px)') to report desktop=true
  vi.stubGlobal('matchMedia', (query) => ({
    matches: true, // pretend every query matches — good enough for isDesktop=true
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HomeScreen />
    </MemoryRouter>
  );
}

describe('HomeScreen grid view', () => {
  it('renders list view with no errors by default', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    renderHome();
    expect(errors, `console.error calls: ${JSON.stringify(errors)}`).toHaveLength(0);
    spy.mockRestore();
  });

  it('switching to grid view does not throw and applies grid layout', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const user = userEvent.setup();
    renderHome();

    // Open the view menu (icon button — find by aria-label)
    const viewBtn = screen.getByLabelText('Change view');
    await user.click(viewBtn);

    const threeColOption = await screen.findByText('3 columns');
    await user.click(threeColOption);

    expect(errors, `console.error calls after switching view: ${JSON.stringify(errors)}`).toHaveLength(0);

    // Verify grid container actually exists with 3 columns
    const container = screen.getByTestId('notes-container');
    expect(container.dataset.view, 'expected view to be grid after switching to 3 columns').toBe('grid');
    expect(container.dataset.columns, 'expected 3 columns').toBe('3');

    spy.mockRestore();
  });

  it('scrolling (simulated intersection) after switching grid view does not revert to list view or throw', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByLabelText('Change view'));
    await user.click(await screen.findByText('3 columns'));

    // Fire the (fake) IntersectionObserver as if the sentinel scrolled into view,
    // possibly multiple times in a row (simulating fast scroll / rapid re-trigger).
    await act(async () => {
      for (const obs of [...FakeIntersectionObserver.instances]) {
        obs.fireIntersecting();
      }
    });
    await act(async () => {
      for (const obs of [...FakeIntersectionObserver.instances]) {
        obs.fireIntersecting();
      }
    });

    expect(errors, `console.error calls after simulated scroll: ${JSON.stringify(errors)}`).toHaveLength(0);

    const container = screen.getByTestId('notes-container');
    expect(container.dataset.view, 'grid view should still be active after scrolling — should NOT have reverted to list view').toBe('grid');
    expect(container.dataset.columns).toBe('3');

    spy.mockRestore();
  });

  it('switching between multiple column counts in a row does not throw or revert', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
    const user = userEvent.setup();
    renderHome();

    for (const label of ['2 columns', '3 columns', '4 columns', '1 column (list)', '3 columns']) {
      await user.click(screen.getByLabelText('Change view'));
      await user.click(await screen.findByText(label));
      await act(async () => {
        for (const obs of [...FakeIntersectionObserver.instances]) {
          obs.fireIntersecting();
        }
      });
    }

    expect(errors, `console.error calls: ${JSON.stringify(errors)}`).toHaveLength(0);
    const container = screen.getByTestId('notes-container');
    expect(container.dataset.view).toBe('grid');
    expect(container.dataset.columns).toBe('3');

    spy.mockRestore();
    // Five menu round trips over 300 cards: about 1s each on a busy machine, past the 5s default.
  }, 20000);
});
