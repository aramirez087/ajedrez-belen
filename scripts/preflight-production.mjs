import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductionArtifact } from './production-policy.mjs';

try {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/preflight-production.mjs (no overrides).');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = validateProductionArtifact(root);
  console.log(`Production preflight passed: ${result.sourceCount} source files, ${result.artifactCount} artifact files.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production preflight failed.');
  process.exitCode = 1;
}
