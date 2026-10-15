import { resolve } from 'node:path';
import { equal, fileInventory, readJson } from './staging-policy.mjs';

export const PRODUCTION_NAME = 'ajedrez-belen';
export const PRODUCTION_ACCOUNT = '7d3e79129c4f0b3619a419cabbfa021e';
export const PRODUCTION_DATABASE = 'ffa2abc9-acce-44e0-ab96-c2cf68a13f13';
export const SOURCE_PATHS = [
  'src', 'public', 'migrations', 'package.json', 'package-lock.json', 'tsconfig.json',
  'astro.production.config.mjs', 'wrangler.production.jsonc',
  'scripts/sync-pdf-assets.mjs', 'scripts/staging-policy.mjs',
  'scripts/production-policy.mjs', 'scripts/build-production.mjs', 'scripts/preflight-production.mjs',
];

const SOURCE_KEYS = new Set([
  '$schema', 'name', 'account_id', 'main', 'compatibility_date', 'compatibility_flags',
  'workers_dev', 'preview_urls', 'observability', 'vars', 'd1_databases', 'r2_buckets',
]);
const GENERATED_DEFAULTS = {
  jsx_factory: 'React.createElement', jsx_fragment: 'React.Fragment', no_bundle: true,
  rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
  durable_objects: { bindings: [] }, queues: { producers: [], consumers: [] }, logfwdr: { bindings: [] },
  python_modules: { exclude: ['**/*.pyc'] },
  dev: { ip: 'localhost', local_protocol: 'http', upstream_protocol: 'http', enable_containers: true, generate_types: false },
};

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateProductionConfig(config, { generated = false, root, artifactRoot } = {}) {
  requireValue(config && typeof config === 'object' && !Array.isArray(config), 'Invalid production configuration.');
  requireValue(config.name === PRODUCTION_NAME && config.account_id === PRODUCTION_ACCOUNT, 'Unexpected production Worker or account.');
  requireValue(config.compatibility_date === '2026-10-10' && equal(config.compatibility_flags, ['nodejs_compat']), 'Unexpected runtime compatibility settings.');
  requireValue(config.workers_dev === false && config.preview_urls === false, 'Production preview hosting must stay disabled.');
  requireValue(equal(config.observability, { enabled: true, head_sampling_rate: 1 }), 'Unexpected production observability settings.');
  const vars = config.vars;
  requireValue(vars && typeof vars === 'object' && !Object.keys(vars).some(key => key.startsWith('STAGING_')), 'Staging variables are forbidden in production.');
  requireValue(vars.PORTAL_ENABLED === 'true' && vars.PORTAL_BUSINESS_CONFIG_APPROVED === 'true' && vars.EMAIL_MODE === 'live' && vars.OCR_MODE === 'groq', 'Production activation settings differ from the live release.');
  requireValue(vars.PORTAL_DEMO === 'false' && vars.PROTOTYPE_ENABLED === 'false' && vars.PROTOTYPE_LOCAL === 'false', 'Demo and prototype must remain disabled.');
  requireValue(vars.WORKOS_REDIRECT_URI === 'https://ajedrezbelen.com/auth/callback', 'Unexpected production auth callback.');
  const database = config.d1_databases?.[0];
  requireValue(config.d1_databases?.length === 1 && database?.binding === 'DB' && database.database_name === 'ajedrez-belen-portal-production' && database.database_id === PRODUCTION_DATABASE, 'Unexpected production D1 binding.');
  requireValue(equal(config.r2_buckets, [{ binding: 'SLIPS', bucket_name: 'ajedrez-belen-portal-production-slips' }]), 'Unexpected production R2 binding.');
  if (!generated) {
    requireValue(Object.keys(config).every(key => SOURCE_KEYS.has(key)), 'Unexpected production configuration key.');
    requireValue(config.main === '@astrojs/cloudflare/entrypoints/server' && database.migrations_dir === 'migrations', 'Unexpected source entry point or migration path.');
    return;
  }
  requireValue(config.main === 'entry.mjs' && config.topLevelName === PRODUCTION_NAME, 'Unexpected generated Worker entry point.');
  requireValue(equal(config.assets, { binding: 'ASSETS', directory: '../client' }), 'Unexpected production static asset binding.');
  requireValue(root && artifactRoot && resolve(artifactRoot, 'server', database.migrations_dir) === resolve(root, 'migrations'), 'Generated migration path does not resolve to this repository.');
  const expectedConfigPath = resolve(root, 'wrangler.production.jsonc');
  requireValue(config.configPath === expectedConfigPath && config.userConfigPath === expectedConfigPath, 'Generated config redirects to another source.');
  const allowed = new Set([...SOURCE_KEYS, 'assets', 'configPath', 'userConfigPath', 'topLevelName', ...Object.keys(GENERATED_DEFAULTS)]);
  for (const [key, value] of Object.entries(config)) {
    if (Object.hasOwn(GENERATED_DEFAULTS, key)) requireValue(equal(value, GENERATED_DEFAULTS[key]), `Unexpected generated setting: ${key}`);
    else if (!allowed.has(key)) requireValue(equal(value, []) || equal(value, {}) || value === false || value === null, `Unexpected generated capability: ${key}`);
  }
}

export function validateProductionArtifact(root) {
  const artifactRoot = resolve(root, 'dist-production');
  const source = readJson(resolve(root, 'wrangler.production.jsonc'));
  validateProductionConfig(source);
  const generated = readJson(resolve(artifactRoot, 'server/wrangler.json'));
  validateProductionConfig(generated, { generated: true, root, artifactRoot });
  requireValue(equal(generated.vars, source.vars) && equal(generated.d1_databases.map(({ migrations_dir, ...db }) => db), source.d1_databases.map(({ migrations_dir, ...db }) => db)), 'Generated production bindings differ from the source config.');
  const manifest = readJson(resolve(artifactRoot, 'production-build.json'));
  requireValue(manifest.version === 1 && manifest.target === PRODUCTION_NAME, 'Missing production build manifest.');
  requireValue(equal(manifest.sourceFiles, fileInventory(root, SOURCE_PATHS)), 'Source changed after the production build.');
  requireValue(equal(manifest.artifactFiles, fileInventory(artifactRoot, ['server', 'client'], { artifact: true })), 'Production artifact changed after the build.');
  requireValue(manifest.artifactFiles.some(file => file.path === 'server/entry.mjs') && manifest.artifactFiles.some(file => file.path === 'client/index.html'), 'Worker entry or public landing asset is missing.');
  requireValue(!manifest.artifactFiles.some(file => /^client\/(auth|login|portal|admin|api|demo|prototype)([/.]|$)/.test(file.path)), 'Protected routes were emitted as public static assets.');
  return { sourceCount: manifest.sourceFiles.length, artifactCount: manifest.artifactFiles.length };
}
