// ─── SettingsScreen ──────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, Typography,
  List, ListItem, ListItemText, Switch, Divider,
  ToggleButtonGroup, ToggleButton, Avatar, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewComfyIcon from '@mui/icons-material/ViewComfy';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import { getSetting } from '../db/database';
import { syncSetting } from '../sync/notesSync';
import useUIStore from '../store/uiStore';
import useAuthStore from '../store/authStore';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const [searchLockedContent, setSearchLockedContent] = useState(false);
  const [defaultDesktopView, setDefaultDesktopView] = useState(1);
  const [loaded, setLoaded] = useState(false);

  const darkMode       = useUIStore(s => s.darkMode);
  const toggleDarkMode = useUIStore(s => s.toggleDarkMode);
  const user           = useAuthStore(s => s.user);
  const signOutUser     = useAuthStore(s => s.signOutUser);

  useEffect(() => {
    (async () => {
      setSearchLockedContent(await getSetting('searchLockedContent', false));
      setDefaultDesktopView(Number(await getSetting('defaultDesktopView', 1)));
      setLoaded(true);
    })();
  }, []);

  const handleSearchLocked = async (checked) => {
    setSearchLockedContent(checked);
    await syncSetting('searchLockedContent', checked);
  };

  const handleDesktopViewChange = async (_e, value) => {
    if (value === null) return;
    setDefaultDesktopView(value);
    await syncSetting('defaultDesktopView', value);
  };

  const handleDarkMode = async (checked) => {
    toggleDarkMode();
    await syncSetting('darkMode', checked);
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56, gap: 1 }}>
          <IconButton onClick={() => navigate(-1)} edge="start">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 500 }}>Settings</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>

        {/* ── ACCOUNT ──────────────────────────────────────────────────────── */}
        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 2, pb: 0.5, color: 'text.secondary' }}>
          ACCOUNT
        </Typography>
        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          <ListItem sx={{ py: 1.5, gap: 1.5 }}>
            <Avatar src={user?.photoURL || undefined} sx={{ width: 40, height: 40 }}>
              {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
            </Avatar>
            <ListItemText
              primary={user?.displayName || 'Signed in'}
              secondary={user?.email}
            />
            <Button color="error" size="small" onClick={signOutUser}>
              Sign out
            </Button>
          </ListItem>
          <Divider component="li" />
        </List>

        {/* ── DISPLAY ─────────────────────────────────────────────────────── */}
        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 2, pb: 0.5, color: 'text.secondary' }}>
          DISPLAY
        </Typography>
        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          {/* Dark mode */}
          <ListItem sx={{ py: 1.5 }}>
            <ListItemText
              primary="Dark mode"
              secondary="Switches the whole app to a dark colour scheme."
              secondaryTypographyProps={{ sx: { mt: 0.5 } }}
            />
            <Switch
              checked={darkMode}
              onChange={e => handleDarkMode(e.target.checked)}
            />
          </ListItem>
          <Divider component="li" />

          {/* Default desktop columns */}
          <ListItem sx={{ py: 1.5, flexDirection: 'column', alignItems: 'stretch', gap: 1.5 }}>
            <ListItemText
              primary="Default desktop view"
              secondary="How many columns of notes Home starts with on a wide screen. Mobile always uses a single column. You can still switch on the fly from Home — this just sets the starting point."
              secondaryTypographyProps={{ sx: { mt: 0.5 } }}
            />
            <ToggleButtonGroup
              exclusive
              value={defaultDesktopView}
              onChange={handleDesktopViewChange}
              disabled={!loaded}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              <ToggleButton value={1}><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />1</ToggleButton>
              <ToggleButton value={2}><ViewCompactIcon fontSize="small" sx={{ mr: 0.5 }} />2</ToggleButton>
              <ToggleButton value={3}><ViewModuleIcon fontSize="small" sx={{ mr: 0.5 }} />3</ToggleButton>
              <ToggleButton value={4}><ViewComfyIcon fontSize="small" sx={{ mr: 0.5 }} />4</ToggleButton>
            </ToggleButtonGroup>
          </ListItem>
          <Divider component="li" />
        </List>

        {/* ── PRIVACY ─────────────────────────────────────────────────────── */}
        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 2, pb: 0.5, color: 'text.secondary' }}>
          PRIVACY
        </Typography>
        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          <ListItem sx={{ py: 1.5 }}>
            <ListItemText
              primary="Search inside locked notes"
              secondary="When on, locked notes can match a search by their content — but the list never shows a preview of locked content, and you still need the password to open one."
              secondaryTypographyProps={{ sx: { mt: 0.5 } }}
            />
            <Switch
              checked={searchLockedContent}
              disabled={!loaded}
              onChange={e => handleSearchLocked(e.target.checked)}
            />
          </ListItem>
          <Divider component="li" />
        </List>
      </Box>
    </Box>
  );
}
