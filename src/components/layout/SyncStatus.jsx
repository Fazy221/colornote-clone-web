import React, { useEffect, useState } from 'react';
import {
  Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Tooltip, Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { db } from '../../db/database';
import { useSyncStatus } from '../../sync/syncStatus';
import { describePending } from '../../sync/pendingChanges';

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

const changes = (n) => `${n} change${n === 1 ? '' : 's'}`;

// What sync is doing, at a glance: synced, sending, connecting or offline, with how many changes
// made here are still waiting for the cloud.
export function describeSync({ online, phase, waiting }) {
  if (!online) {
    return { kind: 'offline', label: waiting ? `Offline, ${changes(waiting)} waiting` : 'Offline' };
  }
  if (phase !== 'live') {
    return { kind: 'connecting', label: waiting ? `Connecting, ${changes(waiting)} waiting` : 'Connecting' };
  }
  if (waiting) return { kind: 'sending', label: `Sending ${changes(waiting)}` };
  return { kind: 'synced', label: 'All changes synced' };
}

const ICONS = {
  offline: CloudOffOutlinedIcon,
  connecting: CloudSyncOutlinedIcon,
  sending: CloudUploadOutlinedIcon,
  synced: CloudDoneOutlinedIcon,
};

// The list behind the badge: each note or setting whose changes the cloud has not confirmed yet.
function PendingChangesDialog({ open, onClose, label }) {
  const rows = useLiveQuery(async () => {
    if (!open) return [];
    const entries = await db.outbox.toArray();
    const uuids = entries.filter(e => e.uuid).map(e => e.uuid);
    const notes = uuids.length ? await db.notes.where('uuid').anyOf(uuids).toArray() : [];
    return describePending(entries, new Map(notes.map(n => [n.uuid, n])));
  }, [open], []);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Sync</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{label}</Typography>
        {rows.length === 0 ? (
          <Typography variant="body2">Nothing is waiting.</Typography>
        ) : (
          <List dense disablePadding>
            {rows.map(r => (
              <ListItem key={r.key} disableGutters>
                <ListItemText primary={r.title} secondary={r.what} primaryTypographyProps={{ noWrap: true }} />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export default function SyncStatus() {
  const online = useOnline();
  const phase = useSyncStatus(s => s.phase);
  const waiting = useLiveQuery(() => db.outbox.count(), [], 0);
  const [open, setOpen] = useState(false);
  const { kind, label } = describeSync({ online, phase, waiting });
  const Icon = ICONS[kind];

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
  };

  return (
    <>
      <Tooltip title={label}>
        <Box
          role="button"
          aria-label={label}
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          sx={{
            display: 'flex', alignItems: 'center', px: 0.75, cursor: 'pointer',
            color: kind === 'synced' ? 'text.secondary' : 'text.primary',
          }}
        >
          <Badge badgeContent={waiting} max={99} color="primary" invisible={!waiting}>
            <Icon fontSize="small" />
          </Badge>
        </Box>
      </Tooltip>
      <PendingChangesDialog open={open} onClose={() => setOpen(false)} label={label} />
    </>
  );
}
