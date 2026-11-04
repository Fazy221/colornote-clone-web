import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, List, ListItemButton,
  ListItemIcon, ListItemText, TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined';
import FolderGlyph from './FolderGlyph';
import { getColor } from '../../utils/colors';
import useFolderStore from '../../store/folderStore';
import { sortFolders } from '../../utils/folders';

// Asks which folder a note goes in: "None", each folder, or a new one.
// onSelect(folderId) is called with 0 for none.
export default function FolderPicker({ open, current, onSelect, onClose }) {
  const folders = useFolderStore(s => s.folders);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    useFolderStore.getState().load({ pull: true });
    setAdding(false);
    setName('');
  }, [open]);

  const choose = (id) => { onSelect(id); onClose(); };

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = await useFolderStore.getState().addFolder(trimmed);
    choose(id);
  };

  if (adding) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 500, fontSize: '1rem' }}>New folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth variant="standard" label="Folder" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!name.trim()}>OK</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 500, fontSize: '1rem' }}>Folder</DialogTitle>
      <DialogContent sx={{ px: 0, pt: 0 }}>
        <List disablePadding>
          <ListItemButton selected={!current} onClick={() => choose(0)}>
            <ListItemIcon sx={{ minWidth: 40 }}><FolderOffOutlinedIcon /></ListItemIcon>
            <ListItemText primary="None" />
          </ListItemButton>
          {sortFolders(folders, {}, 'alpha').map(f => (
            <ListItemButton key={f.id} selected={current === f.id} onClick={() => choose(f.id)}>
              <ListItemIcon sx={{ minWidth: 40 }}>
                <FolderGlyph index={f.icon} sx={{ color: f.color ? getColor(f.color).border : 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText primary={f.name} primaryTypographyProps={{ noWrap: true }} />
            </ListItemButton>
          ))}
          <ListItemButton onClick={() => setAdding(true)}>
            <ListItemIcon sx={{ minWidth: 40 }}><AddIcon /></ListItemIcon>
            <ListItemText primary="New folder" />
          </ListItemButton>
        </List>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button></DialogActions>
    </Dialog>
  );
}
