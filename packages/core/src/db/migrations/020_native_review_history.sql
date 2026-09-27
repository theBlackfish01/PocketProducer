-- Later low-information reviews must not erase earlier document-bound findings.
-- The profile now permits up to six focused review attempts.
ALTER TABLE native_job_plan DROP CONSTRAINT IF EXISTS native_job_plan_creative_review_count_check;
ALTER TABLE native_job_plan ADD CONSTRAINT native_job_plan_creative_review_count_check
  CHECK (creative_review_count >= 0 AND creative_review_count <= 6);
ALTER TABLE native_job_plan ADD COLUMN creative_review_history jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(creative_review_history) = 'array');
