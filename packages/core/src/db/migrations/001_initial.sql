CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_subject text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  current_revision_id uuid,
  version integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_owner_created_idx ON project(owner_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  kind text NOT NULL CHECK (kind IN ('source', 'preview', 'stem')),
  name text NOT NULL,
  content_hash text NOT NULL,
  object_path text NOT NULL,
  mime_type text NOT NULL,
  duration_seconds double precision NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 300),
  sample_rate integer NOT NULL,
  channels integer NOT NULL CHECK (channels IN (1, 2)),
  readiness text NOT NULL CHECK (readiness IN ('ready', 'failed')),
  provenance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, project_id, content_hash, kind)
);
CREATE INDEX IF NOT EXISTS asset_owner_project_idx ON asset(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  kind text NOT NULL CHECK (kind IN ('generation', 'revision', 'export')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  base_revision_id uuid,
  expected_head_revision_id uuid,
  state text NOT NULL CHECK (state IN ('queued','running','needs_input','cancel_requested','cancelled','succeeded','failed','needs_attention')),
  stage text CHECK (stage IS NULL OR stage IN ('analyzing','planning','composing','rendering','checking','exporting')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_generation integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  cancellation_requested_at timestamptz,
  result_revision_id uuid,
  error_code text,
  error_message text,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  actual_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, kind, idempotency_key)
);
CREATE INDEX IF NOT EXISTS job_queue_idx ON job(state, lease_until, created_at);
CREATE INDEX IF NOT EXISTS job_owner_project_idx ON job(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  parent_revision_id uuid REFERENCES revision(id),
  creator_job_id uuid NOT NULL REFERENCES job(id),
  ordinal integer NOT NULL,
  title text NOT NULL,
  composition jsonb NOT NULL,
  composition_hash text NOT NULL,
  preview_path text NOT NULL,
  stems jsonb NOT NULL,
  waveform_peaks jsonb NOT NULL,
  duration_seconds double precision NOT NULL,
  peak double precision NOT NULL,
  rms double precision NOT NULL,
  non_silent_ratio double precision NOT NULL,
  change_summary text NOT NULL,
  protected_track_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  producer jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, ordinal),
  UNIQUE(project_id, composition_hash)
);
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_current_revision_fk;
ALTER TABLE project ADD CONSTRAINT project_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES revision(id);
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_result_revision_fk;
ALTER TABLE job ADD CONSTRAINT job_result_revision_fk FOREIGN KEY (result_revision_id) REFERENCES revision(id);
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_base_revision_fk;
ALTER TABLE job ADD CONSTRAINT job_base_revision_fk FOREIGN KEY (base_revision_id) REFERENCES revision(id);
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_expected_head_fk;
ALTER TABLE job ADD CONSTRAINT job_expected_head_fk FOREIGN KEY (expected_head_revision_id) REFERENCES revision(id);

CREATE TABLE IF NOT EXISTS job_event (
  job_id uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id, sequence)
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES job(id) ON DELETE CASCADE,
  topic text NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS effect (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  step text NOT NULL,
  idempotency_key text NOT NULL,
  input_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','succeeded','unknown','failed')),
  provider text NOT NULL,
  provider_request_id text,
  output jsonb,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audio_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  revision_id uuid REFERENCES revision(id),
  asset_hash text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  purpose text NOT NULL,
  prompt_version text NOT NULL,
  interval_start double precision NOT NULL,
  interval_end double precision NOT NULL,
  measured jsonb NOT NULL,
  observations jsonb NOT NULL,
  uncertainty text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_hash, provider, model, purpose, prompt_version, interval_start, interval_end)
);

CREATE TABLE IF NOT EXISTS project_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  revision_id uuid NOT NULL REFERENCES revision(id),
  job_id uuid NOT NULL REFERENCES job(id),
  provider text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','ready','failed','needs_auth')),
  fidelity jsonb NOT NULL,
  manifest_path text,
  remote_project_id text,
  remote_url text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id, provider)
);

INSERT INTO app_user(provider_subject, display_name)
VALUES ('dev-loopback', 'Local listener')
ON CONFLICT (provider_subject) DO NOTHING;

