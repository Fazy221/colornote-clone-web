import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, TextField,
  Typography, Checkbox, Menu, MenuItem, Divider,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Snackbar,
  CircularProgress,
} from '@mui/material';
import CheckIcon       from '@mui/icons-material/Check';
import MoreVertIcon    from '@mui/icons-material/MoreVert';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ShareIcon       from '@mui/icons-material/Share';
import DeleteIcon      from '@mui/icons-material/Delete';
import ColorLensIcon   from '@mui/icons-material/ColorLens';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import PushPinIcon     from '@mui/icons-material/PushPin';
import LockIcon        from '@mui/icons-material/Lock';
import LockOpenIcon    from '@mui/icons-material/LockOpen';

import ColorPicker          from '../components/common/ColorPicker';
import FolderPicker         from '../components/common/FolderPicker';
import FolderOutlinedIcon   from '@mui/icons-material/FolderOutlined';
import MasterPasswordDialog from '../components/common/MasterPasswordDialog';
import { getColor }         from '../utils/colors';
import { formatFullDate }   from '../utils/dateUtils';
import { parseFormat, formatOf, followEdit, toggleStyle, runsOf } from '../utils/textFormat';
import { decryptNoteContent, encryptNoteContent, getNoteCiphertext } from '../utils/crypto';
import { CONTENT_FIELDS, pick, sameValue } from '../utils/noteFields';
import { ARCHIVE_QUESTION } from '../utils/reminders';
import useNoteStore from '../store/noteStore';
import useUIStore   from '../store/uiStore';

const AUTOSAVE_DELAY = 800;

// Serialize checklist items → "[ ] text\n[V] text\n..." for encryption
function serializeItems(items) {
  return (items || []).map(i => `${i.checked ? '[V]' : '[ ]'} ${i.text}`).join('\n');
}

// Parse decrypted checklist string back to items array
function parseChecklistStr(str) {
  if (!str) return [{ text: '', checked: false }];
  const lines = str.split('\n').filter(l => l.trim());
  if (!lines.length) return [{ text: '', checked: false }];
  return lines.map(line => {
    if (line.startsWith('[V] ')) return { text: line.slice(4), checked: true };
    if (line.startsWith('[ ] ')) return { text: line.slice(4), checked: false };
    return { text: line, checked: false };
  });
}

// Only a plain text note carries styling. A locked note's save leaves the field as it is.
const formatPayloadFor = (type, encrypted) => (fmt) => (type === 'text' && encrypted !== 1 ? { format: fmt } : {});

const EMPTY_ITEMS = [{ text: '', checked: false }];

export default function NoteEditorScreen() {
  const navigate      = useNavigate();
  const { id }        = useParams();
  const [searchParams] = useSearchParams();
  const isNew         = id === 'new';
  const initialType   = searchParams.get('type') || 'text';
  const initialDate   = searchParams.get('date')  || null;

  const { getNoteById, createNote, saveEdited, trashNote, archiveNote, duplicateNote, togglePin, liveReminderIds } = useNoteStore();
  const [archiveAskOpen, setArchiveAskOpen] = useState(false);
  const [toast, setToast] = useState(null);
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
  const [folderId, setFolderId] = useState(0);
  const [calendarDate, setCalendarDate] = useState(initialDate);
  // Bold, strikethrough and highlight ranges of a text note (see utils/textFormat.js); shared with the Android app.
  const [format, setFormat]     = useState('');
  const bodyRef = useRef(null);

  // ── Decrypt state ─────────────────────────────────────────────────────────
  const [locked, setLocked]               = useState(false);
  const [pwDialogOpen, setPwDialogOpen]   = useState(false);
  const [decryptError, setDecryptError]   = useState('');

  // ── UI ───────────────────────────────────────────────────────────────────
  const [menuAnchor, setMenuAnchor]       = useState(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const saveTimer    = useRef(null);
  const isMounted    = useRef(true);
  const currentIdRef = useRef(null);
  // What a save compares against, so only what was edited here is written:
  //  baseRef  - the stored note as opened or last saved (ciphertext if locked)
  //  shownRef - what the editor showed for it (decrypted text, colour, folder)
  const baseRef      = useRef(null);
  const shownRef     = useRef(null);
  // Edits waiting for the autosave timer; saved on leaving too.
  const pendingRef   = useRef(null);
  // One save at a time, in order.
  const saveChain    = useRef(Promise.resolve());
  // The latest render's queueSave, so a save on leaving sees the loaded note's
  // type and lock, not the first render's.
  const queueSaveRef = useRef(null);

  const color = getColor(colorIndex);
  const spans = type === 'text' && encrypted !== 1 ? parseFormat(format, body.length) : [];

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
          }
        }
        setLoading(false);
      });
    }
    return () => {
      isMounted.current = false;
      clearTimeout(saveTimer.current);
      // Leaving any other way than the tick still keeps what was typed.
      if (pendingRef.current) { queueSaveRef.current?.(pendingRef.current); pendingRef.current = null; }
    };
  }, [id]);

  // ── Save ──────────────────────────────────────────────────────────────────
  // What the editor holds now, as plain values.
  const currentValues = (o = {}) => ({ title, body, items, format, colorIndex, folderId, locked, ...o });

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
    const bodyEdited = isChecklist ? !sameValue(v.items, shown.items) : v.body !== shown.body;
    if (bodyEdited && !(encrypted === 1 && v.locked)) {
      if (encrypted === 1) {
        // Content uses ColorNote's fixed built-in key (see crypto.js), so this
        // needs no password. Ciphertext is never written without its flag,
        // and plain text is never written under it.
        try {
          if (isChecklist) {
            edited.note = null;
            edited.items = [{ text: await encryptNoteContent(serializeItems(v.items)), checked: false }];
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
        edited.items = v.items;
      } else {
        edited.note = v.body;
        edited.items = null;
      }
    }
    if (type === 'text' && encrypted !== 1 && v.format !== shown.format) edited.format = v.format;
    return edited;
  };

  const doSave = async (v) => {
    if (!currentIdRef.current) {
      const hasContent = v.title.trim() || (type === 'text' ? v.body.trim() : v.items.some(i => i.text.trim()));
      if (!hasContent) return;
      const content = type === 'checklist' ? { note: null, items: v.items } : { note: v.body, items: null };
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
      .catch(e => console.error('Saving the note failed:', e?.name || 'Error'));
    return saveChain.current;
  };
  queueSaveRef.current = queueSave;

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const scheduleSave = (overrides = {}) => {
    clearTimeout(saveTimer.current);
    const v = currentValues(overrides);
    pendingRef.current = v;
    saveTimer.current = setTimeout(() => {
      if (pendingRef.current !== v) return;
      pendingRef.current = null;
      queueSave(v);
    }, AUTOSAVE_DELAY);
  };

  // ── Field change handlers ─────────────────────────────────────────────────
  const handleTitleChange  = v  => { setTitle(v);  scheduleSave({ title: v }); };
  const handleBodyChange   = v  => {
    // The ranges follow the text, so styling never slides onto other words.
    const next = formatOf(followEdit(parseFormat(format, body.length), body, v));
    setBody(v); setFormat(next); scheduleSave({ body: v, format: next });
  };
  const handleStyle = style => {
    const el = bodyRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    const next = formatOf(toggleStyle(parseFormat(format, body.length), el.selectionStart, el.selectionEnd, style));
    setFormat(next); scheduleSave({ format: next });
  };
  const handleColorChange  = ci => { setColorIndex(ci); scheduleSave({ colorIndex: ci }); };
  const handleFolderChange = fid => { setFolderId(fid); scheduleSave({ folderId: fid }); };

  // Checklist
  const handleItemText  = (idx, text) => {
    const next = items.map((it, i) => i === idx ? { ...it, text } : it);
    setItems(next); scheduleSave({ items: next });
  };
  const handleItemCheck = idx => {
    const next = items.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it);
    setItems(next); scheduleSave({ items: next });
  };
  const addItem = () => {
    const next = [...items, { text: '', checked: false }];
    setItems(next); scheduleSave({ items: next });
  };
  const removeItem = idx => {
    if (items.length === 1) return;
    const next = items.filter((_, i) => i !== idx);
    setItems(next); scheduleSave({ items: next });
  };

  // ── Save on back ──────────────────────────────────────────────────────────
  // Writes only what was edited here; a note that was only read stays as it is.
  const handleBack = async () => {
    clearTimeout(saveTimer.current);
    pendingRef.current = null;
    await queueSave(currentValues());
    navigate(-1);
  };

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    if (currentIdRef.current) await trashNote(currentIdRef.current);
    navigate(-1);
  };

  // What Share and Copy note hand over: the title, a blank line, then the text.
  const shareText = () => {
    const text = type === 'checklist'
      ? items.map(i => `${i.checked ? '[V]' : '[ ]'} ${i.text}`).join('\n')
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
      setToast('Copied to clipboard');
    } catch {
      setToast("Can't copy this note");
    }
  };

  // Saves what is waiting for the autosave timer, so Duplicate and Archive
  // act on what was typed.
  const flushSave = async () => {
    clearTimeout(saveTimer.current);
    const v = pendingRef.current;
    pendingRef.current = null;
    if (v) await queueSave(v);
    else await saveChain.current;
  };

  const handleDuplicate = async () => {
    setMenuAnchor(null);
    await flushSave();
    await duplicateNote(currentIdRef.current);
    navigate(-1);
  };

  // A live reminder is asked about first, and ends with the archive.
  const handleArchive = async () => {
    setMenuAnchor(null);
    await flushSave();
    if ((await liveReminderIds([currentIdRef.current])).length) { setArchiveAskOpen(true); return; }
    await archiveNote(currentIdRef.current);
    navigate(-1);
  };

  const confirmArchive = async () => {
    setArchiveAskOpen(false);
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
    clearTimeout(saveTimer.current);
    if (pendingRef.current) { queueSave(pendingRef.current); pendingRef.current = null; }
    setMasterPassword(null);
    setLocked(true);
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
        <AppBar position="static" elevation={0} sx={{ bgcolor: color.bg, color: color.text }}>
          <Toolbar sx={{ minHeight: 56, px: 1 }}>
            <IconButton onClick={() => navigate(-1)} sx={{ color: color.text }}>
              <CheckIcon />
            </IconButton>
            <Box sx={{ flex: 1, mx: 1, bgcolor: 'rgba(255,255,255,0.9)', borderRadius: '4px', px: 1.5, py: 0.75 }}>
              <Typography sx={{ fontSize: '0.95rem', color: '#212121' }}>{title || ''}</Typography>
            </Box>
            <Box sx={{ width: 32, height: 32, borderRadius: '4px', bgcolor: color.bg, border: `2px solid ${color.border}` }} />
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
      <AppBar position="static" elevation={0} sx={{ bgcolor: color.bg, color: color.text }}>
        <Toolbar sx={{ minHeight: 56, px: 1, gap: 1 }}>
          <IconButton onClick={handleBack} sx={{ color: color.text }}>
            <CheckIcon />
          </IconButton>
          <TextField
            value={title}
            onChange={e => handleTitleChange(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: 'rgba(255,255,255,0.9)', borderRadius: '4px',
                '& fieldset': { border: 'none' },
              },
              '& input': { fontSize: '0.95rem', py: 0.75, px: 1.5 },
            }}
          />
          <Box
            onClick={() => setColorPickerOpen(true)}
            sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: '4px', bgcolor: color.bg, border: `2px solid ${color.border}`, cursor: 'pointer' }}
          />
          <IconButton sx={{ color: color.text }} onClick={e => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Status line */}
      <Box sx={{ px: 2, py: 0.5, bgcolor: color.bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: color.text, opacity: 0.6 }}>Editing</Typography>
          {encrypted === 1 && <LockOpenIcon sx={{ fontSize: 12, color: color.text, opacity: 0.5 }} />}
        </Box>
        <Typography variant="caption" sx={{ color: color.text, opacity: 0.6 }}>
          {formatFullDate(modifiedAt)}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {type === 'text' ? (
          <>
            {encrypted !== 1 && (
              <Box sx={{ px: 2, pt: 0.5, display: 'flex', gap: 0.5 }}>
                {[['b', 'B', { fontWeight: 700 }], ['s', 'S', { textDecoration: 'line-through' }],
                  ['h', 'H', { background: 'rgba(255,235,59,0.8)' }]].map(([style, label, look]) => (
                  <Button
                    key={style} size="small" aria-label={{ b: 'Bold', s: 'Strikethrough', h: 'Highlight' }[style]}
                    onMouseDown={e => e.preventDefault()} onClick={() => handleStyle(style)}
                    sx={{ minWidth: 32, color: color.text, ...look }}
                  >{label}</Button>
                ))}
              </Box>
            )}
            <Box sx={{ position: 'relative' }}>
              {spans.length > 0 && (
                // The text is drawn here, in its styles, and the textarea above it is see-through, so the
                // caret and selection stay native. Same font and wrapping, so the two line up.
                <Box aria-hidden sx={{
                  position: 'absolute', inset: 0, px: 2, pt: '4px', pb: '5px', pointerEvents: 'none',
                  typography: 'body1', fontSize: '0.95rem', lineHeight: '2rem', color: color.text,
                  whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                }}>
                  {runsOf(body, spans).map((run, i) => (
                    <span key={i} style={{
                      fontWeight: run.styles.includes('b') ? 700 : undefined,
                      textDecoration: run.styles.includes('s') ? 'line-through' : undefined,
                      background: run.styles.includes('h') ? 'rgba(255,235,59,0.8)' : undefined,
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
                    background: `repeating-linear-gradient(transparent, transparent calc(2rem - 1px), rgba(0,0,0,0.06) calc(2rem - 1px), rgba(0,0,0,0.06) 2rem)`,
                    minHeight: 'calc(100vh - 160px)',
                    color: spans.length > 0 ? 'transparent' : color.text, caretColor: '#00BCD4',
                  },
                }}
                InputProps={{ disableUnderline: true }}
              />
            </Box>
          </>
        ) : (
          <Box sx={{ px: 1, pb: 4 }}>
            {items.map((item, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', minHeight: 48, borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <Checkbox
                  checked={item.checked} onChange={() => handleItemCheck(idx)} size="small"
                  sx={{ color: color.border, '&.Mui-checked': { color: color.border }, flexShrink: 0 }}
                />
                <TextField
                  value={item.text} onChange={e => handleItemText(idx, e.target.value)}
                  placeholder="Add item" variant="standard" fullWidth
                  autoFocus={isNew && idx === 0}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                    if (e.key === 'Backspace' && item.text === '') removeItem(idx);
                  }}
                  sx={{
                    '& input': { fontSize: '0.95rem', color: color.text, textDecoration: item.checked ? 'line-through' : 'none', opacity: item.checked ? 0.5 : 1 },
                    '& .MuiInput-root:before, & .MuiInput-root:after': { display: 'none' },
                  }}
                  InputProps={{ disableUnderline: true }}
                />
              </Box>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, opacity: 0.6, cursor: 'pointer', p: 1 }} onClick={addItem}>
              <AddCircleOutlineIcon sx={{ fontSize: 20, mr: 1, color: color.text }} />
              <Typography sx={{ fontSize: '0.95rem', color: color.text }}>Add Item</Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Color picker */}
      <ColorPicker open={colorPickerOpen} currentColor={colorIndex} onSelect={handleColorChange} onClose={() => setColorPickerOpen(false)} />
      <FolderPicker open={folderPickerOpen} current={folderId} onSelect={handleFolderChange} onClose={() => setFolderPickerOpen(false)} />

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
        <MenuItem onClick={handleCopy}>
          <ContentCopyIcon sx={{ mr: 1.5, fontSize: 20 }} /> Copy note
        </MenuItem>
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

      <Snackbar open={Boolean(toast)} message={toast || ''} autoHideDuration={2000} onClose={() => setToast(null)} />

      {/* Password dialog — can also appear mid-session if session was locked */}
      <MasterPasswordDialog
        open={pwDialogOpen}
        onSuccess={handlePasswordSuccess}
        onClose={() => { setPwDialogOpen(false); if (locked) navigate(-1); }}
      />
    </Box>
  );
}
