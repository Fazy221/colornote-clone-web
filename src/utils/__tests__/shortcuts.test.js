import { describe, it, expect } from 'vitest';
import { SHORTCUTS, matches, is, isTyping, shortcutGroups, shortcutDone } from '../shortcuts';

const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

describe('matches', () => {
  it('reads Ctrl+Alt letters from the physical key, so AltGr layouts still match', () => {
    expect(matches(ev({ key: 'ñ', code: 'KeyN', ctrlKey: true, altKey: true }), 'ctrl+alt+n')).toBe(true);
  });
  it('treats Cmd as Ctrl', () => {
    expect(matches(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'ctrl+k')).toBe(true);
  });
  it('needs exactly the named modifiers', () => {
    expect(matches(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), 'ctrl+alt+n')).toBe(false);
    expect(matches(ev({ key: 'b', code: 'KeyB', ctrlKey: true, shiftKey: true }), 'ctrl+b')).toBe(false);
    expect(matches(ev({ key: 'x', code: 'KeyX', ctrlKey: true, shiftKey: true }), 'ctrl+shift+x')).toBe(true);
    expect(matches(ev({ key: 'g', code: 'KeyG', ctrlKey: true }), 'g')).toBe(false);
  });
  it('ignores Shift on symbols such as ?', () => {
    expect(matches(ev({ key: '?', code: 'Slash', shiftKey: true }), '?')).toBe(true);
    expect(matches(ev({ key: '/', code: 'Slash' }), '/')).toBe(true);
  });
  it('matches named keys', () => {
    expect(matches(ev({ key: 'Enter', ctrlKey: true }), 'ctrl+enter')).toBe(true);
    expect(matches(ev({ key: 'Delete' }), 'delete')).toBe(true);
    expect(matches(ev({ key: 'ArrowDown' }), 'arrowdown')).toBe(true);
  });
});

describe('is', () => {
  it('finds a shortcut by id, through any of its keys', () => {
    expect(is(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'search')).toBe(true);
    expect(is(ev({ key: '/', code: 'Slash' }), 'search')).toBe(true);
    expect(is(ev({ key: 'y', code: 'KeyY', ctrlKey: true }), 'redo')).toBe(true);
  });
  it('never matches a two-key sequence as one key', () => {
    expect(is(ev({ key: 'g', code: 'KeyG' }), 'goHome')).toBe(false);
  });
});

describe('the table', () => {
  it('has unique ids and a description for every labelled row', () => {
    const ids = SHORTCUTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    SHORTCUTS.filter(s => s.label).forEach(s => expect(s.desc).toBeTruthy());
  });
  it('groups for the cheat sheet, hiding the unlabelled half of a pair', () => {
    const groups = shortcutGroups();
    expect(groups.map(g => g.name)).toEqual(['Anywhere', 'Home', 'Note', 'Search', 'Calendar']);
    expect(groups.flatMap(g => g.rows).some(r => r.id === 'resultUp')).toBe(false);
  });
  it('words the toast', () => {
    expect(shortcutDone('New text note')).toBe('Shortcut Done: New text note');
  });
});

describe('isTyping', () => {
  it('is true in text fields and false on buttons and checkboxes', () => {
    const mk = (tag, type) => { const el = document.createElement(tag); if (type) el.type = type; return el; };
    expect(isTyping(mk('input', 'text'))).toBe(true);
    expect(isTyping(mk('textarea'))).toBe(true);
    expect(isTyping(mk('input', 'checkbox'))).toBe(false);
    expect(isTyping(mk('button'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
