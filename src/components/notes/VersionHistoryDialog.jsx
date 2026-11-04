import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { db } from '../../db/database';
import { listVersions } from '../../db/versionLog';
import { pullVersions } from '../../sync/notesSync';
import useNoteStore from '../../store/noteStore';
import useColorStore from '../../store/colorStore';
import useFolderStore from '../../store/folderStore';
import { changeLabels, groupByDay, previousOf, restorePatch, versionPreview } from '../../utils/versions';
import VersionPreviewDialog from './VersionPreviewDialog';
import { formatFullDate } from '../../utils/dateUtils';

// The version history of one note (utils/versions.js): a day per accordion, newest first, with what each
// edit changed and a way back to it. The phone has the same screen (CLAUDE.md, "Both apps").

const dayTitle = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const timeOf = (at) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function VersionHistoryDialog({ open, noteId, noteUuid, onClose, onRestored }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const restoreVersion = useNoteStore(s => s.restoreVersion);
  const [versions, setVersions] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [viewing, setViewing] = useState(null);
  const colorNames = useColorStore(s => s.colorNames);
  const folders = useFolderStore(s => s.folders);

  const reload = async () => {
    setVersions(await listVersions(noteUuid));
    setCurrent((await db.notes.get(noteId)) || null);
  };

  // Shows what this browser has at once, then adds what the phone saved.
  useEffect(() => {
    if (!open || !noteUuid) return undefined;
    let live = true;
    setLoading(true); setOffline(false); setExpanded(null); setViewing(null);
    (async () => {
      await reload();
      if (!live) return;
      const reached = await pullVersions(noteUuid);
      if (!live) return;
      if (!reached) setOffline(true);
      await reload();
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [open, noteUuid, noteId]);

  const days = useMemo(() => groupByDay(versions), [versions]);
  const openDay = expanded ?? days[0]?.day;
  const isCurrent = (v) => current && Object.keys(restorePatch(v, current)).length === 0;

  const doRestore = async () => {
    const v = confirm;
    setConfirm(null);
    if (await restoreVersion(noteId, v)) { await reload(); onRestored?.(); onClose(); }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby="version-history-title">
        <DialogTitle id="version-history-title" sx={{ display: 'flex', alignItems: 'center', fontSize: '1rem', fontWeight: 500 }}>
          <Box sx={{ flex: 1 }}>Version history</Box>
          <IconButton aria-label="Close" onClick={onClose} edge="end"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {loading && !versions.length ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={28} /></Box>
          ) : !versions.length ? (
            <Typography sx={{ p: 3 }} color="text.secondary">
              No earlier versions yet. Every edit from now on is kept here, grouped by day.
            </Typography>
          ) : days.map(({ day, versions: list }) => (
            <Accordion
              key={day} disableGutters square elevation={0} expanded={openDay === day}
              onChange={(_, isOpen) => setExpanded(isOpen ? day : '')}
              sx={{ '&:before': { display: 'none' }, borderBottom: 1, borderColor: 'divider', bgcolor: 'transparent' }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label={dayTitle(day)}>
                <Box sx={{ flex: 1, fontWeight: 500 }}>{dayTitle(day)}</Box>
                <Chip size="small" label={`${list.length} ${list.length === 1 ? 'edit' : 'edits'}`} sx={{ mr: 1 }} />
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, px: 2 }}>
                {list.map(v => {
                  const preview = versionPreview(v);
                  const locked = v.encrypted === 1 || v.encrypted === true;
                  return (
                    <Box key={v.id} sx={{ py: 1, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, mr: 0.5 }}>{timeOf(v.at)}</Typography>
                          {changeLabels(v).map(l => <Chip key={l} size="small" variant="outlined" label={l} />)}
                          <Typography variant="caption" color="text.secondary">
                            {v.device === 'android' ? 'phone' : 'desktop'}
                          </Typography>
                        </Box>
                        {(v.title || '').trim() && (
                          <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 500, wordBreak: 'break-word' }}>{v.title}</Typography>
                        )}
                        {locked ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>Locked note, content not shown</Typography>
                        ) : preview && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: 'break-word' }}>{preview}</Typography>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                          Modified date {formatFullDate(v.modifiedAt)}
                        </Typography>
                      </Box>
                      <Button size="small" onClick={() => setViewing(v)} aria-label={`View ${timeOf(v.at)} on ${dayTitle(day)}`}>View</Button>
                      {isCurrent(v)
                        ? <Chip size="small" color="primary" label="Current" />
                        : <Button size="small" onClick={() => setConfirm(v)}>Restore</Button>}
                    </Box>
                  );
                })}
              </AccordionDetails>
            </Accordion>
          ))}
          {offline && versions.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>
              Offline: showing what this device has. Edits from the phone appear when you are back online.
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <VersionPreviewDialog
        open={Boolean(viewing)}
        version={viewing}
        previous={viewing ? previousOf(versions, viewing) : null}
        current={current}
        isCurrent={Boolean(viewing && isCurrent(viewing))}
        colorNames={colorNames}
        folders={folders}
        onClose={() => setViewing(null)}
        onRestore={(v) => { setViewing(null); setConfirm(v); }}
      />

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>Restore this version?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The note goes back to how it was on {confirm && `${dayTitle(groupByDay([confirm])[0].day)} at ${timeOf(confirm.at)}`}.
            What it says now stays in the history, so you can come back to it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button onClick={doRestore} variant="contained">Restore</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
