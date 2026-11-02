import { databaseStorageReport, pruneCheckpoints } from "@pocket/core/maintenance";
import { closePool } from "@pocket/core/database";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply" && arg !== "--report-only")) throw new Error("Usage: pnpm db:maintenance [--apply | --report-only]");
if (args.includes("--apply") && args.includes("--report-only")) throw new Error("Choose one maintenance mode");
try {
  console.log(JSON.stringify({ event: "database_storage", ...await databaseStorageReport() }));
  if (!args.includes("--report-only")) console.log(JSON.stringify({ event: "checkpoint_retention", ...await pruneCheckpoints({ apply: args.includes("--apply") }) }));
} finally { await closePool(); }
