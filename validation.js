// Input checks for the API, kept in their own file so they can be unit tested.

const CATEGORIES = ["study", "reading", "work", "journal"];

// Route ids must be positive whole numbers, otherwise Postgres throws an error.
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Returns a list of problems with the body; an empty list means it is valid.
// "= {}" means a request with no body at all gets 400 instead of crashing.
// category and task_id are optional: no category means "study", no task_id means no task.
function validateSession({ label, minutes, category, task_id } = {}) {
  const errors = [];
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 60) {
    errors.push({ field: "label", message: "Label must be 1-60 characters" });
  }
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
    errors.push({ field: "minutes", message: "Minutes must be a whole number from 1 to 180" });
  }
  if (category !== undefined && !CATEGORIES.includes(category)) {
    errors.push({ field: "category", message: "Unknown category" });
  }
  if (task_id !== undefined && task_id !== null && parseId(task_id) === null) {
    errors.push({ field: "task_id", message: "task_id must be a positive whole number" });
  }
  return errors;
}

// Checks the title of a to-do task.
function validateTaskTitle(title) {
  if (typeof title !== "string" || title.trim().length === 0 || title.trim().length > 100) {
    return [{ field: "title", message: "Title must be 1-100 characters" }];
  }
  return [];
}

// A new task: a title, and optionally how many pomodoros it should take (1-12).
function validateTask({ title, estimate } = {}) {
  const errors = validateTaskTitle(title);
  if (estimate !== undefined) {
    const n = Number(estimate);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      errors.push({ field: "estimate", message: "Estimate must be 1-12 pomodoros" });
    }
  }
  return errors;
}

// A habit: a name, one of the categories, and how many sessions a day count as done (1-12).
// For PATCH (partial = true) every field is optional, but at least one must be sent.
function validateHabit({ name, category, target_sessions } = {}, partial = false) {
  const errors = [];
  if (partial && name === undefined && category === undefined && target_sessions === undefined) {
    return [{ field: "body", message: "Send name, category or target_sessions" }];
  }
  if (!partial || name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 60) {
      errors.push({ field: "name", message: "Name must be 1-60 characters" });
    }
  }
  if (!partial || category !== undefined) {
    if (!CATEGORIES.includes(category)) {
      errors.push({ field: "category", message: `Category must be one of: ${CATEGORIES.join(", ")}` });
    }
  }
  if (!partial || target_sessions !== undefined) {
    if (!Number.isInteger(target_sessions) || target_sessions < 1 || target_sessions > 12) {
      errors.push({ field: "target_sessions", message: "Target must be a whole number from 1 to 12 sessions a day" });
    }
  }
  return errors;
}

// "How focused did you feel?" is a whole number from 1 to 5.
function validateRating(rating) {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? []
    : [{ field: "rating", message: "Rating must be a whole number from 1 to 5" }];
}

// PATCH /api/tasks/:id can change done, title, or both, but needs at least one.
function validateTaskUpdate({ done, title } = {}) {
  const errors = [];
  if (done === undefined && title === undefined) {
    errors.push({ field: "body", message: "Send done or title" });
  }
  if (done !== undefined && typeof done !== "boolean") {
    errors.push({ field: "done", message: "done must be true or false" });
  }
  if (title !== undefined) errors.push(...validateTaskTitle(title));
  return errors;
}

// Report range from the query string: day, week or month -> number of days. Anything else -> null (400).
const RANGES = { day: 1, week: 7, month: 30 };
function parseRange(raw) {
  return Object.hasOwn(RANGES, raw) ? RANGES[raw] : null;
}

// Page size for GET /api/sessions: missing -> 20, otherwise a whole number from 1 to 100, else null (400).
function parseLimit(raw) {
  if (raw === undefined) return 20;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

module.exports = {
  CATEGORIES,
  parseRange,
  parseLimit,
  parseId,
  validateSession,
  validateTask,
  validateTaskTitle,
  validateTaskUpdate,
  validateRating,
  validateHabit,
};
