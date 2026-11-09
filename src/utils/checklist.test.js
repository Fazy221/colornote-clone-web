import { describe, it, expect } from 'vitest';
import {
  serializeItems, parseChecklistStr, cleanItems, insertAfter, addChild, addParentAtEnd, removeRow, blockEnd,
} from './checklist';
import { sameValue } from './noteFields';

const row = (text, level, checked = false) => (level ? { text, checked, level: 1 } : { text, checked });

describe('checklist text form (locked notes)', () => {
  it('round-trips sub-items with a two-space indent', () => {
    const items = [row('A', 0), row('a1', 1, true), row('B', 0)];
    const text = serializeItems(items);
    expect(text).toBe('[ ] A\n  [V] a1\n[ ] B');
    expect(parseChecklistStr(text)).toEqual(items);
  });

  it('reads old lists with no indent as plain rows', () => {
    expect(parseChecklistStr('[V] x\n[ ] y')).toEqual([row('x', 0, true), row('y', 0)]);
  });

  it('never starts with a sub-item', () => {
    expect(parseChecklistStr('  [ ] orphan')).toEqual([row('orphan', 0)]);
  });
});

describe('cleanItems', () => {
  it('drops blank rows and keeps level 0 keyless, so old lists compare equal', () => {
    const cleaned = cleanItems([row('A', 0), row('', 0), row('B', 0)]);
    expect(sameValue(cleaned, [{ text: 'A', checked: false }, { text: 'B', checked: false }])).toBe(true);
    expect('level' in cleaned[0]).toBe(false);
  });

  it('promotes the sub-items of a blank parent', () => {
    expect(cleanItems([row('A', 0), row('', 0), row('x', 1)])).toEqual([row('A', 0), row('x', 0)]);
  });
});

describe('editing', () => {
  const list = [row('A', 0), row('a1', 1), row('a2', 1), row('B', 0)];

  it('Enter in a parent adds a parent after its sub-items', () => {
    const r = insertAfter(list, 0);
    expect(r.focus).toBe(3);
    expect(r.items[3]).toEqual(row('', 0));
  });

  it('Enter in a sub-item adds another sub-item', () => {
    const r = insertAfter(list, 1);
    expect(r.focus).toBe(2);
    expect(r.items[2]).toEqual(row('', 1));
  });

  it('adds a child at the end of the parent block', () => {
    const r = addChild(list, 0);
    expect(r.focus).toBe(3);
    expect(r.items.map(i => i.text)).toEqual(['A', 'a1', 'a2', '', 'B']);
    expect(r.items[3].level).toBe(1);
  });

  it('adds a parent at the end', () => {
    expect(addParentAtEnd(list).focus).toBe(4);
  });

  it('removing a parent removes its sub-items; a sub-item goes alone', () => {
    expect(removeRow(list, 0).items).toEqual([row('B', 0)]);
    expect(removeRow(list, 1).items.map(i => i.text)).toEqual(['A', 'a2', 'B']);
  });

  it('clears the only row instead of removing it', () => {
    expect(removeRow([row('x', 0)], 0).items).toEqual([row('', 0)]);
  });

  it('finds the end of a block', () => {
    expect(blockEnd(list, 0)).toBe(2);
    expect(blockEnd(list, 3)).toBe(3);
  });
});
