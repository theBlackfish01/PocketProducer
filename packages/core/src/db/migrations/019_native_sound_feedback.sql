CREATE TABLE native_sound_feedback (
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sample_name text NOT NULL,
  content_hash char(64) NOT NULL,
  rating text NOT NULL CHECK (rating IN ('fits', 'not-for-this')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, project_id, sample_name, content_hash)
);
