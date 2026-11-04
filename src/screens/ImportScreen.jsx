import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, IconButton, Typography,
  Button, Paper, LinearProgress, Alert, Chip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import useNoteStore from '../store/noteStore';

// What the import did to notes already here (see importPlan.js), shown when not zero.
const RESULT_CHIPS = [
  ['replaced', 'took the newer text from the file', 'info'],
  ['keptOurs', 'kept the newer text here', 'default'],
  ['conflictCopies', '[conflict] copies of the other text', 'warning'],
  ['detailsTaken', 'took newer details from the file', 'info'],
  ['detailsKept', 'kept newer details here', 'default'],
  ['stateFixed', 'archived or trashed as in the file', 'default'],
  ['stateKept', 'stayed archived or trashed here', 'default'],
  ['unchanged', 'already the same', 'default'],
];

export default function ImportScreen() {
  const navigate = useNavigate();
  const { importFromJson } = useNoteStore();
  const fileRef = useRef();

  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [dragging, setDragging] = useState(false);

  const processFile = async (file) => {
    if (!file || !file.name.endsWith('.json')) {
      setErrorMsg('Please select a .json file exported by the parse-colornote script.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.notes || !Array.isArray(data.notes)) {
        throw new Error('Invalid format — expected { notes: [...] }');
      }
      const res = await importFromJson(data);
      setResult(res);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message || 'Failed to parse file.');
      setStatus('error');
    }
  };

  const onFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <IconButton onClick={() => navigate(-1)} edge="start">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ ml: 1, fontWeight: 500 }}>Import backup</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* Instructions */}
        <Paper elevation={0} sx={{ p: 2, bgcolor: '#E3F2FD', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>How to import your notes</Typography>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            1. Run <code>node parse-colornote.js output_raw.txt notes.json</code> on your PC{'\n'}
            2. Copy <code>notes.json</code> to this device{'\n'}
            3. Select it below
          </Typography>
        </Paper>

        {/* Drop zone */}
        <Paper
          elevation={0}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            border: `2px dashed ${dragging ? '#00BCD4' : '#BDBDBD'}`,
            borderRadius: 3,
            cursor: 'pointer',
            bgcolor: dragging ? 'rgba(0,188,212,0.05)' : 'transparent',
            transition: 'all 0.2s',
            '&:active': { bgcolor: 'rgba(0,188,212,0.08)' },
          }}
        >
          {status === 'done' ? (
            <>
              <CheckCircleIcon sx={{ fontSize: 64, color: '#4CAF50' }} />
              <Typography variant="h6" sx={{ color: '#4CAF50', fontWeight: 500 }}>Import complete!</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Chip label={`${result?.added ?? 0} added`} color="success" size="small" />
                {RESULT_CHIPS.filter(([key]) => result?.[key] > 0).map(([key, label, color]) => (
                  <Chip key={key} label={`${result[key]} ${label}`} color={color} size="small" />
                ))}
              </Box>
            </>
          ) : status === 'loading' ? (
            <>
              <UploadFileIcon sx={{ fontSize: 48, color: '#00BCD4' }} />
              <Typography color="text.secondary">Importing…</Typography>
              <LinearProgress sx={{ width: '60%', borderRadius: 1 }} />
            </>
          ) : (
            <>
              <UploadFileIcon sx={{ fontSize: 64, color: '#BDBDBD' }} />
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {dragging ? 'Drop notes.json here' : 'Tap to select notes.json'}
              </Typography>
              <Typography variant="body2" color="text.secondary">or drag & drop</Typography>
            </>
          )}
        </Paper>

        {status === 'error' && (
          <Alert severity="error" onClose={() => setStatus('idle')}>{errorMsg}</Alert>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={onFileInput}
        />

        {status === 'done' && (
          <Button
            variant="contained"
            fullWidth
            sx={{ bgcolor: '#00BCD4', '&:hover': { bgcolor: '#0097A7' }, py: 1.5, borderRadius: 2 }}
            onClick={() => navigate('/')}
          >
            View my notes
          </Button>
        )}
      </Box>
    </Box>
  );
}
