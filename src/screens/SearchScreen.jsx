import React, { useState, useCallback } from 'react';
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
  const timerRef = React.useRef(null);
  // The result the arrow keys are on (-1 = none yet). Enter opens it, or the first when none is.
  const [active, setActive] = useState(-1);

  const handleQuery = useCallback((q) => {
    setQuery(q);
    setActive(-1);
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const res = await searchNotes(q);
      setResults(res);
      setLoading(false);
      setSearched(true);
    }, 300);
  }, []);

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
                navigate(`/note/${results[Math.max(active, 0)].id}`);
              }
            }}
            sx={{ fontSize: '1rem', color: 'text.primary' }}
            startAdornment={<SearchIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />}
            endAdornment={
              query ? (
                <IconButton size="small" onClick={() => handleQuery('')}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              ) : null
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
                onPress={() => navigate(`/note/${note.id}`)}
              />
            </Box>
          ))
        )}
      </Box>
      <BottomNav />
    </Box>
  );
}
