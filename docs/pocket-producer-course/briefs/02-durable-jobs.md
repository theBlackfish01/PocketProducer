# Module 2: API, Database, and Durable Jobs

### Teaching Arc
- **Metaphor:** A registered-mail sorting center where every parcel has a receipt, custody record, and expiry time.
- **Opening hook:** Closing the browser does not stop an accepted production job.
- **Key insight:** PostgreSQL is both the durable state store and the job-control ledger; the worker only acts under a valid lease.
- **Why should I care?:** This is where duplicate billing, worker crashes, cancellation races, and stale writes are prevented.

### Code Snippets (pre-extracted)

File: packages/core/src/db/repository.ts (lines 101-112)
```ts
export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  const result = await getPool().query(
    `WITH candidate AS (
       SELECT id FROM job
       WHERE (state='queued' OR (state='running' AND lease_until < now()))
         AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE job SET state='running',stage=CASE WHEN kind='export' THEN 'exporting' ELSE 'analyzing' END,
       lease_owner=$1,lease_generation=lease_generation+1,lease_until=now()+interval '45 seconds',attempts=attempts+1,updated_at=now()
     WHERE id=(SELECT id FROM candidate)
     RETURNING id,owner_id,project_id,kind,state,stage,request,base_revision_id,expected_head_revision_id,lease_generation,attempts,cancellation_requested_at`,
    [workerId]
```

File: packages/core/src/db/repository.ts (lines 169-185)
```ts
    const jobState = await client.query<{ state: string; lease_generation: number; cancellation_requested_at: Date | null }>("SELECT state,lease_generation,cancellation_requested_at FROM job WHERE id=$1 FOR UPDATE", [job.id]);
    const active = jobState.rows[0];
    if (!active || active.lease_generation !== job.leaseGeneration || active.cancellation_requested_at || active.state !== "running") throw new Error("Job lease or cancellation fence rejected commit");
    const ordinalResult = await client.query<{ next: number }>("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM revision WHERE project_id=$1", [job.projectId]);
    const ordinal = Number(ordinalResult.rows[0]?.next ?? 1);
    const id = randomUUID();
    await client.query(
      `INSERT INTO revision(id,owner_id,project_id,parent_revision_id,creator_job_id,ordinal,title,composition,composition_hash,preview_path,stems,waveform_peaks,duration_seconds,peak,rms,non_silent_ratio,change_summary,protected_track_hashes,producer)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, job.ownerId, job.projectId, job.baseRevisionId, job.id, ordinal, input.title, JSON.stringify(composition), canonicalHash(composition), input.previewPath, JSON.stringify(input.stems), JSON.stringify(input.waveformPeaks), input.durationSeconds, input.peak, input.rms, input.nonSilentRatio, input.summary, JSON.stringify(input.protectedTrackHashes), JSON.stringify(input.producer)]
    );
    const expected = job.kind === "generation" ? project.current_revision_id : job.expectedHeadRevisionId;
    const mayAdvance = (project.current_revision_id ?? null) === (expected ?? null);
    if (mayAdvance) await client.query("UPDATE project SET current_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1", [job.projectId, id]);
    await client.query("UPDATE job SET state='succeeded',stage=NULL,result_revision_id=$2,lease_until=NULL,updated_at=now() WHERE id=$1", [job.id, id]);
    const sequence = await nextSequence(client, job.id);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,$2,'succeeded',$3)", [job.id, sequence, { revisionId: id, selected: mayAdvance }]);
```

### Interactive Elements
- [x] Code↔English translation of job claiming.
- [x] Quiz: 3 debugging scenarios—duplicate key, crashed worker, late stale commit.
- [x] Group chat: API, PostgreSQL, Worker, second Worker discuss accepted job, lease, heartbeat, cancellation, commit fence.
- [x] Visual schema cards: project, asset, job/event/outbox/effect, revision, analysis/export.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Group Chat Animation, Multiple-Choice Quizzes, Pattern/Feature Cards, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: Listening Room Journey established the outer flow.
- Next: The Deep Agent Producer explains the planning step claimed by the worker.
- Tone/style: distinguish a job record from an external effect and from an immutable revision.
