-- Upload identities are keyed to owned immutable source bytes, not a single
-- revision/job. A lost post-dispatch outcome is never retried under a new key.
CREATE TABLE native_sample_upload (
  asset_id uuid PRIMARY KEY REFERENCES asset(id),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  asset_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_flight','ready','uncertain')),
  sample_name text,
  duration_seconds double precision,
  dispatch_job_id uuid NOT NULL REFERENCES job(id),
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='ready' AND sample_name IS NOT NULL AND duration_seconds>0) OR state<>'ready')
);
CREATE INDEX native_sample_upload_owner_project_idx ON native_sample_upload(owner_id,project_id);
