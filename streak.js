// Counts how many days in a row the user focused. Kept apart from the database code so it can be unit tested.

// days: distinct "YYYY-MM-DD" strings, newest first. Pure function, unit tested.
function countStreak(days, today) {
  const set = new Set(days);
  const step = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let day = set.has(today) ? today : step(today, -1);
  let streak = 0;
  while (set.has(day)) {
    streak += 1;
    day = step(day, -1);
  }
  return streak;
}

// Longest run of consecutive days ever (within the days given). Same input as countStreak.
function longestStreak(days) {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const iso of sorted) {
    const gap = prev ? (new Date(`${iso}T00:00:00Z`) - new Date(`${prev}T00:00:00Z`)) / 86400000 : null;
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = iso;
  }
  return best;
}

// A streak that ended because yesterday was missed: { days, lastDay }, or null.
// Only yesterday counts: a streak lost a week ago isn't news any more. One day isn't a streak.
function lostStreak(days, today) {
  const set = new Set(days);
  const step = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const yesterday = step(today, -1);
  const lastDay = step(today, -2);
  if (set.has(yesterday) || !set.has(lastDay)) return null;
  const length = countStreak(days, yesterday);
  return length >= 2 ? { days: length, lastDay } : null;
}

// Milliseconds until midnight in Brisbane (UTC+10 all year, no daylight saving)
function msToBrisbaneMidnight(now = Date.now()) {
  const DAY = 86400000;
  const shifted = now + 10 * 3600000;
  return DAY - (shifted % DAY);
}

module.exports = { countStreak, longestStreak, lostStreak, msToBrisbaneMidnight };
