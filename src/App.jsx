import React, { useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Box, CircularProgress } from '@mui/material';
import { buildTheme } from './theme';
import useUIStore from './store/uiStore';
import useColorStore from './store/colorStore';
import useAuthStore from './store/authStore';

import SignInScreen from './screens/SignInScreen';
import HomeScreen from './screens/HomeScreen';
import NoteEditorScreen from './screens/NoteEditorScreen';
import CalendarScreen from './screens/CalendarScreen';
import SearchScreen from './screens/SearchScreen';
import { MoreScreen } from './screens/MoreScreen';
import { ArchiveScreen, TrashScreen } from './screens/ArchiveTrashScreen';
import ImportScreen from './screens/ImportScreen';
import SettingsScreen from './screens/SettingsScreen';

export default function App() {
  const darkMode = useUIStore(s => s.darkMode);
  const theme = useMemo(() => buildTheme(darkMode), [darkMode]);
  const user = useAuthStore(s => s.user);

  // Color names + the "show counts" toggle are persisted settings shared by
  // the Color filter modal and the per-note color picker — load once here
  // so both are ready no matter which screen mounts first.
  useEffect(() => { useColorStore.getState().loadColorSettings(); }, []);

  // Desktop grid-view default — start reading before HomeScreen mounts.
  useEffect(() => { useUIStore.getState().initHomeGridColumns(); }, []);

  // Restore persisted dark-mode preference on boot.
  useEffect(() => {
    import('./db/database').then(({ getSetting }) => {
      getSetting('darkMode', false).then(saved => {
        if (saved !== useUIStore.getState().darkMode) {
          useUIStore.getState().toggleDarkMode();
        }
      });
    });
  }, []);

  // Start/stop Firestore sync as sign-in state changes. Runs the one-time
  // reconciliation (seeds the cloud from this device or pulls it down,
  // whichever applies), then re-checks dark mode and refreshes the visible
  // note list in case that reconciliation just pulled in settings/notes
  // that weren't here a moment ago (a brand-new device signing in for the
  // first time, for example).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const [{ startSync }, { getSetting }, { default: useNoteStore }] = await Promise.all([
        import('./sync/notesSync'),
        import('./db/database'),
        import('./store/noteStore'),
      ]);
      await startSync(user.uid);
      if (cancelled) return;

      const saved = await getSetting('darkMode', false);
      if (saved !== useUIStore.getState().darkMode) {
        useUIStore.getState().toggleDarkMode();
      }
      useNoteStore.getState().loadNotes(useNoteStore.getState().activeState);
    })();

    return () => {
      cancelled = true;
      import('./sync/notesSync').then(({ stopSync }) => stopSync());
    };
  }, [user?.uid]);

  // user === undefined while Firebase is still checking a previous session;
  // don't flash the sign-in screen during that split second.
  if (user === undefined) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
          <CircularProgress sx={{ color: '#00BCD4' }} />
        </Box>
      </ThemeProvider>
    );
  }

  if (user === null) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SignInScreen />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/"           element={<HomeScreen />} />
          <Route path="/note/:id"   element={<NoteEditorScreen />} />
          <Route path="/calendar"   element={<CalendarScreen />} />
          <Route path="/search"     element={<SearchScreen />} />
          <Route path="/more"       element={<MoreScreen />} />
          <Route path="/archive"    element={<ArchiveScreen />} />
          <Route path="/trash"      element={<TrashScreen />} />
          <Route path="/import"     element={<ImportScreen />} />
          <Route path="/settings"   element={<SettingsScreen />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
