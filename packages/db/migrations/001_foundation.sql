CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku text NOT NULL,
  title text NOT NULL,
  current_price numeric(18,4),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, sku)
);

CREATE TABLE IF NOT EXISTS competitor_listings (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  url text NOT NULL,
  retailer text NOT NULL,
  health text NOT NULL DEFAULT 'STALE' CHECK (health IN ('HEALTHY','STALE','DEGRADED','BLOCKED','PARSE_FAILED','PAGE_MISSING','NEEDS_REVIEW')),
  current_price numeric(18,4),
  current_currency char(3),
  current_stock_status text CHECK (current_stock_status IN ('IN_STOCK','OUT_OF_STOCK','UNKNOWN')),
  last_crawl_at timestamptz,
  last_successful_crawl_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT competitor_listing_product_workspace_fk
    FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id text PRIMARY KEY,
  job_key text NOT NULL UNIQUE,
  workspace_id text NOT NULL,
  listing_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT crawl_run_listing_workspace_fk
    FOREIGN KEY (listing_id, workspace_id) REFERENCES competitor_listings(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_observations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  product_id text NOT NULL,
  competitor_listing_id text NOT NULL,
  crawl_run_id text NOT NULL UNIQUE,
  fetched_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  currency char(3) NOT NULL,
  price numeric(18,4) NOT NULL CHECK (price >= 0),
  stock_status text NOT NULL CHECK (stock_status IN ('IN_STOCK','OUT_OF_STOCK','UNKNOWN')),
  seller_name text,
  source_method text NOT NULL,
  extractor_version text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT observation_listing_workspace_fk
    FOREIGN KEY (competitor_listing_id, workspace_id) REFERENCES competitor_listings(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT observation_product_workspace_fk
    FOREIGN KEY (product_id, workspace_id) REFERENCES products(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT observation_crawl_workspace_fk
    FOREIGN KEY (crawl_run_id, workspace_id) REFERENCES crawl_runs(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS price_observations_listing_verified_idx
  ON price_observations (competitor_listing_id, verified_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS change_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  listing_id text NOT NULL,
  observation_id text NOT NULL,
  previous_observation_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('PRICE_CHANGED','STOCK_CHANGED')),
  previous_value jsonb NOT NULL,
  current_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (observation_id, type),
  CONSTRAINT change_listing_workspace_fk
    FOREIGN KEY (listing_id, workspace_id) REFERENCES competitor_listings(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT change_observation_workspace_fk
    FOREIGN KEY (observation_id, workspace_id) REFERENCES price_observations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  change_event_id text NOT NULL REFERENCES change_events(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('WEBHOOK','EMAIL','SLACK')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (change_event_id, channel)
);
