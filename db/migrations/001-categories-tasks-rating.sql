-- 5/11: categories, to-do tasks, focus rating.
-- Run once on Neon dev first, then on production right before merging.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'study'
  CHECK (category IN ('study', 'reading', 'work', 'journal'));

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  estimate INT NOT NULL DEFAULT 1 CHECK (estimate BETWEEN 1 AND 12),
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id, done, created_at);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS task_id INT REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS rating INT CHECK (rating BETWEEN 1 AND 5);
