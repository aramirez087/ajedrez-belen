import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Build only through scripts/build-staging.mjs, which uses a sanitized temporary root.
export default defineConfig({
  output: 'static',
  outDir: './dist-staging',
  adapter: cloudflare({
    configPath: './wrangler.staging.jsonc',
    imageService: 'compile',
    remoteBindings: false,
    persistState: false,
    inspectorPort: false,
  }),
  session: false,
  devToolbar: { enabled: false },
  vite: { cacheDir: './.vite-staging' },
});
