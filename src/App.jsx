import React, { useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { buildTheme } from './theme';
import useUIStore from './store/uiStore';
import useColorStore from './store/colorStore';

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

  // Color names + the "show counts" toggle are persisted settings shared by
  // the Color filter modal and the per-note color picker — load once here
  // so both are ready no matter which screen mounts first.
  useEffect(() => { useColorStore.getState().loadColorSettings(); }, []);

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
