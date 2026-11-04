import React, { useEffect, useState } from 'react';
import { Badge, Box, Tooltip } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { db } from '../../db/database';
import { useSyncStatus } from '../../sync/syncStatus';

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

export default function SyncStatus() {
  const online = useOnline();
  const phase = useSyncStatus(s => s.phase);
  const waiting = useLiveQuery(() => db.outbox.count(), [], 0);
  const { kind, label } = describeSync({ online, phase, waiting });
  const Icon = ICONS[kind];

  return (
    <Tooltip title={label}>
      <Box
        role="status"
        aria-label={label}
        tabIndex={0}
        sx={{ display: 'flex', alignItems: 'center', px: 0.75, color: kind === 'synced' ? 'text.secondary' : 'text.primary' }}
      >
        <Badge badgeContent={waiting} max={99} color="primary" invisible={!waiting}>
          <Icon fontSize="small" />
        </Badge>
      </Box>
    </Tooltip>
  );
}
