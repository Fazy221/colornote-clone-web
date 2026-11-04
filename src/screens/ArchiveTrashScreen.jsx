import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, Typography,
  CircularProgress, Button, Dialog, DialogTitle,
  DialogActions, Menu, MenuItem,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import NoteCard from '../components/notes/NoteCard';
import useNoteStore from '../store/noteStore';

// ─── Archive Screen ───────────────────────────────────────────────────────────
export function ArchiveScreen() {
  const navigate = useNavigate();
  const { notes, loading, loadNotes, restoreNote, trashNote } = useNoteStore();
  const [menuNote, setMenuNote] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);

  useEffect(() => { loadNotes('archived'); }, []);

  const openMenu = (anchorEl, note) => { setMenuNote(note); setMenuAnchor(anchorEl); };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton onClick={() => navigate(-1)} edge="start"><ArrowBackIcon /></IconButton>
          <Typography variant="h6" sx={{ ml: 1, fontWeight: 500 }}>Archive</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={32} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : notes.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <Typography>No archived notes</Typography>
          </Box>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onPress={() => navigate(`/note/${note.id}`)}
              onLongPress={(anchorEl) => openMenu(anchorEl, note)}
            />
          ))
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { restoreNote(menuNote?.id); setMenuAnchor(null); }}>Unarchive</MenuItem>
        <MenuItem onClick={() => { trashNote(menuNote?.id); setMenuAnchor(null); }}>Move to trash</MenuItem>
      </Menu>
    </Box>
  );
}

// ─── Trash Screen ─────────────────────────────────────────────────────────────
export function TrashScreen() {
  const navigate = useNavigate();
  const { notes, loading, loadNotes, restoreNote, deleteNotePermanently } = useNoteStore();
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [menuNote, setMenuNote] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);

  useEffect(() => { loadNotes('trash'); }, []);

  const openMenu = (e, note) => { setMenuNote(note); setMenuAnchor(e.currentTarget); };

  const deleteAll = async () => {
    for (const n of notes) await deleteNotePermanently(n.id);
    setDeleteAllOpen(false);
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton onClick={() => navigate(-1)} edge="start"><ArrowBackIcon /></IconButton>
          <Typography variant="h6" sx={{ ml: 1, fontWeight: 500, flex: 1 }}>Trash Can</Typography>
          {notes.length > 0 && (
            <IconButton onClick={() => setDeleteAllOpen(true)} size="small">
              <Typography variant="caption" color="error">Empty</Typography>
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={32} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : notes.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <Typography>Trash is empty</Typography>
          </Box>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onPress={(e) => openMenu(e, note)}
            />
          ))
        )}
      </Box>

      {/* Bottom action bar */}
      {notes.length > 0 && (
        <Box sx={{ display: 'flex', borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Button
            fullWidth
            startIcon={<ArrowBackIcon />}
            onClick={() => menuNote && restoreNote(menuNote.id)}
            disabled={!menuNote}
            sx={{ py: 1.5, color: 'text.primary' }}
          >
            Restore
          </Button>
          <Button
            fullWidth
            onClick={() => menuNote && deleteNotePermanently(menuNote.id)}
            disabled={!menuNote}
            sx={{ py: 1.5, color: 'error.main' }}
          >
            Permanently delete
          </Button>
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { restoreNote(menuNote?.id); setMenuAnchor(null); }}>Restore</MenuItem>
        <MenuItem onClick={() => { deleteNotePermanently(menuNote?.id); setMenuAnchor(null); }} sx={{ color: 'error.main' }}>
          Permanently delete
        </MenuItem>
      </Menu>

      <Dialog open={deleteAllOpen} onClose={() => setDeleteAllOpen(false)}>
        <DialogTitle>Empty trash? This cannot be undone.</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteAllOpen(false)}>Cancel</Button>
          <Button onClick={deleteAll} color="error">Empty trash</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
