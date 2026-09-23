-- Native construction is an independent immutable history. Legacy revision rows,
-- preview paths, stems and project.current_revision_id are never rewritten.
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_kind_check;
ALTER TABLE job ADD CONSTRAINT job_kind_check CHECK (kind IN ('generation','revision','export','native-generation','native-revision','native-sync'));
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_stage_check;
ALTER TABLE job ADD CONSTRAINT job_stage_check CHECK (stage IS NULL OR stage IN ('analyzing','planning','composing','rendering','checking','exporting','discovering','constructing','validating','synchronizing'));

CREATE TABLE native_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  parent_revision_id uuid REFERENCES native_revision(id),
  creator_job_id uuid NOT NULL REFERENCES job(id),
  ordinal integer NOT NULL,
  document jsonb NOT NULL,
  document_hash text NOT NULL,
  change_summary text NOT NULL,
  structural_diff jsonb NOT NULL,
  producer jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, ordinal),
  UNIQUE(project_id, document_hash)
);
CREATE INDEX native_revision_owner_project_idx ON native_revision(owner_id,project_id,ordinal DESC);

CREATE TABLE native_project_head (
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid PRIMARY KEY REFERENCES project(id),
  revision_id uuid NOT NULL REFERENCES native_revision(id),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE job ADD COLUMN result_native_revision_id uuid REFERENCES native_revision(id);

CREATE TABLE native_job_step (
  job_id uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  operation_hash text NOT NULL,
  operations jsonb NOT NULL,
  result_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,step_key)
);

CREATE TABLE native_sync (
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid PRIMARY KEY REFERENCES project(id),
  revision_id uuid NOT NULL REFERENCES native_revision(id),
  state text NOT NULL CHECK (state IN ('local','pending','applying','verified','conflict','uncertain','failed')),
  remote_project_name text,
  remote_url text,
  observed_hash text,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
