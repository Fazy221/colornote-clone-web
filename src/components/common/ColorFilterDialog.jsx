import React, { useEffect, useState } from 'react';
import {
  Box, Dialog, DialogContent, DialogTitle, Typography,
  IconButton, InputBase,
} from '@mui/material';
import NumbersIcon from '@mui/icons-material/Numbers';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import { NOTE_COLORS } from '../../utils/colors';
import useColorStore from '../../store/colorStore';

// The "Color" modal, opened from the single quadrant icon in the Home app
// bar (replacing the old always-visible 4-square filter row). Three things
// live here, matching the real app:
//  - Tap a swatch to filter Home to that color (tap the blank/diagonal one
//    to clear the filter and show all colors again).
//  - The "123" icon toggles showing a note-count badge on each swatch.
//  - The pencil icon enters rename mode: every named swatch becomes an
//    editable field; the checkmark saves all renames at once and exits.
export default function ColorFilterDialog({ open, colorFilter, onSelectFilter, onClose, counts }) {
  const { colorNames, showColorCounts, toggleShowColorCounts, setColorNames } = useColorStore();
  const [editing, setEditing] = useState(false);
  const [draftNames, setDraftNames] = useState(colorNames);

  // Re-sync the draft whenever the dialog is (re)opened, so a previous
  // edit session that wasn't saved doesn't linger.
  useEffect(() => {
    if (open) { setDraftNames(colorNames); setEditing(false); }
  }, [open, colorNames]);

  const handleStartEdit = () => setEditing(true);

  const handleSaveEdit = () => {
    setColorNames(draftNames);
    setEditing(false);
  };

  const handleSwatchClick = (index) => {
    if (editing) return; // taps in edit mode go to the text field, not the swatch
    onSelectFilter(index === 0 ? null : index);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pb: 0.5, fontWeight: 600 }}>
        <Box component="span" sx={{ flex: 1 }}>Color</Box>
        {editing ? (
          <IconButton size="small" onClick={handleSaveEdit} aria-label="Save color names">
            <CheckIcon />
          </IconButton>
        ) : (
          <>
            <IconButton
              size="small"
              onClick={toggleShowColorCounts}
              aria-label="Toggle note counts"
              sx={{ color: showColorCounts ? '#00BCD4' : 'inherit' }}
            >
              <NumbersIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <IconButton size="small" onClick={handleStartEdit} aria-label="Rename colors">
              <EditIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </>
        )}
      </DialogTitle>

      <DialogContent sx={{ pt: 1, px: 1.5, pb: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
          {colorNames.map((label, index) => {
            const color = NOTE_COLORS[index];
            const isNone = index === 0;
            const isSelected = !isNone && colorFilter === index;
            const count = counts?.[index] || 0;

            return (
              <Box
                key={index}
                onClick={() => handleSwatchClick(index)}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'stretch',
                  backgroundColor: color.bg,
                  border: isSelected ? '2.5px solid' : '1px solid',
                  borderColor: isSelected ? 'text.primary' : 'divider',
                  borderRadius: '4px',
                  height: 64,
                  overflow: 'hidden',
                  cursor: editing ? 'default' : 'pointer',
                  '&:active': editing ? {} : { opacity: 0.85 },
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

                {/* Count badge — only when the toggle is on and there's a nonzero count */}
                {!editing && !isNone && showColorCounts && count > 0 && (
                  <Box sx={{
                    width: 40, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: `${color.border}30`,
                    borderRight: `1px solid ${color.border}55`,
                  }}>
                    <Typography sx={{ color: color.text, fontSize: '0.78rem', fontWeight: 700 }}>
                      {count}
                    </Typography>
                  </Box>
                )}

                {!isNone && (
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', px: 1, minWidth: 0 }}>
                    {editing ? (
                      <InputBase
                        value={draftNames[index]}
                        onChange={(e) => setDraftNames(d => {
                          const next = [...d];
                          next[index] = e.target.value;
                          return next;
                        })}
                        onClick={(e) => e.stopPropagation()}
                        sx={{
                          width: '100%',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: color.text,
                          borderBottom: `1px solid ${color.text}80`,
                        }}
                      />
                    ) : (
                      <Typography sx={{
                        color: color.text,
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {label}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
