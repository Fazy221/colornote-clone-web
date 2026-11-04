import React, { useRef } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import EventIcon from '@mui/icons-material/Event';
import CheckIcon from '@mui/icons-material/Check';
import { getColor } from '../../utils/colors';
import { formatNoteDate } from '../../utils/dateUtils';

const LONG_PRESS_MS = 700; // matches the native ColorNote Android app
const MOVE_CANCEL_PX = 12; // finger/mouse drift past this cancels the long-press (treat as a scroll/drag)

// Build a short preview of the note content
function buildPreview(note) {
  if (!note) return '';
  if (note.encrypted) return ''; // Don't show ciphertext

  if (note.type === 'checklist' && note.items) {
    return note.items.map(i => `${i.checked ? '✓' : '☐'} ${i.text}`).join('  ');
  }
  return (note.note || '').replace(/\n+/g, ' ').trim();
}

// onPress(event) fires on a normal tap/click — the click event is forwarded,
// same as a plain onClick, so existing consumers reading e.currentTarget keep working.
// onLongPress(element) fires after a true press-and-hold (touch or mouse) —
// it receives the pressed DOM node (handy as a Menu anchorEl), not an event,
// since the event that triggered it is a deferred timer callback rather than
// a live event object.
export default function NoteCard({ note, selected, onPress, onLongPress }) {
  const dark = useTheme().palette.mode === 'dark';
  // Dark mode, as on the phone: a dark row, the colour kept in a stripe on the left.
  const color = getColor(note.colorIndex, dark);
  const preview = buildPreview(note);
  const dateStr = formatNoteDate(note.modifiedAt);
  const isChecklist = note.type === 'checklist';

  const checkedCount = isChecklist && note.items ? note.items.filter(i => i.checked).length : 0;
  const totalCount = isChecklist && note.items ? note.items.length : 0;

  const pressTimer   = useRef(null);
  const pressTarget  = useRef(null);
  const startPos     = useRef({ x: 0, y: 0 });
  const longPressFired = useRef(false);

  const clearPressTimer = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const handlePointerDown = (e) => {
    // Only the primary button/touch starts a long-press; right-click is handled separately below.
    if (e.button !== undefined && e.button !== 0) return;
    longPressFired.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    pressTarget.current = e.currentTarget;
    clearPressTimer();
    // Capture the pointer so this element keeps receiving move/up events even
    // if the touch point drifts slightly outside its bounds mid-hold — cards
    // sit only 1px apart with no gutter, so without capture a real-device
    // touch drifts off the card almost instantly and cancels the hold before
    // it can fire, which is what made long-press feel like it needed several
    // tries / several seconds.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported — fine, falls back to normal bubbling */ }
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      pressTimer.current = null;
      onLongPress && onLongPress(pressTarget.current);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e) => {
    if (!pressTimer.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearPressTimer(); // scrolling/dragging — not a hold
  };

  const handlePointerUp = () => clearPressTimer();

  const handleClick = (e) => {
    if (longPressFired.current) {
      // Swallow the click that follows a long-press so it doesn't also navigate/select.
      longPressFired.current = false;
      e.preventDefault();
      return;
    }
    onPress && onPress(e);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    clearPressTimer();
    onLongPress && onLongPress(e.currentTarget);
  };

  return (
    <Box
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      sx={{
        backgroundColor: color.bg,
        borderRadius: '4px',
        mb: '1px',
        mx: 0,
        px: 2,
        py: 1.25,
        minHeight: 64,
        minWidth: 0, // don't let this card's own content force it wider than its grid column
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        borderLeft: dark ? `4px solid ${color.border}` : 'none',
        outline: selected ? `2px solid ${color.border}` : 'none',
        outlineOffset: '-2px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none', // suppress iOS Safari's own long-press callout
        touchAction: 'manipulation',
        transition: 'filter 0.1s',
        '&:active': { filter: 'brightness(0.95)' },
      }}
    >
      {/* Selection overlay */}
      {selected && (
        <Box sx={{
          position: 'absolute', top: 8, right: 8,
          width: 22, height: 22, borderRadius: '50%',
          bgcolor: color.border, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckIcon sx={{ fontSize: 14, color: '#fff' }} />
        </Box>
      )}

      {/* Top row: title + date */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Typography
          variant="body1"
          sx={{
            color: color.text,
            fontWeight: 500,
            fontSize: '0.95rem',
            lineHeight: 1.3,
            flex: 1,
            minWidth: 0,
            wordBreak: 'break-word',
          }}
        >
          {note.title || (preview.slice(0, 60)) || ' '}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, ml: 1 }}>
          {/* Icons row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
            {note.encrypted === 1 && (
              <LockIcon sx={{ fontSize: 14, color: color.text, opacity: 0.7 }} />
            )}
            {isChecklist && (
              <CheckBoxIcon sx={{ fontSize: 14, color: color.text, opacity: 0.7 }} />
            )}
            {note.calendarDate && (
              <EventIcon sx={{ fontSize: 14, color: color.text, opacity: 0.7 }} />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: color.text, opacity: 0.7, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
            {dateStr}
          </Typography>
        </Box>
      </Box>

      {/* Preview text */}
      {note.title && preview ? (
        <Typography
          variant="body2"
          sx={{
            color: color.text,
            opacity: 0.75,
            fontSize: '0.82rem',
            mt: 0.5,
            lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {isChecklist && totalCount > 0
            ? `${checkedCount}/${totalCount} tasks`
            : preview}
        </Typography>
      ) : null}
    </Box>
  );
}
