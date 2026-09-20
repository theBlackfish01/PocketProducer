import pg from "pg";
import { getConfig } from "../config.js";

const { Pool } = pg;
let sharedPool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  sharedPool ??= new Pool({ connectionString: getConfig().DATABASE_URL, max: 8 });
  return sharedPool;
}

export async function closePool(): Promise<void> {
  if (sharedPool) await sharedPool.end();
  sharedPool = undefined;
}

