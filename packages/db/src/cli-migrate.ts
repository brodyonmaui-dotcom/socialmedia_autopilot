import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPool } from "./client.js";
import { migrate } from "./migrate.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const pool = createPool(databaseUrl);
const applied = await migrate(pool, migrationsDir);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date, nothing to apply");
await pool.end();
