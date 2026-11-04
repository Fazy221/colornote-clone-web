import { describe, it, expect, beforeEach, vi } from 'vitest';

// An in-memory stand-in for the versions table.
const h = vi.hoisted(() => ({ rows: new Map() }));

vi.mock('../database', () => {
  const where = (field) => ({
    equals: (value) => {
      const pick = () => [...h.rows.values()].filter(r => r[field] === value);
      return {
        toArray: async () => pick().map(r => ({ ...r })),
        delete: async () => { pick().forEach(r => h.rows.delete(r.id)); },
        and: (fn) => ({
          modify: async (patch) => { pick().filter(fn).forEach(r => h.rows.set(r.id, { ...r, ...patch })); },
        }),
      };
    },
  });
  return {
    db: {
      versions: {
        where,
        get: async (id) => (h.rows.has(id) ? { ...h.rows.get(id) } : undefined),
        put: async (row) => { h.rows.set(row.id, { ...row }); },
        bulkPut: async (rows) => { rows.forEach(r => h.rows.set(r.id, { ...r })); },
        bulkDelete: async (ids) => { ids.forEach(id => h.rows.delete(id)); },
      },
    },
  };
});

import {
  deleteVersionsFor, listVersions, markVersionSynced, recordVersion, takeCloudVersions, unsyncedVersions,
} from '../versionLog';

const note = (o = {}) => ({
  uuid: 'n1', title: 'Trip', type: 'text', note: 'one', items: null, encrypted: 0, format: '',
  colorIndex: 0, folderId: 0, modifiedAt: 1000, ...o,
});
const T = 1_700_000_000_000;

beforeEach(() => { h.rows.clear(); });

describe('recordVersion', () => {
  it('keeps the original and the first edit when a note with text is first edited', async () => {
    const r = await recordVersion(note(), note({ note: 'two' }), { now: T });
    expect(r.written).toHaveLength(2);
    const list = await listVersions('n1');
    expect(list.map(v => [v.kind, v.note])).toEqual([['edit', 'two'], ['baseline', 'one']]);
    expect(list.every(v => v.synced === 0)).toBe(true);
  });

  it('turns a run of quick edits into one version', async () => {
    await recordVersion(note(), note({ note: 'two' }), { now: T });
    await recordVersion(note({ note: 'two' }), note({ note: 'three' }), { now: T + 30_000 });
    await recordVersion(note({ note: 'three' }), note({ note: 'four' }), { now: T + 60_000 });
    const list = await listVersions('n1');
    expect(list).toHaveLength(2);
    expect(list[0].note).toBe('four');
  });

  it('starts a new version a long while later', async () => {
    await recordVersion(note(), note({ note: 'two' }), { now: T });
    await recordVersion(note({ note: 'two' }), note({ note: 'three' }), { now: T + 3_600_000 });
    expect(await listVersions('n1')).toHaveLength(3);
  });

  it('does nothing when nothing kept changed, or the note has no uuid', async () => {
    expect(await recordVersion(note(), note({ importance: 1 }), { now: T })).toBeNull();
    expect(await recordVersion(note(), note({ uuid: undefined, note: 'x' }), { now: T })).toBeNull();
    expect(h.rows.size).toBe(0);
  });

  it('two saves at once still make one baseline', async () => {
    await Promise.all([
      recordVersion(note(), note({ note: 'two' }), { now: T }),
      recordVersion(note({ note: 'two' }), note({ note: 'three' }), { now: T + 1000 }),
    ]);
    const list = await listVersions('n1');
    expect(list.filter(v => v.kind === 'baseline')).toHaveLength(1);
    expect(list).toHaveLength(2);
  });

  it('prunes beyond the cap but keeps the original', async () => {
    let prev = note();
    for (let i = 1; i <= 205; i++) {
      const next = note({ note: `v${i}` });
      await recordVersion(prev, next, { now: T + i * 3_600_000 });
      prev = next;
    }
    const list = await listVersions('n1');
    expect(list).toHaveLength(200);
    expect(list[0].note).toBe('v205');
    expect(list[list.length - 1].kind).toBe('baseline');
  });

  it('keeps notes apart', async () => {
    await recordVersion(note(), note({ note: 'two' }), { now: T });
    await recordVersion(note({ uuid: 'n2' }), note({ uuid: 'n2', note: 'b' }), { now: T });
    await deleteVersionsFor('n1');
    expect(await listVersions('n1')).toEqual([]);
    expect(await listVersions('n2')).toHaveLength(2);
  });
});

describe('cloud bookkeeping', () => {
  it('marks a version synced only if it was not changed meanwhile', async () => {
    await recordVersion(note(), note({ note: 'two' }), { now: T });
    const [edit] = await listVersions('n1');
    await recordVersion(note({ note: 'two' }), note({ note: 'three' }), { now: T + 1000 }); // joins it
    await markVersionSynced(edit); // the send of the older copy finishing
    expect((await unsyncedVersions()).map(v => v.id)).toContain(edit.id);
    const [fresh] = await listVersions('n1');
    await markVersionSynced(fresh);
    expect((await unsyncedVersions()).map(v => v.id)).not.toContain(edit.id);
  });

  it('takes in the cloud versions but keeps one still waiting to go out', async () => {
    await recordVersion(note(), note({ note: 'mine' }), { now: T });
    const [mine] = await listVersions('n1');
    const added = await takeCloudVersions('n1', [
      { id: mine.id, data: { ...mine, note: 'cloud copy' } },
      { id: 'phone-1', data: { at: T - 5000, kind: 'edit', device: 'android', changed: ['note'], note: 'from phone', modifiedAt: 1 } },
    ]);
    expect(added).toBe(1);
    const list = await listVersions('n1');
    expect(list.find(v => v.id === mine.id).note).toBe('mine');
    expect(list.find(v => v.id === 'phone-1')).toMatchObject({ note: 'from phone', synced: 1, noteUuid: 'n1' });
  });
});
