import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, Typography, IconButton, Menu, MenuItem, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Button, TextField, useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import FolderGlyph from '../components/common/FolderGlyph';
import BottomNav from '../components/layout/BottomNav';
import { NOTE_COLORS, getColor } from '../utils/colors';
import { FOLDER_SORTS, FOLDER_ICON_COUNT, sortFolders, folderIconIndex } from '../utils/folders';
import useFolderStore from '../store/folderStore';
import useNoteStore from '../store/noteStore';

// The Folders tab: every folder as a coloured row with its icon, its name and
// how many notes it holds. A tap opens the notes in it, the icon changes its
// colour and icon, and the row's menu does the rest. Mirrors the Android tab.
export default function FoldersScreen() {
  const navigate = useNavigate();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const { folders, counts, sort, loaded } = useFolderStore();

  const [sortAnchor, setSortAnchor] = useState(null);
  const [rowMenu, setRowMenu] = useState(null); // { anchor, folder }
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [styling, setStyling] = useState(null);
  const [applying, setApplying] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Show what this device has at once, then what the phone has changed since.
  useEffect(() => {
    const store = useFolderStore.getState();
    store.load().then(() => store.load({ pull: true }));
    store.loadCounts();
    const onFocus = () => { store.load({ pull: true }); store.loadCounts(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const sorted = useMemo(() => sortFolders(folders, counts, sort), [folders, counts, sort]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 500 }}>Folder</Typography>
          <IconButton aria-label="Add folder" onClick={() => setAdding(true)}><AddIcon /></IconButton>
        </Toolbar>
        <Box
          sx={{ px: 2, py: 0.5, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', cursor: 'pointer' }}
          onClick={e => setSortAnchor(e.currentTarget)}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.25 }}>
            Sort {FOLDER_SORTS[sort]} <ArrowDropDownIcon sx={{ fontSize: 16 }} />
          </Typography>
        </Box>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: '72px' }}>
        {loaded && sorted.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
            <Typography>No folders</Typography>
          </Box>
        ) : sorted.map(folder => {
          const tinted = folder.color !== 0;
          const swatch = getColor(folder.color);
          return (
            <Box
              key={folder.id}
              data-testid="folder-row"
              onClick={() => navigate(`/folders/${folder.id}`)}
              sx={{
                display: 'flex', alignItems: 'center', minHeight: 64, cursor: 'pointer',
                bgcolor: !tinted ? 'transparent' : dark ? `${swatch.border}59` : swatch.bg,
                borderBottom: 1, borderColor: 'divider',
              }}
            >
              <IconButton
                aria-label="Folder color and icon"
                onClick={e => { e.stopPropagation(); setStyling(folder); }}
                sx={{ width: 60, height: 64, borderRadius: 0, color: tinted && !dark ? swatch.border : 'text.secondary' }}
              >
                <FolderGlyph index={folder.icon} sx={{ fontSize: 30 }} />
              </IconButton>
              <Typography noWrap sx={{ flex: 1, pr: 1, fontSize: '1.1rem' }}>{folder.name}</Typography>
              <Box
                sx={{
                  px: 1.1, py: 0.2, borderRadius: '12px', fontSize: '0.875rem', lineHeight: 1.5,
                  bgcolor: tinted ? swatch.border : 'action.selected',
                  color: tinted ? '#fff' : 'text.primary',
                }}
              >
                {counts[folder.id] || 0}
              </Box>
              <IconButton
                aria-label="Folder options"
                onClick={e => { e.stopPropagation(); setRowMenu({ anchor: e.currentTarget, folder }); }}
                sx={{ width: 48, height: 64, borderRadius: 0 }}
              >
                <MoreVertIcon />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
        {Object.entries(FOLDER_SORTS).map(([key, label]) => (
          <MenuItem key={key} selected={sort === key} onClick={() => { useFolderStore.getState().setSort(key); setSortAnchor(null); }}>
            {label}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={rowMenu?.anchor} open={Boolean(rowMenu)} onClose={() => setRowMenu(null)}>
        <MenuItem onClick={() => { setRenaming(rowMenu.folder); setRowMenu(null); }}>Rename</MenuItem>
        <MenuItem onClick={() => { setStyling(rowMenu.folder); setRowMenu(null); }}>Color and icon</MenuItem>
        {rowMenu?.folder.color !== 0 && (
          <MenuItem onClick={() => { setApplying(rowMenu.folder); setRowMenu(null); }}>Apply folder color</MenuItem>
        )}
        <MenuItem onClick={() => { setDeleting(rowMenu.folder); setRowMenu(null); }}>Delete</MenuItem>
      </Menu>

      <NameDialog
        open={adding}
        title="New folder"
        initial=""
        onClose={() => setAdding(false)}
        onSave={async name => { await useFolderStore.getState().addFolder(name); }}
      />
      <NameDialog
        open={Boolean(renaming)}
        title="Rename"
        initial={renaming?.name || ''}
        onClose={() => setRenaming(null)}
        onSave={name => useFolderStore.getState().renameFolder(renaming.id, name)}
      />
      {styling && (
        <StyleDialog
          folder={styling}
          count={counts[styling.id] || 0}
          onClose={() => setStyling(null)}
        />
      )}

      <Dialog open={Boolean(applying)} onClose={() => setApplying(null)}>
        <DialogTitle>Apply color</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Give the notes in this folder the folder's color? You can still change any note's color afterwards.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplying(null)}>Cancel</Button>
          <Button onClick={() => { useNoteStore.getState().applyColorToFolder(applying.id, applying.color); setApplying(null); }}>OK</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete the folder? Its notes stay; they just belong to no folder.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color="error" onClick={() => { useFolderStore.getState().deleteFolder(deleting.id); setDeleting(null); }}>Delete</Button>
        </DialogActions>
      </Dialog>

      <BottomNav />
    </Box>
  );
}

function NameDialog({ open, title, initial, onClose, onSave }) {
  const [name, setName] = useState(initial);
  useEffect(() => { if (open) setName(initial); }, [open, initial]);
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onSave(trimmed);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 500, fontSize: '1rem' }}>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth variant="standard" label="Folder" value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!name.trim()}>OK</Button>
      </DialogActions>
    </Dialog>
  );
}

// Picks the folder's colour and icon. "Apply color" colours the notes already in it, once.
function StyleDialog({ folder, count, onClose }) {
  const [color, setColor] = useState(folder.color);
  const [icon, setIcon] = useState(folderIconIndex(folder.icon));
  const save = async (applyToNotes) => {
    await useFolderStore.getState().setFolderStyle(folder.id, color, icon);
    if (applyToNotes) await useNoteStore.getState().applyColorToFolder(folder.id, color);
    onClose();
  };
  const tint = color ? getColor(color).border : '#444444';
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 500, fontSize: '1rem' }}>{folder.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0.75, mb: 1.5 }}>
          {Object.keys(NOTE_COLORS).map(key => {
            const index = Number(key);
            return (
              <Box
                key={index}
                role="button"
                aria-label={index === 0 ? 'No color' : `Color ${index}`}
                onClick={() => setColor(index)}
                sx={{
                  height: 40, cursor: 'pointer', bgcolor: NOTE_COLORS[index].bg,
                  border: index === color ? '3px solid #333' : '1px solid #ccc',
                }}
              />
            );
          })}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0.75 }}>
          {Array.from({ length: FOLDER_ICON_COUNT }, (_, index) => (
            <IconButton
              key={index}
              aria-label={`Icon ${index + 1}`}
              onClick={() => setIcon(index)}
              sx={{ height: 44, borderRadius: 1, bgcolor: index === icon ? 'action.selected' : 'transparent', color: tint }}
            >
              <FolderGlyph index={index} />
            </IconButton>
          ))}
        </Box>
        {color !== 0 && count > 0 && (
          <Button sx={{ mt: 1.5 }} onClick={() => save(true)}>
            Apply color to {count} {count === 1 ? 'note' : 'notes'}
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => save(false)}>OK</Button>
      </DialogActions>
    </Dialog>
  );
}
