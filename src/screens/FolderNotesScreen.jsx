import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, AppBar, Toolbar, IconButton, Typography, CircularProgress } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import NoteCard from '../components/notes/NoteCard';
import { getNotesInFolder } from '../db/database';
import useFolderStore from '../store/folderStore';

// The notes in one folder (archived ones included, trash not), opened from the Folders tab.
export default function FolderNotesScreen() {
  const navigate = useNavigate();
  const folderId = Number(useParams().id);
  const folder = useFolderStore(s => s.folders.find(f => f.id === folderId));
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    useFolderStore.getState().load();
    getNotesInFolder(folderId).then(setNotes);
  }, [folderId]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton edge="start" aria-label="Back" onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
          <Typography variant="h6" noWrap sx={{ ml: 1, fontWeight: 500 }}>{folder?.name || 'Folder'}</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {notes === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={32} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : notes.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <Typography>No notes in this folder</Typography>
          </Box>
        ) : notes.map(note => (
          <NoteCard key={note.id} note={note} onPress={() => navigate(`/note/${note.id}`)} onLongPress={() => {}} />
        ))}
      </Box>
    </Box>
  );
}
