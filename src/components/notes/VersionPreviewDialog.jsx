import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ToggleButton,
  ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { diffVersions } from '../../utils/versionDiff';
import { getColor } from '../../utils/colors';
import { formatFullDate } from '../../utils/dateUtils';

// A read-only look at one old version of a note, with what changed marked: added text underlined on green,
// removed text struck through on red. Nothing here can be edited. The phone has the same screen
// (ui/VersionPreview.kt): change one, change the other (CLAUDE.md, "Both apps").
//
// Two ways to compare, the same on both apps:
//   'previous': this version against the one saved just before it ("what this edit changed")
//   'current':  this version against the note as it is now ("what Restore would change")

export const MODES = { previous: 'previous', current: 'current' };

const when = (at) => {
  const d = new Date(at);
  return `${d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

function Segments({ parts }) {
  return parts.map((p, i) => {
    if (p.kind === 'add') return <ins key={i}>{p.text}</ins>;
    if (p.kind === 'del') return <del key={i}>{p.text}</del>;
    return <span key={i}>{p.text}</span>;
  });
}

const tick = (checked) => (checked ? '☑' : '☐');

function ItemRow({ row }) {
  const text = `${tick(row.checked)} ${row.text}`;
  return (
    <Box component="li" sx={{ listStyle: 'none', py: 0.25, wordBreak: 'break-word' }}>
      {row.status === 'added' && <ins>{text}</ins>}
      {row.status === 'removed' && <del>{text}</del>}
      {row.status === 'toggled' && (
        <>
          <span>{text}</span>
          <Chip size="small" variant="outlined" sx={{ ml: 1, height: 20 }} label={row.checked ? 'now ticked' : 'now unticked'} />
        </>
      )}
      {row.status === 'same' && <span>{text}</span>}
    </Box>
  );
}

export default function VersionPreviewDialog({
  open, version, previous, current, isCurrent, colorNames, folders, onClose, onRestore,
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [mode, setMode] = useState(MODES.previous);

  // Starts on "what this edit changed", or on the current note when this is the first version.
  useEffect(() => {
    if (open) setMode(previous ? MODES.previous : MODES.current);
  }, [open, version?.id]);

  const names = useMemo(() => ({
    color: (i) => colorNames?.[i] || getColor(i).name,
    folder: (id) => (!id ? 'No folder' : folders?.find(f => f.id === id)?.name || 'Deleted folder'),
    date: (ms) => formatFullDate(ms),
  }), [colorNames, folders]);

  const base = mode === MODES.previous ? previous : current;
  const diff = useMemo(
    () => (version ? diffVersions(isCurrent && mode === MODES.current ? null : base, version, names) : null),
    [version, base, names, isCurrent, mode],
  );
  if (!version || !diff) return null;

  const stripe = getColor(version.colorIndex, dark).border;
  const addBg = dark ? 'rgba(102,187,106,0.28)' : '#C8E6C9';
  const addFg = dark ? '#A5D6A7' : '#1B5E20';
  const delBg = dark ? 'rgba(239,83,80,0.28)' : '#FFCDD2';
  const delFg = dark ? '#EF9A9A' : '#B71C1C';

  const compareNote = (() => {
    if (!diff.compared) return previous ? 'This is the note as it is now.' : 'This is the first saved version, so there is nothing before it to compare with.';
    if (diff.content === 'locked') return 'Locked note: the content is never shown here. Title, colour, folder and date changes still are.';
    if (diff.content === 'was-locked') return 'The version before it was locked, so its content is not compared.';
    return '';
  })();

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="version-preview-title">
      <DialogTitle id="version-preview-title" sx={{ display: 'flex', alignItems: 'center', fontSize: '1rem', fontWeight: 500 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box>{when(version.at)}</Box>
          <Chip size="small" label="Read-only" sx={{ mt: 0.5 }} />
        </Box>
        <IconButton aria-label="Close" onClick={onClose} edge="end"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 2 }}>
        <ToggleButtonGroup
          exclusive fullWidth size="small" value={mode} aria-label="Compare with"
          onChange={(_, next) => next && setMode(next)} sx={{ mb: 1.5 }}
        >
          <ToggleButton value={MODES.previous} disabled={!previous}>What this edit changed</ToggleButton>
          <ToggleButton value={MODES.current} disabled={isCurrent}>What Restore would change</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Key</Typography>
          <Box component="span" sx={{ px: 0.5, bgcolor: addBg, color: addFg, textDecoration: 'underline' }}>Added</Box>
          <Box component="span" sx={{ px: 0.5, bgcolor: delBg, color: delFg, textDecoration: 'line-through' }}>Removed</Box>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary" role="status">
            {diff.compared ? (diff.changes ? `${diff.changes} ${diff.changes === 1 ? 'change' : 'changes'}` : 'No differences') : ''}
          </Typography>
        </Box>

        {compareNote && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{compareNote}</Typography>}

        <Box
          sx={{
            borderLeft: 6, borderColor: stripe, pl: 1.5, py: 0.5,
            '& ins': { bgcolor: addBg, color: addFg, textDecoration: 'underline' },
            '& del': { bgcolor: delBg, color: delFg, textDecoration: 'line-through' },
          }}
        >
          {(diff.title.length > 0) && (
            <Typography variant="h6" component="h3" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
              <Segments parts={diff.title} />
            </Typography>
          )}
          {diff.content === 'locked' && (
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>Locked note, content not shown</Typography>
          )}
          {diff.body && (
            <Typography component="div" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
              <Segments parts={diff.body} />
            </Typography>
          )}
          {diff.items && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0 }}>
              {diff.items.map((row, i) => <ItemRow key={i} row={row} />)}
            </Box>
          )}
        </Box>

        {diff.meta.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="overline" color="text.secondary">Other changes</Typography>
            {diff.meta.map(m => (
              <Typography key={m.label} variant="body2" sx={{ mt: 0.25 }}>
                <strong>{m.label}</strong>
                {m.from === null
                  ? ' changed'
                  : <>: <Box component="del" sx={{ px: 0.5, bgcolor: delBg, color: delFg }}>{m.from}</Box> → <Box component="ins" sx={{ px: 0.5, bgcolor: addBg, color: addFg }}>{m.to}</Box></>}
              </Typography>
            ))}
          </Box>
        )}
        {!diff.meta.length && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Modified date {formatFullDate(version.modifiedAt)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {isCurrent
          ? <Chip color="primary" label="Current" sx={{ mr: 1 }} />
          : <Button variant="contained" onClick={() => onRestore(version)}>Restore this version</Button>}
      </DialogActions>
    </Dialog>
  );
}
