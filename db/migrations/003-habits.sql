-- Habits table (Focus Tracker v3). Safe to run more than once.
-- A habit: "2 study sessions a day". It is ticked automatically from the sessions of that category.
CREATE TABLE IF NOT EXISTS habits (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  category TEXT NOT NULL CHECK (category IN ('study', 'reading', 'work', 'journal')),
  target_sessions INT NOT NULL DEFAULT 1 CHECK (target_sessions BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS habits_user_idx ON habits (user_id, created_at);
