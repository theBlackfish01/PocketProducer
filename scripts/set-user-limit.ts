import { closePool, getPool } from "@pocket/core";
// Local operator command only. Never expose a quota-increase endpoint to users.
const ownerId = process.argv[2];
const amount = Number(process.argv[3]);
if (!ownerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId) || !Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error("Usage: tsx scripts/set-user-limit.ts OWNER_UUID TOTAL_LIFETIME_USD (0–100)");
try {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pocket-producer-provider-budget-v1'))");
    await client.query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET limit_microusd=EXCLUDED.limit_microusd,updated_at=now()", [ownerId, Math.round(amount * 1e6)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  console.log(`Lifetime allowance for ${ownerId} set to US$${amount.toFixed(2)}. Existing usage was not reset.`);
} finally { await closePool(); }
