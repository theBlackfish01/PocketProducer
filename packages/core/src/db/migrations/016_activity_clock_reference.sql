-- Activity publishers already hold their clock lock. A direct project FK would
-- acquire a project key-share lock afterwards, reversing the project -> clock
-- order used by explicit version selection. Cascade through the clock instead.
ALTER TABLE project_activity DROP CONSTRAINT project_activity_project_id_fkey;
ALTER TABLE project_activity ADD CONSTRAINT project_activity_project_id_fkey
  FOREIGN KEY(project_id) REFERENCES project_activity_clock(project_id) ON DELETE CASCADE;
