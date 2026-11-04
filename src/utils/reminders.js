// When a reminder comes round again, and whether it is still live. A port of the Android app's
// Reminders.kt (occurrences, dateOccurrences, reminderState, hasLiveReminder, notesByDate), so both
// apps agree on which days a repeating note sits on and which archive needs asking first.
//
// Dates are "yyyy-MM-dd" strings in this browser's time zone, as the calendar stores them.
import { addDays, addMonths, addWeeks, addYears, format, parseISO, isValid } from 'date-fns';

// ColorNote's own codes, shared with the phone through Firestore.
export const REMINDER_NONE = 0;
export const REMINDER_ALL_DAY = 16;
export const REMINDER_TIME = 32;

export const REPEAT_NONE = 0;
export const REPEAT_DAILY = 16;
export const REPEAT_WEEKDAYS = 32;
export const REPEAT_WEEKLY = 48;
export const REPEAT_BIWEEKLY = 64;
export const REPEAT_MONTHLY = 80;
export const REPEAT_MONTHLY_WEEKDAY = 96;
export const REPEAT_YEARLY = 112;
// Lunar repeats (128, 144) need a lunar calendar this app doesn't have, so here they ring once.

const MAX_OCCURRENCES = 20000;

const isoDay = (d) => format(d, 'yyyy-MM-dd');

function parseDay(s) {
  if (!s || typeof s !== 'string') return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

// Monday 1 … Sunday 7, as java.time counts.
const dayValue = (d) => (d.getDay() === 0 ? 7 : d.getDay());

// Days from base to its n-th weekday: the first is base itself on a weekday, else the Monday after.
function weekdayOffset(base, n) {
  const d = dayValue(base);
  if (d <= 5) {
    const index = d - 1 + n;
    return Math.floor(index / 5) * 7 + (index % 5) - (d - 1);
  }
  if (n === 0) return 0;
  const index = n - 1;
  return (8 - d) + Math.floor(index / 5) * 7 + (index % 5);
}

// The same weekday as base, in the same week of the month (the fifth counts as the last).
function sameWeekdayOfMonth(base, n) {
  const month = addMonths(new Date(base.getFullYear(), base.getMonth(), 1, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds()), n);
  const want = base.getDay();
  const ordinal = Math.floor((base.getDate() - 1) / 7) + 1;
  if (ordinal >= 5) {
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    return addDays(last, -((last.getDay() - want + 7) % 7));
  }
  const first = addDays(month, (want - month.getDay() + 7) % 7);
  return addDays(first, (ordinal - 1) * 7);
}

function occurrenceAt(base, repeat, n) {
  switch (repeat) {
    case REPEAT_DAILY: return addDays(base, n);
    case REPEAT_WEEKDAYS: return addDays(base, weekdayOffset(base, n));
    case REPEAT_WEEKLY: return addWeeks(base, n);
    case REPEAT_BIWEEKLY: return addWeeks(base, 2 * n);
    // Counted from the first date each time, so the 31st gives the 28th in February and the 31st again after.
    case REPEAT_MONTHLY: return addMonths(base, n);
    case REPEAT_MONTHLY_WEEKDAY: return sameWeekdayOfMonth(base, n);
    case REPEAT_YEARLY: return addYears(base, n);
    default: return n === 0 ? base : null;
  }
}

// Every day a date lands on, oldest first, up to the repeat's end (a moment; its day counts).
export function* dateOccurrences(date, repeat, ends) {
  const base = parseDay(date);
  if (!base) return;
  const last = ends > 0 ? isoDay(new Date(ends)) : null;
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const d = occurrenceAt(base, repeat || 0, n);
    if (!d) return;
    const day = isoDay(d);
    if (last && day > last) return;
    yield day;
  }
}

// Every time a time alarm rings, oldest first, up to the repeat's end.
export function* timeOccurrences(time, repeat, ends) {
  if (time == null) return;
  const base = new Date(time);
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const d = occurrenceAt(base, repeat || 0, n);
    if (!d) return;
    const at = d.getTime();
    if (ends > 0 && at > ends) return;
    yield at;
  }
}

function lastUpTo(gen, isPast) {
  let last = null;
  for (const v of gen) {
    if (!isPast(v)) break;
    last = v;
  }
  return last;
}

function some(gen, test) {
  for (const v of gen) if (test(v)) return true;
  return false;
}

// 'none' | 'upcoming' | 'active' (due and not dismissed) | 'overdue' (nothing left of it).
export function reminderState(note, now = Date.now()) {
  const type = note.reminderType || 0;
  const repeat = note.reminderRepeat || 0;
  const ends = note.reminderRepeatEnds || 0;
  const dismissed = note.reminderDismissedAt ?? -Infinity;
  if (type === REMINDER_TIME) {
    if (note.reminderTime == null) return 'none';
    const due = lastUpTo(timeOccurrences(note.reminderTime, repeat, ends), at => at <= now);
    if (due != null && due > dismissed) return 'active';
    return some(timeOccurrences(note.reminderTime, repeat, ends), at => at > now) ? 'upcoming' : 'overdue';
  }
  if (type === REMINDER_ALL_DAY || type === REMINDER_NONE) {
    if (!parseDay(note.calendarDate)) return 'none';
    const today = isoDay(new Date(now));
    // Only today's date is due. Days gone by count as dismissed, so years of old diary dates show nothing.
    const due = lastUpTo(dateOccurrences(note.calendarDate, repeat, ends), day => day <= today);
    if (due === today && parseISO(due).getTime() > dismissed) return 'active';
    return some(dateOccurrences(note.calendarDate, repeat, ends), day => day > today) ? 'upcoming' : 'overdue';
  }
  return 'none';
}

// A reminder that will still ring or show: archiving such a note asks first, and ends it.
export function hasLiveReminder(note, now = Date.now()) {
  const type = note.reminderType || 0;
  if (type !== REMINDER_TIME && type !== REMINDER_ALL_DAY) return false;
  const state = reminderState(note, now);
  return state === 'upcoming' || state === 'active';
}

// The phone's own words for that question.
export const ARCHIVE_QUESTION = 'The reminder will be dismissed when a note is archived. Are you sure you want to archive the note?';

// What archiving after that question writes: the alarm, repeat and dismissal go, the calendar date
// stays, so the note keeps its place in the diary. Like trash and pin, it keeps modifiedAt.
export const ENDED_REMINDER = {
  reminderType: REMINDER_NONE,
  reminderTime: null,
  reminderRepeat: REPEAT_NONE,
  reminderRepeatEnds: 0,
  reminderDismissedAt: null,
};

// The notes on each day from `from` to `to` (inclusive, "yyyy-MM-dd"): a note on its own date, and
// again on each day its repeat lands on. A note in the trash or the archive is on no day.
export function notesByDate(notes, from, to) {
  const days = {};
  const put = (day, note) => { (days[day] ||= []).push(note); };
  for (const note of notes) {
    if (note.state === 'trash' || note.state === 'archived') continue;
    const date = note.calendarDate;
    if (!date) continue;
    if (date >= from && date <= to) put(date, note);
    const type = note.reminderType || 0;
    const repeats = (note.reminderRepeat || 0) !== REPEAT_NONE && (type === REMINDER_ALL_DAY || type === REMINDER_TIME);
    if (!repeats || !parseDay(date)) continue;
    for (const day of dateOccurrences(date, note.reminderRepeat, note.reminderRepeatEnds || 0)) {
      if (day > to) break;
      if (day !== date && day >= from) put(day, note);
    }
  }
  return days;
}
