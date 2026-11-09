// Works out each habit's progress from the sessions the user finished.
// No database code here, so every rule can be unit tested.

// The calendar day ("YYYY-MM-DD") a moment falls on in Brisbane.
// A session saved at 11:50 pm counts for that day; one saved at 12:05 am counts for the next.
function brisbaneDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date(date));
}

// "2026-11-10" moved by n days
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// How many days in a row the habit hit its target.
// counts: { "YYYY-MM-DD": sessions of the habit's category that day }
// Today not done yet does not break the streak (the day isn't over); it starts from yesterday instead.
// Days before the habit was created are never counted.
function habitStreak(counts, target, today, startDay) {
  const hit = (day) => (counts[day] || 0) >= target;
  let day = hit(today) ? today : addDays(today, -1);
  let streak = 0;
  while (day >= startDay && hit(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

// Everything the page needs for one habit.
// habit: { id, name, category, target_sessions, created_at }
// countsByCategory: { study: { "2026-11-10": 2, ... }, reading: {...} }
function habitProgress(habit, countsByCategory, today) {
  const counts = countsByCategory[habit.category] || {};
  const target = habit.target_sessions;
  const startDay = brisbaneDay(habit.created_at);
  const doneToday = counts[today] || 0;

  // The last 7 days, oldest first. Days before the habit existed are marked so the page can grey them out.
  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const sessions = counts[day] || 0;
    last7.push({ day, sessions, done: sessions >= target, before: day < startDay });
  }

  return {
    ...habit,
    today: { sessions: doneToday, target, done: doneToday >= target },
    last7,
    streak: habitStreak(counts, target, today, startDay),
  };
}

// Rows from the database ({ category, day, count }) into { category: { day: count } }
function groupCounts(rows) {
  const out = {};
  for (const { category, day, count } of rows) {
    if (!out[category]) out[category] = {};
    out[category][day] = Number(count);
  }
  return out;
}

module.exports = { brisbaneDay, addDays, habitStreak, habitProgress, groupCounts };
