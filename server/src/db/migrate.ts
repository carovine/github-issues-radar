import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./pool.js";
import { logger } from "../logger.js";

// A minimal migration runner:
//  - migrations are numbered .sql files in ./migrations (001_..., 002_...)
//  - a `schema_migrations` table remembers which ones already ran
//  - each new migration runs inside a transaction: it fully applies or not at all
// Running `npm run migrate` repeatedly is safe: finished files are skipped.

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      logger.info(`skip ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info(`applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(() => logger.info("migrations complete"))
  .catch((err) => {
    logger.error("migration failed", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
