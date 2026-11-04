import { describe, it, expect } from 'vitest';
import {
  COALESCE_MS, MAX_VERSIONS, baselineEntry, changeLabels, changedFields, groupByDay, planVersion,
  restorePatch, snapshotOf, toPrune, versionPreview,
} from '../versions';

const note = (o = {}) => ({
  uuid: 'n1', title: 'Trip', type: 'text', note: 'Packing list', items: null, encrypted: 0, format: '',
  colorIndex: 0, folderId: 0, modifiedAt: 1000, importance: 0, state: 'normal', ...o,
});
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

describe('changedFields', () => {
  it('names what differs, counting 1/true and ""/null as equal', () => {
    expect(changedFields(note(), note({ title: 'Trip 2', modifiedAt: 5 }))).toEqual(['title', 'modifiedAt']);
    expect(changedFields(note({ format: '' }), note({ format: null }))).toEqual([]);
  });
  it('ignores pin, state and other fields that are not kept', () => {
    expect(changedFields(note(), note({ importance: 1, state: 'trash' }))).toEqual([]);
  });
});

describe('planVersion', () => {
  it('keeps nothing when nothing kept changed', () => {
    expect(planVersion({ before: note(), after: note({ importance: 1 }), history: [], now: T0 })).toBeNull();
  });

  it('keeps the note as it was first, then the edit, when there is no history', () => {
    const plan = planVersion({ before: note(), after: note({ note: 'More' }), history: [], now: T0 });
    expect(plan.baseline.note).toBe('Packing list');
    expect(plan.replace).toBeNull();
    expect(plan.entry).toMatchObject({ note: 'More', kind: 'edit', changed: ['note'], at: T0 });
  });

  it('does not keep an empty note as a baseline', () => {
    const empty = note({ title: '', note: '' });
    expect(planVersion({ before: empty, after: note(), history: [], now: T0 }).baseline).toBeNull();
  });

  it('joins an edit made soon after the last one on the same device', () => {
    const first = { ...snapshotOf(note({ note: 'A' })), id: 'v1', at: T0, kind: 'edit', device: 'web', changed: ['note'] };
    const plan = planVersion({ before: note({ note: 'A' }), after: note({ note: 'AB', title: 'T2' }), history: [first], now: T0 + 60_000 });
    expect(plan.replace.id).toBe('v1');
    expect(plan.entry.note).toBe('AB');
    expect(plan.entry.changed.sort()).toEqual(['note', 'title']);
    expect(plan.entry.at).toBe(T0 + 60_000);
  });

  it('starts a new version after the window, on another device, or after a restore', () => {
    const last = { ...snapshotOf(note()), id: 'v1', at: T0, kind: 'edit', device: 'web', changed: ['note'] };
    const after = note({ note: 'x' });
    expect(planVersion({ before: note(), after, history: [last], now: T0 + COALESCE_MS + 1 }).replace).toBeNull();
    expect(planVersion({ before: note(), after, history: [{ ...last, device: 'android' }], now: T0 + 1000 }).replace).toBeNull();
    expect(planVersion({ before: note(), after, history: [{ ...last, kind: 'restore' }], now: T0 + 1000 }).replace).toBeNull();
    expect(planVersion({ before: note(), after, history: [last], now: T0 + 1000, kind: 'restore' }).replace).toBeNull();
  });

  it('keeps a hand-chosen date as its own kind of change', () => {
    const plan = planVersion({ before: note(), after: note({ modifiedAt: 5 }), history: [], now: T0, kind: 'date' });
    expect(plan.entry).toMatchObject({ kind: 'date', changed: ['modifiedAt'] });
  });

  it('keeps a locked note as ciphertext, whole', () => {
    const plan = planVersion({ before: note({ encrypted: 1, note: 'CIPHER1' }), after: note({ encrypted: 1, note: 'CIPHER2' }), history: [], now: T0 });
    expect(plan.entry.note).toBe('CIPHER2');
    expect(plan.baseline.note).toBe('CIPHER1');
  });
});

describe('baselineEntry', () => {
  it('sorts just before the first edit, even when the note carries a later date', () => {
    expect(baselineEntry(snapshotOf(note({ modifiedAt: 99_999 })), 5000).at).toBe(4999);
    expect(baselineEntry(snapshotOf(note({ modifiedAt: 10 })), 5000).at).toBe(9);
    expect(baselineEntry(snapshotOf(note()), 5000).kind).toBe('baseline');
  });
});

describe('groupByDay', () => {
  it('groups by local day, newest day and newest edit first', () => {
    const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
    const days = groupByDay([{ id: 'a', at: at(3, 9) }, { id: 'b', at: at(4, 8) }, { id: 'c', at: at(4, 20) }, { id: 'd', at: at(3, 23) }]);
    expect(days.map(d => d.day)).toEqual(['2026-11-04', '2026-11-03']);
    expect(days[0].versions.map(v => v.id)).toEqual(['c', 'b']);
    expect(days[1].versions.map(v => v.id)).toEqual(['d', 'a']);
  });
  it('is empty for no versions', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('changeLabels and versionPreview', () => {
  it('names the changes once each', () => {
    expect(changeLabels({ kind: 'edit', changed: ['note', 'items', 'modifiedAt', 'colorIndex'] })).toEqual(['Text', 'Checklist', 'Date', 'Colour']);
    expect(changeLabels({ kind: 'baseline', changed: [] })).toEqual(['Original']);
    expect(changeLabels({ kind: 'restore', changed: ['note'] })).toEqual(['Restored']);
    expect(changeLabels({ kind: 'edit', changed: [] })).toEqual(['Edited']);
  });
  it('shows text, checklists and never ciphertext', () => {
    expect(versionPreview({ type: 'text', note: 'a\n\n b' })).toBe('a b');
    expect(versionPreview({ type: 'checklist', items: [{ text: 'x', checked: true }, { text: 'y', checked: false }] })).toBe('✓ x ☐ y');
    expect(versionPreview({ type: 'text', note: 'U2FsdGVk', encrypted: 1 })).toBe('');
    expect(versionPreview({ type: 'text', note: 'x'.repeat(300) }).length).toBe(141);
  });
});

describe('restorePatch', () => {
  it('writes back only what differs, including the date', () => {
    const v = { ...snapshotOf(note({ title: 'Old', modifiedAt: 7 })), id: 'v' };
    expect(restorePatch(v, note({ title: 'New', modifiedAt: 9 }))).toEqual({ title: 'Old', modifiedAt: 7 });
    expect(restorePatch(v, note({ title: 'Old', modifiedAt: 7 }))).toEqual({});
  });
});

describe('toPrune', () => {
  const mk = (n, baseline) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, kind: baseline && i === n - 1 ? 'baseline' : 'edit' }));
  it('keeps everything under the cap', () => {
    expect(toPrune(mk(MAX_VERSIONS))).toEqual([]);
  });
  it('drops the oldest over the cap but never the baseline', () => {
    const list = mk(MAX_VERSIONS + 3, true);
    const gone = toPrune(list).map(v => v.id);
    expect(gone).toHaveLength(3);
    expect(gone).not.toContain(list[list.length - 1].id);
    expect(gone).toEqual(['v199', 'v200', 'v201']);
  });
});
