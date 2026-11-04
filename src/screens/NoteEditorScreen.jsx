import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, TextField,
  Typography, Checkbox, Menu, MenuItem, Divider,
  Dialog, DialogTitle, DialogActions, Button,
  CircularProgress,
} from '@mui/material';
import CheckIcon       from '@mui/icons-material/Check';
import MoreVertIcon    from '@mui/icons-material/MoreVert';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ShareIcon       from '@mui/icons-material/Share';
import DeleteIcon      from '@mui/icons-material/Delete';
import ColorLensIcon   from '@mui/icons-material/ColorLens';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
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

export default function NoteEditorScreen() {
  const navigate      = useNavigate();
  const { id }        = useParams();
  const [searchParams] = useSearchParams();
  const isNew         = id === 'new';
  const initialType   = searchParams.get('type') || 'text';
  const initialDate   = searchParams.get('date')  || null;

  const { getNoteById, createNote, updateNote, trashNote, archiveNote, duplicateNote, togglePin } = useNoteStore();
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
  // Keep a ref to the raw note for re-decryption after password entry
  const rawNoteRef   = useRef(null);

  const color = getColor(colorIndex);
  const formatPayload = formatPayloadFor(type, encrypted);
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
      } else {
        setBody(plaintext);
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
        rawNoteRef.current = note;
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
    return () => { isMounted.current = false; clearTimeout(saveTimer.current); };
  }, [id]);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const scheduleSave = useCallback(async (overrides = {}) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!isMounted.current) return;

      let contentPayload;
      if (encrypted === 1 && masterPassword && !locked) {
        // Re-encrypt updated content
        try {
          if (type === 'checklist') {
            const serialized = serializeItems(overrides.items ?? items);
            const ct = await encryptNoteContent(serialized);
            contentPayload = { note: null, items: [{ text: ct, checked: false }] };
          } else {
            const ct = await encryptNoteContent(overrides.note ?? body);
            contentPayload = { note: ct, items: null };
          }
        } catch {
          // Encryption failed — save plaintext as fallback (should not happen)
          contentPayload = type === 'checklist'
            ? { note: null, items: overrides.items ?? items }
            : { note: overrides.note ?? body, items: null };
        }
      } else {
        contentPayload = type === 'checklist'
          ? { note: null, items: overrides.items ?? items }
          : { note: overrides.note ?? body, items: null };
      }

      const payload = {
        title: overrides.title ?? title,
        type,
        colorIndex: overrides.colorIndex ?? colorIndex,
        encrypted,
        importance,
        calendarDate,
        modifiedAt: Date.now(),
        ...contentPayload,
        ...overrides,
        // Don't let overrides clobber the processed contentPayload
        ...(overrides.items !== undefined || overrides.note !== undefined ? {} : contentPayload),
      };

      // Merge properly
      const finalPayload = {
        title:       overrides.title      ?? title,
        type,
        colorIndex:  overrides.colorIndex ?? colorIndex,
        folderId:    overrides.folderId ?? folderId,
        encrypted,
        importance,
        calendarDate,
        modifiedAt:  Date.now(),
        ...contentPayload,
        ...formatPayload(overrides.format ?? format),
      };

      if (currentIdRef.current) {
        await updateNote(currentIdRef.current, finalPayload);
      } else {
        const newId = await createNote(finalPayload);
        currentIdRef.current = newId;
        setNoteId(newId);
      }
      if (isMounted.current) setModifiedAt(Date.now());
    }, AUTOSAVE_DELAY);
  }, [title, body, items, type, colorIndex, folderId, encrypted, importance, calendarDate, format, masterPassword, locked]);

  // ── Field change handlers ─────────────────────────────────────────────────
  const handleTitleChange  = v  => { setTitle(v);  scheduleSave({ title: v }); };
  const handleBodyChange   = v  => {
    // The ranges follow the text, so styling never slides onto other words.
    const next = formatOf(followEdit(parseFormat(format, body.length), body, v));
    setBody(v); setFormat(next); scheduleSave({ note: v, format: next });
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
  const handleBack = async () => {
    clearTimeout(saveTimer.current);

    let contentPayload;
    if (encrypted === 1 && masterPassword && !locked) {
      try {
        if (type === 'checklist') {
          const ct = await encryptNoteContent(serializeItems(items));
          contentPayload = { note: null, items: [{ text: ct, checked: false }] };
        } else {
          const ct = await encryptNoteContent(body);
          contentPayload = { note: ct, items: null };
        }
      } catch {
        contentPayload = type === 'checklist' ? { note: null, items } : { note: body, items: null };
      }
    } else {
      contentPayload = type === 'checklist' ? { note: null, items } : { note: body, items: null };
    }

    const payload = { title, type, colorIndex, folderId, encrypted, importance, calendarDate, modifiedAt: Date.now(), ...contentPayload, ...formatPayload(format) };

    if (currentIdRef.current) {
      await updateNote(currentIdRef.current, payload);
    } else {
      const hasContent = title.trim() || (type === 'text' ? body.trim() : items.some(i => i.text.trim()));
      if (hasContent) await createNote(payload);
    }
    navigate(-1);
  };

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    if (currentIdRef.current) await trashNote(currentIdRef.current);
    navigate(-1);
  };

  const handleShare = () => {
    const text = type === 'checklist'
      ? items.map(i => `${i.checked ? '[V]' : '[ ]'} ${i.text}`).join('\n')
      : body;
    const full = title ? `${title}\n\n${text}` : text;
    if (navigator.share) navigator.share({ text: full });
    else navigator.clipboard?.writeText(full);
    setMenuAnchor(null);
  };

  // ── Password dialog success ───────────────────────────────────────────────
  const handlePasswordSuccess = (password) => {
    setMasterPassword(password);
    setPwDialogOpen(false);
    if (rawNoteRef.current) decryptAndShow(rawNoteRef.current);
  };

  // ── Lock session ─────────────────────────────────────────────────────────
  const handleLockSession = () => {
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
        {currentIdRef.current && (
          <MenuItem onClick={() => { setMenuAnchor(null); duplicateNote(currentIdRef.current); navigate(-1); }}>
            <ContentCopyIcon sx={{ mr: 1.5, fontSize: 20 }} /> Duplicate
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem onClick={() => { setMenuAnchor(null); togglePin(currentIdRef.current); }}>
            <PushPinIcon sx={{ mr: 1.5, fontSize: 20 }} /> {importance ? 'Unpin' : 'Pin'}
          </MenuItem>
        )}
        {currentIdRef.current && (
          <MenuItem onClick={() => { setMenuAnchor(null); archiveNote(currentIdRef.current); navigate(-1); }}>
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

      {/* Password dialog — can also appear mid-session if session was locked */}
      <MasterPasswordDialog
        open={pwDialogOpen}
        onSuccess={handlePasswordSuccess}
        onClose={() => { setPwDialogOpen(false); if (locked) navigate(-1); }}
      />
    </Box>
  );
}
