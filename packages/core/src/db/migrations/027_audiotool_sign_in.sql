-- Account identity comes only from Audiotool GetWhoami, never browser profile data.
ALTER TABLE hosted_access ALTER COLUMN code_hash DROP NOT NULL;
ALTER TABLE hosted_access ALTER COLUMN expires_at DROP NOT NULL;
CREATE TABLE audiotool_identity (
  subject text PRIMARY KEY,
  owner_id uuid UNIQUE NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hosted_oauth_attempt (
  state_hash text PRIMARY KEY,
  verifier_hash text NOT NULL,
  expected_owner_id uuid REFERENCES app_user(id),
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX hosted_oauth_expiry_idx ON hosted_oauth_attempt(expires_at);
CREATE TABLE hosted_write_window (
  owner_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
CREATE INDEX job_active_owner_idx ON job(owner_id) WHERE state IN ('queued','running','cancel_requested');
