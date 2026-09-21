CREATE TABLE IF NOT EXISTS audiotool_session (
  owner_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  token_tag text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_export
  ADD COLUMN IF NOT EXISTS remote_effects jsonb NOT NULL DEFAULT '{}'::jsonb;
