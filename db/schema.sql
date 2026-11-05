-- Full schema for a fresh database (Docker compose runs this on first start).
-- For an existing database, run the files in db/migrations/ instead.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 30),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  estimate INT NOT NULL DEFAULT 1 CHECK (estimate BETWEEN 1 AND 12),
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id, done, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  minutes INT NOT NULL CHECK (minutes BETWEEN 1 AND 180),
  category TEXT NOT NULL DEFAULT 'study' CHECK (category IN ('study', 'reading', 'work', 'journal')),
  task_id INT REFERENCES tasks(id) ON DELETE SET NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_started_idx ON sessions (user_id, started_at DESC);
