-- A bounded, document-bound symbolic/model review belongs to the durable
-- production plan, not to an accepted version or an audio-quality claim.
ALTER TABLE native_job_plan ADD COLUMN creative_review jsonb;
ALTER TABLE native_job_plan ADD COLUMN creative_review_count integer NOT NULL DEFAULT 0 CHECK (creative_review_count >= 0 AND creative_review_count <= 2);
