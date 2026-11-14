// Health reminders while you focus (Focus Tracker v3): look 6 m away for 20 seconds every
// 20 minutes (the 20-20-20 rule), and drink water every N minutes (you choose; 45 by default).
//
// Works from time, not by counting ticks: the page passes in how much focus time has gone by
// (only focus time: breaks and pauses don't count), and this says which reminders are due.
// So a tab that was asleep for a while still gives the right answer, and each reminder shows
// once per interval even if several intervals passed (no pile of reminders at once).
// Used by timer.js in the browser and by the tests in Node.
(function (root) {
  const MIN = 60 * 1000;

  // state: { eyeAt, waterAt } = the focus time (ms) when each is next due
  function startReminders({ eye, water, waterEvery = 45 }, focusMs = 0) {
    return {
      eyeAt: eye ? focusMs + 20 * MIN : null,
      waterAt: water ? focusMs + waterEvery * MIN : null,
      waterEvery,
    };
  }

  // Which reminders are due at this much focus time, and the state after showing them
  function dueReminders(state, focusMs) {
    const due = [];
    const next = { ...state };
    if (state.eyeAt !== null && focusMs >= state.eyeAt) {
      due.push("eye");
      next.eyeAt = focusMs + 20 * MIN;
    }
    if (state.waterAt !== null && focusMs >= state.waterAt) {
      due.push("water");
      next.waterAt = focusMs + state.waterEvery * MIN;
    }
    return { due, state: next };
  }

  const api = { startReminders, dueReminders, EYE_BREAK_SECS: 20 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Reminders = api;
})(typeof window !== "undefined" ? window : globalThis);
