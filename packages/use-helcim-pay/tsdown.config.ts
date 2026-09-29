import { defineConfig, type UserConfig } from 'tsdown';

const shared = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  platform: 'neutral',
  target: 'es2022',
  fixedExtension: false,
  // `npm run build` removes dist first (prebuild). Both configs write into
  // it, so neither may clean it on its own.
  clean: false,
} satisfies UserConfig;

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    // Mark the client entry as a client module, so it can be imported from
    // React Server Component trees (Next.js App Router) without a wrapper.
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    entry: {
      'server/index': 'src/server/index.ts',
      'testing/index': 'src/testing/index.ts',
    },
  },
]);
