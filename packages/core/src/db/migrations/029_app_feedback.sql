-- User feedback is durable product data, outside execution-history retention.
CREATE TABLE app_feedback (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  username text,
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
