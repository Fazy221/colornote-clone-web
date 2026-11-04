import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, AppBar, Box, Button, CircularProgress, IconButton, List, ListItemButton, ListItemText,
  Toolbar, Typography, useMediaQuery,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import useNoteStore from '../store/noteStore';
import { formatFullDate } from '../utils/dateUtils';
import { diffLines, noteText, pairConflicts, sideBySide, stripPrefix } from '../utils/conflicts';

// Notes whose text was edited on two devices before they synced. Each "[conflict]" copy holds the
// version that lost; here it is compared with its note, and the owner picks what to keep.

const SHADE = {
  removed: 'rgba(244, 67, 54, 0.16)',
  added: 'rgba(76, 175, 80, 0.2)',
};

const edited = (n) => (n?.modifiedAt ? `edited ${formatFullDate(n.modifiedAt)}` : '');
const shownTitle = (t) => t || '(no title)';

function Line({ line, mark }) {
  return (
    <Box sx={{
      px: 1, py: 0.25, minHeight: 24, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      bgcolor: line ? SHADE[line.kind] : 'action.hover', display: 'flex', gap: 1,
    }}>
      {mark && <Box component="span" sx={{ color: 'text.secondary', width: 10, flexShrink: 0 }}>{mark}</Box>}
      <Typography variant="body2" component="span">{line ? line.text || ' ' : ' '}</Typography>
    </Box>
  );
}

// Two columns on a wide screen; on a phone one column, with - and + marking each side's lines.
function Differences({ a, b, wide }) {
  const diff = useMemo(() => diffLines(a, b), [a, b]);
  if (!diff.some(l => l.kind !== 'same')) {
    return <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>The text is the same in both.</Typography>;
  }
  if (!wide) {
    return (
      <Box>
        {diff.map((line, i) => (
          <Line key={i} line={line} mark={line.kind === 'removed' ? '-' : line.kind === 'added' ? '+' : ' '} />
        ))}
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1, rowGap: '1px' }}>
      {sideBySide(diff).map((row, i) => (
        <React.Fragment key={i}>
          <Line line={row.left} />
          <Line line={row.right} />
        </React.Fragment>
      ))}
    </Box>
  );
}

function Detail({ pair, onDone }) {
  const navigate = useNavigate();
  const resolveConflict = useNoteStore(s => s.resolveConflict);
  const wide = useMediaQuery('(min-width:900px)');
  const [busy, setBusy] = useState(false);
  const { copy, original, matchedBy } = pair;

  const choose = async (choice) => {
    setBusy(true);
    try {
      await resolveConflict(original, copy, choice);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const copyText = noteText(copy);
  const originalText = original ? noteText(original) : null;
  const locked = copyText === null || (original && originalText === null);
  const noteTitle = original ? shownTitle(original.title) : null;
  const copyTitle = shownTitle(stripPrefix(copy.title));

  const heading = (label, n) => (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="caption" color="text.secondary">{edited(n)}</Typography>
    </Box>
  );

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: 'auto' }}>
      {!original && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The note this copy was made from can't be found. It may have been deleted or renamed.
        </Alert>
      )}
      {matchedBy === 'guess' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Several notes have this title, so this is the closest match. Open it to check it's the right note.
        </Alert>
      )}

      {original && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          {heading('The note', original)}
          {wide && heading('The [conflict] copy', copy)}
        </Box>
      )}
      {original && !wide && (
        <Box sx={{ mb: 1 }}>
          {heading('The [conflict] copy', copy)}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            - only in the note, + only in the copy
          </Typography>
        </Box>
      )}

      {original && noteTitle !== copyTitle && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="overline" color="text.secondary">Title</Typography>
          <Differences a={noteTitle} b={copyTitle} wide={wide} />
        </Box>
      )}

      <Box sx={{ mb: 2 }}>
        {original && <Typography variant="overline" color="text.secondary">Text</Typography>}
        {locked ? (
          <Alert icon={<LockOutlinedIcon />} severity="info">
            Locked notes aren't shown here. Open each one to compare them.
          </Alert>
        ) : original ? (
          <Differences a={originalText} b={copyText} wide={wide} />
        ) : (
          <Box sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <Typography variant="body2">{copyText || '(empty)'}</Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        {original && <Button size="small" onClick={() => navigate(`/note/${original.id}`)}>Open the note</Button>}
        <Button size="small" onClick={() => navigate(`/note/${copy.id}`)}>Open the copy</Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', flexDirection: wide ? 'row' : 'column' }}>
        {original ? (
          <>
            <Button variant="contained" disabled={busy} onClick={() => choose('note')}>Keep the note's version</Button>
            <Button variant="contained" disabled={busy} onClick={() => choose('copy')}>Keep the copy's version</Button>
            <Button variant="outlined" disabled={busy} onClick={() => choose('both')}>Keep both</Button>
          </>
        ) : (
          <>
            <Button variant="contained" disabled={busy} onClick={() => choose('copy')}>Keep it as a note</Button>
            <Button variant="outlined" disabled={busy} onClick={() => choose('note')}>Move it to Trash</Button>
          </>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {original
          ? "The version you don't keep goes to Trash, where you can still restore it. Keep both turns the copy into an ordinary note."
          : 'Trash keeps it until you empty it.'}
      </Typography>
    </Box>
  );
}

export default function ConflictsScreen() {
  const navigate = useNavigate();
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const pairs = useMemo(() => (notes ? pairConflicts(notes) : null), [notes]);
  const [selected, setSelected] = useState(null);
  const pair = selected && pairs?.find(p => p.copy.uuid === selected);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton onClick={() => (pair ? setSelected(null) : navigate(-1))} edge="start" aria-label="Back">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ ml: 1, fontWeight: 500 }}>
            {pair ? shownTitle(stripPrefix(pair.copy.title)) : 'Conflicts'}
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!pairs ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={32} sx={{ color: '#00BCD4' }} />
          </Box>
        ) : pair ? (
          <Detail key={pair.copy.uuid} pair={pair} onDone={() => setSelected(null)} />
        ) : pairs.length === 0 ? (
          <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary', px: 2 }}>
            <Typography>No conflicts</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              When a note's text is changed on two devices before they sync, both versions show up here.
            </Typography>
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
              These notes were changed on two devices before they synced. Each one has a [conflict] copy
              holding the other version. Pick one to compare them.
            </Typography>
            <List>
              {pairs.map(p => (
                <ListItemButton key={p.copy.uuid} onClick={() => setSelected(p.copy.uuid)}>
                  <ListItemText
                    primary={shownTitle(stripPrefix(p.copy.title))}
                    secondary={p.original
                      ? `Note ${edited(p.original)} · copy ${edited(p.copy)}`
                      : `Copy ${edited(p.copy)} · note not found`}
                  />
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </Box>
    </Box>
  );
}
