import { useEffect, useRef } from 'react';

// Every keyboard shortcut in one table. The cheat sheet (ShortcutsDialog) is drawn from it and the
// screens look their keys up here, so the list on screen can't drift from what is bound.
//
// A combo is 'ctrl+alt+n', 'ctrl+enter', '/', '?'. 'ctrl' also means the Mac Cmd key. A combo with two
// words ('g h') is a sequence: press the first key, then the second within a second.
export const SHORTCUTS = [
  { id: 'newText',      group: 'Anywhere', combos: ['ctrl+alt+n'], label: 'Ctrl+Alt+N',      desc: 'New text note' },
  { id: 'newChecklist', group: 'Anywhere', combos: ['ctrl+alt+l'], label: 'Ctrl+Alt+L',      desc: 'New checklist' },
  { id: 'search',       group: 'Anywhere', combos: ['ctrl+k', '/'], label: 'Ctrl+K  or  /',  desc: 'Search' },
  { id: 'goHome',       group: 'Anywhere', combos: ['g h'],        label: 'G then H',        desc: 'Go to Home' },
  { id: 'goFolders',    group: 'Anywhere', combos: ['g f'],        label: 'G then F',        desc: 'Go to Folders' },
  { id: 'goCalendar',   group: 'Anywhere', combos: ['g c'],        label: 'G then C',        desc: 'Go to Calendar' },
  { id: 'goMore',       group: 'Anywhere', combos: ['g m'],        label: 'G then M',        desc: 'Go to More' },
  { id: 'help',         group: 'Anywhere', combos: ['?'],          label: '?',               desc: 'Show this list' },

  { id: 'selectAll',    group: 'Home',     combos: ['ctrl+a'],     label: 'Ctrl+A',          desc: 'Select all notes' },
  { id: 'clearSel',     group: 'Home',     combos: ['escape'],     label: 'Esc',             desc: 'Clear the selection' },
  { id: 'deleteSel',    group: 'Home',     combos: ['delete'],     label: 'Delete',          desc: 'Move the selected notes to Trash' },
  { id: 'grid1',        group: 'Home',     combos: ['1'],          label: '1',               desc: 'List view' },
  { id: 'grid2',        group: 'Home',     combos: ['2'],          label: '2',               desc: '2 columns' },
  { id: 'grid3',        group: 'Home',     combos: ['3'],          label: '3',               desc: '3 columns' },
  { id: 'grid4',        group: 'Home',     combos: ['4'],          label: '4',               desc: '4 columns' },

  { id: 'save',         group: 'Note',     combos: ['ctrl+s'],     label: 'Ctrl+S',          desc: 'Save' },
  { id: 'saveClose',    group: 'Note',     combos: ['ctrl+enter'], label: 'Ctrl+Enter',      desc: 'Save and close' },
  { id: 'back',         group: 'Note',     combos: ['escape'],     label: 'Esc',             desc: 'Leave the note' },
  { id: 'find',         group: 'Note',     combos: ['ctrl+f'],     label: 'Ctrl+F',          desc: 'Find in note' },
  { id: 'bold',         group: 'Note',     combos: ['ctrl+b'],     label: 'Ctrl+B',          desc: 'Bold the selected text' },
  { id: 'strike',       group: 'Note',     combos: ['ctrl+shift+x'], label: 'Ctrl+Shift+X',  desc: 'Strike through the selected text' },
  { id: 'highlight',    group: 'Note',     combos: ['ctrl+shift+h'], label: 'Ctrl+Shift+H',  desc: 'Highlight the selected text' },
  { id: 'undo',         group: 'Note',     combos: ['ctrl+z'],     label: 'Ctrl+Z',          desc: 'Undo' },
  { id: 'redo',         group: 'Note',     combos: ['ctrl+shift+z', 'ctrl+y'], label: 'Ctrl+Shift+Z  or  Ctrl+Y', desc: 'Redo' },
  { id: 'duplicate',    group: 'Note',     combos: ['ctrl+d'],     label: 'Ctrl+D',          desc: 'Duplicate the note' },
  { id: 'colour',       group: 'Note',     combos: ['ctrl+alt+c'], label: 'Ctrl+Alt+C',      desc: 'Change the note colour' },
  { id: 'nextItem',     group: 'Note',     combos: ['enter'],      label: 'Enter',           desc: 'New checklist item below' },

  { id: 'resultDown',   group: 'Search',   combos: ['arrowdown'],  label: '↓ / ↑',           desc: 'Move through the results' },
  { id: 'resultUp',     group: 'Search',   combos: ['arrowup'],    label: '',                desc: '' },
  { id: 'resultOpen',   group: 'Search',   combos: ['enter'],      label: 'Enter',           desc: 'Open the highlighted result' },

  { id: 'monthStep',    group: 'Calendar', combos: ['arrowleft', 'arrowright'], label: '← / →', desc: 'Previous / next month' },
  { id: 'today',        group: 'Calendar', combos: ['t'],          label: 'T',               desc: 'Jump to this month' },
];

const BY_ID = Object.fromEntries(SHORTCUTS.map(s => [s.id, s]));

// 'Anywhere' → [rows], in table order, for the cheat sheet. Rows with no label are the second half of
// a pair shown on the row before it.
export function shortcutGroups() {
  const groups = [];
  for (const s of SHORTCUTS) {
    if (!s.label) continue;
    let g = groups.find(x => x.name === s.group);
    if (!g) { g = { name: s.group, rows: [] }; groups.push(g); }
    g.rows.push(s);
  }
  return groups;
}

function parse(combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  return { ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'), key };
}

// Letters are read from the physical key when Ctrl or Alt is down, so Ctrl+Alt+N still matches on a
// layout where Ctrl+Alt (AltGr) types a different character.
function keyOf(e) {
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  if (mod && /^Key[A-Z]$/.test(e.code || '')) return e.code.slice(3).toLowerCase();
  return String(e.key || '').toLowerCase();
}

// Does the key event match one single-step combo? Shift only counts when the combo names it (or for
// letters, Enter and the like, where it changes the meaning); for symbols such as ? it is implied.
export function matches(e, combo) {
  const want = parse(combo);
  const ctrl = e.ctrlKey || e.metaKey;
  if (want.ctrl !== Boolean(ctrl) || want.alt !== Boolean(e.altKey)) return false;
  if (keyOf(e) !== want.key) return false;
  const symbol = want.key.length === 1 && !/[a-z0-9]/.test(want.key);
  if (!symbol && want.shift !== Boolean(e.shiftKey)) return false;
  return true;
}

// Does the key event match the shortcut with this id? (Single-step combos only.)
export function is(e, id) {
  return BY_ID[id].combos.some(c => !c.includes(' ') && matches(e, c));
}

// Typing in a field: plain keys must be left alone there.
export function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !/^(checkbox|radio|button|submit|reset)$/.test(target.type);
  return false;
}

// A dialog, menu or picker is open (MUI renders each in a Modal): the shortcuts behind it wait.
export function hasOpenOverlay() {
  return Boolean(document.querySelector('.MuiModal-root'));
}

// Runs fn(event) on every keydown anywhere in the window, always the latest fn.
export function useKeydown(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = e => ref.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const shortcutDone = (label) => `Shortcut Done: ${label}`;
