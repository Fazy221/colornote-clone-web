// What to do when a note changed here (and the cloud hasn't confirmed it yet) and the cloud copy
// changed too. The same rules as the phone's mergeNotes (SyncLogic.kt), worked out field by field:
//
// - A field changed on one side only keeps that change. So a pin made here never undoes an edit
//   made on the phone, and the reverse.
// - Title, type, text, checklist, lock flag and formatting move as one group: locked text never
//   separates from its flag, and formatting never lands on other words.
// - Only when the text was changed on both sides is it a real conflict. The newer version stays in
//   the note, and the other one is kept as a separate "[conflict] …" note, so no writing is lost.
// - Any other field changed on both sides: the newer side wins.
//
// What changed here is known exactly (the outbox's list of fields). What changed in the cloud is
// found by comparing with `base`, the cloud copy as this device last saw it.

import { CONTENT_FIELDS, sameContent, sameValue } from '../utils/noteFields';

const OWN_FIELDS = new Set(['id', 'uuid', 'modifiedAt']);

// base:    the cloud copy as last seen here, or null if unknown
// local:   the note on this device
// remote:  the cloud copy now
// pending: the fields changed here and not yet confirmed (null: all of them)
//
// Returns { merged, loser, send }:
//   merged: the note to keep on this device
//   loser:  the other version of the text when both sides edited it, to keep as a copy; else null
//   send:   the fields where merged differs from the cloud, to send (empty: nothing)
export function mergeNote({ base, local, remote, pending }) {
  const changedHere = (f) => pending === null || pending.includes(f);
  // The cloud changed this since this device last saw it. Unknown base: assume it did not, so a
  // change made here is kept (the behaviour before bases were recorded).
  const changedThere = (f) => !!base && !sameValue(remote[f], base[f]);
  const localIsNewer = (local.modifiedAt || 0) > (remote.modifiedAt || 0);

  const merged = { ...local };
  let loser = null;

  // The content group.
  const contentHere = CONTENT_FIELDS.some(changedHere);
  const contentThere = !base || !sameContent(remote, base);
  if (!contentHere) {
    for (const f of CONTENT_FIELDS) if (f in remote) merged[f] = remote[f];
  } else if (!sameContent(local, remote) && contentThere) {
    // Both sides wrote something different. With no base this can't be told apart from an edit
    // made here alone, so a copy is kept to be safe.
    const [winner, other] = localIsNewer ? [local, remote] : [remote, local];
    for (const f of CONTENT_FIELDS) merged[f] = winner[f] ?? null;
    // A snapshot: the note on this device is updated with the winner next, and the copy must not
    // follow it.
    loser = { ...other };
  }

  // Everything else, one field at a time; fields this app doesn't know come from the cloud.
  const fields = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const f of fields) {
    if (OWN_FIELDS.has(f) || CONTENT_FIELDS.includes(f)) continue;
    if (!(f in remote)) continue; // the cloud has never had it: keep ours
    if (!changedHere(f)) merged[f] = remote[f];
    else if (sameValue(local[f], remote[f])) continue;
    else if (changedThere(f) && !localIsNewer) merged[f] = remote[f];
  }
  merged.modifiedAt = Math.max(local.modifiedAt || 0, remote.modifiedAt || 0);

  const send = [...fields, 'modifiedAt'].filter((f, i, all) => all.indexOf(f) === i
    && f !== 'id' && f !== 'uuid' && f in merged && !sameValue(merged[f], remote[f]));
  return { merged, loser, send };
}

// The note kept when both sides edited the text: the losing version, as a new note.
export function conflictCopy(loser, uuid) {
  const { id: _id, ...rest } = loser;
  return { ...rest, uuid, title: `[conflict] ${loser.title || ''}` };
}
