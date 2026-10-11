import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifact } from './staging-policy.mjs';

try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/preflight-staging.mjs (no overrides).');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = validateArtifact(root);
  console.log(`Local staging preflight passed: ${result.sourceCount} source files and ${result.artifactCount} output files match.`);
  console.log('No remote operation occurred. Verify the approved D1 ID, private R2 bucket, account plan, migrations and owner authorization before deployment.');
  console.log('After an approved deployment this serves the separate workers.dev host, with portal and version previews disabled. Hosted authentication remains to be configured.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Staging preflight failed.');
  process.exitCode = 1;
}
