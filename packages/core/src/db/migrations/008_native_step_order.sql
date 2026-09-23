ALTER TABLE native_job_step ADD COLUMN ordinal integer;
WITH numbered AS (
  SELECT job_id,step_key,row_number() OVER (PARTITION BY job_id ORDER BY created_at,step_key) AS next_ordinal
  FROM native_job_step
)
UPDATE native_job_step n SET ordinal=numbered.next_ordinal
FROM numbered WHERE n.job_id=numbered.job_id AND n.step_key=numbered.step_key;
ALTER TABLE native_job_step ALTER COLUMN ordinal SET NOT NULL;
ALTER TABLE native_job_step ADD CONSTRAINT native_job_step_ordinal_unique UNIQUE(job_id,ordinal);
