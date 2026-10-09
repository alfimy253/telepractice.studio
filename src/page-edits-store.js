async function ensurePageEditsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS builder_page_edits (
      site_id text PRIMARY KEY,
      edits jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function savePageEditsToDatabase(sql, siteId, edits) {
  await ensurePageEditsTable(sql);
  await sql`
    INSERT INTO builder_page_edits (site_id, edits, updated_at)
    VALUES (${siteId}, ${JSON.stringify(edits)}::jsonb, now())
    ON CONFLICT (site_id) DO UPDATE
    SET edits = EXCLUDED.edits, updated_at = now()
  `;
}

export async function loadPageEditsFromDatabase(sql, siteId) {
  await ensurePageEditsTable(sql);
  const [record] = await sql`
    SELECT site_id AS "siteId", edits, updated_at::text AS "updatedAt"
    FROM builder_page_edits
    WHERE site_id = ${siteId}
  `;
  if (!record) return null;
  return { siteId: record.siteId, edits: record.edits, updatedAt: record.updatedAt };
}
