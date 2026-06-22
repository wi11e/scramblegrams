CREATE TABLE IF NOT EXISTS scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name  TEXT    NOT NULL,
  country_code TEXT    NOT NULL,
  mode         TEXT    NOT NULL CHECK(mode IN ('classical','bullet','blitz','rapid')),
  score        INTEGER NOT NULL,
  words        TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_mode_score
  ON scores (mode, score DESC, created_at ASC);
