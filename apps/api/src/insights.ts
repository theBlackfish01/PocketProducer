import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool, getConfig } from "@pocket/core/api";

type Totals = Record<string,number|null> & { active_accounts:number; first_active_accounts:number; saved_generations:number; saved_revisions:number; thumbs_up:number; thumbs_down:number };
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const reportQuery = z.object({
  month: z.string().regex(monthPattern).default(() => new Date().toISOString().slice(0,7)),
  cohort: z.enum(["all","other","internal","unattributed"]).default("other"),
  release: z.string().regex(/^(?:unknown|[a-f0-9]{7,64})$/).optional(),
  format: z.enum(["json","csv"]).default("json")
}).strict();

export const visitorEnabled = () => getConfig().APP_ENV === "production" && process.env.VISITOR_ANALYTICS_ENABLED !== "false";
export async function insightsAccess(ownerId: string) {
  const subject = process.env.INSIGHTS_ADMIN_SUBJECT;
  if (!subject) return false;
  return Boolean((await getPool().query("SELECT 1 FROM audiotool_identity WHERE owner_id=$1 AND subject=$2", [ownerId, subject])).rowCount);
}

// Attribute outcomes to the UTC month the request started. Use ledger facts and
// immutable results so a retry, trace span or accepted copy cannot inflate totals.
const scope = `WITH classified AS (
 SELECT j.id,j.created_at,j.owner_id,j.project_id,j.state,j.kind,j.error_code,j.result_native_revision_id,j.release_sha, CASE WHEN a.subject=ANY($4::text[]) OR j.project_id::text=ANY($5::text[]) THEN 'internal'
  WHEN a.subject IS NULL THEN 'unattributed' ELSE 'other' END AS cohort
 FROM job j LEFT JOIN audiotool_identity a ON a.owner_id=j.owner_id
 WHERE j.kind IN ('native-generation','native-revision','native-sync')
), scoped AS (
 SELECT * FROM classified WHERE created_at >= $1::timestamptz AND created_at < ($1::timestamptz + interval '1 month')
 AND ($2='all' OR cohort=$2) AND ($3::text IS NULL OR coalesce(release_sha,'unknown')=$3)
), facts AS (
 SELECT j.*, r.id AS saved, r.created_at AS saved_at, v.vote, v.reason, v.comment,
 EXISTS (SELECT 1 FROM job_event e WHERE e.job_id=j.id AND e.event_type='succeeded' AND e.payload->>'synchronization'='verified') AS verified
 FROM scoped j LEFT JOIN native_revision r ON j.state='succeeded' AND r.id=j.result_native_revision_id AND r.creator_job_id=j.id
 LEFT JOIN version_rating v ON v.revision_id=r.id
)`;
const summarySql = scope + `
SELECT count(DISTINCT owner_id)::int AS active_accounts, count(DISTINCT project_id)::int AS active_projects,
 count(DISTINCT owner_id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM classified p WHERE p.owner_id=f.owner_id AND p.created_at<$1::timestamptz AND ($2='all' OR p.cohort=$2)))::int AS first_active_accounts,
 count(*) FILTER (WHERE kind='native-generation')::int AS generation_requests,
 count(*) FILTER (WHERE kind='native-generation' AND state='succeeded' AND result_native_revision_id IS NOT NULL)::int AS completed_generations,
 count(saved) FILTER (WHERE kind='native-generation')::int AS saved_generations,
 count(*) FILTER (WHERE kind='native-revision')::int AS revision_requests,
 count(*) FILTER (WHERE kind='native-revision' AND state='succeeded' AND result_native_revision_id IS NOT NULL)::int AS completed_revisions,
 count(saved) FILTER (WHERE kind='native-revision')::int AS saved_revisions,
 count(*) FILTER (WHERE kind='native-sync')::int AS copy_requests,
 count(*) FILTER (WHERE kind='native-sync' AND state='succeeded' AND verified)::int AS verified_copies,
 count(*) FILTER (WHERE state='failed')::int AS failed,
 count(*) FILTER (WHERE state='needs_attention')::int AS needs_attention,
 count(*) FILTER (WHERE state='cancelled')::int AS cancelled,
 count(*) FILTER (WHERE state IN ('queued','running','needs_input','cancel_requested'))::int AS pending,
 round((percentile_cont(.5) WITHIN GROUP (ORDER BY extract(epoch FROM saved_at-created_at)))::numeric)::int AS median_seconds,
 round((percentile_cont(.9) WITHIN GROUP (ORDER BY extract(epoch FROM saved_at-created_at)))::numeric)::int AS p90_seconds,
 count(*) FILTER (WHERE vote='up')::int AS thumbs_up, count(*) FILTER (WHERE vote='down')::int AS thumbs_down,
 (SELECT count(*)::int FROM effect e JOIN scoped j ON j.id=e.job_id WHERE e.step='producer-model-call' AND e.state='succeeded' AND e.cost_status='observed') AS completed_model_calls,
 (SELECT round(coalesce(sum(e.actual_cost_microusd) FILTER (WHERE e.cost_status='observed'),0)/1000000.0,4)::float8 FROM effect e JOIN scoped j ON j.id=e.job_id WHERE e.step='producer-model-call') AS recorded_model_usd,
 (SELECT count(*)::int FROM effect e JOIN scoped j ON j.id=e.job_id WHERE e.step='producer-model-call' AND (e.cost_status='unknown' OR e.state IN ('dispatched','uncertain'))) AS unresolved_model_calls
 FROM facts f`;
const configured = (value?: string) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);

export function registerInsights(app: FastifyInstance) {
  // Bound anonymous write traffic per replica. A later visit can retry a missed observation.
  let windowStarted = 0, admitted = 0;
  app.post("/api/v1/visits", { bodyLimit: 128 }, async (request, reply) => {
    if (!visitorEnabled() || request.headers.dnt === "1" || request.headers["sec-gpc"] === "1") return reply.code(204).send();
    const data = z.object({ month: z.string().regex(monthPattern), bucket: z.number().int().min(0).max(65535) }).strict().safeParse(request.body);
    if (!data.success || data.data.month !== new Date().toISOString().slice(0,7)) return reply.code(400).send();
    const now = Date.now();
    if (now-windowStarted >= 60_000) { windowStarted = now; admitted = 0; }
    if (admitted >= 180) return reply.header("Retry-After","60").code(429).send();
    admitted += 1;
    await getPool().query(`INSERT INTO visitor_month(month,buckets) VALUES($1,set_bit(0::bit(65536),$2,1))
      ON CONFLICT(month) DO UPDATE SET buckets=set_bit(visitor_month.buckets,$2,1) WHERE get_bit(visitor_month.buckets,$2)=0`, [data.data.month+"-01", data.data.bucket]);
    return reply.code(204).send();
  });
  app.get("/api/v1/insights", async (request, reply) => {
    if (!await insightsAccess(request.ownerId)) return reply.code(403).send({ message: "This report is private." });
    const { month, cohort, release, format } = reportQuery.parse(request.query);
    const internal = configured(process.env.INSIGHTS_INTERNAL_SUBJECTS);
    if (process.env.INSIGHTS_ADMIN_SUBJECT) internal.push(process.env.INSIGHTS_ADMIN_SUBJECT);
    const args = [month+"-01T00:00:00Z",cohort,release ?? null,internal,configured(process.env.INSIGHTS_TEST_PROJECTS)];
    const pool = getPool();
    const [counts, visitors, ratings, messages, releases, issues] = await Promise.all([
      pool.query<Totals>(summarySql,args),
      pool.query<{occupied:number; first_seen:Date}>("SELECT bit_count(buckets)::int AS occupied,first_seen FROM visitor_month WHERE month=$1",[month+"-01"]),
      pool.query(scope+` SELECT vote,reason,comment FROM facts WHERE vote IS NOT NULL ORDER BY saved_at DESC LIMIT 100`,args),
      pool.query(`SELECT f.username,f.message,f.created_at FROM app_feedback f LEFT JOIN audiotool_identity a ON a.owner_id=f.owner_id
        WHERE f.created_at >= $1::timestamptz AND f.created_at < $1::timestamptz+interval '1 month'
        AND ($2='all' OR $2=CASE WHEN a.subject=ANY($3::text[]) THEN 'internal' WHEN a.subject IS NULL THEN 'unattributed' ELSE 'other' END)
        ORDER BY f.created_at DESC LIMIT 100`,[args[0],cohort,internal]),
      pool.query("SELECT DISTINCT coalesce(release_sha,'unknown') AS release FROM job WHERE kind LIKE 'native-%' AND created_at >= $1::timestamptz AND created_at < $1::timestamptz+interval '1 month' ORDER BY 1",[args[0]]),
      pool.query(scope+` SELECT coalesce(error_code,state) AS issue,count(*)::int AS total FROM facts WHERE state IN ('failed','needs_attention') GROUP BY 1 ORDER BY 2 DESC`,args)
    ]);
    const row = counts.rows[0]!;
    const saved = row.saved_generations + row.saved_revisions, rated = row.thumbs_up + row.thumbs_down;
    const occupied = visitors.rows[0]?.occupied;
    const metrics = { ...row, returning_accounts: row.active_accounts-row.first_active_accounts,
      rated_percent: saved ? Math.round(100*rated/saved) : null, positive_percent: rated ? Math.round(100*row.thumbs_up/rated) : null,
      site_browser_estimate: occupied == null || occupied >= 65536 ? null : Math.round(-65536*Math.log1p(-occupied/65536)) };
    if (format === "csv") {
      const record: Record<string,string|number|null> = { month,cohort,release:release ?? "all",...metrics };
      return reply.type("text/csv; charset=utf-8").header("Content-Disposition",`attachment; filename="pocket-producer-${month}.csv"`).send(Object.keys(record).join(",")+"\r\n"+Object.values(record).map(value=>value ?? "").join(",")+"\r\n");
    }
    return { metrics, month, visitorCoverage: visitors.rows[0]?.first_seen ?? null, releases: releases.rows.map(r=>r.release), ratings: ratings.rows, feedback: messages.rows, issues: issues.rows };
  });
}
