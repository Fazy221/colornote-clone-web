// Reads and writes a note's version history in IndexedDB. The rules are in utils/versions.js; getting
// the versions to and from the cloud is in sync/notesSync.js.

import { db } from './database';
import { baselineEntry, planVersion, toPrune } from '../utils/versions';

// Saves come one after another, so two quick edits never both think they are the first.
let chain = Promise.resolve();

// Newest first.
export async function listVersions(noteUuid) {
  const rows = await db.versions.where('noteUuid').equals(noteUuid).toArray();
  return rows.sort((a, b) => b.at - a.at);
}

// Notes that `after` was saved over `before`. Returns what was written and what was pruned (for the
// cloud), or null when nothing needed keeping.
export function recordVersion(before, after, { kind = 'edit', now = Date.now() } = {}) {
  const run = async () => {
    if (!after?.uuid) return null;
    const history = await listVersions(after.uuid);
    const plan = planVersion({ before, after, history, now, kind });
    if (!plan) return null;
    const written = [];
    if (plan.baseline) {
      written.push({ id: crypto.randomUUID(), noteUuid: after.uuid, ...baselineEntry(plan.baseline, now), synced: 0 });
    }
    written.push({
      id: plan.replace ? plan.replace.id : crypto.randomUUID(),
      noteUuid: after.uuid, ...plan.entry, synced: 0,
    });
    await db.versions.bulkPut(written);
    const pruned = toPrune(await listVersions(after.uuid)).map(v => v.id);
    if (pruned.length) await db.versions.bulkDelete(pruned);
    return { written, pruned };
  };
  const result = chain.then(run, run);
  chain = result.catch(() => {});
  return result;
}

export async function deleteVersionsFor(noteUuid) {
  await db.versions.where('noteUuid').equals(noteUuid).delete();
}

export async function unsyncedVersions() {
  return db.versions.where('synced').equals(0).toArray();
}

export async function markVersionSynced(row) {
  // Only if it was not changed again (joined by a later edit) while it was being sent.
  await db.versions.where('id').equals(row.id).and(r => r.at === row.at).modify({ synced: 1 });
}

// The cloud's versions of a note, taken in. A version still waiting to go out here is kept as it is.
export async function takeCloudVersions(noteUuid, docs) {
  let added = 0;
  for (const { id, data } of docs) {
    const local = await db.versions.get(id);
    if (local && local.synced === 0) continue;
    await db.versions.put({ ...data, id, noteUuid, synced: 1 });
    if (!local) added++;
  }
  return added;
}
