// The builder's own table uses the same tele_ prefix as the generated app's
// tables, so one Neon database can host both without name collisions. An
// earlier build created it as `builder_page_edits`; rename it in place once.
async function ensurePageEditsTable(sql) {
  await sql`
    DO $$ BEGIN
      IF to_regclass('public.builder_page_edits') IS NOT NULL AND to_regclass('public.tele_builder_page_edits') IS NULL THEN
        ALTER TABLE builder_page_edits RENAME TO tele_builder_page_edits;
      END IF;
    END $$;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tele_builder_page_edits (
      site_id text PRIMARY KEY,
      edits jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function savePageEditsToDatabase(sql, siteId, edits) {
  await ensurePageEditsTable(sql);
  await sql`
    INSERT INTO tele_builder_page_edits (site_id, edits, updated_at)
    VALUES (${siteId}, ${JSON.stringify(edits)}::jsonb, now())
    ON CONFLICT (site_id) DO UPDATE
    SET edits = EXCLUDED.edits, updated_at = now()
  `;
}

export async function loadPageEditsFromDatabase(sql, siteId) {
  await ensurePageEditsTable(sql);
  const [record] = await sql`
    SELECT site_id AS "siteId", edits, updated_at::text AS "updatedAt"
    FROM tele_builder_page_edits
    WHERE site_id = ${siteId}
  `;
  if (!record) return null;
  return { siteId: record.siteId, edits: record.edits, updatedAt: record.updatedAt };
}

// "Clear edits" in the builder must wipe the server row, not just the local
// copy. Without this the next page-editor load (on another device, profile or
// after the worker state is reset) would resurrect the edits the operator
// thought they had cleared.
export async function clearPageEditsFromDatabase(sql, siteId) {
  await ensurePageEditsTable(sql);
  await sql`DELETE FROM tele_builder_page_edits WHERE site_id = ${siteId}`;
}
