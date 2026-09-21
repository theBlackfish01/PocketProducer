ALTER TABLE job
  ADD COLUMN IF NOT EXISTS attempt_id uuid,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_event_sequence integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS estimated_cost_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_microusd bigint NOT NULL DEFAULT 0;

UPDATE job
SET deadline_at = COALESCE(deadline_at, created_at + interval '5 minutes'),
    estimated_cost_microusd = GREATEST(estimated_cost_microusd, round(estimated_cost_usd * 1000000)::bigint),
    actual_cost_microusd = GREATEST(actual_cost_microusd, round(actual_cost_usd * 1000000)::bigint);

UPDATE job j
SET next_event_sequence = events.next_sequence
FROM (
  SELECT job_id, COALESCE(MAX(sequence), 0) + 1 AS next_sequence
  FROM job_event
  GROUP BY job_id
) events
WHERE events.job_id = j.id;

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint WHERE conrelid = 'job'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE job DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE job
  ADD CONSTRAINT job_command_identity_unique UNIQUE(owner_id, project_id, kind, idempotency_key);

ALTER TABLE effect DROP CONSTRAINT IF EXISTS effect_state_check;
UPDATE effect SET state='reserved' WHERE state='pending';
ALTER TABLE effect
  ADD CONSTRAINT effect_state_check CHECK (state IN ('reserved','dispatched','succeeded','failed','uncertain')),
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS reservation_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE effect
SET actual_cost_microusd = GREATEST(actual_cost_microusd, round(cost_usd * 1000000)::bigint);

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint WHERE conrelid = 'audio_analysis'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE audio_analysis DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE audio_analysis DROP CONSTRAINT IF EXISTS audio_analysis_status_check;
ALTER TABLE audio_analysis
  ADD CONSTRAINT audio_analysis_status_check CHECK (status IN ('available','unavailable','failed','uncritiqued')),
  ADD CONSTRAINT audio_analysis_scoped_identity_unique
    UNIQUE(owner_id, project_id, asset_hash, provider, model, purpose, prompt_version, interval_start, interval_end);

ALTER TABLE revision ADD COLUMN IF NOT EXISTS preview_hash text;

ALTER TABLE project_export DROP CONSTRAINT IF EXISTS project_export_state_check;
UPDATE project_export SET state = CASE state
  WHEN 'queued' THEN 'exporting'
  WHEN 'ready' THEN 'completed'
  WHEN 'needs_auth' THEN 'awaiting_authorization'
  ELSE state
END;
ALTER TABLE project_export
  ADD CONSTRAINT project_export_state_check
  CHECK (state IN ('disabled','awaiting_authorization','exporting','failed','uncertain','completed'));
