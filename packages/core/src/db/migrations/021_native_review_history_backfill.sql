-- Preserve an earlier current review when adding append-only history to
-- in-progress jobs. Accepted versions and the financial effect ledger stay put.
UPDATE native_job_plan
SET creative_review_history = jsonb_build_array(creative_review)
WHERE creative_review IS NOT NULL
  AND jsonb_array_length(creative_review_history) = 0;
