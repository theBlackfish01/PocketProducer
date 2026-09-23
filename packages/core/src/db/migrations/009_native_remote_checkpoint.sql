CREATE TABLE native_revision_sync (
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  revision_id uuid PRIMARY KEY REFERENCES native_revision(id),
  state text NOT NULL CHECK (state IN ('local','create_in_flight','created','apply_in_flight','verified','conflict','uncertain','failed')),
  remote_project_name text,
  remote_url text,
  expected_document_hash text NOT NULL,
  observed_hash text,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_revision_sync_owner_project_idx ON native_revision_sync(owner_id,project_id);
