// Turns PostgreSQL/Neon driver failures into messages an operator can act on.
//
// The generated package talks to a Neon database the operator owns. When that
// database is missing its schema (or the site's own row), the raw driver error
// is an opaque string such as
//   insert or update on table "client_accounts" violates foreign key
//   constraint "client_accounts_site_id_fkey"
// which used to reach the browser as a generic "Could not create the client
// account." This helper classifies the driver error code so the public forms
// and the owner dashboard can say what is actually missing.
//
// Every message here is safe to show publicly: it names a setup step and never
// contains the connection string, SQL text or row data.
const DATABASE_ERROR_MESSAGES = {
  // undefined_table
  '42P01': 'The appointment database schema is not installed yet. Run db/schema.sql in the Neon database, then try again.',
  // undefined_column
  '42703': 'The appointment database schema is out of date. Re-run db/schema.sql (it is safe to rerun), then try again.',
  // foreign_key_violation
  '23503': 'The database is missing its schema or site record. Run db/schema.sql, open the owner dashboard once, then try again.',
  // insufficient_privilege
  '42501': 'The database user is not allowed to use this database. Check the DATABASE_URL role and its permissions.',
  // invalid_password / invalid_catalog_name / cannot_connect_now
  '28P01': 'The database rejected the connection. Check the password in DATABASE_URL.',
  '3D000': 'The database named in DATABASE_URL does not exist on that Neon project.',
  '57P03': 'The database is not accepting connections yet. Try again in a moment.',
  // too_many_connections
  '53300': 'The database has too many open connections. Use the pooled Neon connection string in DATABASE_URL.'
};
function databaseErrorCode(cause) {
  return String(cause?.code || '').trim().toUpperCase();
}
/**
 * Returns an actionable message for a database failure, or `fallback` when the
 * error is not one of the recognised database setup problems.
 */
function databaseErrorMessage(cause, fallback) {
  return DATABASE_ERROR_MESSAGES[databaseErrorCode(cause)] || fallback;
}
export { DATABASE_ERROR_MESSAGES, databaseErrorCode, databaseErrorMessage };
