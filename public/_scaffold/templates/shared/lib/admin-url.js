const ADMIN_ANIMALS_BY_MONDAY_FIRST_DAY = Object.freeze([
  'dog',
  'rat',
  'ant',
  'fish',
  'fly',
  'cat',
  'cockroach'
]);

const WEEKDAY_INDEX = Object.freeze({
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
});

/**
 * Build the date-rotating owner dashboard path in the practice site's time zone.
 * The animal sequence is Monday-first, so Tuesday maps to "rat" and the
 * generated route begins with its final letter: /tadmin8/dashboard.
 */
function adminDashboardPath(date = new Date(), timeZone = 'Asia/Manila') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric'
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const dayOfMonth = parts.find((part) => part.type === 'day')?.value;
  const weekdayIndex = WEEKDAY_INDEX[weekday];
  const animal = ADMIN_ANIMALS_BY_MONDAY_FIRST_DAY[weekdayIndex];

  if (!animal || !dayOfMonth) throw new RangeError('Could not determine the current owner dashboard path.');
  return `/${animal.slice(-1)}admin${Number(dayOfMonth)}/dashboard`;
}

function isAdminDashboardPath(pathname) {
  return /^\/[a-z]admin(?:[1-9]|[12][0-9]|3[01])\/dashboard$/.test(String(pathname || ''));
}

export { ADMIN_ANIMALS_BY_MONDAY_FIRST_DAY, adminDashboardPath, isAdminDashboardPath };
