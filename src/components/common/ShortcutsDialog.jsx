import React from 'react';
import { Dialog, DialogTitle, DialogContent, Box, Typography } from '@mui/material';
import useUIStore from '../../store/uiStore';
import { shortcutGroups } from '../../utils/shortcuts';

// The keyboard-shortcut cheat sheet, drawn from the same table the shortcuts are bound from.
// Opened by "?" anywhere, or from the More screen.
export default function ShortcutsDialog() {
  const open = useUIStore(s => s.shortcutsOpen);
  const setOpen = useUIStore(s => s.setShortcutsOpen);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs" scroll="paper">
      <DialogTitle sx={{ fontWeight: 500 }}>Keyboard shortcuts</DialogTitle>
      <DialogContent dividers>
        {shortcutGroups().map(group => (
          <Box key={group.name} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
            <Typography variant="overline" color="text.secondary">{group.name}</Typography>
            {group.rows.map(row => (
              <Box key={row.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
                <Typography variant="body2">{row.desc}</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', color: 'text.secondary' }}>
                  {row.label}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
