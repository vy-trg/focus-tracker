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

module.exports = {
  CATEGORIES,
  parseRange,
  parseId,
  validateSession,
  validateTask,
  validateTaskTitle,
  validateTaskUpdate,
  validateRating,
};
