import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, InputBase, IconButton,
  Typography, CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import NoteCard from '../components/notes/NoteCard';
import useNoteStore from '../store/noteStore';
import BottomNav from '../components/layout/BottomNav';
import { is } from '../utils/shortcuts';

export default function SearchScreen() {
  const navigate = useNavigate();
  const { searchNotes } = useNoteStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // The result the arrow keys are on (-1 = none yet). Enter opens it, or the first when none is.
  const [active, setActive] = useState(-1);
  // "Title only" leaves the text and list items out of the search. Kept for the next visit.
  const [titleOnly, setTitleOnly] = useState(() => {
    try { return localStorage.getItem('searchTitleOnly') === '1'; } catch { return false; }
  });
  const toggleTitleOnly = (on) => {
    setTitleOnly(on);
    setActive(-1);
    try { localStorage.setItem('searchTitleOnly', on ? '1' : '0'); } catch { /* private window: the choice lasts until the page closes */ }
  };

  const handleQuery = useCallback((q) => { setQuery(q); setActive(-1); }, []);

  // Searches a moment after the typing stops, and again when "Title only" changes.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); setLoading(false); return undefined; }
    setLoading(true);
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await searchNotes(query, { titleOnly });
      if (stale) return;
      setResults(res);
      setLoading(false);
      setSearched(true);
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [query, titleOnly, searchNotes]);

  // A note found by its text opens with Find on that word (see NoteEditorScreen). Found by title only, there is nothing to find in the text.
  const openNote = (id) => navigate(`/note/${id}`, { state: titleOnly || !query.trim() ? undefined : { find: query } });

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <Toolbar sx={{ minHeight: 56, gap: 1 }}>
          <IconButton onClick={() => navigate(-1)} edge="start">
            <ArrowBackIcon />
          </IconButton>
          <InputBase
            autoFocus
            fullWidth
            placeholder="Search notes…"
            value={query}
            onChange={e => handleQuery(e.target.value)}
            onKeyDown={e => {
              if (e.isComposing || !results.length) return;
              if (is(e, 'resultDown') || is(e, 'resultUp')) {
                e.preventDefault();
                const d = is(e, 'resultDown') ? 1 : -1;
                setActive(a => (a < 0 ? (d > 0 ? 0 : results.length - 1) : (a + d + results.length) % results.length));
              } else if (is(e, 'resultOpen')) {
                e.preventDefault();
                openNote(results[Math.max(active, 0)].id);
              }
            }}
            sx={{ fontSize: '1rem', color: 'text.primary' }}
            startAdornment={<SearchIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />}
            endAdornment={
              <>
                {/* "Tt": search the titles only. Same size as the clear button, tinted while it is on. The Android app has the same button. */}
                <IconButton
                  size="small"
                  aria-label="Title only"
                  aria-pressed={titleOnly}
                  title="Title only"
                  onClick={() => toggleTitleOnly(!titleOnly)}
                  sx={{ color: titleOnly ? '#00BCD4' : 'text.secondary', bgcolor: titleOnly ? 'rgba(0,188,212,0.16)' : 'transparent' }}
                >
                  <Typography component="span" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: '20px', width: 20, textAlign: 'center', color: 'inherit' }}>Tt</Typography>
                </IconButton>
                {query ? (
                  <IconButton size="small" aria-label="Clear" onClick={() => handleQuery('')}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                ) : null}
              </>
            }
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: '72px' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={28} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : searched && results.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <Typography>No results for "{query}"</Typography>
          </Box>
        ) : (
          results.map((note, i) => (
            <Box
              key={note.id}
              ref={i === active ? (el => el?.scrollIntoView?.({ block: 'nearest' })) : undefined}
              sx={i === active ? { outline: '2px solid #00BCD4', outlineOffset: -2 } : undefined}
            >
              <NoteCard
                note={note}
                onPress={() => openNote(note.id)}
              />
            </Box>
          ))
        )}
      </Box>
      <BottomNav />
    </Box>
  );
}
