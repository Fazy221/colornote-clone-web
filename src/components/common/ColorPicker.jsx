import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import { NOTE_COLORS } from '../../utils/colors';
import useColorStore from '../../store/colorStore';

export default function ColorPicker({ open, currentColor, onSelect, onClose }) {
  const colorNames = useColorStore(s => s.colorNames);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5, fontWeight: 500, fontSize: '1rem' }}>Color</DialogTitle>
      <DialogContent sx={{ pt: 1, px: 1.5, pb: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
          {colorNames.map((label, index) => {
            const color = NOTE_COLORS[index];
            const isSelected = currentColor === index;
            const isNone = index === 0;

            return (
              <Box
                key={index}
                onClick={() => { onSelect(index); onClose(); }}
                sx={{
                  position: 'relative',
                  backgroundColor: color.bg,
                  border: isSelected ? '2.5px solid' : '1px solid',
                  // text.primary: dark ink on a light page, light ink on a dark one.
                  borderColor: isSelected ? 'text.primary' : 'divider',
                  borderRadius: '4px',
                  height: 70,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  '&:active': { opacity: 0.85 },
                }}
              >
                {/* Diagonal line for "none" swatch */}
                {isNone && (
                  <Box sx={{
                    position: 'absolute', inset: 0,
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      background: 'linear-gradient(to bottom right, transparent calc(50% - 0.5px), #bdbdbd calc(50% - 0.5px), #bdbdbd calc(50% + 0.5px), transparent calc(50% + 0.5px))',
                    },
                  }} />
                )}

                <Typography sx={{
                  color: color.text,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  px: 0.75,
                  lineHeight: 1.3,
                  zIndex: 1,
                  userSelect: 'none',
                }}>
                  {label}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
