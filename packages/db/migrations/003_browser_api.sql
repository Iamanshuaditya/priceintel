ALTER TABLE crawl_runs DROP CONSTRAINT IF EXISTS crawl_runs_status_check;
ALTER TABLE crawl_runs ADD CONSTRAINT crawl_runs_status_check
  CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED'));

ALTER TABLE crawl_runs DROP CONSTRAINT IF EXISTS crawl_runs_attempt_check;
ALTER TABLE crawl_runs ADD CONSTRAINT crawl_runs_attempt_check CHECK (attempt >= 0);
ALTER TABLE crawl_runs ALTER COLUMN started_at DROP NOT NULL;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx ON auth_rate_limits(updated_at);
