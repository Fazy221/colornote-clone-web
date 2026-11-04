import React, { useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useUIStore from '../../store/uiStore';
import ShortcutsDialog from './ShortcutsDialog';
import { is, matches, isTyping, hasOpenOverlay, useKeydown, shortcutDone } from '../../utils/shortcuts';

// G then one of these letters, within a second.
const GO_KEYS = { h: ['/', 'Home'], f: ['/folders', 'Folders'], c: ['/calendar', 'Calendar'], m: ['/more', 'More'] };
const GO_WINDOW_MS = 1000;

// The shortcuts that work on every screen: new note, search, go-to, and the cheat sheet. Mounted once,
// inside the router. Each one shows a "Shortcut Done" toast, because the screen change alone doesn't
// say which key did it.
export default function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const goAt = useRef(0);

  useKeydown(e => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    const ui = useUIStore.getState();

    if (is(e, 'help')) {
      if (isTyping(e.target) || (hasOpenOverlay() && !ui.shortcutsOpen)) return;
      e.preventDefault();
      ui.setShortcutsOpen(!ui.shortcutsOpen);
      return;
    }
    if (hasOpenOverlay()) return;

    const modified = e.ctrlKey || e.metaKey || e.altKey;
    // Plain keys are for the page, not for a field being typed in.
    if (isTyping(e.target) && !modified) return;

    const here = location.pathname + location.search;
    const go = (path, label) => {
      e.preventDefault();
      if (here === path) return;
      navigate(path);
      ui.showToast(shortcutDone(label));
    };

    if (is(e, 'newText'))      return go('/note/new?type=text', 'New text note');
    if (is(e, 'newChecklist')) return go('/note/new?type=checklist', 'New checklist');
    if (is(e, 'search'))       return go('/search', 'Search');

    // Two-key go-to: G, then the screen's letter.
    if (!modified) {
      const pending = Date.now() - goAt.current < GO_WINDOW_MS;
      goAt.current = 0;
      if (pending) {
        const target = Object.keys(GO_KEYS).find(k => matches(e, k));
        if (target) return go(...GO_KEYS[target]);
      }
      if (matches(e, 'g')) goAt.current = Date.now();
    }
  });

  return <ShortcutsDialog />;
}
