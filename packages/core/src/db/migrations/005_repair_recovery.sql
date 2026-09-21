ALTER TABLE effect
  ADD COLUMN IF NOT EXISTS attempt_id uuid,
  ADD COLUMN IF NOT EXISTS lease_generation integer,
  ADD COLUMN IF NOT EXISTS cost_status text NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS finalization_key text;

ALTER TABLE effect DROP CONSTRAINT IF EXISTS effect_cost_status_check;
ALTER TABLE effect
  ADD CONSTRAINT effect_cost_status_check CHECK (cost_status IN ('observed','unknown'));

-- A dispatched provider request with no retained usage evidence is a liability,
-- not evidence that the provider charged zero.
UPDATE effect
SET cost_status='unknown'
WHERE dispatched_at IS NOT NULL
  AND state IN ('failed','uncertain','dispatched')
  AND actual_cost_microusd=0;

CREATE TABLE IF NOT EXISTS audio_analysis_revision (
  analysis_id uuid NOT NULL REFERENCES audio_analysis(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(analysis_id, revision_id)
);

ALTER TABLE audio_analysis DROP CONSTRAINT IF EXISTS audio_analysis_scoped_identity_unique;
ALTER TABLE audio_analysis DROP CONSTRAINT IF EXISTS audio_analysis_result_identity_unique;
ALTER TABLE audio_analysis
  ADD CONSTRAINT audio_analysis_result_identity_unique
  UNIQUE(owner_id,project_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,status);

INSERT INTO audio_analysis_revision(analysis_id,revision_id,owner_id,project_id)
SELECT id,revision_id,owner_id,project_id
FROM audio_analysis
WHERE revision_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE project_export
  ADD COLUMN IF NOT EXISTS operation_key text,
  ADD COLUMN IF NOT EXISTS mapping_version text NOT NULL DEFAULT 'nexus-stem-v3';

UPDATE project_export
SET operation_key = COALESCE(operation_key, revision_id::text || ':audiotool:' || mapping_version)
WHERE operation_key IS NULL;

ALTER TABLE project_export ALTER COLUMN operation_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_export_operation_key_unique
  ON project_export(owner_id, operation_key);

CREATE TABLE IF NOT EXISTS project_export_step (
  export_id uuid NOT NULL REFERENCES project_export(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('never_dispatched','in_flight','succeeded','failed','uncertain')),
  attempt_id uuid,
  lease_generation integer,
  remote_id text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(export_id, step_key)
);

CREATE INDEX IF NOT EXISTS project_export_step_state_idx
  ON project_export_step(export_id,state);
