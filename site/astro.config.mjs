import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://igoriuz.github.io',
  base: '/eventgraph',
  trailingSlash: 'ignore',
  build: { format: 'file' },
});
