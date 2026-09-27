-- Lifetime caps, not balances. Existing effects and unknown liabilities stay intact.
CREATE TABLE owner_usage_limit (
  owner_id uuid PRIMARY KEY REFERENCES app_user(id),
  limit_microusd bigint NOT NULL CHECK (limit_microusd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
