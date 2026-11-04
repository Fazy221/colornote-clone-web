// Read-only access to the owner's Firestore. Only get() and list calls are used here (a test scans this
// file for anything that writes). The service account should hold the "Cloud Datastore Viewer" role only,
// so Google refuses a write even if this code were changed.
//
// Layout (see the apps' CLAUDE.md): users/{uid}/notes/{uuid}, users/{uid}/meta/appSettings,
// users/{uid}/notes/{uuid}/versions/{versionId}.

import { Firestore } from '@google-cloud/firestore';
import { toNote, toVersion, groupVersions, DEFAULT_COLOR_NAMES } from './notes.js';

const CACHE_MS = 30_000;

export class NoteStore {
  constructor({ projectId, uid, keyFilename } = {}) {
    this.db = new Firestore({ ...(projectId ? { projectId } : {}), ...(keyFilename ? { keyFilename } : {}) });
    this.uid = uid || null;
    this.cache = null;
  }

  async userRef() {
    if (!this.uid) {
      const users = await this.db.collection('users').listDocuments();
      if (users.length !== 1) {
        throw new Error(`Found ${users.length} users; set COLORNOTE_UID to the one to read.`);
      }
      this.uid = users[0].id;
    }
    return this.db.collection('users').doc(this.uid);
  }

  // Folders and colour names. Nothing else from appSettings is exposed (it also holds app preferences).
  async settings() {
    const ref = await this.userRef();
    const snap = await ref.collection('meta').doc('appSettings').get();
    const data = snap.exists ? snap.data() : {};
    const folders = Array.isArray(data.folders) ? data.folders : [];
    const colorNames = Array.isArray(data.colorNames) && data.colorNames.length === 10 ? data.colorNames : DEFAULT_COLOR_NAMES;
    return { folders, colorNames };
  }

  // Every note as a plain note, locked ones decrypted in memory. Cached for 30 s so a run of tool calls
  // reads Firestore once.
  async allNotes({ fresh = false } = {}) {
    if (!fresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const ref = await this.userRef();
    const ctx = await this.settings();
    const snap = await ref.collection('notes').get();
    const notes = snap.docs.map((d) => toNote(d.id, d.data(), ctx));
    this.cache = { at: Date.now(), notes, ctx };
    return this.cache;
  }

  async getNote(uuid) {
    const { notes } = await this.allNotes();
    const lower = String(uuid).toLowerCase();
    const exact = notes.find((n) => n.uuid.toLowerCase() === lower);
    if (exact) return exact;
    const starts = notes.filter((n) => n.uuid.toLowerCase().startsWith(lower));
    return starts.length === 1 ? starts[0] : null;
  }

  async versions(uuid) {
    const note = await this.getNote(uuid);
    if (!note) return null;
    const ref = await this.userRef();
    const { ctx } = await this.allNotes();
    const snap = await ref.collection('notes').doc(note.uuid).collection('versions').get();
    const versions = snap.docs.map((d) => toVersion(d.id, d.data(), ctx));
    return { note, days: groupVersions(versions), count: versions.length };
  }
}
