ALTER TABLE audio_analysis
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','unavailable')),
  ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_cost_usd numeric(10,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS audio_analysis_project_created_idx
  ON audio_analysis(owner_id, project_id, created_at DESC);
