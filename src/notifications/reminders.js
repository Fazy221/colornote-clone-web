// Local reminder notifications — Android-only (see reminderPopupStore.js /
// ReminderPopup.jsx for the in-app side of this).
//
// Model: every time the app comes to the foreground, resyncFromNotes()
// re-derives the full set of pending notifications from Dexie. Notes due
// today or earlier (and not dismissed) get scheduled to fire almost
// immediately — that's what makes a swiped-away notification reappear when
// you reopen the app, matching the original ColorNote's behavior. Notes
// with a future calendarDate get scheduled for 9:00 AM local time that day.
// Anything no longer due (dismissed, trashed, date removed) gets its
// pending notification cancelled in the same pass — no separate cleanup
// path to keep in sync.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from '../db/database';

const CHANNEL_ID = 'reminders-silent';
const DEFAULT_HOUR = 9; // ColorNote's calendar-linked notes store a day, not a time —
                         // this is the fixed local hour used for future-dated reminders.

// Local Notifications needs a 32-bit integer id, but notes are keyed by
// uuid. This hash just needs to be *stable* (same uuid → same id every
// time, so re-scheduling overwrites rather than duplicates) — collisions
// are effectively a non-issue at diary-scale note counts.
function stableNotificationId(uuid) {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function todayLocalDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fireTimeFor(calendarDate, todayStr) {
  if (calendarDate <= todayStr) {
    // Already due — fire right away rather than scheduling into the past
    // (which most platforms just drop instead of firing immediately).
    return new Date(Date.now() + 500);
  }
  const [y, m, d] = calendarDate.split('-').map(Number);
  return new Date(y, m - 1, d, DEFAULT_HOUR, 0, 0);
}

export async function setupReminderChannel() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Note reminders',
    description: 'Notes with a calendar date — silent, no sound or vibration.',
    importance: 2, // IMPORTANCE_LOW: shows in the shade, no sound, no heads-up popup
    visibility: 1,
    vibration: false,
  });
}

export async function requestReminderPermissions() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.requestPermissions();
}

export async function resyncFromNotes() {
  if (!Capacitor.isNativePlatform()) return;

  const notes = await db.notes
    .where('state').equals('normal')
    .and(n => !!n.calendarDate && !n.reminderDismissedAt)
    .toArray();

  const todayStr = todayLocalDateStr();

  const toSchedule = notes.map(n => ({
    id: stableNotificationId(n.uuid),
    title: n.title || 'Untitled note',
    body: ' ', // title-only, matching the original app's reminder style
    channelId: CHANNEL_ID,
    schedule: { at: fireTimeFor(n.calendarDate, todayStr) },
    extra: { noteUuid: n.uuid },
  }));

  if (toSchedule.length) {
    await LocalNotifications.schedule({ notifications: toSchedule });
  }

  // Cancel anything pending that's no longer due — dismissed, trashed,
  // archived, or its date was cleared since the last sync.
  const pending = await LocalNotifications.getPending();
  const validIds = new Set(toSchedule.map(n => n.id));
  const stale = pending.notifications.filter(p => !validIds.has(p.id));
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map(n => ({ id: n.id })) });
  }
}

// Cancels both a still-pending (not yet fired) and an already-delivered
// (sitting in the shade) notification for one note — used when a reminder
// is dismissed via the in-app popup, so it doesn't linger in either state.
export async function cancelReminderNotification(uuid) {
  if (!Capacitor.isNativePlatform()) return;
  const id = stableNotificationId(uuid);
  await LocalNotifications.cancel({ notifications: [{ id }] });
  await LocalNotifications.removeDeliveredNotifications({ notifications: [{ id }] });
}

// Registered once at app start. Tapping the OS notification doesn't open
// the note directly — it hands off to whatever's listening (ReminderPopup)
// via the noteUuid in `extra`, which shows the small in-app popup instead.
export function onReminderTapped(callback) {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle;
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const uuid = action.notification?.extra?.noteUuid;
    if (uuid) callback(uuid);
  }).then(h => { handle = h; });
  return () => handle?.remove();
}
