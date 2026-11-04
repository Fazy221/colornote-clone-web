// Which note fields belong together, and how two copies of a note are compared. The same rules as the
// Android app (Note.sameContent, NoteRepository.edit/organize).

// What a note says. These move as one group, so ciphertext never separates from its flag.
export const CONTENT_FIELDS = ['title', 'type', 'note', 'items', 'encrypted', 'format'];

// Changing one of these bumps modifiedAt: content, colour and folder. Trash, archive, restore, pin,
// calendar date and reminders don't, so organizing old diary entries never rewrites their dates.
export const BUMP_FIELDS = [...CONTENT_FIELDS, 'colorIndex', 'folderId'];

// true/false and 1/0, '' and null and missing, and key order all count as the same value.
export function normalise(v) {
  if (v === undefined || v === '') return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, normalise(v[k])]));
  }
  return v;
}

export function sameValue(a, b) {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

export function sameContent(a, b) {
  return CONTENT_FIELDS.every(f => sameValue(a?.[f], b?.[f]));
}

// The named fields of a note. Firestore refuses undefined, so a missing field is sent as null.
export function pick(note, fields) {
  return Object.fromEntries(fields.map(f => [f, note?.[f] === undefined ? null : note[f]]));
}

// What an editor save should do, decided without touching anything.
//  base:    the note as the editor opened it or last saved it
//  edited:  the note as the editor holds it now (content fields, colorIndex, folderId)
//  current: the stored note now, which sync may have changed meanwhile; null if it was deleted
//
// Only what the editor changed is written, so opening a note and leaving it writes nothing, and a
// pin, calendar date or reminder set elsewhere is never undone. If the text changed both here and
// elsewhere, the other version becomes a "[conflict]" copy, as on the phone. A note deleted
// elsewhere comes back as a new one, because the editor holds the only copy of its text.
export function planEditorSave({ base, edited, current, now, newUuid }) {
  const contentEdited = !sameContent(edited, base);
  const colourEdited = (f) => !sameValue(edited[f], base[f]);

  if (!current) {
    if (!contentEdited && !colourEdited('colorIndex') && !colourEdited('folderId')) return { changes: null };
    const { id: _id, uuid: _uuid, ...rest } = base;
    return { revive: { ...rest, ...edited, uuid: newUuid(), createdAt: now, modifiedAt: now } };
  }

  const changes = {};
  let conflictCopy = null;
  if (contentEdited && !sameContent(current, edited)) {
    Object.assign(changes, pick(edited, CONTENT_FIELDS));
    if (!sameContent(current, base)) {
      const { id: _id, ...rest } = current;
      conflictCopy = { ...rest, uuid: newUuid(), title: `[conflict] ${current.title || ''}`, conflictOf: current.uuid };
    }
  }
  for (const f of ['colorIndex', 'folderId']) {
    if (colourEdited(f) && !sameValue(edited[f], current[f])) changes[f] = edited[f];
  }
  if (!Object.keys(changes).length) return { changes: null };
  changes.modifiedAt = Math.max(now, (current.modifiedAt || 0) + 1);
  return { changes, conflictCopy };
}
