// Pushes the values from this package's environment file to the hosting
// platform, so a deployed site is configured without pasting each secret by
// hand in a dashboard.
//
//   npm run secrets                     # uses .dev.vars (Cloudflare) or .env (Vercel)
//   npm run secrets -- --dry-run        # shows which names would be set
//   npm run secrets -- --file=.env.production
//
// Cloudflare: runs `wrangler secret put NAME` for the DATABASE_URL, ADMIN_*,
// CSRF_SECRET (and CRON_SECRET) values. Vercel: runs `vercel env add` for each
// value in the production environment, then reminds you to redeploy.
//
// Values are piped straight into the platform CLI and are never printed. The
// CLI needs to be signed in first (`npx wrangler login` / `npx vercel login`)
// and, for Vercel, the project must already be linked (`vercel link`).
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SECRET_NAMES = ['DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'CSRF_SECRET', 'CRON_SECRET'];
const PLACEHOLDER_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST.neon.tech/DB';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArgument = args.find((argument) => argument.startsWith('--file='));
const explicitTarget = args.find((argument) => argument.startsWith('--target='));

function targetFromFiles() {
  if (explicitTarget) return explicitTarget.split('=')[1];
  if (existsSync('.dev.vars')) return 'cloudflare';
  if (existsSync('.env')) return 'vercel';
  return '';
}
function parseEnvFile(text) {
  const values = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (SECRET_NAMES.includes(name) && value) values.set(name, value);
  }
  return values;
}
function run(command, commandArgs, input) {
  return spawnSync(command, commandArgs, { input, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
}

const target = targetFromFiles();
if (target !== 'cloudflare' && target !== 'vercel') {
  console.error('Choose a target: put .dev.vars (Cloudflare) or .env (Vercel) in this folder, or pass --target=cloudflare|vercel.');
  process.exit(1);
}
const file = fileArgument ? fileArgument.split('=')[1] : target === 'cloudflare' ? '.dev.vars' : '.env';
if (!existsSync(file)) {
  console.error(`No ${file} in this folder. Pass --file=PATH if it lives elsewhere.`);
  process.exit(1);
}
const values = parseEnvFile(await readFile(file, 'utf8'));
if (values.get('DATABASE_URL') === PLACEHOLDER_DATABASE_URL) values.delete('DATABASE_URL');
if (!values.size) {
  console.error(`No secret values found in ${file}. Fill in at least DATABASE_URL and the ADMIN_* values first.`);
  process.exit(1);
}
const names = SECRET_NAMES.filter((name) => values.has(name));
console.log(`Preparing ${names.length} value${names.length === 1 ? '' : 's'} from ${file} for ${target === 'cloudflare' ? 'Cloudflare Workers' : 'Vercel'}:`);
for (const name of names) console.log(`  · ${name}`);
if (!values.has('CSRF_SECRET')) {
  console.log('  ! CSRF_SECRET is missing: forms will fall back to a secret derived from DATABASE_URL.');
}
if (dryRun) {
  console.log('\nDry run: nothing was sent. Remove --dry-run to push the values.');
  process.exit(0);
}

let failures = 0;
if (target === 'cloudflare') {
  console.log('\nRunning wrangler secret put (this needs `npx wrangler login` first).\n');
  for (const name of names) {
    console.log(`→ ${name}`);
    const result = run('npx', ['wrangler', 'secret', 'put', name], `${values.get(name)}\n`);
    if (result.status !== 0) { failures += 1; console.error(`  ✗ ${name} was not set — run it again after \`npx wrangler login\`.`); }
    else console.log(`  ✓ ${name} set`);
  }
  console.log(failures ? '\nSome values could not be set.' : '\nAll values set. Run `npm run deploy` to publish the Worker.');
} else {
  console.log('\nRunning vercel env add for the production environment (this needs `npx vercel login` and `vercel link` first).\n');
  for (const name of names) {
    console.log(`→ ${name}`);
    const result = run('npx', ['vercel', 'env', 'add', name, 'production'], `${values.get(name)}\n`);
    if (result.status !== 0) { failures += 1; console.error(`  ✗ ${name} was not set — link the project with \`npx vercel link\` and retry.`); }
    else console.log(`  ✓ ${name} set for production`);
  }
  console.log(failures ? '\nSome values could not be set.' : '\nAll values set. Redeploy so the running deployment picks them up (`npx vercel --prod`).');
}
process.exit(failures ? 1 : 0);
