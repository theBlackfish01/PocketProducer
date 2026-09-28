-- Invitations are individual bearer credentials, never a shared public demo password.
CREATE TABLE hosted_access (
  owner_id uuid PRIMARY KEY REFERENCES app_user(id),
  code_hash text UNIQUE NOT NULL CHECK (length(code_hash)=64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hosted_session (
  token_hash text PRIMARY KEY CHECK (length(token_hash)=64),
  owner_id uuid NOT NULL REFERENCES hosted_access(owner_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hosted_session_owner_idx ON hosted_session(owner_id);
CREATE INDEX hosted_session_expiry_idx ON hosted_session(expires_at);
-- A global bounded login window, not an unbounded attacker-controlled IP table.
CREATE TABLE hosted_login_window (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
