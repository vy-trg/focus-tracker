// Input checks for the sessions API, kept in their own file so they can be unit tested.

// Returns a list of problems with the body; an empty list means it is valid.
// "= {}" means a request with no body at all gets 400 instead of crashing.
function validateSession({ label, minutes } = {}) {
  const errors = [];
  if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 60) {
    errors.push({ field: "label", message: "Label must be 1-60 characters" });
  }
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
    errors.push({ field: "minutes", message: "Minutes must be a whole number from 1 to 180" });
  }
  return errors;
}

// Route ids must be positive whole numbers, otherwise Postgres throws an error.
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { validateSession, parseId };