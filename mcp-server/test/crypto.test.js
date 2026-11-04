// The Node decrypt must read what the web app writes. Invented text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptNoteContent } from '../../src/utils/crypto.js';
import { decryptNoteContent, getNoteCiphertext, deriveKey } from '../src/crypto.js';

test('reads what the web app encrypts, including accents and emoji', async () => {
  for (const text of ['', 'a', 'Sample locked note', 'Line one\nLine two\n\nLine four', 'Café ñandú — 日本語 🙂', 'x'.repeat(5000)]) {
    const ct = await encryptNoteContent(text);
    assert.equal(decryptNoteContent(ct), text);
  }
});

test('the fixed key is 32 bytes and stable', () => {
  assert.equal(deriveKey().length, 32);
  assert.deepEqual(deriveKey(), deriveKey());
});

test('garbage ciphertext throws instead of returning text', () => {
  assert.throws(() => decryptNoteContent('bm90IGEgbm90ZQ=='));
});

test('ciphertext lives in note for text and in items[0].text for checklists', () => {
  assert.equal(getNoteCiphertext({ type: 'text', note: 'abc' }), 'abc');
  assert.equal(getNoteCiphertext({ type: 'checklist', note: 'no', items: [{ text: 'xyz' }] }), 'xyz');
  assert.equal(getNoteCiphertext({ type: 'checklist', items: [] }), null);
  assert.equal(getNoteCiphertext(null), null);
});
