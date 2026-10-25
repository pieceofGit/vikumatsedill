// Shared by the page and tools/siri.mjs.

export const NTFY = 'https://ntfy.sh';
export const PAGE_URL = 'https://pieceofgit.github.io/vikumatsedill/laundry/';

// The Siri shortcut posts "<machine> <how long>" here, titled with the
// person's own topic; the laundry-siri workflow picks it up and books the
// reminders on that topic. Nobody subscribes to this one.
export const SIRI_TOPIC = 'vikumatsedill-thvottur-5rfarhhi29';

export const MACHINES = {
  washer: { name: 'Washer', tag: 'droplet' },
  dryer: { name: 'Dryer', tag: 'dash' },
};

// Reminders are booked under fixed IDs washer-1, washer-2, … so a new start
// replaces the old batch and anything can cancel them by name.
export const SEQ_MAX = 25;
export const REMIND_FOR_MIN = 180;

export function reminderCount(interval) {
  return Math.min(SEQ_MAX - 1, 1 + Math.floor(REMIND_FOR_MIN / interval));
}

export function stopUrl(pageUrl, topic, machine) {
  return `${pageUrl}?stop=${encodeURIComponent(`${topic}.${machine}.${SEQ_MAX}`)}&finish=${machine}`;
}
