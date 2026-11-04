import { describe, it, expect } from 'vitest';
import { mergeNote } from '../merge';

const note = (over = {}) => ({ uuid: 'u1', title: 'Diary', type: 'text', note: 'Body', items: null, encrypted: 0, format: '', colorIndex: 0, folderId: 0, modifiedAt: 5000, ...over });

describe('mergeNote and the modified date', () => {
  it('keeps a date chosen here, even an older one, while the cloud still has the date it had', () => {
    const base = note();
    const local = note({ modifiedAt: 1000 });
    const { merged, send } = mergeNote({ base, local, remote: base, pending: ['modifiedAt'] });
    expect(merged.modifiedAt).toBe(1000);
    expect(send).toContain('modifiedAt');
  });

  it('takes the newer date when the cloud date moved too', () => {
    const base = note();
    const local = note({ modifiedAt: 1000 });
    const remote = note({ modifiedAt: 9000 });
    expect(mergeNote({ base, local, remote, pending: ['modifiedAt'] }).merged.modifiedAt).toBe(9000);
  });

  it('takes the newer date when nothing about the date is pending here', () => {
    const base = note();
    const remote = note({ modifiedAt: 9000 });
    expect(mergeNote({ base, local: base, remote, pending: ['importance'] }).merged.modifiedAt).toBe(9000);
  });

  it('with no recorded base, still takes the newer date', () => {
    const local = note({ modifiedAt: 1000 });
    expect(mergeNote({ base: null, local, remote: note(), pending: ['modifiedAt'] }).merged.modifiedAt).toBe(5000);
  });
});
