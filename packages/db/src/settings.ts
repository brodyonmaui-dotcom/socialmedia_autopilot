/** Kept minimal (vs. importing pg.Pool) so tests can pass a fake, same pattern as migrate.ts. */
export interface SettingsPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<{ value: unknown }> }>;
}

export async function getSetting<T>(pool: SettingsPool, key: string): Promise<T | undefined> {
  const { rows } = await pool.query("select value from settings where key = $1", [key]);
  return rows[0]?.value as T | undefined;
}

export async function setSetting(pool: SettingsPool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
