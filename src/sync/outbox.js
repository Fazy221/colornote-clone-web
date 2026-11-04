// Changes made here that the cloud hasn't confirmed yet, kept in IndexedDB so they survive closing the
// app while offline. Firestore's own queue lives in memory and is lost with the tab. Like the phone's
// "dirty" rows: an entry goes when the cloud confirms the latest write for it, and whatever is left
// is sent again the next time sync starts.
//
// One entry per note or setting:
//   { key: 'note:<uuid>', uuid, fields: [...] | null, deleted, seq }
//     fields null means the whole note (new here, or a copy). deleted means "delete it in the cloud".
//   { key: 'setting:<name>', setting, seq }
// seq goes up with every change, so a confirmation for an older write never removes a newer one.

import { db } from '../db/database';

const noteKey = (uuid) => `note:${uuid}`;
const settingKey = (name) => `setting:${name}`;

// One read-modify-write at a time, so two quick changes to the same note can't lose each other.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Remembers that these fields of the note still have to reach the cloud. Returns { seq, fields }:
// every field still waiting for this note, earlier ones included (null for the whole note), so one
// write carries all of them with the note's current values.
export function recordNote(uuid, fields) {
  return serial(async () => {
    const key = noteKey(uuid);
    const old = await db.outbox.get(key);
    let merged;
    if (!fields || !old || old.deleted || old.fields === null) {
      merged = !fields || (old && !old.deleted && old.fields === null) ? null : [...fields];
    } else {
      merged = [...new Set([...old.fields, ...fields])];
    }
    const seq = (old?.seq || 0) + 1;
    await db.outbox.put({ key, uuid, fields: merged, deleted: false, seq });
    return { seq, fields: merged };
  });
}

export function recordDeletion(uuid) {
  return serial(async () => {
    const key = noteKey(uuid);
    const old = await db.outbox.get(key);
    const seq = (old?.seq || 0) + 1;
    await db.outbox.put({ key, uuid, fields: null, deleted: true, seq });
    return seq;
  });
}

export function recordSetting(name) {
  return serial(async () => {
    const key = settingKey(name);
    const old = await db.outbox.get(key);
    const seq = (old?.seq || 0) + 1;
    await db.outbox.put({ key, setting: name, seq });
    return seq;
  });
}

// The cloud confirmed the write made at `seq`. Removes the entry unless something newer came since.
function confirm(key, seq) {
  return serial(async () => {
    const entry = await db.outbox.get(key);
    if (entry && entry.seq === seq) await db.outbox.delete(key);
  });
}
export const confirmNote = (uuid, seq) => confirm(noteKey(uuid), seq);
export const confirmSetting = (name, seq) => confirm(settingKey(name), seq);

// After a merge with the cloud copy: `fields` are what still differs from the cloud. Made at `seq`;
// if the note changed here since, those changes stay waiting too. Returns the entry left, or null.
export function settleNote(uuid, seq, fields) {
  return serial(async () => {
    const key = noteKey(uuid);
    const entry = await db.outbox.get(key);
    if (!entry || entry.deleted) return entry || null;
    if (entry.seq !== seq) {
      if (entry.fields === null) return entry;
      const next = { ...entry, fields: [...new Set([...entry.fields, ...fields])] };
      await db.outbox.put(next);
      return next;
    }
    if (!fields.length) {
      await db.outbox.delete(key);
      return null;
    }
    const next = { ...entry, fields: [...fields] };
    await db.outbox.put(next);
    return next;
  });
}

// Nothing left to send for it (the note is gone everywhere).
export const dropNote = (uuid) => serial(() => db.outbox.delete(noteKey(uuid)));

export async function pendingNotes() {
  const all = await db.outbox.toArray();
  return new Map(all.filter(e => e.key.startsWith('note:')).map(e => [e.uuid, e]));
}

export async function pendingSettings() {
  const all = await db.outbox.toArray();
  return new Map(all.filter(e => e.key.startsWith('setting:')).map(e => [e.setting, e]));
}
