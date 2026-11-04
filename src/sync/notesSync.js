// Local-first Firestore sync. Dexie stays the single source of truth for
// everything the UI reads and writes — this module's only job is keeping a
// cloud mirror in sync with it, in both directions.
//
// Notes are keyed in Firestore by their `uuid` (not Dexie's local
// auto-increment `id`, which is meaningless outside this device). Conflicts
// are resolved last-write-wins by `modifiedAt` — reasonable for a single
// person using one device at a time, not built for simultaneous editing.
//
// Encrypted notes: `note` is already ciphertext by the time it reaches here
// (see crypto.js) — this module just moves bytes, it doesn't add or remove
// any encryption of its own.
//
// Two things last-write-wins on `modifiedAt` alone can't do, handled below:
//  - Trash, archive, restore, pin, lock and unlock don't bump `modifiedAt`
//    (on the web or on the phone), so a cloud copy with the SAME `modifiedAt`
//    but different content/state fields is a newer change and is taken.
//  - A note deleted on another device must not come back. Each browser keeps
//    the uuids it has already synced with this account; one of those that is
//    missing from the cloud was deleted elsewhere and is removed here, instead
//    of being re-uploaded. Notes this browser never synced are still pushed.
//
// Pushes send only the fields that changed (updateDoc), like the phone does, so
// a field changed elsewhere since this browser last heard of the note (a pin, a
// dismissed reminder, a field this app doesn't know) is never overwritten. Only
// a new note sends the whole doc, with merge.

import {
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db as firestoreDb } from '../firebase';
import { db, setSetting } from '../db/database';
import { BUMP_FIELDS, CONTENT_FIELDS, pick, sameValue } from '../utils/noteFields';

let unsubscribeNotes = null;
let currentUid = null;

// Fields compared when the two copies have the same `modifiedAt`. The reminder
// fields are here because the phone changes them without bumping `modifiedAt`.
const SYNCED_FIELDS = [
  'title', 'note', 'items', 'type', 'colorIndex', 'state', 'encrypted', 'folderId',
  'importance', 'calendarDate', 'reminderType', 'reminderRepeat', 'tags', 'format',
  'reminderTime', 'reminderRepeatEnds', 'reminderDismissedAt',
];

// True when the cloud copy differs in a field the cloud actually has.
function contentDiffers(local, cloud) {
  return SYNCED_FIELDS.some(f => f in cloud && !sameValue(cloud[f], local[f]));
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
  if (!currentUid || !note?.uuid) return;
  if (fields && !fields.length) return;
  const uid = currentUid;
  const ref = doc(firestoreDb, 'users', uid, 'notes', note.uuid);
  try {
    if (!fields) {
      await setDoc(ref, toCloudDoc(note), { merge: true });
    } else {
      try {
        await updateDoc(ref, pick(note, fields));
      } catch (e) {
        if (e?.code !== 'not-found') throw e;
        // Deleted elsewhere meanwhile. Text edited here is the only copy left,
        // so the note comes back; a pin or a move on its own doesn't.
        if (!fields.some(f => CONTENT_FIELDS.includes(f))) return;
        await setDoc(ref, toCloudDoc(note), { merge: true });
      }
    }
    markSynced(uid, note.uuid);
  } catch (e) {
    // Firestore's own offline queue retries automatically once back online.
    console.error('pushNote failed (will retry when online):', e.code || e);
  }
}

export async function pushNoteDeletion(uuid) {
  if (!currentUid || !uuid) return;
  const uid = currentUid;
  markSynced(uid, uuid, false);
  try {
    await deleteDoc(doc(firestoreDb, 'users', uid, 'notes', uuid));
  } catch (e) {
    console.error('pushNoteDeletion failed (will retry when online):', e.code || e);
  }
}

// ─── Notes: pull (cloud → local) ───────────────────────────────────────────
async function upsertLocalNoteFromCloud(uuid, cloudData) {
  const existing = await db.notes.where('uuid').equals(uuid).first();
  if (existing) {
    const cloudAt = cloudData.modifiedAt || 0;
    const localAt = existing.modifiedAt || 0;
    if (cloudAt > localAt || (cloudAt === localAt && contentDiffers(existing, cloudData))) {
      await db.notes.update(existing.id, cloudData);
    }
  } else {
    await db.notes.add({ uuid, ...cloudData });
  }
}

async function removeLocalNoteByUuid(uuid) {
  const existing = await db.notes.where('uuid').equals(uuid).first();
  if (existing) await db.notes.delete(existing.id);
}

// One-time reconciliation right after sign-in. Covers both a brand-new
// device (pull everything down) and a device that already had notes before
// sync existed, like your laptop with the 1,784 imported notes (push
// whatever the cloud doesn't have yet, or only has an older copy of).
async function performInitialReconciliation(uid) {
  const [localNotes, remoteSnapshot] = await Promise.all([
    db.notes.toArray(),
    getDocs(collection(firestoreDb, 'users', uid, 'notes')),
  ]);

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
    if (!remote && cloudIsAuthoritative && synced.has(local.uuid)) {
      // Synced before, gone from the cloud now: deleted on another device.
      await removeLocalNoteByUuid(local.uuid);
      synced.delete(local.uuid);
    } else if (!remote) {
      toPush.push([local, null]);
    } else if ((local.modifiedAt || 0) > (remote.modifiedAt || 0)
      && BUMP_FIELDS.some(f => f in local && !sameValue(local[f], remote[f]))) {
      // An edit made here that the cloud never got. Only content, colour and
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
      if ((remote.modifiedAt || 0) !== (local.modifiedAt || 0) || contentDiffers(local, remote)) {
        await db.notes.update(local.id, remote);
      }
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

  // Whatever's left exists in the cloud but not on this device — pull it down.
  for (const [uuid, remote] of remoteByUuid) {
    await upsertLocalNoteFromCloud(uuid, remote);
    synced.add(uuid);
  }
  saveSynced(uid, synced);
}

// Live listener — keeps this device caught up after the initial sync,
// including deletions (a doc disappearing fires a 'removed' change here,
// no separate tombstone bookkeeping needed).
function attachNotesListener(uid) {
  const colRef = collection(firestoreDb, 'users', uid, 'notes');
  return onSnapshot(colRef, async (snapshot) => {
    const changes = snapshot.docChanges();
    if (!changes.length) return;
    const synced = loadSynced(uid);
    await Promise.all(changes.map(async (change) => {
      const uuid = change.doc.id;
      if (change.type === 'removed') {
        await removeLocalNoteByUuid(uuid);
        synced.delete(uuid);
      } else if (change.doc.metadata?.hasPendingWrites) {
        // Echo of this browser's own write that the server hasn't confirmed:
        // local is already the newer truth, nothing to take.
      } else {
        await upsertLocalNoteFromCloud(uuid, change.doc.data());
        synced.add(uuid);
      }
    }));
    saveSynced(uid, synced);
    const { default: useNoteStore } = await import('../store/noteStore');
    useNoteStore.getState().loadNotes(useNoteStore.getState().activeState);
  }, (e) => console.error('Notes listener error:', e.code || e));
}

// ─── Settings: pull-on-boot + push-on-change ───────────────────────────────
// Simpler than notes on purpose — no live listener, no per-key timestamps.
// Fine for toggles like dark mode; low-stakes even in the rare case it's
// briefly wrong across two devices open at once.
async function reconcileSettings(uid) {
  const ref = doc(firestoreDb, 'users', uid, 'meta', 'appSettings');
  const snap = await getDoc(ref);
  const localSettings = await db.settings.toArray();

  if (!snap.exists()) {
    if (localSettings.length) {
      await setDoc(ref, Object.fromEntries(localSettings.map(s => [s.key, s.value])));
    }
    return;
  }

  await db.settings.bulkPut(Object.entries(snap.data()).map(([key, value]) => ({ key, value })));
}

export async function pushSetting(key, value) {
  if (!currentUid) return;
  try {
    await setDoc(doc(firestoreDb, 'users', currentUid, 'meta', 'appSettings'), { [key]: value }, { merge: true });
  } catch (e) {
    console.error('pushSetting failed (will retry when online):', e.code || e);
  }
}

// Re-reads one setting from the cloud into the local table. The Folders screen
// calls it before it shows or rewrites the list, so a change made on the phone
// since this page loaded is not overwritten with an older list.
export async function pullSetting(key) {
  if (!currentUid) return;
  try {
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
  pushSetting(key, value);
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
export async function startSync(uid) {
  if (currentUid === uid) return; // already running for this user
  currentUid = uid;
  await reconcileSettings(uid);
  await performInitialReconciliation(uid);
  unsubscribeNotes = attachNotesListener(uid);
}

export function stopSync() {
  if (unsubscribeNotes) unsubscribeNotes();
  unsubscribeNotes = null;
  currentUid = null;
}
