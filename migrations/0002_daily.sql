ALTER TABLE scores ADD COLUMN puzzle_date TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_puzzle_date_score
  ON scores (puzzle_date, score DESC, created_at ASC);
