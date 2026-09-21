-- A post-dispatch SDK TypeError with no response/request evidence cannot prove
-- that Gemini rejected the request before accepting any billable work.
UPDATE effect
SET state='uncertain',cost_status='unknown',updated_at=now()
WHERE provider='gemini'
  AND dispatched_at IS NOT NULL
  AND state='failed'
  AND actual_cost_microusd=0
  AND provider_request_id IS NULL
  AND output->>'errorClass'='TypeError';
