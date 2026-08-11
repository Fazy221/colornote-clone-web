import { format, isToday, isYesterday, differenceInDays, parseISO } from 'date-fns';

// Format note date the same way ColorNote does:
// Today: nothing shown (just time)
// Within 7 days: "Mon", "Tue" etc
// Same year: "5 Apr"
// Different year: "5 Apr 2022"
export const formatNoteDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();

  if (isToday(date)) {
    return format(date, 'h:mm a');
  }
  if (isYesterday(date)) {
    return 'Yesterday';
  }
  const diff = differenceInDays(now, date);
  if (diff < 7) {
    return format(date, 'EEE'); // Mon, Tue, etc.
  }
  if (date.getFullYear() === now.getFullYear()) {
    return format(date, 'd MMM'); // 5 Apr
  }
  return format(date, 'd MMM yyyy'); // 5 Apr 2022
};

export const formatFullDate = (timestamp) => {
  if (!timestamp) return '';
  return format(new Date(timestamp), 'dd/MM/yyyy h:mm a');
};

export const formatCalendarDate = (timestamp) => {
  if (!timestamp) return '';
  return format(new Date(timestamp), 'yyyy-MM-dd');
};

export const toTimestamp = (date) => date ? new Date(date).getTime() : null;
