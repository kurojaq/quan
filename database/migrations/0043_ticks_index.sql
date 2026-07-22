-- Migration 0043: Ticks Index Schema
-- Purpose: Archive index for market-data tick storage (Tick Engine)
-- Stores metadata about tick batches archived to R2 for replay/analysis

CREATE TABLE IF NOT EXISTS ticks_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Session metadata
  date TEXT NOT NULL,                    -- Trading session date (YYYY-MM-DD)
  instrument TEXT NOT NULL,              -- Symbol (ESZ26, ZNM26, SPX, RUT, etc.)
  start_time TIMESTAMP NOT NULL,         -- Session start time (ISO 8601)
  end_time TIMESTAMP NOT NULL,           -- Session end time (ISO 8601)

  -- Tick statistics
  tick_count INTEGER NOT NULL DEFAULT 0, -- Total ticks in this batch
  first_price REAL,                      -- First traded price
  last_price REAL,                       -- Last traded price
  high REAL,                             -- Session high
  low REAL,                              -- Session low

  -- Storage location
  r2_key TEXT NOT NULL UNIQUE,           -- R2 object key (instruments/ESZ26/2026-07-22/09.ndjson)

  -- Status tracking
  status TEXT DEFAULT 'archiving',       -- 'archiving', 'complete', 'failed'

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Composite index: queries by (instrument, date)
CREATE INDEX IF NOT EXISTS idx_ticks_inst_date
  ON ticks_index(instrument, date);

-- Index on R2 key (for lookups by storage location)
CREATE INDEX IF NOT EXISTS idx_ticks_r2_key
  ON ticks_index(r2_key);

-- Index on status (for finding incomplete archives)
CREATE INDEX IF NOT EXISTS idx_ticks_status
  ON ticks_index(status);

-- Index on created_at (for time-range queries)
CREATE INDEX IF NOT EXISTS idx_ticks_created
  ON ticks_index(created_at DESC);

-- View: latest tick batch per instrument
CREATE VIEW IF NOT EXISTS latest_ticks_per_instrument AS
  SELECT
    instrument,
    date,
    start_time,
    end_time,
    tick_count,
    first_price,
    last_price,
    r2_key,
    status
  FROM ticks_index
  WHERE (instrument, date) IN (
    SELECT instrument, MAX(date)
    FROM ticks_index
    WHERE status = 'complete'
    GROUP BY instrument
  )
  ORDER BY instrument;

-- View: daily tick statistics
CREATE VIEW IF NOT EXISTS daily_tick_statistics AS
  SELECT
    date,
    instrument,
    COUNT(*) as batch_count,
    SUM(tick_count) as total_ticks,
    MIN(first_price) as session_low,
    MAX(last_price) as session_high,
    MAX(updated_at) as last_updated
  FROM ticks_index
  WHERE status = 'complete'
  GROUP BY date, instrument
  ORDER BY date DESC, instrument;
