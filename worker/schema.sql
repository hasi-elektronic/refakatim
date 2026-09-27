CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('contact','apply')),
  payload_json TEXT NOT NULL,
  phone       TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  emailed     INTEGER NOT NULL DEFAULT 0,
  duplicate   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_created ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_sub_phone ON submissions(phone, created_at);
