import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, Typography, IconButton,
  Fab, Menu, MenuItem, Divider, Dialog, DialogTitle,
  DialogContent, List, ListItem, ListItemIcon, ListItemText,
  CircularProgress, Chip, useMediaQuery,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NotesIcon from '@mui/icons-material/Notes';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import CloseIcon from '@mui/icons-material/Close';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import ColorLensIcon from '@mui/icons-material/ColorLens';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteIcon from '@mui/icons-material/Delete';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridViewIcon from '@mui/icons-material/GridView';

import ErrorBoundary from '../components/common/ErrorBoundary';
import NoteCard from '../components/notes/NoteCard';
import ColorPicker from '../components/common/ColorPicker';
import FolderPicker from '../components/common/FolderPicker';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ColorFilterDialog from '../components/common/ColorFilterDialog';
import BottomNav from '../components/layout/BottomNav';
import { NOTE_COLORS } from '../utils/colors';
import useNoteStore from '../store/noteStore';
import useUIStore from '../store/uiStore';

// Desktop breakpoint for the grid-view option. Below this, Home is always
// the single-column list (that's the native mobile layout and it already
// works well there) — the multi-column grid only makes sense once there's
// enough width that a single column means a lot of wasted side space.
const DESKTOP_BREAKPOINT = '(min-width:900px)';

export default function HomeScreen() {
  const navigate = useNavigate();
  const {
    notes, loading, loadNotes, activeState,
    archiveNotes, trashNotes, setColorForNotes, setPinForNotes, setFolderForNotes,
  } = useNoteStore();
  const {
    colorFilter, setColorFilter, sortOrder, setSortOrder,
    selectedIds, selectionMode, toggleSelect, clearSelection, selectAll,
    homeGridColumns, setHomeGridColumns, initHomeGridColumns,
  } = useUIStore();

  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT);
  const columns = isDesktop ? homeGridColumns : 1;

  const [menuAnchor, setMenuAnchor] = useState(null);
  const [sortAnchor, setSortAnchor] = useState(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [colorFilterDialogOpen, setColorFilterDialogOpen] = useState(false);
  const [viewMenuAnchor, setViewMenuAnchor] = useState(null);

  // Load the persisted "default desktop view" once per session. Deliberately
  // NOT re-run on every Home mount — if the user changes columns on the fly,
  // navigating away and back shouldn't silently reset it back to the saved
  // default (that's what Settings is for, not implicit remounts).
  useEffect(() => { initHomeGridColumns(); }, []);

  // Skip a redundant IndexedDB refetch if the store already has fresh
  // 'normal'-state notes cached (e.g. coming back from Calendar/Search/an
  // edit). Every CRUD/bulk action in noteStore.js reloads after it writes,
  // so this can't go stale — it only stops the refetch-and-rerender that
  // otherwise fired on every single Home visit even when nothing changed.
  useEffect(() => {
    if (activeState !== 'normal' || notes.length === 0) loadNotes('normal');
  }, []);

  // Leaving Home shouldn't leave a stale selection lying around for other screens.
  useEffect(() => () => clearSelection(), []);

  // ── Incremental rendering ──────────────────────────────────────────────
  // With ~1.7k notes, mounting every NoteCard at once (not the IndexedDB
  // query, which is already fast/indexed) is what made Home feel slow.
  // Only a batch is actually mounted; an IntersectionObserver on a sentinel
  // grows the batch as the user scrolls near the bottom. Filtering/sorting
  // still runs over the full in-memory list as before — only what gets
  // *rendered* is batched, so search/sort/filter/select-all are unaffected.
  const BATCH_SIZE = 60;
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  // Apply color filter + sort
  const displayNotes = useMemo(() => {
    let list = colorFilter !== null
      ? notes.filter(n => n.colorIndex === colorFilter)
      : notes;

    // Pinned notes first
    const pinned = list.filter(n => n.importance === 1);
    const rest = list.filter(n => n.importance !== 1);

    const sortFn = {
      modified: (a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0),
      created:  (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      title:    (a, b) => (a.title || '').localeCompare(b.title || ''),
      color:    (a, b) => (a.colorIndex || 0) - (b.colorIndex || 0),
    }[sortOrder] || ((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));

    return [...pinned.sort(sortFn), ...rest.sort(sortFn)];
  }, [notes, colorFilter, sortOrder]);

  // Per-color note counts for the Color filter modal's "123" toggle —
  // counted over all 'normal' notes, independent of the current color
  // filter (so the modal always shows the full breakdown, not just the
  // count for whatever's currently filtered).
  const colorCounts = useMemo(() => {
    const counts = {};
    for (const n of notes) counts[n.colorIndex] = (counts[n.colorIndex] || 0) + 1;
    return counts;
  }, [notes]);

  // Changing filter/sort is a deliberate "start over", not a scroll
  // continuation — reset back to the first batch and scroll to top.
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [colorFilter, sortOrder]);

  const visibleNotes = useMemo(
    () => displayNotes.slice(0, visibleCount),
    [displayNotes, visibleCount]
  );

  // Grow the batch as the user scrolls near the bottom.
  //
  // `columns` is kept in the dependency array even though it's not used
  // inside the callback, as defense-in-depth: if this effect ever needs to
  // re-run on a view switch again, this makes sure it does. It's not load-
  // bearing anymore though — see the note below on why list/grid both
  // render a <Box> at this position now.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(c => Math.min(c + BATCH_SIZE, displayNotes.length));
        }
      },
      { root, rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayNotes.length, columns]);

  const selectedNotes = useMemo(
    () => displayNotes.filter(n => selectedIds.has(n.id)),
    [displayNotes, selectedIds]
  );
  const allSelectedPinned = selectedNotes.length > 0 && selectedNotes.every(n => n.importance === 1);
  const allFilteredSelected = displayNotes.length > 0 && selectedIds.size === displayNotes.length;

  const handleAdd = (type) => {
    setAddDialogOpen(false);
    navigate(`/note/new?type=${type}`);
  };

  const handleCardPress = (note) => {
    if (selectionMode) toggleSelect(note.id);
    else navigate(`/note/${note.id}`);
  };

  const handleCardLongPress = (note) => {
    toggleSelect(note.id);
  };

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) clearSelection();
    else selectAll(displayNotes.map(n => n.id));
  };

  const handleBulkColor = (colorIndex) => {
    setColorForNotes([...selectedIds], colorIndex);
    clearSelection();
  };

  const handleBulkFolder = (folderId) => {
    setFolderForNotes([...selectedIds], folderId);
    clearSelection();
  };

  const handleBulkPin = () => {
    setPinForNotes([...selectedIds], !allSelectedPinned);
    clearSelection();
  };

  const handleBulkArchive = () => {
    archiveNotes([...selectedIds]);
    clearSelection();
  };

  const handleBulkDelete = () => {
    trashNotes([...selectedIds]);
    clearSelection();
  };

  const SORT_LABELS = {
    modified: 'Sort by modified time',
    created:  'Sort by created time',
    title:    'Sort by title',
    color:    'Sort by color',
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>

      {/* ── Top AppBar ── */}
      <AppBar position="static" sx={{ bgcolor: 'background.paper', color: 'text.primary' }} elevation={0}>
        {selectionMode ? (
          /* ── Selection toolbar ── */
          <Toolbar sx={{ minHeight: 56, px: 1 }}>
            <IconButton onClick={clearSelection}>
              <CloseIcon />
            </IconButton>
            <Typography sx={{ flex: 1, ml: 1, fontWeight: 500 }}>
              {selectedIds.size} selected
            </Typography>
            <IconButton onClick={handleToggleSelectAll}>
              <SelectAllIcon sx={{ color: allFilteredSelected ? '#00BCD4' : 'inherit' }} />
            </IconButton>
          </Toolbar>
        ) : (
          <Toolbar sx={{ minHeight: 56, px: 2 }}>
            {/* Logo */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1 }}>
              <Box sx={{
                width: 28, height: 28, borderRadius: '4px',
                background: 'linear-gradient(135deg, #F44336 25%, #FFEB3B 25% 50%, #4CAF50 50% 75%, #2196F3 75%)',
                flexShrink: 0,
              }} />
              <Typography sx={{ fontWeight: 400, fontSize: '1.15rem', letterSpacing: 0 }}>
                Color<Typography component="span" sx={{ fontWeight: 700, fontSize: '1.15rem' }}>Note</Typography>
              </Typography>
            </Box>

            {/* Color filter — single icon opens the full Color modal (all 10
                colors, filter/rename/counts), replacing the old always-visible
                4-square row. A small dot shows which color is active, since
                that's no longer visible at a glance without opening it. */}
            <IconButton
              size="small"
              onClick={() => setColorFilterDialogOpen(true)}
              sx={{ mr: 0.5, position: 'relative' }}
              aria-label="Filter by color"
            >
              <Box sx={{
                width: 22, height: 22, borderRadius: '4px',
                background: 'linear-gradient(135deg, #F44336 25%, #FFEB3B 25% 50%, #4CAF50 50% 75%, #2196F3 75%)',
              }} />
              {colorFilter !== null && (
                <Box sx={{
                  position: 'absolute', bottom: 2, right: 2,
                  width: 9, height: 9, borderRadius: '50%',
                  bgcolor: NOTE_COLORS[colorFilter]?.border || '#000',
                  border: '1.5px solid',
                  borderColor: 'background.paper',
                }} />
              )}
            </IconButton>

            {/* Grid view toggle — desktop only; mobile stays single-column
                (that's the native layout and already works well there). */}
            {isDesktop && (
              <IconButton
                size="small"
                onClick={e => setViewMenuAnchor(e.currentTarget)}
                sx={{ mr: 0.5 }}
                aria-label="Change view"
              >
                {columns === 1 ? <ViewListIcon /> : <GridViewIcon />}
              </IconButton>
            )}

            <IconButton size="small" onClick={e => setMenuAnchor(e.currentTarget)}>
              <MoreVertIcon />
            </IconButton>
          </Toolbar>
        )}
        {/* Sort bar */}
        {!selectionMode && (
          <Box
            sx={{ px: 2, py: 0.5, bgcolor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
            onClick={e => setSortAnchor(e.currentTarget)}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.25 }}>
              {SORT_LABELS[sortOrder]} <ArrowDropDownIcon sx={{ fontSize: 16 }} />
            </Typography>
          </Box>
        )}
      </AppBar>

      {/* ── Notes List ── */}
      <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', pb: selectionMode ? '132px' : '72px' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
            <CircularProgress size={32} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : displayNotes.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <NotesIcon sx={{ fontSize: 64, opacity: 0.2, mb: 1 }} />
            <Typography>No notes yet. Tap + to add one.</Typography>
          </Box>
        ) : (
        <ErrorBoundary resetKeys={[columns]}>
        {columns === 1 ? (
          // Single column — the native packed-row list (cards flush against
          // each other, 1px gap), same as the mobile layout always was.
          //
          // This is a <Box>, not a bare <> Fragment, and that's deliberate:
          // list view and grid view render at this exact same JSX position,
          // and until this was a matching element type in both branches,
          // switching between them was a *type change* to React, which
          // fully unmounted/remounted this entire notes+sentinel subtree on
          // every view switch. That's what caused "switch to grid, scroll,
          // and it snaps back to list view" — the remount reset scroll
          // position and, combined with the batching/sentinel logic, made
          // it look like the view itself had reverted. Keeping both
          // branches as <Box> (only their props/children differ) means
          // React just updates props on the same DOM node instead of
          // tearing it down. `data-testid`/`data-view`/`data-columns` exist
          // so the regression test in `__tests__/HomeScreen.gridview.test.jsx`
          // can assert on this reliably (MUI's `sx` compiles to CSS classes,
          // not inline styles, so a plain style-attribute selector doesn't work).
          <Box data-testid="notes-container" data-view="list" data-columns={1}>
            {visibleNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                selected={selectedIds.has(note.id)}
                onPress={() => handleCardPress(note)}
                onLongPress={() => handleCardLongPress(note)}
              />
            ))}
            {visibleCount < displayNotes.length && (
              <Box ref={sentinelRef} sx={{ height: 1 }} />
            )}
          </Box>
        ) : (
          // Multi-column grid (desktop only) — real gaps between cards
          // instead of the packed-row look, since that's what reads as a
          // "grid of notes" rather than a cramped list stretched wide.
          // Same element type (<Box>) as the list branch above — see the
          // comment there for why that matters.
          <Box
            data-testid="notes-container"
            data-view="grid"
            data-columns={columns}
            sx={{
              display: 'grid',
              // minmax(0, 1fr), not a bare 1fr: a plain 1fr track still won't
              // shrink a column below the min-content width of what's inside
              // it (e.g. a nowrap date, a long unbroken word/URL in a note).
              // Once a card's content needed more room than an even split
              // allowed, the grid stopped honoring equal columns and cards
              // started overlapping/overflowing — that's the "layout breaks
              // on switching grid view" symptom. minmax(0, 1fr) tells the
              // grid it's allowed to shrink tracks to 0 before growing them,
              // which is what makes equal-width columns actually hold.
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: 1,
              p: 1,
            }}
          >
            {visibleNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                selected={selectedIds.has(note.id)}
                onPress={() => handleCardPress(note)}
                onLongPress={() => handleCardLongPress(note)}
              />
            ))}
            {visibleCount < displayNotes.length && (
              <Box ref={sentinelRef} sx={{ height: 1, gridColumn: '1 / -1' }} />
            )}
          </Box>
        )}
        </ErrorBoundary>
        )}
      </Box>

      {/* ── FAB (hidden while selecting) ── */}
      {!selectionMode && (
        <Fab
          onClick={() => setAddDialogOpen(true)}
          sx={{ position: 'fixed', bottom: 72, right: 16, zIndex: 50 }}
        >
          <AddIcon />
        </Fab>
      )}

      {/* ── Multi-select action bar ── */}
      {selectionMode && (
        <Box sx={{
          position: 'fixed', bottom: 56, left: 0, right: 0, zIndex: 90,
          display: 'flex', bgcolor: 'background.paper',
          borderTop: '1px solid rgba(0,0,0,0.1)',
        }}>
          <IconButton
            onClick={() => setColorPickerOpen(true)}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            <ColorLensIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Color</Typography>
          </IconButton>
          <IconButton
            onClick={() => setFolderPickerOpen(true)}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            <FolderOutlinedIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Folder</Typography>
          </IconButton>
          <IconButton
            onClick={handleBulkPin}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            {allSelectedPinned ? <PushPinIcon sx={{ fontSize: 22 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 22 }} />}
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>{allSelectedPinned ? 'Unpin' : 'Pin'}</Typography>
          </IconButton>
          <IconButton
            onClick={handleBulkArchive}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25 }}
          >
            <ArchiveIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Archive</Typography>
          </IconButton>
          <IconButton
            onClick={handleBulkDelete}
            sx={{ flex: 1, borderRadius: 0, py: 1, flexDirection: 'column', gap: 0.25, color: 'error.main' }}
          >
            <DeleteIcon sx={{ fontSize: 22 }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>Delete</Typography>
          </IconButton>
        </Box>
      )}

      {/* ── Bulk color picker ── */}
      <ColorPicker
        open={colorPickerOpen}
        currentColor={selectedNotes.length === 1 ? selectedNotes[0].colorIndex : undefined}
        onSelect={handleBulkColor}
        onClose={() => setColorPickerOpen(false)}
      />

      {/* ── Bulk folder picker ── */}
      <FolderPicker
        open={folderPickerOpen}
        current={selectedNotes.length === 1 ? selectedNotes[0].folderId : undefined}
        onSelect={handleBulkFolder}
        onClose={() => setFolderPickerOpen(false)}
      />

      {/* ── Color filter modal (filter / rename / counts) ── */}
      <ColorFilterDialog
        open={colorFilterDialogOpen}
        colorFilter={colorFilter}
        onSelectFilter={setColorFilter}
        onClose={() => setColorFilterDialogOpen(false)}
        counts={colorCounts}
      />

      {/* ── Add Note Dialog ── */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)}>
        <DialogTitle sx={{ pb: 0, fontWeight: 500 }}>Add</DialogTitle>
        <DialogContent sx={{ pt: 1, minWidth: 220 }}>
          <List disablePadding>
            <ListItem button onClick={() => handleAdd('text')} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}><NotesIcon /></ListItemIcon>
              <ListItemText primary="Text" />
            </ListItem>
            <ListItem button onClick={() => handleAdd('checklist')} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}><CheckBoxIcon /></ListItemIcon>
              <ListItemText primary="Checklist" />
            </ListItem>
            <Divider sx={{ my: 0.5 }} />
            <ListItem disabled sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 36 }}><WorkspacePremiumIcon /></ListItemIcon>
              <ListItemText primary="Premium" />
            </ListItem>
          </List>
        </DialogContent>
      </Dialog>

      {/* ── Three-dot menu ── */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={() => { setMenuAnchor(null); navigate('/import'); }}>Import backup</MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); navigate('/more'); }}>Settings</MenuItem>
      </Menu>

      {/* ── Sort menu ── */}
      <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
        {Object.entries({
          modified: 'Modified time', created: 'Created time', title: 'Title', color: 'Color',
        }).map(([key, label]) => (
          <MenuItem
            key={key}
            selected={sortOrder === key}
            onClick={() => { setSortOrder(key); setSortAnchor(null); }}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>

      {/* ── View menu (desktop grid columns) ── */}
      <Menu anchorEl={viewMenuAnchor} open={Boolean(viewMenuAnchor)} onClose={() => setViewMenuAnchor(null)}>
        {[
          { n: 1, label: '1 column (list)' },
          { n: 2, label: '2 columns' },
          { n: 3, label: '3 columns' },
          { n: 4, label: '4 columns' },
        ].map(({ n, label }) => (
          <MenuItem
            key={n}
            selected={columns === n}
            onClick={() => { setHomeGridColumns(n); setViewMenuAnchor(null); }}
          >
            {label}
          </MenuItem>
        ))}
      </Menu>

      <BottomNav />
    </Box>
  );
}
