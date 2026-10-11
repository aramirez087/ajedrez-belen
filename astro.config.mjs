import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Validation must not clear the dependency cache used by a running preview.
const isValidation = process.argv.some((argument) => argument === 'check' || argument === 'build');

export default defineConfig({
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  session: false, // AuthKit manages its own signed/encrypted session cookie.
  devToolbar: { enabled: false },
  vite: { cacheDir: isValidation ? 'node_modules/.vite-validation' : 'node_modules/.vite-development' },
});
