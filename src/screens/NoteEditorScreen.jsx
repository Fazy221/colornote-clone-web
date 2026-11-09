import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, TextField,
  Typography, Checkbox, Menu, MenuItem, Divider,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
  CircularProgress, InputBase, useTheme,
} from '@mui/material';
import ArrowBackIcon   from '@mui/icons-material/ArrowBack';
import SaveIcon        from '@mui/icons-material/Save';
import EditIcon        from '@mui/icons-material/Edit';
import MoreVertIcon    from '@mui/icons-material/MoreVert';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ShareIcon       from '@mui/icons-material/Share';
import DeleteIcon      from '@mui/icons-material/Delete';
import ColorLensIcon   from '@mui/icons-material/ColorLens';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import PushPinIcon     from '@mui/icons-material/PushPin';
import VisibilityIcon    from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockIcon        from '@mui/icons-material/Lock';
import LockOpenIcon    from '@mui/icons-material/LockOpen';
import SearchIcon      from '@mui/icons-material/Search';
import KeyboardArrowUpIcon   from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseIcon       from '@mui/icons-material/Close';
import UndoIcon        from '@mui/icons-material/Undo';
import RedoIcon        from '@mui/icons-material/Redo';

import ColorPicker          from '../components/common/ColorPicker';
import FolderPicker         from '../components/common/FolderPicker';
import FolderOutlinedIcon   from '@mui/icons-material/FolderOutlined';
import MasterPasswordDialog from '../components/common/MasterPasswordDialog';
import DatePickerDialog     from '../components/common/DatePickerDialog';
import VersionHistoryDialog from '../components/notes/VersionHistoryDialog';
import HistoryIcon          from '@mui/icons-material/History';
import { getColor }         from '../utils/colors';
import { formatFullDate }   from '../utils/dateUtils';
import { parseFormat, formatOf, followEdit, toggleStyle, runsOf } from '../utils/textFormat';
import { findOffsets, markRuns } from '../utils/findInNote';
import { is, hasOpenOverlay, shortcutDone } from '../utils/shortcuts';
import { decryptNoteContent, encryptNoteContent, getNoteCiphertext } from '../utils/crypto';
import { CONTENT_FIELDS, pick, sameValue } from '../utils/noteFields';
import { ARCHIVE_QUESTION } from '../utils/reminders';
import {
  serializeItems, parseChecklistStr, cleanItems, insertAfter, addChild, addParentAtEnd, removeRow, levelOf,
} from '../utils/checklist';
import useNoteStore from '../store/noteStore';
import useUIStore   from '../store/uiStore';

// Only a text note carries styling. A locked note keeps its ranges too, in plain text, as on the phone
// (they show only where styled text sits).
const formatPayloadFor = (type) => (fmt) => (type === 'text' ? { format: fmt } : {});

const EMPTY_ITEMS = [{ text: '', checked: false }];

export default function NoteEditorScreen() {
  const navigate      = useNavigate();
  const { id }        = useParams();
  const [searchParams] = useSearchParams();
  // Opened from a Search result: the word searched for (see SearchScreen). The note opens in Find on it.
  const autoFindRef   = useRef(useLocation().state?.find || ''); // used once: a reload after Restore doesn't reopen Find
  const isNew         = id === 'new';
  const initialType   = searchParams.get('type') || 'text';
  const initialDate   = searchParams.get('date')  || null;

  const { getNoteById, createNote, saveEdited, trashNote, archiveNote, duplicateNote, togglePin, liveReminderIds, setModifiedDate, setHidden: setHiddenInStore } = useNoteStore();
  const [archiveAskOpen, setArchiveAskOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const showToast = useUIStore(s => s.showToast);
  const masterPassword    = useUIStore(s => s.masterPassword);
  const setMasterPassword = useUIStore(s => s.setMasterPassword);

  // ── Note fields ──────────────────────────────────────────────────────────
  const [loading, setLoading]     = useState(!isNew);
  const [noteId, setNoteId]       = useState(null);
  const [title, setTitle]         = useState('');
  const [body, setBody]           = useState('');
  const [items, setItems]         = useState([{ text: '', checked: false }]);
  const [type, setType]           = useState(initialType);
  const [colorIndex, setColorIndex] = useState(0);
  const [modifiedAt, setModifiedAt] = useState(Date.now());
  const [encrypted, setEncrypted] = useState(0);
  const [importance, setImportance] = useState(0);
  const [hidden, setHidden] = useState(0);
  const [folderId, setFolderId] = useState(0);
  const [calendarDate, setCalendarDate] = useState(initialDate);
  // Bold, strikethrough and highlight ranges of a text note (see utils/textFormat.js); shared with the Android app.
  const [format, setFormat]     = useState('');
  const bodyRef = useRef(null);
  // A text note opens to read, and the pencil starts editing; a new note and a checklist are always editable.
  const [editing, setEditing] = useState(isNew);
  // The selected range of the text, so the style buttons can show what the selection already has.
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [, redraw] = useReducer(n => n + 1, 0);
  const focusEndRef  = useRef(false);
  const focusItemRef = useRef(null);
  const itemRefs     = useRef([]);
  const contentRef   = useRef(null);
  // Set once the note is being left on purpose, so the safety-net save below stays quiet.
  const leavingRef   = useRef(false);
  const latestRef    = useRef(null);

  // ── Decrypt state ─────────────────────────────────────────────────────────
  const [locked, setLocked]               = useState(false);
  const [pwDialogOpen, setPwDialogOpen]   = useState(false);
  const [decryptError, setDecryptError]   = useState('');

  // ── UI ───────────────────────────────────────────────────────────────────
  const [menuAnchor, setMenuAnchor]       = useState(null);
  const [historyOpen, setHistoryOpen]     = useState(false);
  const [reloadTick, setReloadTick]       = useState(0); // bumped after a restore, so the editor loads the note again
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Find in note: the bar, what was typed, and which hit is in focus.
  const [finding, setFinding]       = useState(false);
  const [findQuery, setFindQuery]   = useState('');
  const [findIndex, setFindIndex]   = useState(0);

  const isMounted    = useRef(true);
  const currentIdRef = useRef(null);
  // What a save compares against, so only what was edited here is written:
  //  baseRef  - the stored note as opened or last saved (ciphertext if locked)
  //  shownRef - what the editor showed for it (decrypted text, colour, folder)
  const baseRef      = useRef(null);
  const shownRef     = useRef(null);
  // One save at a time, in order.
  const saveChain    = useRef(Promise.resolve());
  // The latest render's queueSave, so a save on leaving sees the loaded note's
  // type and lock, not the first render's.
  const queueSaveRef = useRef(null);

  const dark = useTheme().palette.mode === 'dark';
  // In dark mode the page is dark and the note's colour stays in the top bar and the swatch (as on the phone).
  const color = getColor(colorIndex, dark);
  const field = dark
    ? { bg: 'rgba(255,255,255,0.1)', text: '#F5F5F5', edge: 'rgba(255,255,255,0.35)', edgeHover: 'rgba(255,255,255,0.6)' }
    : { bg: 'rgba(255,255,255,0.9)', text: '#212121', edge: 'rgba(0,0,0,0.3)', edgeHover: 'rgba(0,0,0,0.5)' };
  const swatch = { width: 32, height: 32, flexShrink: 0, borderRadius: '4px', bgcolor: dark ? color.border : color.bg, border: `2px solid ${dark ? 'rgba(255,255,255,0.7)' : color.border}` };
  const ruleColor = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  const spans = type === 'text' ? parseFormat(format, body.length) : [];
  const canFind = type === 'text' && !locked;
  const hits = finding && canFind ? findOffsets(body, findQuery) : [];
  const focusHit = hits.length ? Math.min(findIndex, hits.length - 1) : 0;
  const drawn = spans.length > 0 || hits.length > 0;

  const openFind = () => { setMenuAnchor(null); setFinding(true); };
  const closeFind = () => { setFinding(false); setFindQuery(''); setFindIndex(0); };
  const stepFind = d => { if (hits.length) setFindIndex((focusHit + d + hits.length) % hits.length); };

  // The hit in focus is brought into view.
  useEffect(() => {
    contentRef.current?.querySelector('[data-find-current]')?.scrollIntoView({ block: 'center' });
  }, [findQuery, findIndex, finding, loading]);

  // Ctrl+F opens the bar on a text note, as on any desktop app.
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && canFind) { e.preventDefault(); setFinding(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFind]);

  // ── Decrypt note content ──────────────────────────────────────────────────
  // Content always decrypts with ColorNote's fixed built-in key (see crypto.js)
  // — it doesn't actually depend on the session password. This is only called
  // once the privacy-gate dialog has been passed for this session.
  const decryptAndShow = useCallback(async (note) => {
    const ct = getNoteCiphertext(note);
    if (!ct) {
      // Encrypted flag set but no content yet — treat as unlocked empty note
      setLocked(false);
      return;
    }
    try {
      const plaintext = await decryptNoteContent(ct);
      if (note.type === 'checklist') {
        const parsed = parseChecklistStr(plaintext);
        setItems(parsed);
        shownRef.current = { ...shownRef.current, items: parsed };
      } else {
        setBody(plaintext);
        shownRef.current = { ...shownRef.current, body: plaintext };
      }
      setLocked(false);
      setDecryptError('');
    } catch (e) {
      // Only expected for genuinely malformed/corrupt ciphertext now.
      console.error('Note decryption failed:', e);
      setDecryptError('This note could not be decrypted (corrupt data?)');
    }
  }, []);

  // ── Load note ─────────────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    if (!isNew) {
      getNoteById(id).then(note => {
        if (!note || !isMounted.current) return;
        baseRef.current = note;
        shownRef.current = {
          title: note.title || '',
          body: note.encrypted === 1 || note.type === 'checklist' ? '' : (note.note || ''),
          items: note.encrypted !== 1 && note.type === 'checklist' && note.items?.length ? note.items : EMPTY_ITEMS,
          format: note.format || '',
          colorIndex: note.colorIndex || 0,
          folderId: note.folderId || 0,
        };
        currentIdRef.current = note.id;
        setNoteId(note.id);
        setTitle(note.title || '');
        setType(note.type || 'text');
        setColorIndex(note.colorIndex || 0);
        setEncrypted(note.encrypted || 0);
        setImportance(note.importance || 0);
        setHidden(note.hidden ? 1 : 0);
        setFolderId(note.folderId || 0);
        setCalendarDate(note.calendarDate || null);
        setFormat(note.format || '');
        setModifiedAt(note.modifiedAt || Date.now());

        if (note.encrypted === 1) {
          setLocked(true);
          // ColorNote's real behavior (confirmed via their FAQ): the master
          // password is asked every time you open a locked note — not just
          // once per app session. So we always show the gate here, even if
          // a password was already verified earlier for a different note.
          const ct = getNoteCiphertext(note);
          if (ct) { setPwDialogOpen(true); }
          else    { setLocked(false); }
        } else {
          // Not encrypted — load content directly
          if (note.type === 'checklist') {
            setItems(note.items?.length ? note.items : [{ text: '', checked: false }]);
          } else {
            setBody(note.note || '');
            // Only when the word is in the text: a note found by its title alone opens as usual.
            const word = autoFindRef.current;
            autoFindRef.current = '';
            if (word && findOffsets(note.note || '', word).length) { setFindQuery(word); setFindIndex(0); setFinding(true); }
          }
        }
        setLoading(false);
      });
    }
    return () => {
      isMounted.current = false;
      // Leaving any way but Save (the browser Back button, say) still keeps what was typed.
      const latest = latestRef.current;
      if (latest?.dirty && !leavingRef.current) queueSaveRef.current?.(latest.values);
    };
  }, [id, reloadTick]);

  // ── Save ──────────────────────────────────────────────────────────────────
  // What the editor holds now, as plain values.
  const currentValues = (o = {}) => ({ title, body, items, format, colorIndex, folderId, locked, ...o });

  // Whether anything differs from what was last saved (or, for a new note, whether there is anything to save).
  const shown = shownRef.current;
  const hasContent = Boolean(title.trim() || (type === 'text' ? body.trim() : items.some(i => i.text.trim())));
  const dirty = !loading && !locked && (shown
    ? title !== shown.title || colorIndex !== shown.colorIndex || folderId !== shown.folderId
      || (type === 'checklist' ? !sameValue(cleanItems(items), cleanItems(shown.items)) : body !== shown.body || format !== shown.format)
    : hasContent);
  const editable = type === 'checklist' || editing;
  // A text note that is being edited and has nothing new to save: the control leaves edit mode.
  const closable = type === 'text' && editing && Boolean(noteId) && !dirty;

  // The note as it should be stored, from what the editor holds. Text that
  // wasn't edited keeps its stored value, so a locked note isn't re-encrypted
  // and a note that was only looked at compares equal. Returns null when it
  // can't be built (encryption failed), so nothing is written.
  const buildEdited = async (v) => {
    const base = baseRef.current;
    const shown = shownRef.current;
    const edited = { ...pick(base, CONTENT_FIELDS), colorIndex: v.colorIndex, folderId: v.folderId };
    if (v.title !== shown.title) edited.title = v.title;
    const isChecklist = type === 'checklist';
    const rows = cleanItems(v.items);
    const bodyEdited = isChecklist ? !sameValue(rows, cleanItems(shown.items)) : v.body !== shown.body;
    if (bodyEdited && !(encrypted === 1 && v.locked)) {
      if (encrypted === 1) {
        // Content uses ColorNote's fixed built-in key (see crypto.js), so this
        // needs no password. Ciphertext is never written without its flag,
        // and plain text is never written under it.
        try {
          if (isChecklist) {
            edited.note = null;
            edited.items = [{ text: await encryptNoteContent(serializeItems(rows)), checked: false }];
          } else {
            edited.note = await encryptNoteContent(v.body);
            edited.items = null;
          }
        } catch (e) {
          console.error('Encrypting the note failed, not saved:', e?.name || 'Error');
          return null;
        }
      } else if (isChecklist) {
        edited.note = null;
        edited.items = rows;
      } else {
        edited.note = v.body;
        edited.items = null;
      }
    }
    if (type === 'text' && v.format !== shown.format) edited.format = v.format;
    return edited;
  };

  const doSave = async (v) => {
    if (!currentIdRef.current) {
      const hasContent = v.title.trim() || (type === 'text' ? v.body.trim() : v.items.some(i => i.text.trim()));
      if (!hasContent) return;
      const content = type === 'checklist' ? { note: null, items: cleanItems(v.items) } : { note: v.body, items: null };
      const newId = await createNote({
        title: v.title, type, colorIndex: v.colorIndex, folderId: v.folderId, encrypted, importance, calendarDate,
        ...content, ...formatPayloadFor(type, encrypted)(v.format),
      });
      currentIdRef.current = newId;
      baseRef.current = await getNoteById(newId);
      shownRef.current = v;
      if (isMounted.current) { setNoteId(newId); setModifiedAt(baseRef.current?.modifiedAt || Date.now()); }
      return;
    }
    const edited = await buildEdited(v);
    if (!edited) return;
    const savedId = await saveEdited(currentIdRef.current, baseRef.current, edited);
    baseRef.current = { ...baseRef.current, ...edited };
    shownRef.current = v;
    if (savedId !== currentIdRef.current) {
      // Deleted elsewhere while open: the text came back as a new note.
      currentIdRef.current = savedId;
      if (isMounted.current) setNoteId(savedId);
    }
    const row = await getNoteById(savedId);
    if (row) baseRef.current = { ...baseRef.current, id: row.id, uuid: row.uuid };
    if (row && isMounted.current) setModifiedAt(row.modifiedAt || Date.now());
  };

  const queueSave = (v) => {
    saveChain.current = saveChain.current
      .then(() => doSave(v))
      .then(() => { if (isMounted.current) redraw(); })
      .catch(e => console.error('Saving the note failed:', e?.name || 'Error'));
    return saveChain.current;
  };
  queueSaveRef.current = queueSave;
  latestRef.current = { dirty, values: currentValues() };

  // ── Field change handlers ─────────────────────────────────────────────────
  // Nothing is written until Save (see handleSave).
  const handleTitleChange  = v  => setTitle(v);
  // Undo and redo for the text and its styling together (the browser's own undo knows nothing of styles).
  // Typing in one go is a single step; a pause, or a style change, starts a new one.
  const history = useRef({ past: [], future: [], lastAt: 0, lastKind: '' });
  const record = kind => {
    const h = history.current;
    const now = Date.now();
    if (!(kind === 'type' && h.lastKind === 'type' && now - h.lastAt < 1000)) {
      h.past.push({ body, format, caret: bodyRef.current?.selectionStart ?? body.length });
      if (h.past.length > 200) h.past.shift();
    }
    h.future = [];
    h.lastAt = now;
    h.lastKind = kind;
  };
  const goTo = (snap) => {
    setBody(snap.body);
    setFormat(snap.format);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      const at = Math.min(snap.caret, el.value.length);
      el.setSelectionRange(at, at);
    });
  };
  const undo = () => {
    const h = history.current;
    const snap = h.past.pop();
    if (!snap) return;
    h.future.push({ body, format, caret: bodyRef.current?.selectionStart ?? body.length });
    h.lastKind = '';
    goTo(snap);
  };
  const redo = () => {
    const h = history.current;
    const snap = h.future.pop();
    if (!snap) return;
    h.past.push({ body, format, caret: bodyRef.current?.selectionStart ?? body.length });
    h.lastKind = '';
    goTo(snap);
  };
  const handleBodyChange   = v  => {
    record('type');
    // The ranges follow the text, so styling never slides onto other words.
    setFormat(formatOf(followEdit(parseFormat(format, body.length), body, v)));
    setBody(v);
  };
  const handleStyle = style => {
    const el = bodyRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    record('style');
    setFormat(formatOf(toggleStyle(parseFormat(format, body.length), el.selectionStart, el.selectionEnd, style)));
  };
  const handleColorChange  = ci => setColorIndex(ci);
  const handleFolderChange = fid => setFolderId(fid);

  // Checklist
  const handleItemText  = (idx, text) => setItems(items.map((it, i) => i === idx ? { ...it, text } : it));
  const handleItemCheck = idx => setItems(items.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it));
  // A new row takes the cursor, so a list can be typed without the mouse. Enter in a row adds the new
  // one below it (after its sub-items, for a parent); "Add item" adds at the end of the list, or, under
  // a parent, at the end of its sub-items (a plus on the parent does the same).
  const apply = ({ items: next, focus }) => { focusItemRef.current = focus; setItems(next); };
  const addItem = (after) => apply(after === undefined ? addParentAtEnd(items) : insertAfter(items, after));
  const addSubItem = (parentIdx) => apply(addChild(items, parentIdx));
  // The cross removes a row (a parent with its sub-items); the last row is only cleared.
  const removeItem = idx => apply(removeRow(items, idx));
  useEffect(() => {
    const at = focusItemRef.current;
    if (at === null) return;
    focusItemRef.current = null;
    itemRefs.current[at]?.focus();
  }, [items]);

  // The pencil: edit mode, with the cursor at the end of the note and the end in view.
  const startEditing = () => { focusEndRef.current = true; setEditing(true); };
  useEffect(() => {
    if (!editing || !focusEndRef.current) return;
    focusEndRef.current = false;
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight });
  }, [editing]);

  // ── Save on back ──────────────────────────────────────────────────────────
  // Writes only what was edited here; a note that was only read stays as it is.
  const handleBack = () => { leavingRef.current = true; navigate(-1); };

  // The only way an edit is written from the screen; the note stays open.
  const handleSave = async () => {
    if (!dirty) return;
    await queueSave(currentValues());
    if (!isMounted.current) return;
    setEditing(false);
    // Rows left empty are gone once saved, as they were not stored.
    if (type === 'checklist') setItems(list => (cleanItems(list).length ? cleanItems(list) : EMPTY_ITEMS));
  };
  const saveRef = useRef(null);
  saveRef.current = handleSave;
  // Escape leaves the note, unless a menu, dialog or the find bar is open (those take Escape themselves).
  const overlayOpen = Boolean(menuAnchor || colorPickerOpen || folderPickerOpen || deleteDialogOpen || archiveAskOpen || pwDialogOpen || datePickerOpen || historyOpen || finding);
  const escapeRef = useRef(null);
  escapeRef.current = () => { if (!overlayOpen) handleBack(); };
  // Ctrl+Enter saves and leaves, Ctrl+D duplicates, Ctrl+Alt+C opens the colour picker. They wait while a
  // dialog or menu is open, and on a locked note. The ones that act without showing it say so in a toast.
  const comboRef = useRef(null);
  comboRef.current = async (e) => {
    if (e.defaultPrevented || e.isComposing || locked || loading || hasOpenOverlay()) return;
    if (is(e, 'saveClose')) {
      e.preventDefault();
      const wasDirty = dirty;
      await handleSave();
      handleBack();
      if (wasDirty) showToast(shortcutDone('Saved and closed'));
    } else if (is(e, 'duplicate')) {
      e.preventDefault();
      if (!currentIdRef.current) return;
      await handleDuplicate();
      showToast(shortcutDone('Note duplicated'));
    } else if (is(e, 'colour')) {
      e.preventDefault();
      setColorPickerOpen(true);
    }
  };
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current?.(); }
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) escapeRef.current?.();
      comboRef.current?.(e);
    };
    // Closing the tab with unsaved text asks first.
    const onUnload = e => { if (latestRef.current?.dirty) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, []);

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    leavingRef.current = true;
    if (currentIdRef.current) await trashNote(currentIdRef.current);
    navigate(-1);
  };

  // What Share and Copy note hand over: the title, a blank line, then the text.
  const shareText = () => {
    const text = type === 'checklist'
      ? serializeItems(cleanItems(items))
      : body;
    return title ? `${title}\n\n${text}` : text;
  };

  const handleShare = () => {
    const full = shareText();
    if (navigator.share) navigator.share({ text: full }).catch(() => {});
    else navigator.clipboard?.writeText(full).catch(() => {});
    setMenuAnchor(null);
  };

  // As on the phone: the same text as Share, straight to the clipboard.
  const handleCopy = async () => {
    setMenuAnchor(null);
    try {
      if (locked) throw new Error('locked');
      await navigator.clipboard.writeText(shareText());
      showToast('Copied to clipboard');
    } catch {
      showToast("Can't copy this note");
    }
  };

  // Saves what was typed, so Duplicate and Archive act on it.
  const flushSave = async () => {
    if (dirty) await queueSave(currentValues());
    else await saveChain.current;
  };

  // The date picked in the dialog becomes the note's last-modified date, at the time of day it
  // already has. Picking the same day changes nothing. A text being edited is saved first, so the
  // chosen date is the one that stays.
  const handleDatePicked = async ({ year, month, day }) => {
    if (!currentIdRef.current) return;
    const was = new Date(modifiedAt);
    const next = new Date(year, month, day, was.getHours(), was.getMinutes(), was.getSeconds(), was.getMilliseconds());
    if (next.toDateString() === was.toDateString()) return;
    await flushSave();
    await setModifiedDate(currentIdRef.current, next.getTime());
    baseRef.current = { ...baseRef.current, modifiedAt: next.getTime() };
    if (isMounted.current) setModifiedAt(next.getTime());
  };

  const handleDuplicate = async () => {
    setMenuAnchor(null);
    await flushSave();
    leavingRef.current = true;
    await duplicateNote(currentIdRef.current);
    navigate(-1);
  };

  // A live reminder is asked about first, and ends with the archive.
  const handleArchive = async () => {
    setMenuAnchor(null);
    await flushSave();
    if ((await liveReminderIds([currentIdRef.current])).length) { setArchiveAskOpen(true); return; }
    leavingRef.current = true;
    await archiveNote(currentIdRef.current);
    navigate(-1);
  };

  const confirmArchive = async () => {
    setArchiveAskOpen(false);
    leavingRef.current = true;
    await archiveNote(currentIdRef.current, true);
    navigate(-1);
  };

  // ── Password dialog success ───────────────────────────────────────────────
  const handlePasswordSuccess = (password) => {
    setMasterPassword(password);
    setPwDialogOpen(false);
    // The note as last saved here, not as first opened.
    if (baseRef.current) decryptAndShow(baseRef.current);
  };

  // ── Lock session ─────────────────────────────────────────────────────────
  const handleLockSession = () => {
    // Save what was typed before the text is hidden.
    if (dirty) queueSave(currentValues());
    setMasterPassword(null);
    setLocked(true);
    history.current = { past: [], future: [], lastAt: 0, lastKind: '' };
    setBody('');
    setItems([{ text: '', checked: false }]);
    setMenuAnchor(null);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress sx={{ color: '#00BCD4' }} />
      </Box>
    );
  }

  // ── Locked overlay ────────────────────────────────────────────────────────
  if (locked) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: color.bg }}>
        <AppBar position="static" elevation={0} sx={{ bgcolor: color.bar, color: color.text }}>
          <Toolbar sx={{ minHeight: 56, px: 1 }}>
            <IconButton aria-label="Back" onClick={() => navigate(-1)} sx={{ color: color.text }}>
              <ArrowBackIcon />
            </IconButton>
            <Box sx={{ flex: 1, mx: 1, bgcolor: field.bg, border: `1px solid ${field.edge}`, borderRadius: '4px', px: 1.5, py: 0.75 }}>
              <Typography sx={{ fontSize: '0.95rem', color: field.text }}>{title || ''}</Typography>
            </Box>
            <Box sx={swatch} />
            <IconButton sx={{ color: color.text }}><MoreVertIcon /></IconButton>
          </Toolbar>
        </AppBar>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <LockIcon sx={{ fontSize: 64, color: color.text, opacity: 0.4 }} />
          <Typography sx={{ color: color.text, opacity: 0.6 }}>This note is locked</Typography>
          <Button
            variant="outlined"
            startIcon={<LockOpenIcon />}
            onClick={() => setPwDialogOpen(true)}
            sx={{ color: color.text, borderColor: color.border, borderRadius: 2 }}
          >
            Enter password
          </Button>
        </Box>

        <MasterPasswordDialog
          open={pwDialogOpen}
          onSuccess={handlePasswordSuccess}
          onClose={() => { setPwDialogOpen(false); navigate(-1); }}
        />
      </Box>
    );
  }

  // ── Full editor ───────────────────────────────────────────────────────────
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: color.bg }}>

      {/* Top bar */}
      <AppBar position="static" elevation={0} sx={{ bgcolor: color.bar, color: color.text }}>
        <Toolbar sx={{ minHeight: 56, px: 1, gap: 1 }}>
          {/* Save while there is something to save, otherwise the way back. */}
          <IconButton
            aria-label={dirty ? 'Save' : closable ? 'Stop editing' : 'Back'}
            onClick={dirty ? handleSave : closable ? () => setEditing(false) : handleBack}
            sx={{ color: color.text }}
          >
            {dirty ? <SaveIcon /> : closable ? <CloseIcon /> : <ArrowBackIcon />}
          </IconButton>
          <TextField
            value={title}
            onChange={e => handleTitleChange(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: field.bg, borderRadius: '4px', color: field.text,
                // A visible edge, so a white note's white field doesn't vanish into it.
                '& .MuiOutlinedInput-notchedOutline': { borderColor: field.edge, borderWidth: 1 },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: field.edgeHover },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#00BCD4', borderWidth: 1 },
              },
              '& input': { fontSize: '0.95rem', py: 0.75, px: 1.5, color: field.text },
            }}
          />
          {type === 'text' && !editing && (
            <IconButton aria-label="Edit" onClick={startEditing} sx={{ color: color.text }}>
              <EditIcon />
            </IconButton>
          )}
          <Box
            onClick={() => setColorPickerOpen(true)}
            sx={{ ...swatch, cursor: 'pointer' }}
          />
          <IconButton sx={{ color: color.text }} onClick={e => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Status line */}
      <Box sx={{ px: 2, py: 0.5, bgcolor: color.bar, color: color.text, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: color.text, opacity: 0.6 }}>{editable ? 'Editing' : 'Viewing'}</Typography>
          {encrypted === 1 && <LockOpenIcon sx={{ fontSize: 12, color: color.text, opacity: 0.5 }} />}
        </Box>
        {noteId ? (
          // Tap the date to change it (a new note has none to change yet).
          <Box
            component="button" type="button" aria-label="Change modified date"
            onClick={() => setDatePickerOpen(true)}
            sx={{
              all: 'unset', cursor: 'pointer', color: color.text, opacity: 0.6, fontSize: '0.75rem', lineHeight: 1.66,
              letterSpacing: '0.03333em', textDecoration: 'underline dotted', textUnderlineOffset: '3px',
              '&:hover': { opacity: 1 }, '&:focus-visible': { outline: `2px solid ${color.border}`, opacity: 1 },
            }}
          >
            {formatFullDate(modifiedAt)}
          </Box>
        ) : (
          <Typography variant="caption" sx={{ color: color.text, opacity: 0.6 }}>{formatFullDate(modifiedAt)}</Typography>
        )}
      </Box>

      {/* Find in note */}
      {finding && canFind && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, height: 44, bgcolor: dark ? '#2C2C2C' : '#F2F2F2', color: dark ? '#BDBDBD' : '#555' }}>
          <SearchIcon sx={{ fontSize: 20 }} />
          <InputBase
            autoFocus fullWidth placeholder="Find in note" value={findQuery}
            onChange={e => { setFindQuery(e.target.value); setFindIndex(0); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') closeFind();
            }}
            sx={{ fontSize: '0.95rem', color: dark ? '#F5F5F5' : '#111', borderBottom: '2px solid #009688', py: 0, mx: 0.5 }}
          />
          {findQuery && <Typography variant="body2" sx={{ minWidth: 36, textAlign: 'right' }}>{hits.length ? `${focusHit + 1}/${hits.length}` : '0'}</Typography>}
          <IconButton size="small" aria-label="Previous match" disabled={!hits.length} onClick={() => stepFind(-1)}><KeyboardArrowUpIcon /></IconButton>
          <IconButton size="small" aria-label="Next match" disabled={!hits.length} onClick={() => stepFind(1)}><KeyboardArrowDownIcon /></IconButton>
          <IconButton size="small" aria-label="Close find" onClick={closeFind}><CloseIcon /></IconButton>
        </Box>
      )}

      {/* Content */}
      <Box ref={contentRef} sx={{ flex: 1, overflowY: 'auto', pb: editing ? 9 : 0 }}>
        {type === 'text' ? (
          <>
            <Box sx={{ position: 'relative' }}>
              {drawn && (
                // The text is drawn here, in its styles, and the textarea above it is see-through, so the
                // caret and selection stay native. Same font and wrapping, so the two line up.
                <Box aria-hidden sx={{
                  position: 'absolute', inset: 0, px: 2, pt: '4px', pb: '5px', pointerEvents: 'none',
                  typography: 'body1', fontSize: '0.95rem', lineHeight: '2rem', color: color.text,
                  whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                }}>
                  {markRuns(runsOf(body, spans), hits, findQuery.length, focusHit).map((run, i) => (
                    <span key={i} data-find-current={run.hit === 2 ? '' : undefined} style={{
                      borderRadius: run.hit ? 2 : undefined,
                      fontWeight: run.styles.includes('b') ? 700 : undefined,
                      textDecoration: run.styles.includes('s') ? 'line-through' : undefined,
                      color: run.hit || run.styles.includes('h') ? '#212121' : undefined,
                      background: run.hit === 2 ? '#FF9800' : run.hit === 1 ? '#FFCC80' : run.styles.includes('h') ? 'rgba(255,235,59,0.8)' : undefined,
                    }}>{run.text}</span>
                  ))}
                  {'​'}
                </Box>
              )}
              <TextField
                value={body}
                onChange={e => handleBodyChange(e.target.value)}
                inputRef={bodyRef}
                multiline fullWidth variant="standard"
                autoFocus={isNew}
                sx={{
                  px: 2,
                  '& .MuiInput-root:before, & .MuiInput-root:after': { display: 'none' },
                  '& textarea': {
                    fontSize: '0.95rem', lineHeight: '2rem',
                    background: `repeating-linear-gradient(transparent, transparent calc(2rem - 1px), ${ruleColor} calc(2rem - 1px), ${ruleColor} 2rem)`,
                    minHeight: 'calc(100vh - 160px)',
                    color: drawn ? 'transparent' : color.text, caretColor: '#00BCD4',
                  },
                }}
                InputProps={{ disableUnderline: true, readOnly: !editable }}
                inputProps={{
                  onSelect: e => setSel({ start: e.target.selectionStart, end: e.target.selectionEnd }),
                  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y use the same history as the buttons.
                  onKeyDown: e => {
                    if (editable && !e.nativeEvent.isComposing) {
                      const style = is(e, 'bold') ? 'b' : is(e, 'strike') ? 's' : is(e, 'highlight') ? 'h' : null;
                      if (style) { e.preventDefault(); handleStyle(style); return; }
                    }
                    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
                    const k = e.key.toLowerCase();
                    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
                    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
                  },
                }}
              />
            </Box>
          </>
        ) : (
          <Box sx={{ px: 1, pb: 4 }}>
            {items.map((item, idx) => {
              const child = levelOf(item) === 1;
              const hasChildren = !child && levelOf(items[idx + 1]) === 1;
              const endsBlock = levelOf(items[idx + 1]) !== 1; // the last row of a parent's sub-items (or a lone parent)
              const parentIdx = child ? (() => { let p = idx; while (p > 0 && levelOf(items[p]) === 1) p--; return p; })() : idx;
              const parentHasChildren = levelOf(items[parentIdx + 1]) === 1;
              return (
                <React.Fragment key={idx}>
                  <Box
                    data-testid={child ? 'sub-item-row' : 'item-row'}
                    sx={{
                      display: 'flex', alignItems: 'center', minHeight: 48, borderBottom: `1px solid ${ruleColor}`,
                      pl: child ? 4 : 0,
                      // The plus shows when the pointer is over the row; on touch screens (no hover) it is always there.
                      '& .row-plus': { visibility: 'hidden' },
                      '&:hover .row-plus, &:focus-within .row-plus': { visibility: 'visible' },
                      '@media (hover: none)': { '& .row-plus': { visibility: 'visible' } },
                    }}
                  >
                    <Checkbox
                      checked={item.checked} onChange={() => handleItemCheck(idx)} size="small"
                      sx={{ color: color.border, '&.Mui-checked': { color: color.border }, flexShrink: 0 }}
                    />
                    <TextField
                      value={item.text} onChange={e => handleItemText(idx, e.target.value)}
                      inputRef={el => { itemRefs.current[idx] = el; }}
                      placeholder="Add item" variant="standard" fullWidth multiline
                      autoFocus={isNew && idx === 0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); addItem(idx); }
                        if (e.key === 'Backspace' && item.text === '' && !hasChildren) removeItem(idx);
                      }}
                      sx={{
                        // A long item wraps onto more lines instead of running out of sight.
                        '& textarea': {
                          fontSize: '0.95rem', color: color.text, textDecoration: item.checked ? 'line-through' : 'none',
                          opacity: item.checked ? 0.5 : 1, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                        },
                        '& .MuiInput-root': { py: 1 },
                        '& .MuiInput-root:before, & .MuiInput-root:after': { display: 'none' },
                      }}
                      InputProps={{ disableUnderline: true }}
                    />
                    {!child && (
                      <IconButton
                        className="row-plus" size="small" aria-label="Add sub-item" title="Add sub-item"
                        onClick={() => addSubItem(idx)} sx={{ color: color.text, opacity: 0.7, flexShrink: 0 }}
                      >
                        <AddCircleOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                    <IconButton
                      size="small" aria-label="Remove item" title="Remove item"
                      onClick={() => removeItem(idx)} sx={{ color: color.text, opacity: 0.7, flexShrink: 0, mr: 0.5 }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  {endsBlock && parentHasChildren && (
                    <Box
                      data-testid="sub-add-item"
                      sx={{ display: 'flex', alignItems: 'center', opacity: 0.6, cursor: 'pointer', py: 1, pr: 1, pl: 5, borderBottom: `1px solid ${ruleColor}` }}
                      onClick={() => addSubItem(parentIdx)}
                    >
                      <AddCircleOutlineIcon sx={{ fontSize: 18, mr: 1, color: color.text }} />
                      <Typography sx={{ fontSize: '0.9rem', color: color.text }}>Add item</Typography>
                    </Box>
                  )}
                </React.Fragment>
              );
            })}
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, opacity: 0.6, cursor: 'pointer', p: 1 }} onClick={() => addItem()}>
              <AddCircleOutlineIcon sx={{ fontSize: 20, mr: 1, color: color.text }} />
              <Typography sx={{ fontSize: '0.95rem', color: color.text }}>Add Item</Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Styles: floats at the bottom while editing. A button shows as on when the selection has that style. */}
      {type === 'text' && editing && (
        <Box sx={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 1100,
          display: 'flex', gap: 0.5, p: 0.5, bgcolor: dark ? '#2C2C2C' : '#FFFFFF', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
        }}>
          {[['Undo', UndoIcon, undo, history.current.past.length], ['Redo', RedoIcon, redo, history.current.future.length]].map(([label, Icon, act, count]) => (
            <IconButton
              key={label} size="small" aria-label={label} disabled={!count} disableRipple
              onMouseDown={e => e.preventDefault()} onClick={act}
              sx={{ color: dark ? '#E0E0E0' : '#212121', '&.Mui-disabled': { color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }, '&:hover': { bgcolor: 'transparent' } }}
            ><Icon fontSize="small" /></IconButton>
          ))}
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
          {[['b', 'B', { fontWeight: 800 }], ['s', 'S', { textDecoration: 'line-through' }],
            ['h', 'H', { background: 'rgba(255,235,59,0.8)' }]].map(([style, label, on]) => {
            const point = sel.start === sel.end;
            const active = spans.some(sp => sp.style === style && (point
              ? sp.start < sel.start && sel.start <= sp.end
              : sp.start <= sel.start && sp.end >= sel.end));
            const look = active ? on : { fontWeight: 400 };
            return (
              <Button
                key={style} size="small" disableRipple aria-pressed={active}
                aria-label={{ b: 'Bold', s: 'Strikethrough', h: 'Highlight' }[style]}
                onMouseDown={e => e.preventDefault()} onClick={() => handleStyle(style)}
                sx={{ minWidth: 40, color: dark ? '#E0E0E0' : '#212121', ...look, '&:hover': { ...look, bgcolor: look.background ? undefined : 'transparent' } }}
              >{label}</Button>
            );
          })}
        </Box>
      )}

      {/* Color picker */}
      <ColorPicker open={colorPickerOpen} currentColor={colorIndex} onSelect={handleColorChange} onClose={() => setColorPickerOpen(false)} />
      <FolderPicker open={folderPickerOpen} current={folderId} onSelect={handleFolderChange} onClose={() => setFolderPickerOpen(false)} />
      <DatePickerDialog open={datePickerOpen} value={modifiedAt} onPick={handleDatePicked} onClose={() => setDatePickerOpen(false)} />
      {noteId && (
        <VersionHistoryDialog
          open={historyOpen}
          noteId={noteId}
          noteUuid={baseRef.current?.uuid}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => { setLoading(true); setReloadTick(t => t + 1); }}
        />
      )}

      {/* Three-dot menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); setColorPickerOpen(true); }}>
          <ColorLensIcon sx={{ mr: 1.5, fontSize: 20 }} /> Color
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); setFolderPickerOpen(true); }}>
          <FolderOutlinedIcon sx={{ mr: 1.5, fontSize: 20 }} /> Folder
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); handleShare(); }}>
          <ShareIcon sx={{ mr: 1.5, fontSize: 20 }} /> Share
        </MenuItem>
        {canFind && (
          <MenuItem onClick={openFind}>
            <SearchIcon sx={{ mr: 1.5, fontSize: 20 }} /> Find
          </MenuItem>
        )}
        <MenuItem onClick={handleCopy}>
          <ContentCopyIcon sx={{ mr: 1.5, fontSize: 20 }} /> Copy note
        </MenuItem>
        {currentIdRef.current && (
          <MenuItem onClick={async () => { setMenuAnchor(null); await flushSave(); setHistoryOpen(true); }}>
            <HistoryIcon sx={{ mr: 1.5, fontSize: 20 }} /> Version history
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem onClick={handleDuplicate}>
            <FileCopyOutlinedIcon sx={{ mr: 1.5, fontSize: 20 }} /> Duplicate
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem onClick={() => { setMenuAnchor(null); togglePin(currentIdRef.current); setImportance(i => (i ? 0 : 1)); }}>
            <PushPinIcon sx={{ mr: 1.5, fontSize: 20 }} /> {importance ? 'Unpin' : 'Pin'}
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem
            data-testid="menu-hide"
            onClick={() => { setMenuAnchor(null); setHiddenInStore(currentIdRef.current, !hidden); setHidden(hidden ? 0 : 1); }}
          >
            {hidden
              ? <VisibilityIcon sx={{ mr: 1.5, fontSize: 20 }} />
              : <VisibilityOffIcon sx={{ mr: 1.5, fontSize: 20 }} />} {hidden ? 'Unhide' : 'Hide'}
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem onClick={handleArchive}>
            Archive
          </MenuItem>
        )}
        {encrypted === 1 && masterPassword && (
          <MenuItem onClick={handleLockSession}>
            <LockIcon sx={{ mr: 1.5, fontSize: 20 }} /> Lock session
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); setDeleteDialogOpen(true); }} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1.5, fontSize: 20 }} /> Delete
        </MenuItem>
      </Menu>

      {/* Delete confirm */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete note?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Archive confirm, only for a note whose reminder would still ring or show */}
      <Dialog open={archiveAskOpen} onClose={() => setArchiveAskOpen(false)}>
        <DialogTitle>Archive</DialogTitle>
        <DialogContent>
          <DialogContentText>{ARCHIVE_QUESTION}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveAskOpen(false)}>Cancel</Button>
          <Button onClick={confirmArchive}>OK</Button>
        </DialogActions>
      </Dialog>

      {/* Password dialog — can also appear mid-session if session was locked */}
      <MasterPasswordDialog
        open={pwDialogOpen}
        onSuccess={handlePasswordSuccess}
        onClose={() => { setPwDialogOpen(false); if (locked) navigate(-1); }}
      />
    </Box>
  );
}
