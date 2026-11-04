// Local-first Firestore sync. Dexie stays the single source of truth for
// everything the UI reads and writes — this module's only job is keeping a
// cloud mirror in sync with it, in both directions.
//
// Notes are keyed in Firestore by their `uuid` (not Dexie's local
// auto-increment `id`, which is meaningless outside this device).
//
// The same rules as the phone (SyncLogic.kt):
//  - A note with nothing waiting here takes the cloud copy as it is, whatever
//    its date: trash, archive, pin and reminders don't change the date.
//  - A note changed here that the cloud hasn't confirmed is merged field by
//    field with the cloud copy (merge.js), using `bases`, the cloud copy as
//    this device last saw it, to tell whose change is whose. Text edited on
//    both sides keeps the newer version, and the other becomes a "[conflict]"
//    note.
//  - A note deleted here comes back if its text was changed elsewhere meanwhile.
//    A note deleted elsewhere comes back if its text was changed here.
//
// Encrypted notes: `note` is already ciphertext by the time it reaches here
// (see crypto.js) — this module just moves bytes, it doesn't add or remove
// any encryption of its own.
//
// A note deleted on another device must not come back. Each browser keeps
// the uuids it has already synced with this account; one of those that is
// missing from the cloud was deleted elsewhere and is removed here, instead
// of being re-uploaded. Notes this browser never synced are still pushed.
//
// Pushes send only the fields that changed (updateDoc), like the phone does, so
// a field changed elsewhere since this browser last heard of the note (a pin, a
// dismissed reminder, a field this app doesn't know) is never overwritten. Only
// a new note sends the whole doc, with merge.
//
// Offline: every change is first written to the outbox (outbox.js), which
// lives in IndexedDB and survives closing the app. It leaves the outbox only
// when the cloud confirms it. Sync starts only once the cloud answers; until
// then changes just wait there, and it tries again when the browser comes
// back online, or every minute. Once started, what is still waiting goes out,
// and the fields waiting for a note are kept over the cloud's copy.

import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocFromServer,
  getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db as firestoreDb } from '../firebase';
import { db, getSetting, setSetting } from '../db/database';
import { BUMP_FIELDS, CONTENT_FIELDS, pick, sameContent, sameValue } from '../utils/noteFields';
import {
  recordNote, recordDeletion, recordSetting, confirmNote, confirmSetting, dropNote, settleNote,
  pendingNotes, pendingSettings,
} from './outbox';
import { deleteVersionsFor, markVersionSynced, takeCloudVersions, unsyncedVersions } from '../db/versionLog';
import { mergeNote, conflictCopy } from './merge';
import { setSyncPhase } from './syncStatus';

let unsubscribeNotes = null;
let currentUid = null;
// True once the first catch-up with the cloud is done; until then changes only wait in the outbox.
let ready = false;
let retryTimer = null;
let onlineHandler = null;
let lastReplay = Promise.resolve();
const RETRY_MS = 60_000;
// uuid -> the values of the write sent and not yet confirmed, so the cloud echoing it back is not
// mistaken for a change made elsewhere (the phone's inFlight).
const inFlight = new Map();

// True when the cloud copy differs in a field the cloud actually has.
function differs(local, cloud) {
  return Object.keys(cloud).some(f => f !== 'id' && !sameValue(cloud[f], local[f]));
}

const newUuid = () => crypto.randomUUID();

// ─── Bases: each note as last seen in the cloud ────────────────────────────
async function loadBases() {
  return new Map((await db.bases.toArray()).map(b => [b.uuid, b.doc]));
}

// The cloud confirmed `sent` (the whole note when `whole`, else some of its fields).
async function rememberSent(uuid, sent, whole) {
  if (whole) { await db.bases.put({ uuid, doc: sent }); return; }
  const old = await db.bases.get(uuid);
  if (old) await db.bases.put({ uuid, doc: { ...old.doc, ...sent } });
}

// The base to merge against, counting a write of ours the cloud is echoing back as already seen.
function baseWithOwnWrite(uuid, base, remote) {
  const sent = inFlight.get(uuid);
  if (!sent) return base;
  const echoed = Object.keys(sent).filter(f => sameValue(remote[f], sent[f]));
  if (!base) return echoed.length === Object.keys(sent).length && CONTENT_FIELDS.every(f => f in sent) ? remote : null;
  const b = { ...base };
  for (const f of echoed) b[f] = remote[f];
  return b;
}

// ─── Per-browser record of uuids already synced with this account ──────────
// localStorage, not Dexie settings: settings are mirrored to the cloud.
const syncedKey = (uid) => `colornote.synced.${uid}`;

function loadSynced(uid) {
  try {
    return new Set(JSON.parse(localStorage.getItem(syncedKey(uid)) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSynced(uid, set) {
  try {
    localStorage.setItem(syncedKey(uid), JSON.stringify([...set]));
  } catch {
    // Storage blocked or full: sync still works, only deletion detection is lost.
  }
}

function markSynced(uid, uuid, synced = true) {
  const set = loadSynced(uid);
  if (synced) set.add(uuid); else set.delete(uuid);
  saveSynced(uid, set);
}

function toCloudDoc(note) {
  const { id, ...rest } = note; // strip the device-local Dexie key
  return rest;
}

// ─── Notes: push (local → cloud) ───────────────────────────────────────────
// `fields` names what changed; only those are sent. Without it (a new note, a
// copy) the whole note is sent, merged into whatever the cloud has.
export async function pushNote(note, fields) {
  if (!note?.uuid) return;
  if (fields && !fields.length) return;
  const waiting = await recordNote(note.uuid, fields ?? null);
  if (!ready || !currentUid) return; // goes out when sync starts
  await sendNote(currentUid, note, waiting.fields, waiting.seq);
}

// `fields`: every field still waiting for this note (null: the whole note).
// The promise settles only when the cloud confirms, which offline can be much later.
async function sendNote(uid, note, fields, seq) {
  const ref = doc(firestoreDb, 'users', uid, 'notes', note.uuid);
  let whole = !fields;
  let sent = whole ? toCloudDoc(note) : pick(note, fields);
  inFlight.set(note.uuid, sent);
  try {
    if (whole) {
      await setDoc(ref, sent, { merge: true });
    } else {
      try {
        await updateDoc(ref, sent);
      } catch (e) {
        if (e?.code !== 'not-found') throw e;
        // Deleted elsewhere meanwhile. Text edited here is the only copy left,
        // so the note comes back; a pin or a move on its own doesn't.
        if (!fields.some(f => CONTENT_FIELDS.includes(f))) {
          await confirmNote(note.uuid, seq);
          return;
        }
        whole = true;
        sent = toCloudDoc(note);
        inFlight.set(note.uuid, sent);
        await setDoc(ref, sent, { merge: true });
      }
    }
    await rememberSent(note.uuid, sent, whole);
    markSynced(uid, note.uuid);
    await confirmNote(note.uuid, seq);
  } catch (e) {
    // Stays in the outbox, and goes out again the next time sync starts.
    console.error('Note upload failed, kept for later:', e?.code || e?.name);
  } finally {
    if (inFlight.get(note.uuid) === sent) inFlight.delete(note.uuid);
  }
}

export async function pushNoteDeletion(uuid) {
  if (!uuid) return;
  const seq = await recordDeletion(uuid);
  if (currentUid) markSynced(currentUid, uuid, false);
  if (!ready || !currentUid) return;
  await sendDeletion(currentUid, uuid, seq);
}

async function sendDeletion(uid, uuid, seq) {
  try {
    await deleteCloudVersions(uid, uuid);
    await deleteDoc(doc(firestoreDb, 'users', uid, 'notes', uuid));
    await db.bases.delete(uuid);
    await confirmNote(uuid, seq);
  } catch (e) {
    console.error('Note deletion failed, kept for later:', e?.code || e?.name);
  }
}

// ─── Version history ───────────────────────────────────────────────────────
// users/{uid}/notes/{noteUuid}/versions/{versionId}, shared with the phone (utils/versions.js). Keeping
// history must never get in the way of the note itself, so nothing here throws.
const versionsRef = (uid, noteUuid) => collection(firestoreDb, 'users', uid, 'notes', noteUuid, 'versions');

async function sendVersion(uid, row) {
  try {
    const { id, noteUuid, synced, ...fields } = row;
    await setDoc(doc(versionsRef(uid, noteUuid), id), fields);
    await markVersionSynced(row);
  } catch (e) {
    console.error('Version upload failed, kept for later:', e?.code || e?.name);
  }
}

// `result` is what recordVersion returned: the rows written and the ids pruned.
export async function pushVersions(noteUuid, result) {
  if (!result || !ready || !currentUid) return; // what is unsynced goes out when sync starts
  const uid = currentUid;
  await Promise.all([
    ...result.written.map(row => sendVersion(uid, row)),
    ...result.pruned.map(id => deleteDoc(doc(versionsRef(uid, noteUuid), id)).catch(() => {})),
  ]);
}

async function replayVersions(uid) {
  try {
    await Promise.all((await unsyncedVersions()).map(row => sendVersion(uid, row)));
  } catch (e) {
    console.error('Version replay failed:', e?.code || e?.name);
  }
}

// Brings the cloud's versions of one note into this browser (the history screen calls it when it
// opens). Returns false when there was no connection to ask.
export async function pullVersions(noteUuid) {
  if (!currentUid || !noteUuid) return false;
  try {
    const snap = await getDocs(versionsRef(currentUid, noteUuid));
    await takeCloudVersions(noteUuid, snap.docs.map(d => ({ id: d.id, data: d.data() })));
    return true;
  } catch (e) {
    console.error('Could not fetch version history:', e?.code || e?.name);
    return false;
  }
}

// A note deleted for good takes its history with it, here and in the cloud.
async function deleteCloudVersions(uid, noteUuid) {
  try {
    const snap = await getDocs(versionsRef(uid, noteUuid));
    for (let i = 0; i < snap.docs.length; i += 450) {
      const batch = writeBatch(firestoreDb);
      snap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.error('Could not delete version history:', e?.code || e?.name);
  }
}

// Sends everything still in the outbox. Not awaited by startSync: offline mid-way, these settle
// only once the connection is back.
async function replayPending(uid) {
  const sends = [];
  for (const entry of (await pendingNotes()).values()) {
    if (entry.deleted) { sends.push(sendDeletion(uid, entry.uuid, entry.seq)); continue; }
    const note = await db.notes.where('uuid').equals(entry.uuid).first();
    if (!note) { await dropNote(entry.uuid); continue; }
    sends.push(sendNote(uid, note, entry.fields, entry.seq));
  }
  for (const [name, entry] of await pendingSettings()) {
    sends.push(sendSetting(uid, name, await getSetting(name), entry.seq));
  }
  sends.push(replayVersions(uid)); // not behind the notes: those can wait offline for a long time
  await Promise.all(sends);
}

// Settles once what was waiting when sync started has been confirmed (tests use it).
export const syncSettled = () => lastReplay;

// ─── Notes: pull (cloud → local) ───────────────────────────────────────────
// Takes in one note's cloud copy. `entry` is what is waiting in the outbox for it, `base` the cloud
// copy as last seen here. Returns false when the note stays deleted here.
async function applyCloudNote(uid, uuid, remote, entry, base) {
  const local = await db.notes.where('uuid').equals(uuid).first();

  if (entry?.deleted) {
    // Deleted here, and the cloud doesn't know yet. Text changed elsewhere since beats the deletion:
    // never throw away writing nobody here has seen.
    if (!base || sameContent(remote, base)) return false;
    await dropNote(uuid);
    if (!local) await db.notes.add({ uuid, ...remote });
    return true;
  }

  if (!local) {
    await db.notes.add({ uuid, ...remote });
    return true;
  }

  if (!entry) {
    // Nothing waiting here: the cloud copy is taken as it is, whatever its date.
    if (differs(local, remote)) await db.notes.update(local.id, remote);
    return true;
  }

  const { merged, loser, send } = mergeNote({ base, local, remote, pending: entry.fields });
  const changes = Object.fromEntries(Object.entries(merged)
    .filter(([f, v]) => f !== 'id' && !sameValue(v, local[f])));
  if (Object.keys(changes).length) await db.notes.update(local.id, changes);
  const left = await settleNote(uuid, entry.seq, send);

  let copy = null;
  if (loser) {
    copy = conflictCopy(loser, newUuid(), uuid);
    copy = { ...copy, id: await db.notes.add(copy) };
  }
  const copyWaiting = copy ? await recordNote(copy.uuid, null) : null;
  if (ready && uid === currentUid) {
    // Live: send now what the merge left. At the start, the outbox replay sends it.
    if (left) {
      const now = await db.notes.where('uuid').equals(uuid).first();
      if (now) sendNote(uid, now, left.fields, left.seq);
    }
    if (copy) sendNote(uid, copy, null, copyWaiting.seq);
  }
  return true;
}

async function removeLocalNoteByUuid(uuid) {
  const existing = await db.notes.where('uuid').equals(uuid).first();
  if (existing) await db.notes.delete(existing.id);
  await deleteVersionsFor(uuid).catch(() => {});
}

// One-time reconciliation right after sign-in. Covers both a brand-new
// device (pull everything down) and a device that already had notes before
// sync existed, like your laptop with the 1,784 imported notes (push
// whatever the cloud doesn't have yet, or only has an older copy of).
// `remoteSnapshot` is the live listener's first answer that the cloud has confirmed (see
// startNotesListener): the whole collection, so one read of it serves both this and the listener.
async function performInitialReconciliation(uid, remoteSnapshot) {
  const [localNotes, pending, bases] = await Promise.all([
    db.notes.toArray(),
    pendingNotes(),
    loadBases(),
  ]);
  if (uid !== currentUid) return;

  const remoteByUuid = new Map(remoteSnapshot.docs.map(d => [d.id, d.data()]));

  // A cache-only answer (offline) can't tell us what was deleted elsewhere.
  const cloudIsAuthoritative = !remoteSnapshot.metadata?.fromCache;
  const synced = loadSynced(uid);

  // Firestore batches cap at 500 writes — chunk in case a first sync ever
  // needs to push more than that in one go.
  // [note, fields]: fields null sends the whole note (the cloud doesn't have it).
  const toPush = [];
  for (const local of localNotes) {
    const remote = remoteByUuid.get(local.uuid);
    const waiting = pending.get(local.uuid);
    if (waiting && !waiting.deleted) {
      // Changed here, and the cloud never confirmed it: merged with the cloud
      // copy, and what is still ours goes out after this loop.
      if (remote) {
        await applyCloudNote(uid, local.uuid, remote, waiting, bases.get(local.uuid) || null);
        synced.add(local.uuid);
      } else if (!remote && cloudIsAuthoritative && synced.has(local.uuid)
        && waiting.fields && !waiting.fields.some(f => CONTENT_FIELDS.includes(f))) {
        // Deleted on another device, and only pinned or moved here: it stays deleted.
        await removeLocalNoteByUuid(local.uuid);
        synced.delete(local.uuid);
        await dropNote(local.uuid);
      }
      remoteByUuid.delete(local.uuid);
      continue;
    }
    if (!remote && cloudIsAuthoritative && synced.has(local.uuid)) {
      // Synced before, gone from the cloud now: deleted on another device.
      await removeLocalNoteByUuid(local.uuid);
      synced.delete(local.uuid);
    } else if (!remote) {
      toPush.push([local, null]);
    } else if (!bases.has(local.uuid) && (local.modifiedAt || 0) > (remote.modifiedAt || 0)
      && BUMP_FIELDS.some(f => f in local && !sameValue(local[f], remote[f]))) {
      // Only before this browser recorded the cloud copies, so only once: an
      // edit made here, before the outbox existed, that the cloud never got. Only content, colour and
      // folder bump modifiedAt, so only those are sent; state, pin, calendar
      // date and reminders are taken from the cloud, where the phone changes
      // them without a new date. A newer date with nothing different to send
      // is left to the branch below, which takes the cloud copy.
      const fields = [...BUMP_FIELDS.filter(f => f in local && !sameValue(local[f], remote[f])), 'modifiedAt'];
      toPush.push([local, fields]);
      const theirs = Object.fromEntries(Object.entries(remote).filter(([k]) => !fields.includes(k)));
      await db.notes.update(local.id, theirs);
    } else {
      // Cloud is the same age or newer, or holds the same content under an
      // older date (the live listener would catch most of this too, but
      // doing it here keeps startup deterministic).
      if (differs(local, remote)) await db.notes.update(local.id, remote);
      synced.add(local.uuid);
    }
    remoteByUuid.delete(local.uuid);
  }
  for (let i = 0; i < toPush.length; i += 450) {
    const batch = writeBatch(firestoreDb);
    for (const [local, fields] of toPush.slice(i, i + 450)) {
      const ref = doc(firestoreDb, 'users', uid, 'notes', local.uuid);
      batch.set(ref, fields ? pick(local, fields) : toCloudDoc(local), { merge: true });
    }
    await batch.commit();
    for (const [local] of toPush.slice(i, i + 450)) synced.add(local.uuid);
  }

  // Whatever's left exists in the cloud but not on this device — pull it down,
  // unless it was deleted here while offline (the outbox deletes it there too).
  for (const [uuid, remote] of remoteByUuid) {
    const kept = await applyCloudNote(uid, uuid, remote, pending.get(uuid), bases.get(uuid) || null);
    if (kept) synced.add(uuid);
  }
  saveSynced(uid, synced);

  // What the cloud holds now becomes the base for the next merge.
  if (cloudIsAuthoritative) await db.bases.clear();
  await db.bases.bulkPut(remoteSnapshot.docs.map(d => ({ uuid: d.id, doc: d.data() })));
  for (const [local, fields] of toPush) {
    const remote = remoteSnapshot.docs.find(d => d.id === local.uuid)?.data();
    await db.bases.put({ uuid: local.uuid, doc: fields ? { ...remote, ...pick(local, fields) } : toCloudDoc(local) });
  }
}

// Live listener — keeps this device caught up after the initial sync,
// including deletions (a doc disappearing fires a 'removed' change here,
// no separate tombstone bookkeeping needed).
//
// It is also the start-up read. Reading the collection twice (once for the reconciliation, once for
// this listener) cost two reads of every note on every page load, and the free plan allows 50,000 reads
// a day. So the listener's first answer that the cloud has confirmed (`fromCache` false: the whole
// collection, after the cache caught up) is what the reconciliation runs on. With the persistent
// cache (firebase.js) that costs only the notes changed since the last visit. An answer from the cache
// alone says nothing about what was deleted elsewhere, so it is ignored until the cloud answers.
// Resolves once reconciled; rejects when the cloud does not answer in time or reconciling fails.
let firstAnswerMs = 20_000;
export const setFirstAnswerTimeoutForTests = (ms) => { firstAnswerMs = ms; };

function startNotesListener(uid) {
  return new Promise((resolve, reject) => {
    let reconciled = false;
    let finished = false;
    let queue = Promise.resolve();
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) { stop(); reject(error); } else resolve();
    };
    const timer = setTimeout(
      () => finish(Object.assign(new Error('no answer from the cloud'), { code: 'unavailable' })),
      firstAnswerMs,
    );
    const stop = onSnapshot(
      collection(firestoreDb, 'users', uid, 'notes'),
      { includeMetadataChanges: true },
      (snapshot) => {
        // One snapshot at a time, in order.
        queue = queue.then(async () => {
          if (uid !== currentUid) return;
          if (!reconciled) {
            if (snapshot.metadata?.fromCache) return; // wait for the cloud
            await performInitialReconciliation(uid, snapshot);
            if (uid !== currentUid) return;
            reconciled = true;
            ready = true;
            finish();
            return;
          }
          await applyListenerChanges(uid, snapshot);
        }).catch((e) => {
          console.error('Notes listener failed:', e?.code || e?.name);
          if (!reconciled) finish(e);
        });
        return queue;
      },
      (e) => {
        console.error('Notes listener error:', e?.code || e);
        if (!reconciled) finish(e);
      },
    );
    unsubscribeNotes = () => { stop(); finish(); };
  });
}

async function applyListenerChanges(uid, snapshot) {
  const changes = snapshot.docChanges();
  if (!changes.length) return;
  const synced = loadSynced(uid);
  const pending = await pendingNotes();
  for (const change of changes) {
    const uuid = change.doc.id;
    const entry = pending.get(uuid);
    if (change.type === 'removed') {
      await db.bases.delete(uuid);
      synced.delete(uuid);
      const local = await db.notes.where('uuid').equals(uuid).first();
      if (local && entry && !entry.deleted
        && (entry.fields === null || entry.fields.some(f => CONTENT_FIELDS.includes(f)))) {
        // Deleted elsewhere, but its text was changed here: it comes back, whole.
        const waiting = await recordNote(uuid, null);
        sendNote(uid, local, null, waiting.seq);
      } else {
        await removeLocalNoteByUuid(uuid);
        if (entry) await dropNote(uuid);
      }
    } else if (change.doc.metadata?.hasPendingWrites) {
      // Echo of this browser's own write that the server hasn't confirmed:
      // local is already the newer truth, nothing to take.
    } else {
      const remote = change.doc.data();
      const base = baseWithOwnWrite(uuid, (await db.bases.get(uuid))?.doc || null, remote);
      const kept = await applyCloudNote(uid, uuid, remote, entry, base);
      await db.bases.put({ uuid, doc: remote });
      if (kept) synced.add(uuid);
    }
  }
  saveSynced(uid, synced);
  const { default: useNoteStore } = await import('../store/noteStore');
  useNoteStore.getState().loadNotes(useNoteStore.getState().activeState);
}

// ─── Settings: pull-on-boot + push-on-change ───────────────────────────────
// Simpler than notes on purpose — no live listener, no per-key timestamps.
// Fine for toggles like dark mode; low-stakes even in the rare case it's
// briefly wrong across two devices open at once.
// A setting changed here and still waiting in the outbox keeps its value here.
async function reconcileSettings(uid) {
  const ref = doc(firestoreDb, 'users', uid, 'meta', 'appSettings');
  const [snap, localSettings, pending] = await Promise.all([
    getDocFromServer(ref), db.settings.toArray(), pendingSettings(),
  ]);
  if (uid !== currentUid) return;

  if (!snap.exists()) {
    if (localSettings.length) {
      await setDoc(ref, Object.fromEntries(localSettings.map(s => [s.key, s.value])));
    }
    for (const [name, entry] of pending) await confirmSetting(name, entry.seq);
    return;
  }

  await db.settings.bulkPut(Object.entries(snap.data())
    .filter(([key]) => !pending.has(key))
    .map(([key, value]) => ({ key, value })));
}

async function sendSetting(uid, key, value, seq) {
  try {
    await setDoc(
      doc(firestoreDb, 'users', uid, 'meta', 'appSettings'),
      { [key]: value === undefined ? null : value },
      { merge: true },
    );
    await confirmSetting(key, seq);
  } catch (e) {
    console.error('Setting upload failed, kept for later:', e?.code || e?.name);
  }
}

// Re-reads one setting from the cloud into the local table. The Folders screen
// calls it before it shows or rewrites the list, so a change made on the phone
// since this page loaded is not overwritten with an older list.
export async function pullSetting(key) {
  if (!currentUid) return;
  try {
    if ((await pendingSettings()).has(key)) return; // changed here, not sent yet: this copy is newer
    const snap = await getDoc(doc(firestoreDb, 'users', currentUid, 'meta', 'appSettings'));
    if (snap.exists() && key in snap.data()) await setSetting(key, snap.data()[key]);
  } catch (e) {
    console.error('pullSetting failed (using the local copy):', e.code || e);
  }
}

// Convenience used by UI call sites in place of the plain database.js
// setSetting — saves locally, then mirrors to the cloud.
export async function syncSetting(key, value) {
  await setSetting(key, value);
  const seq = await recordSetting(key);
  if (!ready || !currentUid) return; // goes out when sync starts
  sendSetting(currentUid, key, value, seq);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
// Returns once sync is live, or once it knows it has to wait for a connection.
export async function startSync(uid) {
  if (currentUid === uid) return; // already running for this user
  stopSync();
  currentUid = uid;
  await attemptStart(uid);
}

async function attemptStart(uid) {
  clearRetry();
  if (uid !== currentUid) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncPhase('waiting');
    scheduleRetry(uid);
    return;
  }
  setSyncPhase('connecting');
  try {
    await reconcileSettings(uid);
    if (uid !== currentUid) return;
    await startNotesListener(uid); // reconciles on the cloud's first answer, then stays live
    if (uid !== currentUid) return;
    setSyncPhase('live');
    lastReplay = replayPending(uid).catch(e => console.error('Outbox replay failed:', e?.code || e?.name));
  } catch (e) {
    // Most often offline, or the cloud didn't answer. Nothing was taken or lost: try again later.
    console.error('Sync could not start, trying again later:', e?.code || e?.name);
    if (uid !== currentUid) return;
    setSyncPhase('waiting');
    scheduleRetry(uid);
  }
}

function scheduleRetry(uid) {
  onlineHandler = () => attemptStart(uid);
  if (typeof window !== 'undefined') window.addEventListener('online', onlineHandler);
  retryTimer = setTimeout(() => attemptStart(uid), RETRY_MS);
}

function clearRetry() {
  if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
  onlineHandler = null;
  clearTimeout(retryTimer);
  retryTimer = null;
}

export function stopSync() {
  clearRetry();
  if (unsubscribeNotes) unsubscribeNotes();
  unsubscribeNotes = null;
  currentUid = null;
  ready = false;
  inFlight.clear();
  setSyncPhase('off');
}
