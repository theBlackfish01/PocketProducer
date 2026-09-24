-- A model call and a musical batch are not evidence that a producer turn ended.
-- This lease-fenced marker is written only after the graph returned and the
-- requested structure passed its objective postconditions. It lets a restarted
-- worker distinguish a completed turn from an unfinished confirmed sketch.
CREATE TABLE native_producer_completion (
  job_id uuid PRIMARY KEY REFERENCES job(id) ON DELETE CASCADE,
  document_hash text NOT NULL,
  step_count integer NOT NULL CHECK (step_count > 0),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
