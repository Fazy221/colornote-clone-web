// Turns the outbox into plain sentences for the "changes waiting" dialog: which note, and what about
// it still has to reach the cloud.

const FIELD_LABELS = {
  title: 'title',
  type: 'type',
  note: 'text',
  items: 'checklist items',
  encrypted: 'lock',
  format: 'format',
  colorIndex: 'colour',
  folderId: 'folder',
  importance: 'pin',
  state: 'archive / trash',
  modifiedAt: 'edit time',
  hidden: 'hidden',
  calendarDate: 'calendar date',
  reminder: 'reminder',
  reminderAt: 'reminder',
};

const SETTING_LABELS = {
  showHiddenNotes: 'Show hidden notes',
  searchLockedContent: 'Search inside locked notes',
  searchHiddenNotes: 'Search hidden notes',
};

export function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

export function settingLabel(name) {
  return SETTING_LABELS[name] || name;
}

// entries: outbox rows. notes: Map uuid -> note (as far as it is still held here).
// Returns [{ key, kind: 'note' | 'setting', title, what }], notes first, then settings.
export function describePending(entries, notes) {
  const rows = [];
  for (const e of entries || []) {
    if (e.key?.startsWith('setting:')) {
      rows.push({ key: e.key, kind: 'setting', title: settingLabel(e.setting), what: 'Setting changed' });
      continue;
    }
    const note = notes?.get(e.uuid);
    const title = note ? (note.encrypted ? 'Locked note' : (note.title || '(untitled)')) : '(note no longer here)';
    let what;
    if (e.deleted) what = 'Deleted';
    else if (e.fields === null || e.fields === undefined) what = 'Whole note (new or copied)';
    else {
      const labels = [...new Set(e.fields.map(fieldLabel))];
      what = labels.length ? `Changed: ${labels.join(', ')}` : 'Changed';
    }
    rows.push({ key: e.key, kind: 'note', title, what });
  }
  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1));
}
