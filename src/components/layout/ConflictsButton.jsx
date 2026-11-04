import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, IconButton, Tooltip } from '@mui/material';
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { isConflictCopy } from '../../utils/conflicts';

// Shown only while there are "[conflict]" copies to review, with how many.
export default function ConflictsButton() {
  const navigate = useNavigate();
  const count = useLiveQuery(
    () => db.notes.filter(n => n.state !== 'trash' && isConflictCopy(n)).count(),
    [],
    0,
  );
  if (!count) return null;
  const label = `${count} conflict${count === 1 ? '' : 's'} to review`;
  return (
    <Tooltip title={label}>
      <IconButton size="small" onClick={() => navigate('/conflicts')} aria-label={label}>
        <Badge badgeContent={count} color="error" max={99}>
          <DifferenceOutlinedIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
