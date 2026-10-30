-- Run this once in the Neon SQL Editor (or psql) to create the table.
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  minutes INT NOT NULL CHECK (minutes BETWEEN 1 AND 180),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
