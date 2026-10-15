import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { equal, fileInventory, readJson } from './staging-policy.mjs';
import { PRODUCTION_NAME, SOURCE_PATHS, validateProductionArtifact, validateProductionConfig } from './production-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let temporary;
let incoming;
try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-production.mjs (no overrides).');
  validateProductionConfig(readJson(join(root, 'wrangler.production.jsonc')));
  const sourceFiles = fileInventory(root, SOURCE_PATHS);
  temporary = mkdtempSync(join(tmpdir(), 'ajedrez-belen-production-build-'));
  for (const file of sourceFiles) {
    const destination = join(temporary, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, file.path), destination);
  }
  symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const environment = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', TMPDIR: '/tmp', CI: 'true', NO_COLOR: '1',
    ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: join(temporary, '.wrangler', 'logs'),
    XDG_CONFIG_HOME: join(temporary, '.config'), XDG_CACHE_HOME: join(temporary, '.cache'),
    XDG_DATA_HOME: join(temporary, '.local', 'share'),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
  };
  for (const args of [
    ['scripts/sync-pdf-assets.mjs'],
    [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--config', 'astro.production.config.mjs'],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: temporary, env: environment, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Production build failed; existing artifact was not replaced.');
  }
  const output = join(temporary, 'dist-production');
  const generatedPath = join(output, 'server', 'wrangler.json');
  const generated = readJson(generatedPath);
  generated.configPath = join(root, 'wrangler.production.jsonc');
  generated.userConfigPath = join(root, 'wrangler.production.jsonc');
  validateProductionConfig(generated, { generated: true, root, artifactRoot: join(root, 'dist-production') });
  writeFileSync(generatedPath, JSON.stringify(generated, null, 2) + '\n');
  if (!equal(sourceFiles, fileInventory(root, SOURCE_PATHS))) throw new Error('Source changed during the production build.');
  const manifest = { version: 1, target: PRODUCTION_NAME, builtAt: new Date().toISOString(), sourceFiles,
    artifactFiles: fileInventory(output, ['server', 'client'], { artifact: true }) };
  writeFileSync(join(output, 'production-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  incoming = join(root, `dist-production.incoming-${crypto.randomUUID()}`);
  cpSync(output, incoming, { recursive: true });
  const target = join(root, 'dist-production');
  if (existsSync(target)) {
    if (!existsSync(join(target, 'production-build.json'))) throw new Error('Refusing to replace an unrecognized dist-production directory.');
    rmSync(target, { recursive: true });
  }
  renameSync(incoming, target);
  incoming = undefined;
  const result = validateProductionArtifact(root);
  console.log(`Production artifact verified: ${result.sourceCount} input files, ${result.artifactCount} output files.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production build failed.');
  process.exitCode = 1;
} finally {
  if (incoming) rmSync(incoming, { recursive: true, force: true });
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
