import React from 'react';
import { Box, Typography, Button } from '@mui/material';

// Class component because React error boundaries can't be written as hooks
// (getDerivedStateFromError / componentDidCatch have no hook equivalent).
//
// Scoped narrowly around the notes list/grid rather than the whole app: if
// something in that area throws during render, only that area shows a
// fallback — the app bar, bottom nav, and rest of the page stay usable, and
// the actual error message is shown on screen instead of the page just
// going blank with nothing to go on.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Still surface it in the console for anyone with devtools open.
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // If the caller passes resetKeys (e.g. [columns]) and one of them
    // changed while we're showing an error, clear it automatically — no
    // remount involved, this only swaps what render() returns.
    if (this.state.error && prevProps.resetKeys && this.props.resetKeys) {
      const changed = prevProps.resetKeys.length !== this.props.resetKeys.length
        || prevProps.resetKeys.some((v, i) => v !== this.props.resetKeys[i]);
      if (changed) this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <Box sx={{ textAlign: 'center', mt: 6, px: 3, color: 'text.secondary' }}>
          <Typography sx={{ fontWeight: 500, mb: 1 }}>
            Something went wrong rendering this view.
          </Typography>
          <Typography
            variant="caption"
            component="pre"
            sx={{
              display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              bgcolor: 'action.hover', p: 1.5, borderRadius: 1, textAlign: 'left',
              mb: 2, fontSize: '0.75rem',
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}
