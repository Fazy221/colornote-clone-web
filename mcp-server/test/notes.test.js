// Note logic and the tool layer, with invented notes and a fake store. No Firestore, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encryptNoteContent } from '../../src/utils/crypto.js';
import { buildServer } from '../src/server.js';
import { toNote, toVersion, groupVersions, filterNotes, searchNotes, noteStats, summarise, dayOf } from '../src/notes.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();
const ctx = { folders: [{ id: 7, name: 'Trips' }, { id: 8, name: 'Work' }], colorNames: ['', 'Red label', '', '', '', '', '', '', '', ''] };

async function sample() {
  const lockedText = await encryptNoteContent('Secret about the harbour');
  const lockedList = await encryptNoteContent('[V] buy rope\n[ ] buy lamp');
  const docs = {
    a: { title: 'Harbour walk', note: 'Went to the harbour and saw boats', type: 'text', colorIndex: 1, folderId: 7, createdAt: at(2020, 3, 1), modifiedAt: at(2021, 5, 2), state: 'normal', importance: 1 },
    b: { title: 'Locked one', note: lockedText, type: 'text', encrypted: 1, colorIndex: 0, createdAt: at(2019, 1, 1), modifiedAt: at(2022, 6, 3), state: 'normal' },
    c: { title: 'Locked list', type: 'checklist', encrypted: 1, items: [{ text: lockedList, checked: false }], createdAt: at(2019, 2, 1), modifiedAt: at(2022, 6, 4), state: 'normal' },
    d: { title: 'Shopping', type: 'checklist', items: [{ text: 'milk', checked: true }, { text: 'eggs', checked: false }], createdAt: at(2021, 1, 1), modifiedAt: at(2021, 1, 5), state: 'normal', folderId: 8, calendarDate: '2021-01-06' },
    e: { title: 'Old thing', note: 'trash me', createdAt: at(2018, 1, 1), modifiedAt: at(2018, 1, 2), state: 'trash' },
    f: { title: 'Broken lock', note: 'bm90IGEgbm90ZQ==', encrypted: 1, createdAt: at(2018, 5, 1), modifiedAt: at(2018, 5, 2), state: 'normal' },
  };
  return Object.entries(docs).map(([id, data]) => toNote(`uuid-${id}-0000`, data, ctx));
}

test('locked text and checklist notes are decrypted; a corrupt one reports instead of crashing', async () => {
  const notes = await sample();
  const by = Object.fromEntries(notes.map((n) => [n.uuid, n]));
  assert.equal(by['uuid-b-0000'].text, 'Secret about the harbour');
  assert.equal(by['uuid-b-0000'].locked, true);
  assert.deepEqual(by['uuid-c-0000'].items, [{ text: 'buy rope', checked: true }, { text: 'buy lamp', checked: false }]);
  assert.equal(by['uuid-c-0000'].text, '[x] buy rope\n[ ] buy lamp');
  assert.equal(by['uuid-f-0000'].text, '');
  assert.match(by['uuid-f-0000'].decryptError, /Could not decrypt/);
});

test('folders, colours, pins and dates are resolved', async () => {
  const a = (await sample())[0];
  assert.deepEqual(a.folder, { id: 7, name: 'Trips' });
  assert.equal(a.color.name, 'Red label');
  assert.equal(a.pinned, true);
  assert.equal(a.modifiedDate, '2021-05-02');
  assert.equal(dayOf(at(2021, 12, 31, 23)), '2021-12-31');
});

test('Firestore timestamps and ISO strings are read as times', () => {
  const fromTs = toNote('u', { title: 't', modifiedAt: { toMillis: () => at(2020, 1, 2) }, createdAt: '2020-01-01T10:00:00Z' }, ctx);
  assert.equal(fromTs.modifiedDate, '2020-01-02');
  assert.ok(fromTs.createdAt.startsWith('2020-01-01'));
  const none = toNote('u', {}, ctx);
  assert.equal(none.modifiedAt, null);
  assert.equal(none.state, 'normal');
});

test('filters: default hides trash, state any shows it, ranges and folders work', async () => {
  const notes = await sample();
  assert.equal(filterNotes(notes, {}).total, 5);
  assert.equal(filterNotes(notes, { state: 'trash' }).total, 1);
  assert.equal(filterNotes(notes, { state: 'any' }).total, 6);
  assert.deepEqual(filterNotes(notes, { folder: 'trips' }).notes.map((n) => n.uuid), ['uuid-a-0000']);
  assert.equal(filterNotes(notes, { locked: true }).total, 3);
  assert.equal(filterNotes(notes, { type: 'checklist' }).total, 2);
  assert.equal(filterNotes(notes, { calendarDate: '2021-01-06' }).total, 1);
  assert.equal(filterNotes(notes, { modifiedFrom: '2022-06-04', modifiedTo: '2022-06-04' }).total, 1);
  assert.equal(filterNotes(notes, { folderId: 0 }).total, 3);
});

test('sorting and paging are stable', async () => {
  const notes = await sample();
  const newest = filterNotes(notes, { limit: 2 });
  assert.deepEqual(newest.notes.map((n) => n.uuid), ['uuid-c-0000', 'uuid-b-0000']);
  const next = filterNotes(notes, { limit: 2, offset: 2 });
  assert.equal(next.total, 5);
  assert.equal(next.notes.length, 2);
  const oldest = filterNotes(notes, { order: 'asc', limit: 1 });
  assert.equal(oldest.notes[0].uuid, 'uuid-f-0000');
  assert.equal(filterNotes(notes, { sort: 'title', order: 'asc', limit: 1 }).notes[0].title, 'Broken lock');
});

test('search needs every word, reads locked notes, and gives snippets', async () => {
  const notes = await sample();
  const r = searchNotes(notes, 'harbour');
  assert.deepEqual(r.results.map((x) => x.uuid).sort(), ['uuid-a-0000', 'uuid-b-0000']);
  assert.ok(r.results.every((x) => x.snippets.length > 0 && x.text === undefined));
  assert.equal(searchNotes(notes, 'harbour boats').total, 1);
  assert.equal(searchNotes(notes, 'HARBOUR', { locked: true }).total, 1);
  assert.equal(searchNotes(notes, 'rope').total, 1);
  assert.equal(searchNotes(notes, 'nothing-like-this').total, 0);
  assert.equal(searchNotes(notes, '   ').total, 0);
  assert.equal(searchNotes(notes, 'trash').total, 0);
  assert.equal(searchNotes(notes, 'trash', { state: 'trash' }).total, 1);
});

test('search sees past the 200-note list cap', () => {
  const many = Array.from({ length: 250 }, (_, i) => toNote(`n${i}`, { title: `Note ${i}`, note: i === 0 ? 'needle' : 'hay', modifiedAt: at(2020, 1, 1) + i }, ctx));
  assert.equal(searchNotes(many, 'needle').total, 1);
  assert.equal(searchNotes(many, 'hay').total, 249);
});

test('summaries clip the text and never carry the full text', async () => {
  const [a] = await sample();
  const s = summarise(a, 10);
  assert.equal(s.preview, 'Went to th…');
  assert.equal(s.text, undefined);
  assert.equal(s.length, a.text.length);
});

test('stats count by state, type, folder and lock', async () => {
  const s = noteStats(await sample());
  assert.equal(s.total, 6);
  assert.equal(s.byState.trash, 1);
  assert.equal(s.normalNotes.count, 5);
  assert.equal(s.normalNotes.locked, 3);
  assert.equal(s.normalNotes.pinned, 1);
  assert.equal(s.normalNotes.byFolder['7 Trips'], 1);
  assert.equal(s.oldestCreated.slice(0, 4), '2018');
  assert.equal(noteStats([]).oldestCreated, null);
});

test('versions are grouped by day, newest first, and locked ones are decrypted', async () => {
  const locked = await encryptNoteContent('Older secret');
  const versions = [
    toVersion('v1', { at: at(2022, 1, 1, 9), kind: 'baseline', device: 'web', title: 'T', note: 'first' }, ctx),
    toVersion('v2', { at: at(2022, 1, 2, 9), kind: 'edit', device: 'android', changed: ['note'], title: 'T', note: locked, encrypted: 1 }, ctx),
    toVersion('v3', { at: at(2022, 1, 2, 15), kind: 'date', device: 'web', changed: ['modifiedAt'], title: 'T', note: 'third' }, ctx),
  ];
  const days = groupVersions(versions);
  assert.deepEqual(days.map((d) => [d.day, d.count]), [['2022-01-02', 2], ['2022-01-01', 1]]);
  assert.deepEqual(days[0].versions.map((v) => v.id), ['v3', 'v2']);
  assert.equal(days[0].versions[1].text, 'Older secret');
  assert.equal(days[0].versions[0]._at, undefined);
});

// ---- the tool layer, over a real MCP connection in memory ----

async function connect(notes, versionsFor = {}) {
  const store = {
    allNotes: async () => ({ notes, ctx }),
    getNote: async (id) => notes.find((n) => n.uuid.startsWith(id)) ?? null,
    versions: async (id) => {
      const note = notes.find((n) => n.uuid.startsWith(id));
      if (!note) return null;
      const list = versionsFor[note.uuid] ?? [];
      return { note, days: groupVersions(list), count: list.length };
    },
  };
  const server = buildServer(store);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: !!r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
  };
  return { client, call };
}

test('the server offers exactly the read tools, all marked read-only', async () => {
  const { client } = await connect(await sample());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_note', 'get_note_versions', 'list_folders', 'list_notes', 'search_notes', 'stats']);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
});

test('tools return locked notes in full and accept a uuid prefix', async () => {
  const { call } = await connect(await sample());
  const listed = await call('list_notes', { locked: true });
  assert.equal(listed.data.total, 3);
  assert.ok(listed.data.notes.every((n) => n.text === undefined));
  const full = await call('get_note', { uuid: 'uuid-b' });
  assert.equal(full.data.text, 'Secret about the harbour');
  assert.equal((await call('get_note', { uuid: 'nope-nope' })).error, true);
  assert.equal((await call('search_notes', { query: 'rope' })).data.total, 1);
  const folders = await call('list_folders');
  assert.deepEqual(folders.data.folders.map((f) => [f.name, f.notes]), [['Trips', 1], ['Work', 1]]);
  assert.equal(folders.data.withoutFolder, 3);
  assert.equal((await call('stats')).data.total, 6);
});

test('bad input is refused and a store failure becomes a tool error', async () => {
  const { client, call } = await connect(await sample());
  const bad = await client.callTool({ name: 'list_notes', arguments: { modifiedFrom: '5 May' } }).catch((e) => ({ isError: true, thrown: e }));
  assert.equal(bad.isError, true);
  const broken = buildServer({ allNotes: async () => { const e = new Error('permission denied'); e.code = 7; throw e; } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 't', version: '1' });
  await Promise.all([broken.connect(a), c.connect(b)]);
  const r = await c.callTool({ name: 'stats', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /permission denied/);
  void call;
});

test('get_note_versions groups by day and can leave the text out', async () => {
  const notes = await sample();
  const list = [
    toVersion('v1', { at: at(2022, 1, 1, 9), kind: 'baseline', title: 'T', note: 'one' }, ctx),
    toVersion('v2', { at: at(2022, 1, 2, 9), kind: 'edit', title: 'T', note: 'two' }, ctx),
  ];
  const { call } = await connect(notes, { 'uuid-a-0000': list });
  const full = await call('get_note_versions', { uuid: 'uuid-a' });
  assert.equal(full.data.versionCount, 2);
  assert.deepEqual(full.data.days.map((d) => d.day), ['2022-01-02', '2022-01-01']);
  assert.equal(full.data.days[0].versions[0].text, 'two');
  const bare = await call('get_note_versions', { uuid: 'uuid-a', includeText: false });
  assert.equal(bare.data.days[0].versions[0].text, undefined);
  assert.equal((await call('get_note_versions', { uuid: 'zzzz' })).error, true);
});
