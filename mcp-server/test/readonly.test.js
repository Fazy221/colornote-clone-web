// The server must never write. IAM (Cloud Datastore Viewer) is the real lock; this is the second one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const src = fileURLToPath(new URL('../src/', import.meta.url));
// Only these two touch Firestore. crypto.js (hash.update) and notes.js (Map.set) use look-alike method names.
const files = ['store.js', 'server.js'];

test('no source file calls a Firestore write', () => {
  const writes = /\.(set|update|delete|create|add|batch|bulkWriter|runTransaction|recursiveDelete|writeBatch)\s*\(/;
  for (const f of files) {
    const code = readFileSync(join(src, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, writes, `${f} calls a write method`);
  }
});

test('the pure modules do not import Firestore at all', () => {
  for (const f of ['notes.js', 'crypto.js']) {
    assert.doesNotMatch(readFileSync(join(src, f), 'utf8'), /@google-cloud|new Firestore/, `${f} imports Firestore`);
  }
});

test('the only Firestore calls are reads', () => {
  const code = readFileSync(join(src, 'store.js'), 'utf8');
  const used = [...code.matchAll(/\.(get|listDocuments|listCollections|collection|doc)\(/g)].map((m) => m[1]);
  assert.ok(used.includes('get'));
  assert.doesNotMatch(code, /\.(onSnapshot|runTransaction)\(/);
});

test('no encrypt function is exported by the Node crypto module', async () => {
  const mod = await import('../src/crypto.js');
  assert.deepEqual(Object.keys(mod).sort(), ['decryptNoteContent', 'deriveKey', 'getNoteCiphertext']);
});

test('the server never prints note text to the console', () => {
  const code = readFileSync(join(src, 'server.js'), 'utf8') + readFileSync(join(src, 'store.js'), 'utf8') + readFileSync(join(src, 'notes.js'), 'utf8');
  assert.doesNotMatch(code, /console\.(log|info|debug)/);
});
