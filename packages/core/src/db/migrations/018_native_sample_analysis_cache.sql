-- Model opinion is reused only for the same owner, exact selected bytes,
-- model and prompt version. Measured audio facts are always recomputed from
-- the current bytes and never inherited from this table.
CREATE TABLE native_sample_analysis_cache (
  owner_id uuid NOT NULL REFERENCES app_user(id),
  cache_key text NOT NULL,
  asset_hash char(64) NOT NULL,
  model text NOT NULL,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, cache_key)
);
CREATE INDEX native_sample_analysis_cache_created ON native_sample_analysis_cache(owner_id, created_at DESC);
