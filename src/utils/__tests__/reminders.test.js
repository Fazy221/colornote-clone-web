import { describe, it, expect } from 'vitest';
import {
  dateOccurrences, timeOccurrences, hasLiveReminder, reminderState, notesByDate, ENDED_REMINDER,
  REMINDER_ALL_DAY, REMINDER_TIME, REPEAT_DAILY, REPEAT_WEEKDAYS, REPEAT_WEEKLY, REPEAT_BIWEEKLY,
  REPEAT_MONTHLY, REPEAT_MONTHLY_WEEKDAY, REPEAT_YEARLY,
} from '../reminders';

// Invented notes only.
const take = (gen, n) => { const out = []; for (const v of gen) { out.push(v); if (out.length === n) break; } return out; };
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const note = (extra = {}) => ({
  id: 1, uuid: 'u-1', title: 'Invented', state: 'normal', colorIndex: 0,
  calendarDate: null, reminderType: 0, reminderRepeat: 0, reminderRepeatEnds: 0,
  reminderTime: null, reminderDismissedAt: null, ...extra,
});

describe('dateOccurrences', () => {
  it('a one-time date lands once', () => {
    expect([...dateOccurrences('2026-01-05', 0, 0)]).toEqual(['2026-01-05']);
  });

  it('daily, weekly and fortnightly', () => {
    expect(take(dateOccurrences('2026-01-30', REPEAT_DAILY, 0), 3)).toEqual(['2026-01-30', '2026-01-31', '2026-02-01']);
    expect(take(dateOccurrences('2026-01-05', REPEAT_WEEKLY, 0), 3)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    expect(take(dateOccurrences('2026-01-05', REPEAT_BIWEEKLY, 0), 3)).toEqual(['2026-01-05', '2026-01-19', '2026-02-02']);
  });

  it('weekdays skip the weekend, starting from a weekend day too', () => {
    expect(take(dateOccurrences('2026-01-01', REPEAT_WEEKDAYS, 0), 4)).toEqual(['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06']);
    expect(take(dateOccurrences('2026-01-03', REPEAT_WEEKDAYS, 0), 3)).toEqual(['2026-01-03', '2026-01-05', '2026-01-06']);
  });

  it('monthly on the 31st gives the end of short months and the 31st again after', () => {
    expect(take(dateOccurrences('2026-01-31', REPEAT_MONTHLY, 0), 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('monthly by weekday keeps the week of the month, the fifth meaning the last', () => {
    // Second Tuesday.
    expect(take(dateOccurrences('2026-01-13', REPEAT_MONTHLY_WEEKDAY, 0), 2)).toEqual(['2026-01-13', '2026-02-10']);
    // Fifth Thursday: the last Thursday of February.
    expect(take(dateOccurrences('2026-01-29', REPEAT_MONTHLY_WEEKDAY, 0), 2)).toEqual(['2026-01-29', '2026-02-26']);
  });

  it('yearly, and a repeat stops on its end day', () => {
    expect(take(dateOccurrences('2024-02-29', REPEAT_YEARLY, 0), 2)).toEqual(['2024-02-29', '2025-02-28']);
    expect([...dateOccurrences('2026-01-05', REPEAT_DAILY, at(2026, 1, 7))]).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('a lunar repeat lands once here, and a bad date not at all', () => {
    expect([...dateOccurrences('2026-01-05', 128, 0)]).toEqual(['2026-01-05']);
    expect([...dateOccurrences('not a date', REPEAT_DAILY, 0)]).toEqual([]);
  });
});

describe('timeOccurrences', () => {
  it('repeats the time and stops at the end', () => {
    const start = at(2026, 1, 5, 9);
    expect([...timeOccurrences(start, REPEAT_DAILY, at(2026, 1, 6, 10))]).toEqual([start, at(2026, 1, 6, 9)]);
  });
});

describe('hasLiveReminder', () => {
  const now = at(2026, 3, 10);

  it('a date reminder still to come, or due today, is live', () => {
    expect(hasLiveReminder(note({ reminderType: REMINDER_ALL_DAY, calendarDate: '2026-03-20' }), now)).toBe(true);
    expect(hasLiveReminder(note({ reminderType: REMINDER_ALL_DAY, calendarDate: '2026-03-10' }), now)).toBe(true);
  });

  it('a date gone by is not, unless it repeats', () => {
    expect(hasLiveReminder(note({ reminderType: REMINDER_ALL_DAY, calendarDate: '2026-03-01' }), now)).toBe(false);
    expect(hasLiveReminder(note({ reminderType: REMINDER_ALL_DAY, calendarDate: '2020-03-01', reminderRepeat: REPEAT_YEARLY }), now)).toBe(true);
    expect(hasLiveReminder(note({
      reminderType: REMINDER_ALL_DAY, calendarDate: '2026-03-01', reminderRepeat: REPEAT_DAILY, reminderRepeatEnds: at(2026, 3, 5),
    }), now)).toBe(false);
  });

  it('a time alarm is live until it has rung and been dismissed', () => {
    expect(hasLiveReminder(note({ reminderType: REMINDER_TIME, reminderTime: at(2026, 3, 11) }), now)).toBe(true);
    expect(hasLiveReminder(note({ reminderType: REMINDER_TIME, reminderTime: at(2026, 3, 9) }), now)).toBe(true);
    expect(hasLiveReminder(note({ reminderType: REMINDER_TIME, reminderTime: at(2026, 3, 9), reminderDismissedAt: at(2026, 3, 9, 13) }), now)).toBe(false);
  });

  it('a calendar date with no reminder, or a reminder already ended, is not', () => {
    expect(hasLiveReminder(note({ calendarDate: '2026-03-20' }), now)).toBe(false);
    expect(hasLiveReminder(note({ calendarDate: '2026-03-20', ...ENDED_REMINDER }), now)).toBe(false);
    expect(reminderState(note({ reminderType: REMINDER_TIME }), now)).toBe('none');
  });
});

describe('notesByDate', () => {
  const ids = (days, day) => (days[day] || []).map(n => n.id);

  it('puts a note on its own date', () => {
    const days = notesByDate([note({ id: 1, calendarDate: '2026-02-03' })], '2026-02-01', '2026-02-28');
    expect(ids(days, '2026-02-03')).toEqual([1]);
  });

  it('puts a repeating reminder on every day it comes round, from before the month too', () => {
    const weekly = note({ id: 2, calendarDate: '2026-01-05', reminderType: REMINDER_ALL_DAY, reminderRepeat: REPEAT_WEEKLY });
    const days = notesByDate([weekly], '2026-02-01', '2026-02-28');
    expect(Object.keys(days).sort()).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']);
  });

  it('a repeat without a reminder, or ended before the range, stays on its own date', () => {
    const noReminder = note({ id: 3, calendarDate: '2026-01-05', reminderRepeat: REPEAT_DAILY });
    const ended = note({
      id: 4, calendarDate: '2026-01-05', reminderType: REMINDER_TIME, reminderTime: at(2026, 1, 5),
      reminderRepeat: REPEAT_DAILY, reminderRepeatEnds: at(2026, 1, 20),
    });
    expect(notesByDate([noReminder, ended], '2026-02-01', '2026-02-28')).toEqual({});
  });

  it('leaves out archived and trashed notes', () => {
    const days = notesByDate([
      note({ id: 5, calendarDate: '2026-02-03', state: 'archived' }),
      note({ id: 6, calendarDate: '2026-02-03', state: 'trash' }),
    ], '2026-02-01', '2026-02-28');
    expect(days).toEqual({});
  });
});
