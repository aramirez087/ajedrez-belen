import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileInventory, readJson, SOURCE_PATHS, STAGING_NAME, validateArtifact, validateConfig } from './staging-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let temporary;
let incoming;
try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-staging.mjs (no overrides).');
  // Wrangler checks a legacy home directory before XDG. Inspect existence only, never its contents.
  if (existsSync(join(homedir(), '.wrangler'))) throw new Error('Legacy global Wrangler directory exists. Use a clean build environment; its contents were not read.');
  validateConfig(readJson(join(root, 'wrangler.staging.jsonc')));
  const sourceFiles = fileInventory(root, SOURCE_PATHS);
  mkdirSync(join(root, 'output'), { recursive: true });
  temporary = mkdtempSync(join(root, 'output', 'staging-build-'));
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
    [join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--config', 'astro.staging.config.mjs'],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: temporary, env: environment, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Staging build failed; existing artifacts were not replaced.');
  }
  const output = join(temporary, 'dist-staging');
  const generatedPath = join(output, 'server', 'wrangler.json');
  const generated = readJson(generatedPath);
  // Relocate metadata paths after copying the isolated build; entry/assets remain relative.
  generated.configPath = join(root, 'wrangler.staging.jsonc');
  generated.userConfigPath = join(root, 'wrangler.staging.jsonc');
  validateConfig(generated, { generated: true, root, artifactRoot: join(root, 'dist-staging') });
  writeFileSync(generatedPath, JSON.stringify(generated, null, 2) + '\n');
  const headersPath = join(output, 'client', '_headers');
  const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
  writeFileSync(headersPath, `${headers}\n/*\n  X-Robots-Tag: noindex, nofollow\n`);
  // Recheck copied input hashes so a concurrent source edit cannot be certified as this build.
  const manifest = { version: 1, target: STAGING_NAME, builtAt: new Date().toISOString(), sourceFiles,
    artifactFiles: fileInventory(output, ['server', 'client'], { artifact: true }) };
  const { equal } = await import('./staging-policy.mjs');
  if (!equal(sourceFiles, fileInventory(root, SOURCE_PATHS))) throw new Error('Source changed during staging build; output was not published.');
  writeFileSync(join(output, 'staging-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  incoming = join(root, `dist-staging.incoming-${crypto.randomUUID()}`);
  cpSync(output, incoming, { recursive: true });
  const target = join(root, 'dist-staging');
  if (existsSync(target)) {
    if (!existsSync(join(target, 'staging-build.json'))) throw new Error('Refusing to replace an unrecognized dist-staging directory.');
    // Only this builder's generated artifact directory is replaced after successful compilation.
    rmSync(target, { recursive: true });
  }
  renameSync(incoming, target);
  incoming = undefined;
  const result = validateArtifact(root, { requireDatabase: false });
  console.log(`Staging artifact verified: ${result.sourceCount} input files, ${result.artifactCount} output files.`);
  console.log(result.placeholder ? 'LOCAL BUILD ONLY: placeholder D1; deployment preflight will refuse.' : 'Local artifact checks passed. Account/resource verification and deployment authorization remain separate.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Staging build failed.');
  process.exitCode = 1;
} finally {
  if (incoming) rmSync(incoming, { recursive: true, force: true });
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
