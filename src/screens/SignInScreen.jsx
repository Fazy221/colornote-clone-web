import React from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import EditNoteIcon from '@mui/icons-material/EditNote';
import useAuthStore from '../store/authStore';

export default function SignInScreen() {
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle);
  const error = useAuthStore(s => s.error);

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        px: 4,
        textAlign: 'center',
        bgcolor: 'background.default',
      }}
    >
      <EditNoteIcon sx={{ fontSize: 64, color: '#00BCD4' }} />
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 500, mb: 0.5 }}>ColorNote</Typography>
        <Typography variant="body2" color="text.secondary">
          Sign in to sync your notes across devices
        </Typography>
      </Box>

      <Button
        variant="contained"
        size="large"
        startIcon={<GoogleIcon />}
        onClick={signInWithGoogle}
        sx={{ borderRadius: 6, px: 3, py: 1.25, textTransform: 'none', fontSize: '1rem' }}
      >
        Sign in with Google
      </Button>

      {error && (
        <Alert severity="error" sx={{ maxWidth: 320 }}>{error}</Alert>
      )}
    </Box>
  );
}
