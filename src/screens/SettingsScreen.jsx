// ─── SettingsScreen ──────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, Typography,
  List, ListItem, ListItemText, Switch, Divider,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewComfyIcon from '@mui/icons-material/ViewComfy';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import { getSetting, setSetting } from '../db/database';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const [searchLockedContent, setSearchLockedContent] = useState(false);
  const [defaultDesktopView, setDefaultDesktopView] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setSearchLockedContent(await getSetting('searchLockedContent', false));
      setDefaultDesktopView(Number(await getSetting('defaultDesktopView', 1)));
      setLoaded(true);
    })();
  }, []);

  const handleToggle = async (checked) => {
    setSearchLockedContent(checked); // optimistic — settings screen has no autosave delay
    await setSetting('searchLockedContent', checked);
  };

  const handleDesktopViewChange = async (_e, value) => {
    if (value === null) return; // ignore re-clicking the already-selected option
    setDefaultDesktopView(value);
    await setSetting('defaultDesktopView', value);
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
        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 2, pb: 0.5, color: 'text.secondary' }}>
          DISPLAY
        </Typography>
        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          <ListItem sx={{ py: 1.5, flexDirection: 'column', alignItems: 'stretch', gap: 1.5 }}>
            <ListItemText
              primary="Default desktop view"
              secondary="How many columns of notes Home starts with on a wide (desktop-size) screen. Mobile always uses a single column, same as the original app. You can still switch views on the fly from Home — this just sets the starting point."
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
              <ToggleButton value={1} aria-label="1 column"><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />1</ToggleButton>
              <ToggleButton value={2} aria-label="2 columns"><ViewCompactIcon fontSize="small" sx={{ mr: 0.5 }} />2</ToggleButton>
              <ToggleButton value={3} aria-label="3 columns"><ViewModuleIcon fontSize="small" sx={{ mr: 0.5 }} />3</ToggleButton>
              <ToggleButton value={4} aria-label="4 columns"><ViewComfyIcon fontSize="small" sx={{ mr: 0.5 }} />4</ToggleButton>
            </ToggleButtonGroup>
          </ListItem>
          <Divider component="li" />
        </List>

        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 2, pb: 0.5, color: 'text.secondary' }}>
          PRIVACY
        </Typography>
        <List disablePadding sx={{ bgcolor: 'background.paper' }}>
          <ListItem sx={{ py: 1.5 }}>
            <ListItemText
              primary="Search inside locked notes"
              secondary="Off by default. When on, a locked note can match a search by its content, not just its title — but the note list still never shows a preview of locked content, and you still need the password to open it."
              secondaryTypographyProps={{ sx: { mt: 0.5 } }}
            />
            <Switch
              checked={searchLockedContent}
              disabled={!loaded}
              onChange={e => handleToggle(e.target.checked)}
            />
          </ListItem>
          <Divider component="li" />
        </List>
      </Box>
    </Box>
  );
}
