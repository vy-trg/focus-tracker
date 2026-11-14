-- Health reminders while focusing (Focus Tracker v3). Safe to run more than once.
-- Each person's choices are kept with their account, so they follow them to another device.
ALTER TABLE users ADD COLUMN IF NOT EXISTS eye_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_every INT NOT NULL DEFAULT 45;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_water_every_check CHECK (water_every BETWEEN 15 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Each eye break taken or glass of water had, so Today can count them
CREATE TABLE IF NOT EXISTS health_breaks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('eye', 'water')),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_breaks_user_at_idx ON health_breaks (user_id, at);
