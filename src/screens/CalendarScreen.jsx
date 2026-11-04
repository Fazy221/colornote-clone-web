import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, AppBar, Toolbar, Typography, IconButton,
  Fab, Divider, Paper, useTheme,
} from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import AddIcon from '@mui/icons-material/Add';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import EventIcon from '@mui/icons-material/Event';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import BottomNav from '../components/layout/BottomNav';
import DatePickerDialog from '../components/common/DatePickerDialog';
import { db } from '../db/database';
import { getColor } from '../utils/colors';
import { formatCalendarDate } from '../utils/dateUtils';
import { notesByDate } from '../utils/reminders';

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// The notes on each day from `from` to `to`, a repeating reminder on every
// day it comes round, as on the phone.
async function loadDays(from, to) {
  const notes = await db.notes
    .filter(n => Boolean(n.calendarDate) && n.calendarDate <= to && (n.calendarDate >= from || Boolean(n.reminderRepeat)))
    .toArray();
  return notesByDate(notes, from, to);
}

function getFirstDayOfWeek(year, month) {
  // 0=Mon, 6=Sun
  let d = new Date(year, month, 1).getDay();
  return (d + 6) % 7;
}

export default function CalendarScreen() {
  const navigate = useNavigate();
  const dark = useTheme().palette.mode === 'dark';
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [notesOnDate, setNotesOnDate] = useState([]);
  const [dotMap, setDotMap] = useState({}); // { 'YYYY-MM-DD': [colorIndex,...] }
  const [picking, setPicking] = useState(false);

  // Load all calendar notes for this month
  useEffect(() => {
    let live = true;
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    loadDays(`${prefix}-01`, `${prefix}-${String(getDaysInMonth(year, month)).padStart(2, '0')}`).then(days => {
      if (!live) return;
      setDotMap(Object.fromEntries(Object.entries(days).map(([day, notes]) => [day, notes.map(n => n.colorIndex ?? 0)])));
    });
    return () => { live = false; };
  }, [year, month]);

  // Load notes for selected date
  useEffect(() => {
    if (!selectedDate) { setNotesOnDate([]); return; }
    let live = true;
    loadDays(selectedDate, selectedDate).then(days => { if (live) setNotesOnDate(days[selectedDate] || []); });
    return () => { live = false; };
  }, [selectedDate]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  // The top bar's calendar button: back to the present month.
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(null);
  };

  // Left and right arrow keys step the month, T returns to this month (not while typing in a field).
  const stepRef = useRef(null);
  stepRef.current = { prevMonth, nextMonth, goToday };
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 't') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.MuiModal-root')) return;
      e.preventDefault();
      if (e.key === 't') stepRef.current.goToday();
      else if (e.key === 'ArrowLeft') stepRef.current.prevMonth(); else stepRef.current.nextMonth();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  const handleDayPress = (day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(prev => prev === dateStr ? null : dateStr);
  };

  const todayStr = formatCalendarDate(today);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ minHeight: 56 }}>
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 400 }}>Calendar</Typography>
          <IconButton aria-label="Go to this month" title="This month" onClick={goToday}>
            <CalendarTodayIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflowY: 'auto', pb: '72px' }}>
        {/* Month navigation */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, bgcolor: 'background.paper' }}>
          <IconButton size="small" onClick={prevMonth}><ArrowBackIosIcon sx={{ fontSize: 14 }} /></IconButton>
          {/* Opens the date picker, as the month title does on the phone. */}
          <Typography
            component="button" type="button" variant="body1" aria-label="Pick a month"
            onClick={() => setPicking(true)}
            sx={{ all: 'unset', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem', px: 1.5, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid #00BCD4' } }}
          >
            {MONTHS[month]} {year}
          </Typography>
          <IconButton size="small" onClick={nextMonth}><ArrowForwardIosIcon sx={{ fontSize: 14 }} /></IconButton>
        </Box>

        {/* Day headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', bgcolor: 'background.paper' }}>
          {DAY_LABELS.map(d => (
            <Box key={d} sx={{ textAlign: 'center', py: 0.5 }}>
              <Typography variant="caption" sx={{
                fontWeight: 500, fontSize: '0.7rem',
                color: d === 'SAT' ? '#2196F3' : d === 'SUN' ? '#F44336' : 'text.secondary',
              }}>
                {d}
              </Typography>
            </Box>
          ))}
        </Box>

        <Divider />

        {/* Calendar grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          bgcolor: 'background.paper',
          minHeight: 280,
        }}>
          {/* Empty cells for offset */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <Box key={`e-${i}`} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 52 }} />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = selectedDate === dateStr;
            const dots = dotMap[dateStr] || [];
            const dow = (firstDow + i) % 7; // 0=Mon, 6=Sun

            return (
              <Box
                key={day}
                onClick={() => handleDayPress(day)}
                sx={{
                  minHeight: 52,
                  borderBottom: 1, borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  pt: 0.5,
                  px: 0.5,
                  cursor: 'pointer',
                  bgcolor: isSelected ? 'rgba(0,188,212,0.08)' : 'transparent',
                  outline: isSelected ? '2px solid #00BCD4' : 'none',
                  outlineOffset: '-2px',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: isToday ? 700 : 400,
                    fontSize: '0.85rem',
                    color: isToday
                      ? '#00BCD4'
                      : dow === 5 ? '#2196F3'
                      : dow === 6 ? '#F44336'
                      : 'text.primary',
                    lineHeight: 1.2,
                  }}
                >
                  {day}
                </Typography>

                {/* Colored dots for notes */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px', mt: 0.25 }}>
                  {dots.slice(0, 3).map((ci, di) => (
                    <Box
                      key={di}
                      sx={{
                        width: 6, height: 6,
                        borderRadius: '1px',
                        bgcolor: getColor(ci).border,
                      }}
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>

        {/* Notes panel for selected date */}
        {selectedDate && (
          <Paper elevation={0} sx={{ mx: 0, mt: 0, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton size="small" onClick={() => {
                  const parts = selectedDate.split('-');
                  const d = new Date(parts[0], parts[1]-1, parseInt(parts[2])-1);
                  setSelectedDate(formatCalendarDate(d));
                }}>
                  <ArrowBackIosIcon sx={{ fontSize: 12 }} />
                </IconButton>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long' })}
                </Typography>
                <IconButton size="small" onClick={() => {
                  const parts = selectedDate.split('-');
                  const d = new Date(parts[0], parts[1]-1, parseInt(parts[2])+1);
                  setSelectedDate(formatCalendarDate(d));
                }}>
                  <ArrowForwardIosIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Box>
            </Box>

            {notesOnDate.length === 0 ? (
              <Box sx={{ px: 2, pb: 2 }}>
                <Typography variant="body2" color="text.secondary">No notes on this date</Typography>
              </Box>
            ) : (
              notesOnDate.map(note => {
                const c = getColor(note.colorIndex, dark);
                return (
                  <Box
                    key={note.id}
                    onClick={() => navigate(`/note/${note.id}`)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      px: 2, py: 1.25,
                      bgcolor: c.bg,
                      mb: '1px',
                      cursor: 'pointer',
                      '&:active': { filter: 'brightness(0.96)' },
                    }}
                  >
                    <Typography sx={{ flex: 1, fontSize: '0.95rem', color: c.text }}>
                      {note.title || note.note?.slice(0, 50) || '(untitled)'}
                    </Typography>
                    {note.type === 'checklist'
                      ? <CheckBoxIcon sx={{ fontSize: 16, color: c.text, opacity: 0.6 }} />
                      : <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c.border }} />
                    }
                  </Box>
                );
              })
            )}

            <Box
              onClick={() => navigate(`/note/new?date=${selectedDate}`)}
              sx={{ px: 2, py: 1.5, color: '#00BCD4', cursor: 'pointer', fontWeight: 500, fontSize: '0.9rem' }}
            >
              Add
            </Box>
          </Paper>
        )}
      </Box>

      {/* FAB */}
      <Fab
        onClick={() => navigate(selectedDate ? `/note/new?date=${selectedDate}` : '/note/new?type=text')}
        sx={{ position: 'fixed', bottom: 72, right: 16, zIndex: 50 }}
      >
        <AddIcon />
      </Fab>

      {/* Choosing a date only turns the calendar to that month, as on the phone: no day opens. */}
      <DatePickerDialog
        open={picking}
        value={new Date(year, month, 1)}
        onPick={({ year: y, month: m }) => { setYear(y); setMonth(m); }}
        onClose={() => setPicking(false)}
      />

      <BottomNav />
    </Box>
  );
}
