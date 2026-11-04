import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory stand-ins for Dexie and Firestore. Notes here are invented.
const h = vi.hoisted(() => ({
  local: [],
  nextId: 1,
  remote: new Map(),
  cacheOnly: false,
  cacheFirst: null,
  listener: null,
  listens: 0,
  setDocs: [],
  updates: [],
  batchSets: [],
  deleted: [],
  outbox: new Map(),
  settings: new Map(),
  remoteSettings: null,
  online: true,
  failWrites: null,
  bases: new Map(),
  gate: null,
  held: 0,
}));

// A write the cloud refuses (offline mid-way, say), when a test sets h.failWrites to an error code.
const maybeFail = () => {
  if (h.failWrites) throw Object.assign(new Error('refused'), { code: h.failWrites });
};

// set with { merge: true } keeps the fields it doesn't name, as Firestore does.
const write = (id, data, opts) => {
  h.remote.set(id, opts?.merge ? { ...(h.remote.get(id) || {}), ...data } : data);
};

vi.mock('../../firebase', () => ({ db: {} }));

vi.mock('../../store/noteStore', () => ({
  default: { getState: () => ({ activeState: 'normal', loadNotes: () => {} }) },
}));

vi.mock('../../db/database', () => ({
  setSetting: async (key, value) => { h.settings.set(key, value); },
  getSetting: async (key, def = null) => (h.settings.has(key) ? h.settings.get(key) : def),
  db: {
    settings: {
      toArray: async () => [...h.settings].map(([key, value]) => ({ key, value })),
      bulkPut: async (rows) => { for (const r of rows) h.settings.set(r.key, r.value); },
    },
    outbox: {
      get: async (key) => (h.outbox.has(key) ? { ...h.outbox.get(key) } : undefined),
      put: async (entry) => { h.outbox.set(entry.key, { ...entry }); },
      delete: async (key) => { h.outbox.delete(key); },
      toArray: async () => [...h.outbox.values()].map(e => ({ ...e })),
    },
    bases: {
      get: async (uuid) => (h.bases.has(uuid) ? { uuid, doc: { ...h.bases.get(uuid) } } : undefined),
      put: async (row) => { h.bases.set(row.uuid, { ...row.doc }); },
      delete: async (uuid) => { h.bases.delete(uuid); },
      toArray: async () => [...h.bases].map(([uuid, doc]) => ({ uuid, doc: { ...doc } })),
      clear: async () => { h.bases.clear(); },
      bulkPut: async (rows) => { for (const r of rows) h.bases.set(r.uuid, { ...r.doc }); },
    },
    notes: {
      toArray: async () => h.local.map(n => ({ ...n })),
      where: () => ({
        equals: (uuid) => ({ first: async () => h.local.find(n => n.uuid === uuid) }),
      }),
      add: async (n) => { const id = h.nextId++; h.local.push({ id, ...n }); return id; },
      update: async (id, changes) => Object.assign(h.local.find(n => n.id === id), changes),
      delete: async (id) => { h.local = h.local.filter(n => n.id !== id); },
    },
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ path }),
  doc: (_db, ...path) => ({ path, id: path[path.length - 1] }),
  getDoc: async () => ({ exists: () => false }),
  // The server-only reads fail offline, as Firestore's do.
  getDocFromServer: async () => {
    if (!h.online) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    const data = h.remoteSettings;
    return { exists: () => data !== null, data: () => ({ ...data }) };
  },
  setDoc: async (ref, data, opts) => {
    maybeFail();
    if (ref.path.includes('meta')) { h.remoteSettings = { ...(opts?.merge ? h.remoteSettings : {}), ...data }; return; }
    h.setDocs.push([ref.id, data, opts]); write(ref.id, data, opts);
  },
  updateDoc: async (ref, data) => {
    maybeFail();
    if (h.gate) { h.held++; await h.gate; }
    if (!h.remote.has(ref.id)) throw Object.assign(new Error('gone'), { code: 'not-found' });
    h.updates.push([ref.id, data]);
    write(ref.id, data, { merge: true });
  },
  deleteDoc: async (ref) => { maybeFail(); h.deleted.push(ref.id); h.remote.delete(ref.id); },
  writeBatch: () => {
    const sets = [];
    return {
      set: (ref, data, opts) => sets.push([ref.id, data, opts]),
      commit: async () => { for (const [id, d, o] of sets) { h.batchSets.push([id, d]); write(id, d, o); } },
    };
  },
  // The listener is the start-up read: it answers with the whole collection, from the cache first when a
  // test sets h.cacheFirst (a Map of what the cache holds), then from the cloud if there is a connection.
  onSnapshot: (_ref, opts, cb) => {
    h.listener = cb;
    h.listens++;
    h.listenOpts = opts;
    const snapshotOf = (map, fromCache) => {
      const docs = [...map].map(([id, data]) => ({ id, data: () => data, metadata: { hasPendingWrites: false } }));
      return { docs, docChanges: () => docs.map(doc => ({ type: 'added', doc })), metadata: { fromCache } };
    };
    setTimeout(() => {
      if (h.listener !== cb) return;
      if (h.cacheFirst || h.cacheOnly) cb(snapshotOf(h.cacheFirst || h.remote, true));
      if (h.online && !h.cacheOnly) cb(snapshotOf(h.remote, false));
    }, 0);
    return () => { if (h.listener === cb) h.listener = null; };
  },
}));

import { startSync, stopSync, setFirstAnswerTimeoutForTests, pushNote, pushNoteDeletion, syncSetting, syncSettled } from '../notesSync';
import { recordNote, recordDeletion, confirmNote } from '../outbox';
import { useSyncStatus } from '../syncStatus';

const UID = 'user-1';
const note = (uuid, extra = {}) => ({
  uuid, title: `Invented ${uuid}`, type: 'text', note: 'made up body', items: null,
  colorIndex: 0, state: 'normal', encrypted: 0, folderId: 0, importance: 0,
  calendarDate: null, reminderType: 0, reminderRepeat: 0, tags: '',
  createdAt: 1000, modifiedAt: 2000, ...extra,
});
const addLocal = (n) => h.local.push({ id: h.nextId++, ...n });
const localByUuid = (u) => h.local.find(n => n.uuid === u);
const change = (type, uuid, data, hasPendingWrites = false) => ({
  type, doc: { id: uuid, data: () => data, metadata: { hasPendingWrites } },
});
const emit = async (...changes) => h.listener({ docChanges: () => changes, metadata: { fromCache: false } });
const phase = () => useSyncStatus.getState().phase;
const waitingFor = (uuid) => h.outbox.get(`note:${uuid}`);
const markSyncedBefore = (...uuids) => localStorage.setItem(`colornote.synced.${UID}`, JSON.stringify(uuids));
// The cloud copy as this browser last saw it.
const seenBefore = (n) => h.bases.set(n.uuid, { ...n });
const conflictCopies = () => h.local.filter(n => n.title?.startsWith('[conflict] '));
// Comes back online and waits until sync is live and what was waiting has gone out.
const goOnline = async () => {
  h.online = true;
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(phase()).toBe('live'));
  await syncSettled();
};

beforeEach(() => {
  stopSync();
  setFirstAnswerTimeoutForTests(5000);
  localStorage.clear();
  Object.assign(h, {
    local: [], nextId: 1, remote: new Map(), cacheOnly: false, cacheFirst: null, listener: null, listens: 0,
    setDocs: [], updates: [], batchSets: [], deleted: [],
    outbox: new Map(), settings: new Map(), remoteSettings: null,
    online: true, failWrites: null,
    bases: new Map(), gate: null, held: 0,
  });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => h.online });
});

afterEach(() => {
  stopSync();
  vi.restoreAllMocks();
});

describe('cloud changes that do not bump modifiedAt', () => {
  it('takes a trash change from the phone', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a', { state: 'trash' }));
    await startSync(UID);
    expect(localByUuid('a').state).toBe('trash');
  });

  it('takes archive, pin and lock changes that arrive live', async () => {
    addLocal(note('a'));
    addLocal(note('b'));
    addLocal(note('c'));
    h.remote.set('a', note('a')); h.remote.set('b', note('b')); h.remote.set('c', note('c'));
    await startSync(UID);
    await emit(
      change('modified', 'a', note('a', { state: 'archived' })),
      change('modified', 'b', note('b', { importance: 1 })),
      change('modified', 'c', note('c', { encrypted: 1, note: 'cipher-text' })),
    );
    expect(localByUuid('a').state).toBe('archived');
    expect(localByUuid('b').importance).toBe(1);
    expect(localByUuid('c')).toMatchObject({ encrypted: 1, note: 'cipher-text' });
  });

  it('treats true/false, empty and missing values as equal, so nothing churns', async () => {
    addLocal(note('a', { encrypted: 1, tags: '' }));
    h.remote.set('a', note('a', { encrypted: true, tags: undefined }));
    await startSync(UID);
    await emit(change('modified', 'a', note('a', { encrypted: true, note: 'made up body' })));
    expect(localByUuid('a').encrypted).toBe(1);
  });

  it('keeps text edited here that is newer, and takes state set on the phone', async () => {
    addLocal(note('a', { modifiedAt: 3000, title: 'newer here' }));
    h.remote.set('a', note('a', { modifiedAt: 2000, state: 'trash' }));
    await startSync(UID);
    expect(localByUuid('a')).toMatchObject({ title: 'newer here', state: 'trash', modifiedAt: 3000 });
    expect(h.remote.get('a')).toMatchObject({ title: 'newer here', state: 'trash', modifiedAt: 3000 });
  });

  it('sends only the edited fields of a newer local copy, so the pin and reminder set on the phone stay', async () => {
    addLocal(note('a', { modifiedAt: 3000, note: 'edited here' }));
    h.remote.set('a', note('a', { modifiedAt: 2000, importance: 1, reminderDismissedAt: 2500, extraField: 'kept' }));
    await startSync(UID);
    expect(h.batchSets).toEqual([['a', { note: 'edited here', modifiedAt: 3000 }]]);
    expect(h.remote.get('a')).toMatchObject({ note: 'edited here', importance: 1, reminderDismissedAt: 2500, extraField: 'kept' });
    expect(localByUuid('a')).toMatchObject({ note: 'edited here', importance: 1, reminderDismissedAt: 2500 });
  });

  it('takes the cloud date when only the date is newer here', async () => {
    addLocal(note('a', { modifiedAt: 3000 }));
    h.remote.set('a', note('a', { modifiedAt: 2000 }));
    await startSync(UID);
    expect(h.batchSets).toEqual([]);
    expect(localByUuid('a').modifiedAt).toBe(2000);
  });

  it('takes reminder changes from the phone, which keep the date', async () => {
    addLocal(note('a', { reminderTime: 100 }));
    addLocal(note('b'));
    h.remote.set('a', note('a', { reminderTime: 200 }));
    h.remote.set('b', note('b'));
    await startSync(UID);
    await emit(change('modified', 'b', note('b', { reminderDismissedAt: 4000, reminderRepeatEnds: 9000 })));
    expect(localByUuid('a').reminderTime).toBe(200);
    expect(localByUuid('b')).toMatchObject({ reminderDismissedAt: 4000, reminderRepeatEnds: 9000 });
  });

  it('ignores the echo of its own unconfirmed write', async () => {
    addLocal(note('a', { state: 'trash' }));
    h.remote.set('a', note('a', { state: 'trash' }));
    await startSync(UID);
    await emit(change('modified', 'a', note('a', { state: 'normal' }), true));
    expect(localByUuid('a').state).toBe('trash');
  });
});

describe('deleted notes stay deleted', () => {
  it('removes a note it synced before that is gone from the cloud, instead of re-uploading', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);
    stopSync();

    h.remote.delete('a'); // deleted on the phone meanwhile
    h.batchSets = [];
    await startSync(UID);
    expect(localByUuid('a')).toBeUndefined();
    expect(h.batchSets).toEqual([]);
    expect(h.remote.has('a')).toBe(false);
  });

  it('still uploads a note this browser never synced', async () => {
    addLocal(note('new-here'));
    await startSync(UID);
    expect(h.batchSets.map(([id]) => id)).toEqual(['new-here']);
    expect(h.remote.has('new-here')).toBe(true);
  });

  it('does not delete anything when the answer came only from the cache', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);
    stopSync();

    h.remote.delete('a');
    h.cacheOnly = true; // the cloud never answers; the cache says 'a' is gone
    setFirstAnswerTimeoutForTests(30);
    await startSync(UID);
    expect(phase()).toBe('waiting');
    expect(localByUuid('a')).toBeDefined();
  });

  it('ignores the cache answer and reconciles on the cloud answer', async () => {
    addLocal(note('a'));
    addLocal(note('b'));
    markSyncedBefore('a', 'b');
    seenBefore(note('a')); seenBefore(note('b'));
    h.remote.set('a', note('a'));
    // The cache still holds b; the cloud no longer has it, so it was deleted elsewhere.
    h.cacheFirst = new Map([['a', note('a')], ['b', note('b')]]);
    await startSync(UID);
    expect(phase()).toBe('live');
    expect(localByUuid('a')).toBeDefined();
    expect(localByUuid('b')).toBeUndefined();
  });

  it('reads the notes once at start: one listener, no separate pull', async () => {
    h.remote.set('a', note('a'));
    await startSync(UID);
    expect(h.listens).toBe(1);
    expect(h.listenOpts).toMatchObject({ includeMetadataChanges: true });
    expect(localByUuid('a')).toBeDefined();
  });

  it('a metadata-only snapshot after start changes nothing', async () => {
    h.remote.set('a', note('a'));
    await startSync(UID);
    const before = JSON.stringify(h.local);
    await h.listener({ docChanges: () => [], metadata: { fromCache: false } });
    expect(JSON.stringify(h.local)).toBe(before);
  });

  it('removes a note live when the cloud deletes it, and forgets it', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);
    await emit(change('removed', 'a', note('a')));
    expect(localByUuid('a')).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(`colornote.synced.${UID}`))).not.toContain('a');
  });

  it('a note deleted here is forgotten, so it is not mistaken for synced later', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);
    await pushNoteDeletion('a');
    expect(h.deleted).toEqual(['a']);
    expect(JSON.parse(localStorage.getItem(`colornote.synced.${UID}`))).not.toContain('a');
  });

  it('a note pushed from here counts as synced', async () => {
    await startSync(UID);
    await pushNote({ id: 9, ...note('p') });
    expect(h.setDocs[0][0]).toBe('p');
    expect(h.setDocs[0][1].id).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(`colornote.synced.${UID}`))).toContain('p');
  });

  it('keeps the record per account', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);
    stopSync();

    h.remote.clear();
    await startSync('user-2'); // different account: 'a' was never synced with it
    expect(localByUuid('a')).toBeDefined();
    expect(h.remote.has('a')).toBe(true);
  });
});

describe('pushes send only what changed', () => {
  it('sends only the named fields, so a field changed elsewhere survives', async () => {
    h.remote.set('a', note('a', { importance: 1, reminderDismissedAt: 4000 }));
    await startSync(UID);
    await pushNote({ id: 1, ...note('a', { state: 'trash' }) }, ['state']);
    expect(h.updates).toEqual([['a', { state: 'trash' }]]);
    expect(h.remote.get('a')).toMatchObject({ state: 'trash', importance: 1, reminderDismissedAt: 4000 });
  });

  it('sends a new note whole, merged', async () => {
    await startSync(UID);
    await pushNote({ id: 1, ...note('n') });
    expect(h.setDocs[0][2]).toEqual({ merge: true });
  });

  it('sends nothing for an empty change', async () => {
    h.remote.set('a', note('a'));
    await startSync(UID);
    await pushNote({ id: 1, ...note('a') }, []);
    expect(h.updates).toEqual([]);
  });

  it('brings back text edited here when the note was deleted elsewhere meanwhile', async () => {
    await startSync(UID);
    await pushNote({ id: 1, ...note('gone', { note: 'edited here' }) }, ['note', 'modifiedAt']);
    expect(h.remote.get('gone')).toMatchObject({ note: 'edited here' });
  });

  it('does not bring back a deleted note for a pin alone', async () => {
    await startSync(UID);
    await pushNote({ id: 1, ...note('gone', { importance: 1 }) }, ['importance']);
    expect(h.remote.has('gone')).toBe(false);
  });

  it('sends a missing field as null, never undefined', async () => {
    h.remote.set('a', note('a'));
    await startSync(UID);
    const { format: _f, ...noFormat } = note('a');
    await pushNote({ id: 1, ...noFormat }, ['format']);
    expect(h.updates).toEqual([['a', { format: null }]]);
  });
});

describe('the outbox', () => {
  it('collects every field still waiting for a note', async () => {
    await recordNote('x', ['title']);
    const second = await recordNote('x', ['importance', 'title']);
    expect(second).toEqual({ seq: 2, fields: ['title', 'importance'] });
  });

  it('a whole-note entry stays whole when a field changes after it', async () => {
    await recordNote('x', null);
    expect((await recordNote('x', ['title'])).fields).toBeNull();
  });

  it('an edit after a deletion replaces it', async () => {
    await recordDeletion('x');
    await recordNote('x', ['title']);
    expect(waitingFor('x')).toMatchObject({ deleted: false, fields: ['title'] });
  });

  it('a confirmation for an older write keeps the newer one waiting', async () => {
    await recordNote('x', ['title']);
    await recordNote('x', ['note']);
    await confirmNote('x', 1);
    expect(waitingFor('x')).toBeDefined();
    await confirmNote('x', 2);
    expect(waitingFor('x')).toBeUndefined();
  });
});

describe('working offline', () => {
  it('starts without the internet, keeps changes, and sends them when it comes back', async () => {
    h.online = false;
    await startSync(UID);
    expect(phase()).toBe('waiting');
    expect(h.listens).toBe(0);

    addLocal(note('made-offline'));
    await pushNote({ id: 1, ...note('made-offline') });
    expect(h.setDocs).toEqual([]);
    expect(waitingFor('made-offline')).toMatchObject({ fields: null });

    await goOnline();
    expect(h.remote.get('made-offline')).toMatchObject({ title: 'Invented made-offline' });
    expect(waitingFor('made-offline')).toBeUndefined();
  });

  it('tries again when the cloud did not answer at the start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.remote.set('a', note('a'));
    h.online = false; // the cloud never answers...
    setFirstAnswerTimeoutForTests(30);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true }); // ...though the browser says online
    await startSync(UID);
    expect(phase()).toBe('waiting');
    expect(localByUuid('a')).toBeUndefined();

    await goOnline();
    expect(localByUuid('a')).toBeDefined();
  });

  it('sends a change that was waiting when the app was closed', async () => {
    // Made in an earlier visit, before the app was closed offline: only the outbox remembers it.
    addLocal(note('a', { note: 'edited offline', modifiedAt: 3000 }));
    await recordNote('a', ['note', 'modifiedAt']);
    seenBefore(note('a'));
    h.remote.set('a', note('a', { importance: 1 }));
    await startSync(UID);
    await syncSettled();
    expect(h.remote.get('a')).toMatchObject({ note: 'edited offline', modifiedAt: 3000, importance: 1 });
    expect(localByUuid('a')).toMatchObject({ note: 'edited offline', importance: 1 });
    expect(waitingFor('a')).toBeUndefined();
    expect(conflictCopies()).toEqual([]);
  });

  it('keeps a pin made offline, though the cloud copy has the same date', async () => {
    addLocal(note('a', { importance: 1 }));
    await recordNote('a', ['importance']);
    h.remote.set('a', note('a', { importance: 0 }));
    markSyncedBefore('a');
    await startSync(UID);
    await syncSettled();
    expect(localByUuid('a').importance).toBe(1);
    expect(h.remote.get('a').importance).toBe(1);
  });

  it('a note deleted offline does not come back, and is deleted in the cloud', async () => {
    h.remote.set('a', note('a'));
    markSyncedBefore('a');
    await recordDeletion('a');
    await startSync(UID);
    await syncSettled();
    expect(localByUuid('a')).toBeUndefined();
    expect(h.remote.has('a')).toBe(false);
    expect(waitingFor('a')).toBeUndefined();
  });

  it('a note only pinned offline stays deleted when the phone deleted it', async () => {
    addLocal(note('a', { importance: 1 }));
    await recordNote('a', ['importance']);
    markSyncedBefore('a');
    await startSync(UID);
    await syncSettled();
    expect(localByUuid('a')).toBeUndefined();
    expect(h.remote.has('a')).toBe(false);
    expect(waitingFor('a')).toBeUndefined();
  });

  it('text edited offline brings back a note the phone deleted', async () => {
    addLocal(note('a', { note: 'edited offline' }));
    await recordNote('a', ['note', 'modifiedAt']);
    markSyncedBefore('a');
    await startSync(UID);
    await syncSettled();
    expect(h.remote.get('a')).toMatchObject({ note: 'edited offline' });
  });

  it('a write the cloud refuses stays waiting', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.remote.set('a', note('a'));
    await startSync(UID);
    h.failWrites = 'unavailable';
    await pushNote({ id: 1, ...note('a', { state: 'archived' }) }, ['state']);
    expect(waitingFor('a')).toMatchObject({ fields: ['state'] });
    expect(h.remote.get('a').state).toBe('normal');
  });

  it('a setting changed offline is kept over the cloud copy and sent', async () => {
    h.remoteSettings = { darkMode: false, fontSize: 'large' };
    h.online = false;
    await startSync(UID);
    await syncSetting('darkMode', true);

    await goOnline();
    expect(h.settings.get('darkMode')).toBe(true);
    expect(h.settings.get('fontSize')).toBe('large');
    expect(h.remoteSettings).toMatchObject({ darkMode: true, fontSize: 'large' });
    expect(h.outbox.size).toBe(0);
  });
});

describe('merging with changes made on the phone', () => {
  it('keeps both versions when the text was edited on both sides, the newer one in the note', async () => {
    seenBefore(note('a'));
    addLocal(note('a', { note: 'edited here', modifiedAt: 3000 }));
    await recordNote('a', ['note', 'modifiedAt']);
    h.remote.set('a', note('a', { note: 'edited on the phone', modifiedAt: 4000 }));
    await startSync(UID);
    await syncSettled();

    expect(localByUuid('a')).toMatchObject({ note: 'edited on the phone', modifiedAt: 4000 });
    expect(h.remote.get('a').note).toBe('edited on the phone');
    const copies = conflictCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ title: '[conflict] Invented a', note: 'edited here', conflictOf: 'a' });
    expect(copies[0].uuid).not.toBe('a');
    expect(h.remote.get(copies[0].uuid)).toMatchObject({ title: '[conflict] Invented a', note: 'edited here' });
    expect(h.outbox.size).toBe(0);
  });

  it('keeps the text edited here in the note when it is the newer one', async () => {
    seenBefore(note('a'));
    addLocal(note('a', { note: 'edited here', modifiedAt: 5000 }));
    await recordNote('a', ['note', 'modifiedAt']);
    h.remote.set('a', note('a', { note: 'edited on the phone', modifiedAt: 4000 }));
    await startSync(UID);
    await syncSettled();

    expect(localByUuid('a')).toMatchObject({ note: 'edited here', modifiedAt: 5000 });
    expect(h.remote.get('a')).toMatchObject({ note: 'edited here', modifiedAt: 5000 });
    expect(conflictCopies().map(n => n.note)).toEqual(['edited on the phone']);
  });

  it('a pin made here and a text edit made on the phone both stay, with no copy', async () => {
    seenBefore(note('a'));
    addLocal(note('a', { importance: 1 }));
    await recordNote('a', ['importance']);
    h.remote.set('a', note('a', { note: 'edited on the phone', modifiedAt: 3000 }));
    await startSync(UID);
    await syncSettled();

    expect(localByUuid('a')).toMatchObject({ importance: 1, note: 'edited on the phone', modifiedAt: 3000 });
    expect(h.remote.get('a')).toMatchObject({ importance: 1, note: 'edited on the phone' });
    expect(conflictCopies()).toEqual([]);
    expect(h.outbox.size).toBe(0);
  });

  it('a colour changed on both sides takes the newer one, with no copy', async () => {
    seenBefore(note('a'));
    addLocal(note('a', { colorIndex: 2, modifiedAt: 3000 }));
    await recordNote('a', ['colorIndex', 'modifiedAt']);
    h.remote.set('a', note('a', { colorIndex: 5, modifiedAt: 4000 }));
    await startSync(UID);
    await syncSettled();

    expect(localByUuid('a')).toMatchObject({ colorIndex: 5, modifiedAt: 4000 });
    expect(h.remote.get('a').colorIndex).toBe(5);
    expect(conflictCopies()).toEqual([]);
    expect(h.outbox.size).toBe(0);
  });

  it('keeps both versions when it cannot tell who changed the text (first sync after this update)', async () => {
    addLocal(note('a', { note: 'edited here', modifiedAt: 3000 }));
    await recordNote('a', ['note', 'modifiedAt']);
    h.remote.set('a', note('a', { note: 'other text', modifiedAt: 2000 }));
    await startSync(UID);
    await syncSettled();

    expect(localByUuid('a').note).toBe('edited here');
    expect(conflictCopies().map(n => n.note)).toEqual(['other text']);
  });

  it('a note with nothing waiting here takes the cloud copy, even with an older date', async () => {
    seenBefore(note('a', { modifiedAt: 3000 }));
    addLocal(note('a', { modifiedAt: 3000 }));
    h.remote.set('a', note('a', { note: 'restored on the phone', modifiedAt: 2500 }));
    await startSync(UID);

    expect(localByUuid('a')).toMatchObject({ note: 'restored on the phone', modifiedAt: 2500 });
    expect(h.batchSets).toEqual([]);
  });

  it('remembers what the cloud holds, for the next merge', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a', { importance: 1 }));
    await startSync(UID);
    expect(h.bases.get('a')).toMatchObject({ importance: 1 });

    await emit(change('modified', 'a', note('a', { state: 'archived' })));
    expect(h.bases.get('a')).toMatchObject({ state: 'archived' });
  });

  it('its own write coming back from the cloud is not mistaken for an edit made elsewhere', async () => {
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);

    let release;
    h.gate = new Promise((r) => { release = r; });
    Object.assign(localByUuid('a'), { note: 'edited here', modifiedAt: 3000 });
    const sending = pushNote({ ...localByUuid('a') }, ['note', 'modifiedAt']);
    await vi.waitFor(() => expect(h.held).toBe(1));

    // Typing goes on while the first save is on its way, and then the cloud reports that save.
    Object.assign(localByUuid('a'), { note: 'edited here, and more', modifiedAt: 3100 });
    await recordNote('a', ['note', 'modifiedAt']);
    await emit(change('modified', 'a', note('a', { note: 'edited here', modifiedAt: 3000 })));

    release();
    await sending;
    await vi.waitFor(() => expect(h.remote.get('a').note).toBe('edited here, and more'));
    expect(localByUuid('a').note).toBe('edited here, and more');
    expect(conflictCopies()).toEqual([]);
    await vi.waitFor(() => expect(h.outbox.size).toBe(0));
  });

  it('a text edit on the phone brings back a note deleted here before the cloud heard of it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);

    h.failWrites = 'unavailable';
    h.local = [];
    await pushNoteDeletion('a');
    expect(waitingFor('a')).toMatchObject({ deleted: true });
    h.failWrites = null;

    await emit(change('modified', 'a', note('a', { note: 'edited on the phone', modifiedAt: 3000 })));
    expect(localByUuid('a')).toMatchObject({ note: 'edited on the phone' });
    expect(waitingFor('a')).toBeUndefined();
  });

  it('a pin on the phone does not bring back a note deleted here', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);

    h.failWrites = 'unavailable';
    h.local = [];
    await pushNoteDeletion('a');
    h.failWrites = null;

    await emit(change('modified', 'a', note('a', { importance: 1 })));
    expect(localByUuid('a')).toBeUndefined();
    expect(waitingFor('a')).toMatchObject({ deleted: true });
  });

  it('text edited here brings back a note the phone deletes meanwhile', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);

    h.failWrites = 'unavailable';
    Object.assign(localByUuid('a'), { note: 'edited here', modifiedAt: 3000 });
    await pushNote({ ...localByUuid('a') }, ['note', 'modifiedAt']);
    h.failWrites = null;

    h.remote.delete('a');
    await emit(change('removed', 'a', note('a')));
    expect(localByUuid('a')).toBeDefined();
    await vi.waitFor(() => expect(h.remote.get('a')).toMatchObject({ note: 'edited here' }));
    await vi.waitFor(() => expect(waitingFor('a')).toBeUndefined());
  });

  it('a note only pinned here is removed when the phone deletes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    addLocal(note('a'));
    h.remote.set('a', note('a'));
    await startSync(UID);

    h.failWrites = 'unavailable';
    Object.assign(localByUuid('a'), { importance: 1 });
    await pushNote({ ...localByUuid('a') }, ['importance']);
    h.failWrites = null;

    h.remote.delete('a');
    await emit(change('removed', 'a', note('a')));
    expect(localByUuid('a')).toBeUndefined();
    expect(waitingFor('a')).toBeUndefined();
    expect(h.bases.has('a')).toBe(false);
  });
});
