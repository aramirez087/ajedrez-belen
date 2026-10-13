import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Production portal build only. Never deploy without the reviewed
// disabled-shell approval in docs/PRODUCTION-CONFIGURATION.md.
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
