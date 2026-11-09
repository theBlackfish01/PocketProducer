-- Optional local discovery hints, never a request, score, authorization or ledger.
CREATE TABLE native_checkpoint_read_cache (
  job_id uuid PRIMARY KEY REFERENCES job(id) ON DELETE CASCADE,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(evidence::text) <= 100000)
);
