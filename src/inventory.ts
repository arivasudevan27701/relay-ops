import type {
  Action,
  JobRow,
  Kind,
  Region,
  ResourceRow,
  ResourceStatus,
  Size
} from "./types";
import { MAX_RESOURCES, SIZE_GIB } from "./types";

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, desk_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, team TEXT NOT NULL, region TEXT NOT NULL, size TEXT NOT NULL, status TEXT NOT NULL, endpoint TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  );
  await db.exec("DROP INDEX IF EXISTS resources_desk_name");
  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS resources_desk_name_live ON resources (desk_id, name) WHERE status != 'gone'"
  );
  await db.exec(
    "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, desk_id TEXT NOT NULL, action TEXT NOT NULL, resource_name TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  );
}

export async function listResources(
  db: D1Database,
  deskId: string
): Promise<ResourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM resources WHERE desk_id = ? AND status != 'gone' ORDER BY created_at DESC`
    )
    .bind(deskId)
    .all<ResourceRow>();
  return results ?? [];
}

export async function countLive(db: D1Database, deskId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM resources WHERE desk_id = ? AND status != 'gone'`
    )
    .bind(deskId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getByName(
  db: D1Database,
  deskId: string,
  name: string
): Promise<ResourceRow | null> {
  return await db
    .prepare(
      `SELECT * FROM resources WHERE desk_id = ? AND name = ? AND status != 'gone'`
    )
    .bind(deskId, name)
    .first<ResourceRow>();
}

export async function insertResource(
  db: D1Database,
  row: ResourceRow
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO resources (id, desk_id, kind, name, team, region, size, status, endpoint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.desk_id,
      row.kind,
      row.name,
      row.team,
      row.region,
      row.size,
      row.status,
      row.endpoint,
      row.created_at,
      row.updated_at
    )
    .run();
}

export async function patchResource(
  db: D1Database,
  id: string,
  patch: Partial<Pick<ResourceRow, "status" | "endpoint">>
): Promise<void> {
  const now = new Date().toISOString();
  if (patch.status && patch.endpoint !== undefined) {
    await db
      .prepare(`UPDATE resources SET status = ?, endpoint = ?, updated_at = ? WHERE id = ?`)
      .bind(patch.status, patch.endpoint, now, id)
      .run();
    return;
  }
  if (patch.status) {
    await db
      .prepare(`UPDATE resources SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(patch.status, now, id)
      .run();
  }
}

export async function upsertJob(
  db: D1Database,
  row: {
    id: string;
    deskId: string;
    action: Action;
    resourceName: string;
    status: string;
    detail?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO jobs (id, desk_id, action, resource_name, status, detail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at`
    )
    .bind(
      row.id,
      row.deskId,
      row.action,
      row.resourceName,
      row.status,
      row.detail ?? null,
      now,
      now
    )
    .run();
}

export async function listJobs(db: D1Database, deskId: string): Promise<JobRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM jobs WHERE desk_id = ? ORDER BY created_at DESC LIMIT 12`
    )
    .bind(deskId)
    .all<JobRow>();
  return results ?? [];
}

export function endpointFor(
  kind: Kind,
  name: string,
  region: Region
): string {
  const host = `${name}.${region}.relay.internal`;
  switch (kind) {
    case "redis":
      return `rediss://${host}:6379`;
    case "postgres":
      return `postgres://${host}:5432/app`;
    case "kv":
      return `https://${host}/kv`;
    case "worker":
      return `https://${host}`;
    case "queue":
      return `queue://${host}`;
  }
}

export function describeSize(size: Size): string {
  return `${SIZE_GIB[size]} GiB`;
}

export { MAX_RESOURCES };
export type { ResourceStatus };
