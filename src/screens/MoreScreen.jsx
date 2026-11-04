// ─── MoreScreen ──────────────────────────────────────────────────────────────
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, Typography, List, ListItem,
  ListItemIcon, ListItemText, Divider, Avatar,
} from '@mui/material';
import NotesIcon from '@mui/icons-material/Notes';
import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteIcon from '@mui/icons-material/Delete';
import PaletteIcon from '@mui/icons-material/Palette';
import InfoIcon from '@mui/icons-material/Info';
import SettingsIcon from '@mui/icons-material/Settings';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import useUIStore from '../store/uiStore';
import BottomNav from '../components/layout/BottomNav';

export function MoreScreen() {
  const navigate = useNavigate();
  const items = [
    { label: 'All notes',    icon: <NotesIcon />,      path: '/' },
    { label: 'Archive',      icon: <ArchiveIcon />,     path: '/archive' },
    { label: 'Trash Can',    icon: <DeleteIcon />,      path: '/trash' },
    { label: 'Import backup',icon: <UploadFileIcon />,  path: '/import' },
    { label: 'Settings',     icon: <SettingsIcon />,    path: '/settings' },
    { label: 'Keyboard shortcuts', icon: <KeyboardIcon />, action: () => useUIStore.getState().setShortcutsOpen(true) },
  ];

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', pb: '72px' }}>
        {/* Account card */}
        <Box sx={{ bgcolor: 'background.paper', px: 2, py: 2, display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Avatar sx={{ bgcolor: '#4285F4', width: 48, height: 48 }}>G</Avatar>
          <Box>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>My Notes</Typography>
            <Typography variant="caption" color="text.secondary">Local storage</Typography>
          </Box>
        </Box>

        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              <ListItem button onClick={() => (item.action ? item.action() : navigate(item.path))} sx={{ py: 1.5 }}>
                <ListItemIcon sx={{ minWidth: 44 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItem>
              {i < items.length - 1 && <Divider component="li" />}
            </React.Fragment>
          ))}
        </List>
      </Box>
      <BottomNav />
    </Box>
  );
}
