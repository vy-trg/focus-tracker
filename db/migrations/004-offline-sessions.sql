-- Sessions finished offline (Focus Tracker v3). Safe to run more than once.
-- The page gives every session an id of its own (client_id) before sending it, so a session sent
-- twice (the reply got lost when the connection dropped) is saved only once.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_client_idx ON sessions (user_id, client_id) WHERE client_id IS NOT NULL;
