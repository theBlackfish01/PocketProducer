-- One-way, cumulative-pool handoff. Original captured limits and effects remain intact.
CREATE TABLE native_model_handoff (
  job_id uuid PRIMARY KEY REFERENCES job(id) ON DELETE CASCADE,
  from_limits jsonb NOT NULL,
  to_limits jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'sol_pool_unavailable' CHECK (reason='sol_pool_unavailable'),
  created_at timestamptz NOT NULL DEFAULT now()
);
