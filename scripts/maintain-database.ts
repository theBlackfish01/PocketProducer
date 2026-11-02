import { databaseStorageReport, discardExecutionCheckpoints, pruneCheckpoints } from "@pocket/core/maintenance";
import { closePool } from "@pocket/core/database";

const args = process.argv.slice(2);
if (args.some((arg) => !["--apply", "--report-only", "--discard-execution-checkpoints"].includes(arg))) throw new Error("Usage: pnpm db:maintenance [--apply | --report-only | --discard-execution-checkpoints]");
if (args.length > 1) throw new Error("Choose one maintenance mode");
try {
  console.log(JSON.stringify({ event: "database_storage", ...await databaseStorageReport() }));
  if (args.includes("--discard-execution-checkpoints")) {
    console.log(JSON.stringify({ event: "checkpoint_reset", ...await discardExecutionCheckpoints() }));
    console.log(JSON.stringify({ event: "database_storage", ...await databaseStorageReport() }));
  } else if (!args.includes("--report-only")) console.log(JSON.stringify({ event: "checkpoint_retention", ...await pruneCheckpoints({ apply: args.includes("--apply") }) }));
} catch (error) {
  // Never dump connection details or provider history from a maintenance failure.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const known = error instanceof Error && /^CHECKPOINT_[A-Z_]+$/.test(error.message) ? error.message : "DATABASE_MAINTENANCE_FAILED";
  console.error(JSON.stringify({ event: "database_maintenance_failed", code: /^[A-Z0-9_]+$/.test(code) ? code : known }));
  process.exitCode = 1;
} finally { await closePool(); }
