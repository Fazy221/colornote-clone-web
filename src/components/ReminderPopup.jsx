import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, Box, Typography, IconButton, ButtonBase } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { db } from '../db/database';
import useReminderPopupStore from '../store/reminderPopupStore';
import useNoteStore from '../store/noteStore';
import { cancelReminderNotification } from '../notifications/reminders';

export default function ReminderPopup() {
  const navigate = useNavigate();
  const activeNoteUuid = useReminderPopupStore(s => s.activeNoteUuid);
  const hide = useReminderPopupStore(s => s.hide);
  const dismissReminder = useNoteStore(s => s.dismissReminder);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (!activeNoteUuid) { setNote(null); return; }
    db.notes.where('uuid').equals(activeNoteUuid).first().then(setNote);
  }, [activeNoteUuid]);

  if (!activeNoteUuid || !note) return null;

  const handleOpen = () => {
    hide();
    navigate(`/note/${note.id}`);
  };

  const handleDismiss = async (e) => {
    e.stopPropagation();
    await dismissReminder(note.id);
    await cancelReminderNotification(note.uuid);
    hide();
  };

  return (
    <Dialog open onClose={hide} maxWidth="xs" fullWidth>
      <DialogContent sx={{ p: 0 }}>
        <ButtonBase
          onClick={handleOpen}
          sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.5, p: 2, textAlign: 'left' }}
        >
          <EditNoteIcon sx={{ color: '#00BCD4', flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body1" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
              {note.title || 'Untitled note'}
            </Typography>
            <Typography variant="caption" color="text.secondary">Tap to open</Typography>
          </Box>
          <IconButton onClick={handleDismiss} size="small" sx={{ flexShrink: 0 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </ButtonBase>
      </DialogContent>
    </Dialog>
  );
}
