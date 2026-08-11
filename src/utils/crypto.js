// ColorNote note-content encryption / decryption
//
// CONFIRMED via reverse-engineering + cross-checked against the forensic paper
// "Data Decryption and Analysis of Note-Taking Applications" (Yoon, Park, Jang,
// Seo — 2024, https://eprint.iacr.org/2024/2006.pdf), Algorithms 1 & 2.
//
// KEY FINDING: individual note content (the "note" column in colornote.db) is
// encrypted with a password that's HARDCODED into the ColorNote app itself —
// NOT the user's master password:
//
//   FixedPassword = "ColorNote Password"
//   Salt          = "ColorNote Fixed Salt"
//   Iterations    = 20
//   KDF           = PBEWITHSHA256AND256BITAES-CBC-BC  (PKCS#12 Appendix B, SHA-256)
//   Key length    = 256 bits
//   IV            = 16 zero bytes (hardcoded)
//   Cipher        = AES-256-CBC / PKCS5(7) padding
//
// So the user's real master password is NEVER involved in decrypting note text.
// It's only used (Algorithm 2) to protect a separate "BACKUP_SECRET_KEY" value
// stored in a system note (title "name_master_password"), which is itself the
// key for whole-*backup-file* encryption (Algorithm 3) — a different thing from
// per-note content. We implement Algorithm 2 as well, so the app can genuinely
// verify a user-entered password against that value when it's available.

// ───────────────────────── base64 <-> bytes ──────────────────────────────────
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function repeatToLength(src, len) {
  if (len === 0) return new Uint8Array(0);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = src[i % src.length];
  return out;
}
// PKCS#12 passwords are UTF-16BE, null-terminated
function utf16BEPassword(password) {
  const bytes = new Uint8Array((password.length + 1) * 2); // trailing null stays zero
  for (let i = 0; i < password.length; i++) {
    const code = password.charCodeAt(i);
    bytes[i * 2] = (code >> 8) & 0xff;
    bytes[i * 2 + 1] = code & 0xff;
  }
  return bytes;
}

// ───────────────────────── PKCS#12 Appendix B KDF ─────────────────────────────
// Generic, hash-agnostic implementation shared by both algorithms:
//   - Algorithm 1 note-content key: hash=SHA-256 (v=64, u=32)
//   - Algorithm 2 verifier key/IV:  hash=MD5     (v=64, u=16)
// hashFn: async (Uint8Array) => Uint8Array digest
async function pkcs12Derive(hashFn, v, u, id, iterations, outputLen, saltBytes, password) {
  const D = new Uint8Array(v).fill(id);
  const S = saltBytes.length ? repeatToLength(saltBytes, Math.ceil(saltBytes.length / v) * v) : new Uint8Array(0);
  const pwBytes = utf16BEPassword(password);
  const P = repeatToLength(pwBytes, Math.ceil(pwBytes.length / v) * v);

  const I = new Uint8Array(S.length + P.length);
  I.set(S, 0);
  I.set(P, S.length);

  const blocks = [];
  const blockCount = Math.ceil(outputLen / u);

  for (let i = 0; i < blockCount; i++) {
    let A = await hashFn(concatBytes(D, I));
    for (let j = 1; j < iterations; j++) A = await hashFn(A);
    blocks.push(A);

    const B = repeatToLength(A, v);
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k] + B[k] + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return concatBytes(...blocks).slice(0, outputLen);
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// ── tiny pure-JS MD5 (Web Crypto has no MD5; only needed for Algorithm 2) ────
function md5Hex(binaryString) {
  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a,b,c,d,k[0], 7, -680876936); d = ff(d,a,b,c,k[1], 12,-389564586); c = ff(c,d,a,b,k[2], 17, 606105819);
    b = ff(b,c,d,a,k[3], 22,-1044525330); a = ff(a,b,c,d,k[4], 7, -176418897); d = ff(d,a,b,c,k[5], 12, 1200080426);
    c = ff(c,d,a,b,k[6], 17,-1473231341); b = ff(b,c,d,a,k[7], 22,-45705983); a = ff(a,b,c,d,k[8], 7, 1770035416);
    d = ff(d,a,b,c,k[9], 12,-1958414417); c = ff(c,d,a,b,k[10],17,-42063); b = ff(b,c,d,a,k[11],22,-1990404162);
    a = ff(a,b,c,d,k[12], 7, 1804603682); d = ff(d,a,b,c,k[13],12,-40341101); c = ff(c,d,a,b,k[14],17,-1502002290);
    b = ff(b,c,d,a,k[15],22, 1236535329);
    a = gg(a,b,c,d,k[1], 5, -165796510); d = gg(d,a,b,c,k[6], 9, -1069501632); c = gg(c,d,a,b,k[11],14, 643717713);
    b = gg(b,c,d,a,k[0], 20,-373897302); a = gg(a,b,c,d,k[5], 5, -701558691); d = gg(d,a,b,c,k[10], 9, 38016083);
    c = gg(c,d,a,b,k[15],14,-660478335); b = gg(b,c,d,a,k[4], 20,-405537848); a = gg(a,b,c,d,k[9], 5, 568446438);
    d = gg(d,a,b,c,k[14], 9,-1019803690); c = gg(c,d,a,b,k[3], 14,-187363961); b = gg(b,c,d,a,k[8], 20, 1163531501);
    a = gg(a,b,c,d,k[13], 5,-1444681467); d = gg(d,a,b,c,k[2], 9,-51403784); c = gg(c,d,a,b,k[7], 14, 1735328473);
    b = gg(b,c,d,a,k[12],20,-1926607734);
    a = hh(a,b,c,d,k[5], 4, -378558); d = hh(d,a,b,c,k[8], 11,-2022574463); c = hh(c,d,a,b,k[11],16, 1839030562);
    b = hh(b,c,d,a,k[14],23,-35309556); a = hh(a,b,c,d,k[1], 4,-1530992060); d = hh(d,a,b,c,k[4], 11, 1272893353);
    c = hh(c,d,a,b,k[7], 16,-155497632); b = hh(b,c,d,a,k[10],23,-1094730640); a = hh(a,b,c,d,k[13], 4, 681279174);
    d = hh(d,a,b,c,k[0], 11,-358537222); c = hh(c,d,a,b,k[3], 16,-722521979); b = hh(b,c,d,a,k[6], 23, 76029189);
    a = hh(a,b,c,d,k[9], 4,-640364487); d = hh(d,a,b,c,k[12],11,-421815835); c = hh(c,d,a,b,k[15],16, 530742520);
    b = hh(b,c,d,a,k[2], 23,-995338651);
    a = ii(a,b,c,d,k[0], 6, -198630844); d = ii(d,a,b,c,k[7], 10, 1126891415); c = ii(c,d,a,b,k[14],15,-1416354905);
    b = ii(b,c,d,a,k[5], 21,-57434055); a = ii(a,b,c,d,k[12], 6, 1700485571); d = ii(d,a,b,c,k[3], 10,-1894986606);
    c = ii(c,d,a,b,k[10],15,-1051523); b = ii(b,c,d,a,k[1], 21,-2054922799); a = ii(a,b,c,d,k[8], 6, 1873313359);
    d = ii(d,a,b,c,k[15],10,-30611744); c = ii(c,d,a,b,k[6], 15,-1560198380); b = ii(b,c,d,a,k[13],21, 1309151649);
    a = ii(a,b,c,d,k[4], 6,-145523070); d = ii(d,a,b,c,k[11],10,-1120210379); c = ii(c,d,a,b,k[2], 15, 718787259);
    b = ii(b,c,d,a,k[9], 21,-343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q,a,b,x,s,t) { a=add32(add32(a,q),add32(x,t)); return add32((a<<s)|(a>>>(32-s)),b); }
  function ff(a,b,c,d,x,s,t) { return cmn((b&c)|(~b&d),a,b,x,s,t); }
  function gg(a,b,c,d,x,s,t) { return cmn((b&d)|(c&~d),a,b,x,s,t); }
  function hh(a,b,c,d,x,s,t) { return cmn(b^c^d,a,b,x,s,t); }
  function ii(a,b,c,d,x,s,t) { return cmn(c^(b|(~d)),a,b,x,s,t); }
  function md51(s) {
    let n=s.length, state=[1732584193,-271733879,-1732584194,271733878], i;
    for(i=64;i<=n;i+=64) md5cycle(state,md5blk(s.substring(i-64,i)));
    s=s.substring(i-64); let tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for(i=0;i<s.length;i++) tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);
    tail[i>>2]|=0x80<<((i%4)<<3);
    if(i>55) { md5cycle(state,tail); tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; }
    tail[14]=n*8; md5cycle(state,tail); return state;
  }
  function md5blk(s) {
    let md5blks=[],i;
    for(i=0;i<64;i+=4) md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);
    return md5blks;
  }
  function rhex(n) { let s='',j=0; for(;j<4;j++) s+=('0'+(n>>>(j*8+4)&0x0F).toString(16)).slice(-1)+('0'+(n>>>(j*8)&0x0F).toString(16)).slice(-1); return s; }
  function hex(x) { let s='',i; for(i=0;i<x.length;i++) s+=rhex(x[i]); return s; }
  function add32(a,b) { return (a+b)&0xFFFFFFFF; }
  return hex(md51(binaryString));
}
function md5Bytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const hex = md5Hex(bin);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function md5Async(bytes) { return md5Bytes(bytes); }

// ═══════════════════════ Algorithm 1 — note content ═══════════════════════

const FIXED_NOTE_PASSWORD = 'ColorNote Password';
const FIXED_SALT_STR      = 'ColorNote Fixed Salt';
const ITERATIONS          = 20;
const ZERO_IV_16          = new Uint8Array(16);

let fixedNoteKeyPromise = null;
function getFixedNoteCryptoKey() {
  if (!fixedNoteKeyPromise) {
    fixedNoteKeyPromise = (async () => {
      const saltBytes = new TextEncoder().encode(FIXED_SALT_STR);
      const keyBytes = await pkcs12Derive(sha256, 64, 32, 1, ITERATIONS, 32, saltBytes, FIXED_NOTE_PASSWORD);
      return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
    })();
  }
  return fixedNoteKeyPromise;
}

// Decrypt a ColorNote note-content ciphertext (base64). No password needed —
// see the note at the top of this file for why.
export async function decryptNoteContent(ciphertextB64) {
  const key = await getFixedNoteCryptoKey();
  const cipherBytes = b64ToBytes(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ZERO_IV_16 }, key, cipherBytes);
  return new TextDecoder('utf-8').decode(plainBuf);
}

// Encrypt text back into ColorNote's native note-content format (base64).
// Uses the same fixed key/IV as the real app, so the result stays compatible
// if these notes are ever re-imported into ColorNote itself.
export async function encryptNoteContent(plaintext) {
  const key = await getFixedNoteCryptoKey();
  const data = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ZERO_IV_16 }, key, data);
  return bytesToB64(new Uint8Array(cipherBuf));
}

// ═══════════════════ Algorithm 2 — master password verifier ═══════════════════
// ColorNote stores a system note (title "name_master_password") whose "note"
// column holds BACKUP_SECRET_KEY: the master password, self-encrypted with a
// key/IV derived from itself via PBEWITHMD5AND128BITAES. We can recompute this
// from a candidate password and compare against the stored value to genuinely
// verify it — no guessing/heuristics required.

async function deriveMasterPasswordArtifacts(password) {
  const saltBytes = new TextEncoder().encode(FIXED_SALT_STR);
  const keyBytes = await pkcs12Derive(md5Async, 64, 16, 1, ITERATIONS, 16, saltBytes, password);
  const ivBytes  = await pkcs12Derive(md5Async, 64, 16, 2, ITERATIONS, 16, saltBytes, password);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes }, key, new TextEncoder().encode(password));
  return { keyBytes, ivBytes, backupSecretKeyB64: bytesToB64(new Uint8Array(cipherBuf)) };
}

// Returns true iff `password` reproduces the stored BACKUP_SECRET_KEY value
// (i.e. it's genuinely the user's real ColorNote master password).
export async function verifyMasterPassword(password, storedBackupSecretKeyB64) {
  if (!password || !storedBackupSecretKeyB64) return false;
  const { backupSecretKeyB64 } = await deriveMasterPasswordArtifacts(password);
  return backupSecretKeyB64 === storedBackupSecretKeyB64;
}

// ═════════════════════ Local app-lock fallback (no verifier) ═════════════════
// If the "name_master_password" system note wasn't captured on import, we
// can't cryptographically verify the real ColorNote password. In that case
// the app falls back to a simple local passphrase: hash-and-compare, stored
// in the settings table. This is a privacy screen, not real encryption — the
// note content itself is already decrypted via the fixed key regardless.
// Extract the raw ciphertext blob from a note object, regardless of type —
// checklist notes stash their single encrypted blob in items[0].text, text
// notes keep it in the `note` field. Shared by the editor and search so both
// agree on where encrypted content lives.
export function getNoteCiphertext(note) {
  if (!note) return null;
  if (note.type === 'checklist') return note.items?.[0]?.text || null;
  return note.note || null;
}

export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
