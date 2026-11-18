-- Durable product records are independent of execution-history retention.
ALTER TABLE job ADD COLUMN release_sha text;
CREATE TABLE version_rating (
  revision_id uuid PRIMARY KEY REFERENCES native_revision(id),
  vote text NOT NULL CHECK (vote IN ('up','down')),
  reason text CHECK (reason IN ('Direction','Arrangement','Sound choices','Other')),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 600),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Fixed storage per UTC month. Bucket collisions are accounted for when reporting.
CREATE TABLE visitor_month (
  month date PRIMARY KEY,
  buckets bit(65536) NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now()
);
