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

-- Sessions finished offline carry an id made by the page, so sending one twice saves it once
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_client_idx ON sessions (user_id, client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_user_started_idx ON sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id, id DESC);

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

-- Health reminders while focusing: each person's choices, and each break taken
ALTER TABLE users ADD COLUMN IF NOT EXISTS eye_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_every INT NOT NULL DEFAULT 45;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_water_every_check CHECK (water_every BETWEEN 15 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS health_breaks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('eye', 'water')),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_breaks_user_at_idx ON health_breaks (user_id, at);
