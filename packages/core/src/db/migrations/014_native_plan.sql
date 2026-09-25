-- Logical producer progress survives process restart independently of graph messages.
-- This never changes accepted revisions or the canonical native document.
CREATE TABLE native_job_plan (
  job_id uuid PRIMARY KEY REFERENCES job(id) ON DELETE CASCADE,
  plan jsonb NOT NULL,
  stage text NOT NULL CHECK (stage IN ('planned', 'building', 'refining', 'reviewed')),
  inspected_document_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
