-- Six Extended reviews plus the existing, separately accounted single format repair.
-- Domain validation still enforces profile limits and requires a settled repair effect.
ALTER TABLE native_job_plan DROP CONSTRAINT native_job_plan_creative_review_count_check;
ALTER TABLE native_job_plan ADD CONSTRAINT native_job_plan_creative_review_count_check
  CHECK (creative_review_count >= 0 AND creative_review_count <= 7);
