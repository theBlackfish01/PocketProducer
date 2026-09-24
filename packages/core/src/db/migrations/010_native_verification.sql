-- Old verified rows remain historical evidence, not a claim of current Studio state.
ALTER TABLE native_revision_sync ADD COLUMN mapping_version text;
ALTER TABLE native_revision_sync ADD COLUMN verified_at timestamptz;
ALTER TABLE native_sync ADD COLUMN mapping_version text;
ALTER TABLE native_sync ADD COLUMN verified_at timestamptz;
