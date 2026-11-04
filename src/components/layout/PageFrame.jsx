import React from 'react';
import { Box } from '@mui/material';
import useUIStore from '../../store/uiStore';

export const PAGE_MAX_WIDTH = 880;

// Holds every signed-in screen. With the fixed page width, a window wider than 880px shows the app
// in a centred column with plain margins on both sides.
//
// The column's transform makes it the frame for its position:fixed children, so the bottom nav, the
// add button and the selection bar sit inside the column instead of at the window's edges. That is
// safe because every screen is exactly one window tall and scrolls inside itself, so the column
// never scrolls. Dialogs and menus open over the whole window, as before.
//
// Both modes render the same two boxes, so switching in Settings doesn't remount the screen.
export default function PageFrame({ children }) {
  const fixed = useUIStore(s => s.pageWidth) !== 'fluid';
  return (
    <Box
      data-testid="page-frame"
      data-width={fixed ? 'fixed' : 'fluid'}
      sx={fixed ? {
        minHeight: '100vh',
        bgcolor: (t) => (t.palette.mode === 'dark' ? '#0F0F0F' : '#E2E2E2'),
      } : undefined}
    >
      <Box
        sx={fixed ? {
          maxWidth: PAGE_MAX_WIDTH,
          mx: 'auto',
          minHeight: '100vh',
          position: 'relative',
          transform: 'translateZ(0)',
          bgcolor: 'background.default',
          boxShadow: (t) => (t.palette.mode === 'dark'
            ? '0 0 0 1px rgba(255,255,255,0.06)'
            : '0 0 0 1px rgba(0,0,0,0.06)'),
        } : undefined}
      >
        {children}
      </Box>
    </Box>
  );
}
