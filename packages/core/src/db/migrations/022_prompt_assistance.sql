-- Writing assistance has no composition job, but shares the provider ledger.
CREATE TABLE prompt_assistance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid NOT NULL REFERENCES project(id),
  idempotency_key uuid NOT NULL,
  input_hash text NOT NULL,
  request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX prompt_assistance_project ON prompt_assistance(project_id, created_at);
ALTER TABLE effect ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE effect ADD COLUMN prompt_assistance_id uuid UNIQUE REFERENCES prompt_assistance(id);
ALTER TABLE effect ADD CONSTRAINT effect_execution_identity CHECK (
  (job_id IS NOT NULL AND prompt_assistance_id IS NULL) OR
  (job_id IS NULL AND prompt_assistance_id IS NOT NULL)
);
