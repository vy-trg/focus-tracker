-- Index for keyset pagination of GET /api/sessions: WHERE user_id = $1 AND id < $2 ORDER BY id DESC.
-- Safe to run more than once.
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id, id DESC);
