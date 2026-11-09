import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Box, AppBar, Toolbar, IconButton, Typography, Alert, CircularProgress } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import VisibilityIcon from '@mui/icons-material/Visibility';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import NoteCard from '../components/notes/NoteCard';
import MasterPasswordDialog from '../components/common/MasterPasswordDialog';
import { getHiddenNotes, getSetting } from '../db/database';
import useNoteStore from '../store/noteStore';

// The Hidden notes page, opened from the ColorNote logo on Home (the phone's does the same).
// Hidden notes (text, checklist and calendar notes alike) show only here, unless "Show hidden notes"
// is on in Settings. With a master password set (the one from the phone's backup, or a local lock
// password) the page asks for it each time it opens. With none, it opens freely: a password set
// here would never reach the phone, so this page doesn't create one.
export default function HiddenScreen() {
  const navigate = useNavigate();
  const { setHiddenForNotes, setPinForNotes, trashNotes } = useNoteStore();
  // null while checking; false: nothing to ask for; true: the password is needed
  const [gated, setGated] = useState(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    (async () => {
      const has = Boolean(await getSetting('masterPasswordVerifier', null) || await getSetting('appLockHash', null));
      if (live) setGated(has);
    })();
    return () => { live = false; };
  }, []);

  const notes = useLiveQuery(() => getHiddenNotes(), [], null);
  const shown = gated === false || open;

  // A note that was unhidden elsewhere drops out of the selection with it.
  const ids = useMemo(() => new Set((notes || []).map(n => n.id)), [notes]);
  const picked = useMemo(() => (notes || []).filter(n => selected.has(n.id) && ids.has(n.id)), [notes, selected, ids]);
  const selecting = picked.length > 0;
  const allPinned = selecting && picked.every(n => n.importance === 1);
  const allPicked = notes?.length > 0 && picked.length === notes.length;

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clear = () => setSelected(new Set());
  const run = (action) => { action([...selected].filter(id => ids.has(id))); clear(); };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        {selecting ? (
          <Toolbar sx={{ minHeight: 56, px: 1 }}>
            <IconButton onClick={clear} aria-label="Cancel selection"><CloseIcon /></IconButton>
            <Typography sx={{ flex: 1, ml: 1, fontWeight: 500 }}>{picked.length} selected</Typography>
            <IconButton
              aria-label="Select all"
              onClick={() => setSelected(allPicked ? new Set() : new Set(notes.map(n => n.id)))}
            >
              <SelectAllIcon sx={{ color: allPicked ? '#00BCD4' : 'inherit' }} />
            </IconButton>
          </Toolbar>
        ) : (
          <Toolbar sx={{ minHeight: 56 }}>
            <IconButton onClick={() => navigate(-1)} edge="start" aria-label="Back"><ArrowBackIcon /></IconButton>
            <Typography variant="h6" sx={{ ml: 1, fontWeight: 500, flex: 1 }}>Hidden notes</Typography>
            {shown && notes?.length > 0 && (
              <IconButton aria-label="Select all" onClick={() => setSelected(new Set(notes.map(n => n.id)))}>
                <SelectAllIcon />
              </IconButton>
            )}
          </Toolbar>
        )}
      </AppBar>

      {gated === false && (
        <Alert severity="info" icon={false} sx={{ borderRadius: 0 }} data-testid="hidden-unprotected">
          Nothing locks this page yet. Set a master password in the phone app to protect it.
        </Alert>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', pb: selecting ? '64px' : 0 }}>
        {!shown ? (
          gated === null ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress size={32} sx={{ color: '#00BCD4' }} /></Box>
          ) : null
        ) : notes === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress size={32} sx={{ color: '#00BCD4' }} /></Box>
        ) : notes.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <VisibilityOffIcon sx={{ fontSize: 64, opacity: 0.2, mb: 1 }} />
            <Typography>No hidden notes</Typography>
          </Box>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              selected={selected.has(note.id)}
              onPress={() => (selecting ? toggle(note.id) : navigate(`/note/${note.id}`))}
              onLongPress={() => toggle(note.id)}
            />
          ))
        )}
      </Box>

      {selecting && (
        <Box sx={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90,
          display: 'flex', bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
        }}>
          <IconButton
            onClick={() => run(ids2 => setHiddenForNotes(ids2, false))}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            <VisibilityIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Unhide</Typography>
          </IconButton>
          <IconButton
            onClick={() => run(ids2 => setPinForNotes(ids2, !allPinned))}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            {allPinned ? <PushPinIcon sx={{ fontSize: 22 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 22 }} />}
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{allPinned ? 'Unpin' : 'Pin'}</Typography>
          </IconButton>
          <IconButton
            onClick={() => run(trashNotes)}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25, color: 'error.main' }}
          >
            <DeleteIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Delete</Typography>
          </IconButton>
        </Box>
      )}

      <MasterPasswordDialog
        open={gated === true && !open}
        onSuccess={() => setOpen(true)}
        onClose={() => navigate(-1)}
      />
    </Box>
  );
}
