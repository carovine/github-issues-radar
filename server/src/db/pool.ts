import pg from "pg";
import { config } from "../config.js";

// One shared connection pool for the whole process. A pool reuses a few open
// connections instead of opening a new one per query (which is slow).
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export async function closePool(): Promise<void> {
  await pool.end();
}
