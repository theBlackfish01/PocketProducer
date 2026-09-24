-- New steps record the exact canonical predecessor they were computed from.
-- Historical rows remain NULL; replay checks their result hashes rather than
-- inventing an original predecessor for already accepted data.
ALTER TABLE native_job_step ADD COLUMN predecessor_hash text;
