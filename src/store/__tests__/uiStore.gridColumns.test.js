import { describe, it, expect, vi, beforeEach } from 'vitest';

// getSetting does a real IndexedDB round-trip in the app (see db/database.js),
// which is genuinely async and not instant. Mocked here with a controllable
// promise so the test can land a manual column pick *while the read is still
// pending* — that's the exact window the real bug lived in, and it's not one
// a fixed-delay mock or a "just await everything" test would ever hit.
vi.mock('../../db/database', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting } from '../../db/database';
import useUIStore from '../uiStore';

function resetStore() {
  useUIStore.setState({ homeGridColumns: 1, gridColumnsInitialized: false });
}

describe('uiStore — homeGridColumns init vs. manual-set race', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('does not clobber a manual column pick made while the settings read is still in flight', async () => {
    // Hold the settings read open until the test says otherwise.
    let resolveSetting;
    getSetting.mockImplementation(() => new Promise((resolve) => { resolveSetting = resolve; }));

    // Mount-time init kicks off, but doesn't resolve yet — mirrors
    // HomeScreen's `useEffect(() => { initHomeGridColumns(); }, [])`.
    const initPromise = useUIStore.getState().initHomeGridColumns();

    // The user opens the view menu and picks "3 columns" before the
    // IndexedDB read comes back.
    useUIStore.getState().setHomeGridColumns(3);
    expect(useUIStore.getState().homeGridColumns).toBe(3);

    // The pending read now resolves with a *different* persisted default —
    // this is the moment the old code silently overwrote the user's pick.
    resolveSetting(1);
    await initPromise;

    expect(useUIStore.getState().homeGridColumns).toBe(3);
    expect(useUIStore.getState().gridColumnsInitialized).toBe(true);
  });

  it('applies the persisted default when nothing raced it', async () => {
    getSetting.mockResolvedValue(2);
    await useUIStore.getState().initHomeGridColumns();
    expect(useUIStore.getState().homeGridColumns).toBe(2);
    expect(useUIStore.getState().gridColumnsInitialized).toBe(true);
  });

  it('is a no-op once already initialized (does not re-read settings or reset the count)', async () => {
    useUIStore.setState({ homeGridColumns: 4, gridColumnsInitialized: true });
    getSetting.mockResolvedValue(1);

    await useUIStore.getState().initHomeGridColumns();

    expect(getSetting).not.toHaveBeenCalled();
    expect(useUIStore.getState().homeGridColumns).toBe(4);
  });

  it('clamps a corrupt/out-of-range persisted setting to a safe 1-4 value instead of passing it through', async () => {
    getSetting.mockResolvedValue(99);
    await useUIStore.getState().initHomeGridColumns();
    expect(useUIStore.getState().homeGridColumns).toBe(4);
  });

  it('clamps a non-numeric persisted setting to 1 instead of producing NaN', async () => {
    getSetting.mockResolvedValue('not-a-number');
    await useUIStore.getState().initHomeGridColumns();
    expect(useUIStore.getState().homeGridColumns).toBe(1);
  });

  it('clamps an out-of-range manual setHomeGridColumns call the same way', () => {
    useUIStore.getState().setHomeGridColumns(0);
    expect(useUIStore.getState().homeGridColumns).toBe(1);
    useUIStore.getState().setHomeGridColumns(-5);
    expect(useUIStore.getState().homeGridColumns).toBe(1);
    useUIStore.getState().setHomeGridColumns(12);
    expect(useUIStore.getState().homeGridColumns).toBe(4);
  });
});
