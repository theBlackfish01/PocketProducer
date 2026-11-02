import type pg from "pg";
import { createHash } from "node:crypto";
import { getConfig } from "../config.js";
import { getPool } from "./pool.js";

const MB = 1_000_000; // Railway's configured volume capacity is decimal MB.
const intervalMs = 300_000;
const tables = ["checkpoint_writes", "checkpoint_blobs", "checkpoints"] as const;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const threadFormat = `^${uuid}(:${uuid}(:[a-zA-Z0-9._-]{1,100})?)?$`;

// Deliberately exclude failed/cancelled/paused jobs and unmatched historical
// threads. A saved revision alone is not proof that all paid work is settled.
const eligible = `j.kind IN ('native-generation','native-revision') AND j.state='succeeded'
  AND j.updated_at < now() - make_interval(days => $1)
  AND j.lease_owner IS NULL AND j.lease_until IS NULL AND j.attempt_id IS NULL
  AND EXISTS (SELECT 1 FROM native_revision r JOIN native_producer_completion done
    ON done.job_id=j.id AND done.document_hash=r.document_hash
    WHERE r.id=j.result_native_revision_id AND r.creator_job_id=j.id
      AND r.owner_id=j.owner_id AND r.project_id=j.project_id)
  AND NOT EXISTS (SELECT 1 FROM effect e WHERE e.job_id=j.id
    AND (e.state NOT IN ('succeeded','failed') OR e.cost_status<>'observed'))
  AND NOT EXISTS (SELECT 1 FROM native_sample_upload u WHERE u.project_id=j.project_id AND u.state<>'ready')
  AND NOT EXISTS (SELECT 1 FROM native_revision_sync s WHERE s.project_id=j.project_id
    AND s.state IN ('create_in_flight','apply_in_flight','uncertain'))`;

async function hasCheckpoints(client: pg.PoolClient) {
  const result = await client.query<{ present: boolean }>("SELECT to_regclass('public.checkpoints') IS NOT NULL AND to_regclass('public.checkpoint_blobs') IS NOT NULL AND to_regclass('public.checkpoint_writes') IS NOT NULL AS present");
  return result.rows[0]!.present;
}

/** Explicit, offline-only reclamation. Never called by the worker's retention loop.
 * Discards provider execution history, not canonical drafts, versions or the ledger.
 * A resumed native job gets a new attempt/thread and rebuilds from domain records.
 * Unknown provider liabilities remain unknown and still block unsafe recovery.
 */
export async function discardExecutionCheckpoints() {
  if (!getConfig().HOSTED_MAINTENANCE) throw new Error("CHECKPOINT_RESET_REQUIRES_MAINTENANCE");
  const client = await getPool().connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('pocket-checkpoint-retention')) AS acquired");
    if (!lock.rows[0]!.acquired) throw new Error("CHECKPOINT_MAINTENANCE_BUSY");
    // Also serialize against job creation/claims: maintenance must already be
    // serving on every replica, with API and worker processes stopped.
    await client.query("LOCK TABLE public.job IN SHARE ROW EXCLUSIVE MODE");
    const active = await client.query(`SELECT 1 FROM public.job WHERE state IN ('queued','running','cancel_requested')
      OR lease_owner IS NOT NULL OR lease_until IS NOT NULL OR attempt_id IS NOT NULL LIMIT 1`);
    if (active.rowCount) throw new Error("CHECKPOINT_RESET_HAS_ACTIVE_JOBS");
    if (!await hasCheckpoints(client)) throw new Error("CHECKPOINT_TABLES_MISSING");
    await client.query("LOCK TABLE public.checkpoint_writes, public.checkpoint_blobs, public.checkpoints IN ACCESS EXCLUSIVE MODE");
    const before = await client.query<{ bytes: string; rows: string }>(`SELECT
      (pg_total_relation_size('public.checkpoint_writes') + pg_total_relation_size('public.checkpoint_blobs') + pg_total_relation_size('public.checkpoints'))::text AS bytes,
      ((SELECT count(*) FROM public.checkpoint_writes) + (SELECT count(*) FROM public.checkpoint_blobs) + (SELECT count(*) FROM public.checkpoints))::text AS rows`);
    // RESTRICT is intentional. Never follow foreign keys into unrelated tables.
    // Unlike DELETE/VACUUM this releases the table files without a large rewrite.
    await client.query("TRUNCATE ONLY public.checkpoint_writes, ONLY public.checkpoint_blobs, ONLY public.checkpoints CONTINUE IDENTITY RESTRICT");
    await client.query("COMMIT");
    committed = true;
    return { discardedRows: Number(before.rows[0]!.rows), previousTableBytes: Number(before.rows[0]!.bytes) };
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export async function pruneCheckpoints(options: { apply?: boolean; retentionDays?: number; limit?: number } = {}) {
  const retentionDays = options.retentionDays ?? getConfig().CHECKPOINT_RETENTION_DAYS;
  const limit = options.limit ?? 10;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365 || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Invalid checkpoint retention bounds");
  const result = { mode: options.apply ? "apply" : "dry-run", candidateThreads: 0, prunedThreads: 0, deletedRows: 0, checkpointBytes: 0, prunedThreadDigests: [] as string[] };
  const client = await getPool().connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    if (!await hasCheckpoints(client)) return result;
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('pocket-checkpoint-retention')) AS acquired");
    if (!lock.rows[0]!.acquired) return result;
    const candidates = await client.query<{ thread_id: string; job_id: string }>(
      `SELECT DISTINCT cp.thread_id,j.id AS job_id FROM checkpoints cp
       JOIN job j ON j.id::text=split_part(cp.thread_id,':',1)
       WHERE ${eligible} AND cp.thread_id ~ $2 ORDER BY cp.thread_id LIMIT $3`, [retentionDays, threadFormat, limit]);
    result.candidateThreads = candidates.rows.length;
    const deadline = Date.now() + 15_000;
    for (const row of candidates.rows) {
      if (Date.now() >= deadline) break;
      // Serialize with domain transitions and recheck after acquiring the job
      // lock. Never invoke PostgresSaver.deleteThread on another connection.
      const stillEligible = await client.query(`SELECT j.id FROM job j WHERE j.id=$2 AND ${eligible} FOR UPDATE OF j SKIP LOCKED`, [retentionDays, row.job_id]);
      if (!stillEligible.rowCount) continue;
      const bytes = await client.query<{ bytes: string }>(`SELECT COALESCE(sum(pg_column_size(blob)),0)::text AS bytes FROM checkpoint_blobs WHERE thread_id=$1`, [row.thread_id]);
      result.checkpointBytes += Number(bytes.rows[0]!.bytes);
      if (!options.apply) continue;
      for (const table of tables) {
        const deleted = await client.query(`DELETE FROM ${table} WHERE thread_id=$1`, [row.thread_id]);
        result.deletedRows += deleted.rowCount ?? 0;
      }
      result.prunedThreads++;
      result.prunedThreadDigests.push(createHash("sha256").update(row.thread_id).digest("hex"));
    }
    await client.query("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export type StorageReport = {
  databaseBytes: number; walBytes: number | null; capacityBytes: number;
  accountedBytes: number; pressure: "normal" | "warning" | "high" | "critical";
  relations: Array<{ name: string; bytes: number; liveRows: number; deadRows: number }>;
};

export function storagePressure(bytes: number, capacity: number): StorageReport["pressure"] {
  if (!capacity) return "normal";
  const ratio = bytes / capacity;
  return ratio >= 0.95 ? "critical" : ratio >= 0.85 ? "high" : ratio >= 0.7 ? "warning" : "normal";
}

export async function databaseStorageReport(): Promise<StorageReport> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='5s'");
    const size = await client.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes");
    const relations = await client.query<{ name: string; bytes: string; live: string; dead: string }>(`SELECT relname AS name,pg_total_relation_size(relid)::text AS bytes,n_live_tup::text AS live,n_dead_tup::text AS dead
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`);
    // Some installations deny pg_ls_waldir. Keep DB diagnostics useful there,
    // and disclose the missing WAL coverage rather than claiming free space.
    await client.query("SAVEPOINT wal_probe");
    let walBytes: number | null = null;
    try {
      const wal = await client.query<{ bytes: string }>("SELECT COALESCE(sum(size),0)::text AS bytes FROM pg_ls_waldir()");
      walBytes = Number(wal.rows[0]!.bytes);
    } catch { await client.query("ROLLBACK TO SAVEPOINT wal_probe"); }
    const databaseBytes = Number(size.rows[0]!.bytes);
    const capacityBytes = getConfig().DATABASE_VOLUME_CAPACITY_MB * MB;
    const accountedBytes = databaseBytes + (walBytes ?? 0);
    return { databaseBytes, walBytes, capacityBytes, accountedBytes, pressure: storagePressure(accountedBytes, capacityBytes), relations: relations.rows.map((r) => ({ name: r.name, bytes: Number(r.bytes), liveRows: Number(r.live), deadRows: Number(r.dead) })) };
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
}

let pressureCache: { until: number; capacity: number; critical: boolean } | undefined;
let pressureRead: Promise<boolean> | undefined;
/** Admission only: reads, cancellation and already-running work remain available. */
export async function databaseUnderPressure(): Promise<boolean> {
  const capacity = getConfig().DATABASE_VOLUME_CAPACITY_MB;
  if (!capacity) return false;
  if (pressureCache && pressureCache.capacity === capacity && pressureCache.until > Date.now()) return pressureCache.critical;
  pressureRead ??= databaseStorageReport().then((report) => {
    const critical = report.pressure === "critical";
    pressureCache = { until: Date.now() + 30_000, capacity, critical };
    return critical;
  }).catch(() => {
    // Optional measurement failures must not create a new availability failure.
    process.stderr.write('{"event":"storage_probe_failed"}\n');
    return pressureCache?.critical ?? false;
  }).finally(() => { pressureRead = undefined; });
  return pressureRead;
}

export async function ensureDatabaseHeadroom(): Promise<void> {
  if (await databaseUnderPressure()) throw Object.assign(new Error("New generation and copying are temporarily paused while storage is being maintained. Your saved work remains available."), { statusCode: 503, code: "STORAGE_PRESSURE" });
}

/** Called between jobs; never on the generation/commit path. Failures are logged
 * safely and retried next interval, not allowed to shut down API and worker. */
export function createDatabaseMaintenance() {
  let nextRun = 0;
  return async () => {
    const config = getConfig();
    if ((!config.CHECKPOINT_RETENTION_ENABLED && !config.RUNTIME_METRICS_ENABLED) || Date.now() < nextRun) return;
    nextRun = Date.now() + intervalMs;
    try {
      const report = await databaseStorageReport();
      process.stdout.write(`${JSON.stringify({ event: "database_storage", ...report })}\n`);
      // DELETE and VACUUM themselves generate WAL. Drain a nearly-full volume
      // slowly so cleanup does not consume the headroom it is meant to protect.
      const cleanup = await pruneCheckpoints({ apply: config.CHECKPOINT_RETENTION_ENABLED, limit: report.pressure === "normal" ? 10 : 1 });
      process.stdout.write(`${JSON.stringify({ event: "checkpoint_retention", ...cleanup })}\n`);
      if (cleanup.prunedThreads) {
        // Ordinary VACUUM reuses free pages without a table rewrite or exclusive
        // table lock. Use a dedicated bounded connection outside a transaction.
        const client = await getPool().connect();
        try {
          await client.query("SET statement_timeout='30s'");
          await client.query("SET lock_timeout='1s'");
          for (const table of tables) await client.query(`VACUUM (ANALYZE) ${table}`);
        } finally { client.release(true); }
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "UNAVAILABLE";
      process.stderr.write(`${JSON.stringify({ event: "database_maintenance_failed", code })}\n`);
    }
  };
}
