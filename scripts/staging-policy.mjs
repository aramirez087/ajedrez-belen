import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const STAGING_NAME = 'ajedrez-belen-portal-staging';
export const STAGING_ACCOUNT = '7d3e79129c4f0b3619a419cabbfa021e';
export const PLACEHOLDER_DATABASE = '00000000-0000-0000-0000-000000000000';
export const SOURCE_PATHS = [
  'src', 'public', 'migrations', 'package.json', 'package-lock.json', 'tsconfig.json',
  'astro.staging.config.mjs', 'wrangler.staging.jsonc',
  'scripts/sync-pdf-assets.mjs', 'scripts/staging-policy.mjs',
  'scripts/build-staging.mjs', 'scripts/preflight-staging.mjs',
];
const VARS = {
  PROTOTYPE_ENABLED: 'false', PROTOTYPE_LOCAL: 'false', PORTAL_ENABLED: 'false', PORTAL_DEMO: 'false',
  OCR_MODE: 'off', EMAIL_MODE: 'dry_run', PAYMENT_BANK_NAME: 'PRUEBA — no transferir',
  PAYMENT_ACCOUNT_ID: 'staging-synthetic-only', PAYMENT_DESTINATION: 'ENTORNO DE PRUEBA — no realizar transferencias',
  ASSOCIATION_RECEIPT_NAME: 'PRUEBAS — Ajedrez Belén (datos ficticios)',
};
const SOURCE_KEYS = [
  '$schema', 'name', 'account_id', 'main', 'compatibility_date', 'compatibility_flags',
  'workers_dev', 'preview_urls', 'vars', 'd1_databases', 'r2_buckets',
];
const GENERATED_DEFAULTS = {
  jsx_factory: 'React.createElement', jsx_fragment: 'React.Fragment', no_bundle: true,
  rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
  durable_objects: { bindings: [] }, queues: { producers: [], consumers: [] }, logfwdr: { bindings: [] },
  python_modules: { exclude: ['**/*.pyc'] },
  dev: { ip: 'localhost', local_protocol: 'http', upstream_protocol: 'http', enable_containers: true, generate_types: false },
};
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function readJson(path) {
  // Staging .jsonc intentionally uses the strict JSON subset, without executing configuration.
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`Cannot read valid JSON: ${path}`); }
}
export function validateConfig(config, { generated = false, root, artifactRoot } = {}) {
  requireValue(config && typeof config === 'object' && !Array.isArray(config), 'Invalid staging configuration.');
  requireValue(config.name === STAGING_NAME && config.account_id === STAGING_ACCOUNT, 'Staging Worker/account identity does not match the reviewed target.');
  requireValue(config.compatibility_date === '2026-10-10' && equal(config.compatibility_flags, ['nodejs_compat']), 'Unexpected runtime compatibility settings.');
  requireValue(config.workers_dev === true && config.preview_urls === false, 'Staging requires only its named workers.dev host; version preview URLs must stay disabled.');
  requireValue(equal(config.vars, VARS), 'Staging variables must contain only the reviewed disabled/synthetic settings; secrets and activation are not allowed here.');
  const database = config.d1_databases?.[0];
  requireValue(config.d1_databases?.length === 1 && database?.binding === 'DB' && database.database_name === STAGING_NAME, 'Unexpected D1 binding or name.');
  requireValue(typeof database.database_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(database.database_id), 'D1 ID must be the reviewed UUID or the local placeholder.');
  requireValue(equal(Object.keys(database).sort(), ['binding', 'database_id', 'database_name', 'migrations_dir']), 'Unexpected D1 options.');
  requireValue(equal(config.r2_buckets, [{ binding: 'SLIPS', bucket_name: `${STAGING_NAME}-slips` }]), 'Unexpected R2 binding or bucket.');
  if (!generated) {
    requireValue(Object.keys(config).every(key => SOURCE_KEYS.includes(key)), 'Unexpected staging configuration key; routes, environments, hooks and extra bindings are forbidden.');
    requireValue(config.main === '@astrojs/cloudflare/entrypoints/server' && database.migrations_dir === 'migrations', 'Unexpected source entry point or migration path.');
    return;
  }
  requireValue(config.main === 'entry.mjs', 'Generated Worker entry point must be entry.mjs.');
  requireValue(equal(config.assets, { binding: 'ASSETS', directory: '../client' }), 'Generated assets must be the sibling staging client directory.');
  requireValue(root && artifactRoot && resolve(artifactRoot, 'server', database.migrations_dir) === resolve(root, 'migrations'), 'Generated migration path does not resolve to this project migrations directory.');
  requireValue(config.topLevelName === STAGING_NAME, 'Generated top-level Worker name is not staging.');
  const allowed = new Set([...SOURCE_KEYS, 'assets', 'configPath', 'userConfigPath', 'topLevelName', ...Object.keys(GENERATED_DEFAULTS)]);
  for (const [key, value] of Object.entries(config)) {
    if (Object.hasOwn(GENERATED_DEFAULTS, key)) requireValue(equal(value, GENERATED_DEFAULTS[key]), `Unexpected generated setting: ${key}`);
    else if (!allowed.has(key)) requireValue(equal(value, []) || equal(value, {}) || value === false || value === null, `Unexpected generated capability: ${key}`);
  }
  // No generated paths can redirect Wrangler to a different source configuration.
  for (const key of ['configPath', 'userConfigPath']) requireValue(config[key] === resolve(root, 'wrangler.staging.jsonc'), `Unexpected generated ${key}.`);
}
function forbiddenFile(name) { return name === '.env' || name.startsWith('.env.') || name === '.dev.vars' || name.startsWith('.dev.vars.'); }
export function fileInventory(root, paths, { artifact = false } = {}) {
  const files = [];
  function visit(path) {
    const rel = relative(root, path).split(sep).join('/');
    requireValue(!isAbsolute(rel) && !rel.startsWith('../'), 'Inventory path escapes its root.');
    if (!artifact && (rel === 'public/portal-pdf' || rel.startsWith('public/portal-pdf/'))) return;
    if (artifact && rel === 'staging-build.json') return;
    const info = lstatSync(path);
    requireValue(!info.isSymbolicLink(), `Symlinks are not permitted in staging inputs or artifacts: ${rel}`);
    requireValue(!forbiddenFile(path.split(sep).at(-1)), `Environment file is not permitted in staging inputs or artifacts: ${rel}`);
    if (info.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else {
      requireValue(info.isFile(), `Non-regular staging file: ${rel}`);
      files.push({ path: rel, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
    }
  }
  for (const path of paths) visit(resolve(root, path));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function validateArtifact(root, { requireDatabase = true } = {}) {
  const artifactRoot = resolve(root, 'dist-staging');
  const source = readJson(resolve(root, 'wrangler.staging.jsonc'));
  validateConfig(source);
  const built = readJson(resolve(artifactRoot, 'server/wrangler.json'));
  validateConfig(built, { generated: true, root, artifactRoot });
  requireValue(equal(built.vars, source.vars) && equal(built.d1_databases.map(({ migrations_dir, ...db }) => db), source.d1_databases.map(({ migrations_dir, ...db }) => db)), 'Generated settings do not match the staging source.');
  const manifest = readJson(resolve(artifactRoot, 'staging-build.json'));
  requireValue(manifest.version === 1 && manifest.target === STAGING_NAME, 'Staging artifact has no recognized build manifest.');
  requireValue(equal(manifest.sourceFiles, fileInventory(root, SOURCE_PATHS)), 'Staging source changed after this build. Rebuild before any deployment.');
  requireValue(equal(manifest.artifactFiles, fileInventory(artifactRoot, ['server', 'client'], { artifact: true })), 'Staging output changed after this build. Rebuild before any deployment.');
  requireValue(manifest.artifactFiles.some(file => file.path === 'server/entry.mjs') && manifest.artifactFiles.some(file => file.path === 'client/index.html'), 'Staging Worker or static landing assets are missing.');
  if (requireDatabase) requireValue(source.d1_databases[0].database_id !== PLACEHOLDER_DATABASE, 'STOP: D1 is still the local placeholder. No deployment or remote migration is ready.');
  return { placeholder: source.d1_databases[0].database_id === PLACEHOLDER_DATABASE, sourceCount: manifest.sourceFiles.length, artifactCount: manifest.artifactFiles.length };
}
