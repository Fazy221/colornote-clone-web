import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert, Box, CircularProgress, Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { verifyMasterPassword, sha256Hex } from '../../utils/crypto';
import { getSetting, setSetting } from '../../db/database';

// Note content itself decrypts with a fixed, hardcoded key (see crypto.js) —
// it never actually depends on the password typed here. This dialog exists as
// a privacy gate in front of that content, and verifies what's typed in one
// of two ways:
//
//  1. Real verification — if the ColorNote backup included the
//     "name_master_password" system note, we recompute BACKUP_SECRET_KEY from
//     the candidate password and compare it against the stored value
//     (crypto.js verifyMasterPassword). This confirms the actual ColorNote
//     master password.
//  2. Local fallback — if that system note wasn't captured, there's nothing
//     to verify against, so the first password entered sets a local gate
//     (hashed, stored in settings) and future entries are checked against it.
export default function MasterPasswordDialog({ open, onSuccess, onClose }) {
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [mode, setMode]           = useState('checking'); // 'checking' | 'verify' | 'verify-local' | 'setup'
  const verifierRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setError('');
    setMode('checking');
    (async () => {
      const verifier = await getSetting('masterPasswordVerifier', null);
      if (verifier) {
        verifierRef.current = verifier;
        setMode('verify');
      } else {
        const localHash = await getSetting('appLockHash', null);
        verifierRef.current = localHash;
        setMode(localHash ? 'verify-local' : 'setup');
      }
      setTimeout(() => inputRef.current?.focus(), 120);
    })();
  }, [open]);

  const handleSubmit = async () => {
    if (!password || loading || mode === 'checking') return;
    setLoading(true);
    setError('');
    try {
      if (mode === 'verify') {
        const ok = await verifyMasterPassword(password, verifierRef.current);
        if (!ok) { setError('Wrong password — try again.'); return; }
      } else if (mode === 'verify-local') {
        const hash = await sha256Hex(password);
        if (hash !== verifierRef.current) { setError('Wrong password — try again.'); return; }
      } else if (mode === 'setup') {
        const hash = await sha256Hex(password);
        await setSetting('appLockHash', hash);
      }
      onSuccess(password);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <LockIcon fontSize="small" /> {mode === 'setup' ? 'Set a lock password' : 'Enter master password'}
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        {mode === 'setup' && (
          <Typography variant="body2" sx={{ mb: 1.5, color: 'text.secondary' }}>
            No verifier note was found in this import, so this sets a local passphrase
            for locked notes on this device. It won't necessarily match your original
            ColorNote master password.
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 1.5, py: 0.5 }}>{error}</Alert>
        )}
        <TextField
          inputRef={inputRef}
          fullWidth
          // A plain text field drawn as dots: a real password field makes the browser offer to save it.
          type="text"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          variant="standard"
          disabled={loading || mode === 'checking'}
          autoComplete="off"
          inputProps={{ autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false, 'data-lpignore': 'true', 'data-1p-ignore': 'true' }}
          sx={{ '& input': { fontSize: '1.1rem', letterSpacing: 4, WebkitTextSecurity: 'disc' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5 }}>
        <Button onClick={onClose} disabled={loading} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={loading || !password || mode === 'checking'}
          sx={{ color: '#00BCD4', fontWeight: 600 }}
        >
          {loading ? <CircularProgress size={18} sx={{ color: '#00BCD4' }} /> : 'OK'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
