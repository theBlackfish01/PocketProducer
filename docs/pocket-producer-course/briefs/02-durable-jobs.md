# Module 2: API, Database, and Durable Jobs

### Teaching Arc
- **Metaphor:** A registered-mail sorting center where every parcel has a receipt, custody record, and expiry time.
- **Opening hook:** Closing the browser does not stop an accepted production job.
- **Key insight:** PostgreSQL is both the durable state store and the job-control ledger; the worker only acts under a valid lease.
- **Why should I care?:** This is where duplicate billing, worker crashes, cancellation races, and stale writes are prevented.

### Code Snippets (pre-extracted)

File: packages/core/src/db/repository.ts (`claimNextJob`)
```ts
export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  const result = await getPool().query(
    `WITH candidate AS (
       SELECT id FROM job
       WHERE (state='queued' OR (state IN ('running','cancel_requested') AND lease_until < now()))
         AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE job SET state=CASE WHEN job.state='cancel_requested' THEN 'cancel_requested' ELSE 'running' END,
       lease_owner=$1,lease_generation=lease_generation+1,attempt_id=gen_random_uuid(),
       lease_until=now()+make_interval(secs=>$2),attempts=attempts+1,updated_at=now()
     WHERE id=(SELECT id FROM candidate)
     RETURNING id,state,lease_owner,lease_generation,attempt_id,lease_until,deadline_at,cancellation_requested_at`,
    [workerId, getConfig().JOB_LEASE_SECONDS]
```

File: packages/core/src/db/repository.ts (`appendAttemptEvent`)
```ts
    const active = await client.query<{ state: string; cancellation_requested_at: Date | null; deadline_at: Date }>(
      `UPDATE job SET stage=COALESCE($5,stage),updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND lease_until>now() AND deadline_at>now()
       RETURNING state,cancellation_requested_at,deadline_at`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, stage ?? null]
    );
    const row = active.rows[0];
    if (!row) throw new JobControlError("LEASE_LOST", "Worker lease or deadline rejected progress");
    if (row.cancellation_requested_at || row.state === "cancel_requested") throw new JobControlError("CANCELLED", "Cancellation requested");
    if (row.state !== "running") throw new JobControlError("LEASE_LOST", "Job is no longer running");
    await insertJobEvent(client, job.id, eventType, payload);
```

File: packages/core/src/db/repository.ts (`commitRevision` fence)
```ts
    const jobState = await client.query<{ state: string; lease_generation: number; attempt_id: string | null; lease_owner: string | null; lease_valid: boolean; deadline_valid: boolean; cancellation_requested_at: Date | null }>("SELECT state,lease_generation,attempt_id,lease_owner,lease_until>now() AS lease_valid,deadline_at>now() AS deadline_valid,cancellation_requested_at FROM job WHERE id=$1 FOR UPDATE", [job.id]);
    const active = jobState.rows[0];
    if (active?.cancellation_requested_at || active?.state === "cancel_requested") throw new JobControlError("CANCELLED", "Cancellation fence rejected commit");
    if (!active || active.lease_generation !== job.leaseGeneration || active.attempt_id !== job.attemptId || active.lease_owner !== job.leaseOwner || active.state !== "running" || !active.lease_valid) {
      throw new JobControlError("LEASE_LOST", "Job lease rejected commit");
    }
    if (!active.deadline_valid) throw new JobControlError("DEADLINE_EXCEEDED", "Job deadline rejected commit");
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
