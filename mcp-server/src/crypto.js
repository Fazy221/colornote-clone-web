// Locked-note decryption, the same as the web app (src/utils/crypto.js) and the phone (NoteCrypto.kt).
// Change one, change all: the key is a fixed one built into ColorNote, not the owner's master password.
//
//   password "ColorNote Password", salt "ColorNote Fixed Salt", 20 iterations,
//   PKCS#12 key derivation with SHA-256, AES-256-CBC, 16 zero bytes of IV, PKCS#7 padding.
//
// Read-only: there is no encrypt here on purpose (the test file builds its own ciphertext).

import { createHash, createDecipheriv } from 'node:crypto';

const PASSWORD = 'ColorNote Password';
const SALT = 'ColorNote Fixed Salt';
const ITERATIONS = 20;
const V = 64; // SHA-256 block size
const U = 32; // SHA-256 output size

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();

function repeatToLength(src, len) {
  const out = Buffer.alloc(len);
  if (!src.length) return out;
  for (let i = 0; i < len; i++) out[i] = src[i % src.length];
  return out;
}

// PKCS#12 passwords are UTF-16BE with a trailing null.
function utf16be(text) {
  const out = Buffer.alloc((text.length + 1) * 2);
  for (let i = 0; i < text.length; i++) out.writeUInt16BE(text.charCodeAt(i), i * 2);
  return out;
}

// PKCS#12 appendix B, id 1 (key material).
export function deriveKey(password = PASSWORD, salt = SALT, iterations = ITERATIONS, length = 32) {
  const d = Buffer.alloc(V, 1);
  const saltBytes = Buffer.from(salt, 'utf8');
  const s = saltBytes.length ? repeatToLength(saltBytes, Math.ceil(saltBytes.length / V) * V) : Buffer.alloc(0);
  const pw = utf16be(password);
  const p = repeatToLength(pw, Math.ceil(pw.length / V) * V);
  const i = Buffer.concat([s, p]);

  const blocks = [];
  for (let n = 0; n < Math.ceil(length / U); n++) {
    let a = sha256(Buffer.concat([d, i]));
    for (let j = 1; j < iterations; j++) a = sha256(a);
    blocks.push(a);

    const b = repeatToLength(a, V);
    for (let j = 0; j < i.length; j += V) {
      let carry = 1;
      for (let k = V - 1; k >= 0; k--) {
        const sum = i[j + k] + b[k] + carry;
        i[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return Buffer.concat(blocks).subarray(0, length);
}

let key = null;

// The text of a locked note's ciphertext (base64). Throws if it is not valid ciphertext.
export function decryptNoteContent(ciphertextB64) {
  key ??= deriveKey();
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
}

// Where a locked note keeps its ciphertext: text notes in `note`, checklists in the first row's text.
export function getNoteCiphertext(note) {
  if (!note) return null;
  if (note.type === 'checklist') return note.items?.[0]?.text || null;
  return note.note || null;
}
