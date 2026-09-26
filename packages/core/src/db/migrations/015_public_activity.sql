-- Cursor allocation is serialized per room until commit, not by a global sequence.
CREATE TABLE project_activity_clock (
  project_id uuid PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  cursor bigint NOT NULL DEFAULT 0 CHECK (cursor >= 0)
);
CREATE TABLE project_activity (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  cursor bigint NOT NULL,
  origin text NOT NULL,
  job_id uuid REFERENCES job(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,cursor),
  UNIQUE(project_id,origin)
);
-- Older requests are factual historical directions, not invented producer commentary.
INSERT INTO project_activity(project_id,owner_id,cursor,origin,job_id,payload,created_at)
SELECT project_id,owner_id,row_number() OVER(PARTITION BY project_id ORDER BY created_at,id),
  'request:'||id,id,jsonb_build_object('version',1,'kind','request','text',left(COALESCE(request->>'direction',''),32768),'historical',true),created_at
FROM job WHERE kind IN ('native-generation','native-revision');
INSERT INTO project_activity_clock(project_id,cursor)
SELECT project_id,max(cursor) FROM project_activity GROUP BY project_id;
