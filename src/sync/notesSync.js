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

import {
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db as firestoreDb } from '../firebase';
import { db, setSetting } from '../db/database';

let unsubscribeNotes = null;
let currentUid = null;

function toCloudDoc(note) {
  const { id, ...rest } = note; // strip the device-local Dexie key
  return rest;
}

// ─── Notes: push (local → cloud) ───────────────────────────────────────────
export async function pushNote(note) {
  if (!currentUid || !note?.uuid) return;
  try {
    await setDoc(doc(firestoreDb, 'users', currentUid, 'notes', note.uuid), toCloudDoc(note));
  } catch (e) {
    // Firestore's own offline queue retries automatically once back online.
    console.error('pushNote failed (will retry when online):', e.code || e);
  }
}

export async function pushNoteDeletion(uuid) {
  if (!currentUid || !uuid) return;
  try {
    await deleteDoc(doc(firestoreDb, 'users', currentUid, 'notes', uuid));
  } catch (e) {
    console.error('pushNoteDeletion failed (will retry when online):', e.code || e);
  }
}

// ─── Notes: pull (cloud → local) ───────────────────────────────────────────
async function upsertLocalNoteFromCloud(uuid, cloudData) {
  const existing = await db.notes.where('uuid').equals(uuid).first();
  if (existing) {
    if ((cloudData.modifiedAt || 0) > (existing.modifiedAt || 0)) {
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

  // Firestore batches cap at 500 writes — chunk in case a first sync ever
  // needs to push more than that in one go.
  const toPush = [];
  for (const local of localNotes) {
    const remote = remoteByUuid.get(local.uuid);
    if (!remote || (local.modifiedAt || 0) > (remote.modifiedAt || 0)) {
      toPush.push(local);
    }
    remoteByUuid.delete(local.uuid);
  }
  for (let i = 0; i < toPush.length; i += 450) {
    const batch = writeBatch(firestoreDb);
    for (const local of toPush.slice(i, i + 450)) {
      batch.set(doc(firestoreDb, 'users', uid, 'notes', local.uuid), toCloudDoc(local));
    }
    await batch.commit();
  }

  // Whatever's left exists in the cloud but not on this device — pull it down.
  for (const [uuid, remote] of remoteByUuid) {
    await upsertLocalNoteFromCloud(uuid, remote);
  }
}

// Live listener — keeps this device caught up after the initial sync,
// including deletions (a doc disappearing fires a 'removed' change here,
// no separate tombstone bookkeeping needed).
function attachNotesListener(uid) {
  const colRef = collection(firestoreDb, 'users', uid, 'notes');
  return onSnapshot(colRef, async (snapshot) => {
    const changes = snapshot.docChanges();
    if (!changes.length) return;
    await Promise.all(changes.map(change =>
      change.type === 'removed'
        ? removeLocalNoteByUuid(change.doc.id)
        : upsertLocalNoteFromCloud(change.doc.id, change.doc.data())
    ));
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
