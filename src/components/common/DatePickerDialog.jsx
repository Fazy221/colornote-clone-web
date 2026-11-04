import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Dialog, Typography, IconButton } from '@mui/material';

// The date picker, the same one everywhere: the calendar's month title and the note's modified
// date open it. It mirrors the phone's MonthPickerDialog (ui/DatePicker.kt): a teal header with
// the year and the chosen day, a month grid, and a year list behind the year.
// Change one, change the other (CLAUDE.md, "Both apps").

const TEAL = '#009688';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const FIRST_YEAR = 1900;
const LAST_YEAR = 2100;

const daysIn = (year, month) => new Date(year, month + 1, 0).getDate();
// 0 = Monday, like the calendar screen.
const startOffset = (year, month) => (new Date(year, month, 1).getDay() + 6) % 7;

export function headerLabel(year, month, day) {
  return new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

// value: a Date (or anything new Date accepts). onPick gets { year, month (0-11), day }.
export default function DatePickerDialog({ open, value, title, onPick, onClose }) {
  const start = useMemo(() => {
    const d = value instanceof Date ? value : new Date(value ?? Date.now());
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [value, open]);
  const [shown, setShown] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const [picked, setPicked] = useState({ year: start.getFullYear(), month: start.getMonth(), day: start.getDate() });
  const [yearMode, setYearMode] = useState(false);
  const currentYearRef = useRef(null);

  // Each time it opens it starts from the value it was given.
  useEffect(() => {
    if (!open) return;
    setShown({ year: start.getFullYear(), month: start.getMonth() });
    setPicked({ year: start.getFullYear(), month: start.getMonth(), day: start.getDate() });
    setYearMode(false);
  }, [open, start]);

  useEffect(() => {
    if (yearMode) currentYearRef.current?.scrollIntoView?.({ block: 'center' });
  }, [yearMode]);

  const today = new Date();
  const step = (delta) => setShown(({ year, month }) => {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const pickYear = (year) => {
    const day = Math.min(picked.day, daysIn(year, picked.month));
    setPicked({ year, month: picked.month, day });
    setShown({ year, month: picked.month });
    setYearMode(false);
  };

  const confirm = () => { onPick(picked); onClose(); };
  const blanks = startOffset(shown.year, shown.month);
  const length = daysIn(shown.year, shown.month);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 316, maxWidth: 'calc(100vw - 32px)', m: 2, borderRadius: '6px', overflow: 'hidden' } }}
      onKeyDown={(e) => { if (e.key === 'Enter' && !yearMode && e.target.tagName !== 'BUTTON') confirm(); }}
    >
      <Box sx={{ bgcolor: TEAL, color: '#fff', height: 96, pl: 2.75, pt: 1.75 }}>
        <Typography
          component="button"
          type="button"
          aria-label="Choose year"
          onClick={() => setYearMode(m => !m)}
          sx={{ all: 'unset', cursor: 'pointer', fontSize: 16, opacity: yearMode ? 1 : 0.7, display: 'block', py: 0.25 }}
        >
          {picked.year}
        </Typography>
        <Typography sx={{ fontSize: 32, mt: 0.75, lineHeight: 1.2 }}>
          {title || headerLabel(picked.year, picked.month, picked.day)}
        </Typography>
      </Box>

      <Box sx={{ height: 334, bgcolor: 'background.paper' }}>
        {yearMode ? (
          <Box role="listbox" aria-label="Years" sx={{ height: '100%', overflowY: 'auto' }}>
            {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).map(y => {
              const current = y === picked.year;
              return (
                <Box
                  key={y}
                  role="option"
                  aria-selected={current}
                  ref={current ? currentYearRef : null}
                  onClick={() => pickYear(y)}
                  sx={{
                    height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    color: current ? TEAL : 'text.primary', fontSize: current ? 26 : 18, fontWeight: current ? 700 : 400,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {y}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ px: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', height: 48 }}>
              <IconButton aria-label="Previous month" onClick={() => step(-1)} sx={{ width: 48, height: 48, fontSize: 26 }}>‹</IconButton>
              <Typography sx={{ flex: 1, textAlign: 'center', fontSize: 16 }}>{MONTHS[shown.month]} {shown.year}</Typography>
              <IconButton aria-label="Next month" onClick={() => step(1)} sx={{ width: 48, height: 48, fontSize: 26 }}>›</IconButton>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', height: 32 }}>
              {WEEKDAYS.map((w, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: 13 }}>{w}</Box>
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {Array.from({ length: blanks }, (_, i) => <Box key={`b${i}`} sx={{ height: 44 }} />)}
              {Array.from({ length: length }, (_, i) => {
                const day = i + 1;
                const chosen = picked.year === shown.year && picked.month === shown.month && picked.day === day;
                const isToday = today.getFullYear() === shown.year && today.getMonth() === shown.month && today.getDate() === day;
                return (
                  <Box key={day} sx={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Box
                      component="button"
                      type="button"
                      aria-label={`${MONTHS[shown.month]} ${day}, ${shown.year}`}
                      aria-pressed={chosen}
                      onClick={() => setPicked({ year: shown.year, month: shown.month, day })}
                      sx={{
                        all: 'unset', cursor: 'pointer', width: 38, height: 38, borderRadius: '50%', fontSize: 15,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        bgcolor: chosen ? TEAL : 'transparent',
                        color: chosen ? '#fff' : isToday ? TEAL : 'text.primary',
                        '&:hover': { bgcolor: chosen ? TEAL : 'action.hover' },
                        '&:focus-visible': { outline: `2px solid ${TEAL}` },
                      }}
                    >
                      {day}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', pr: 1, pb: 0.75, bgcolor: 'background.paper' }}>
        <Button onClick={onClose} sx={{ color: TEAL }}>Cancel</Button>
        <Button onClick={confirm} sx={{ color: TEAL }}>OK</Button>
      </Box>
    </Dialog>
  );
}
