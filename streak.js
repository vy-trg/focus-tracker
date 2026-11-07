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

module.exports = { countStreak, longestStreak };
