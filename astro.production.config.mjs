import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Production portal build. Use scripts/build-production.mjs to keep local
// development secrets out of the deployable artifact.
export default defineConfig({
  output: 'static',
  outDir: './dist-production',
  adapter: cloudflare({
    configPath: './wrangler.production.jsonc',
    imageService: 'compile',
    remoteBindings: false,
    persistState: false,
    inspectorPort: false,
  }),
  session: false,
  devToolbar: { enabled: false },
  vite: { cacheDir: './.vite-production' },
});
