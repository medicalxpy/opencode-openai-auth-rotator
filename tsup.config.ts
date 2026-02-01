import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  external: ['@opencode-ai/plugin'],
  // Bundle all internal modules into single files (no chunks)
  splitting: false,
  treeshake: true,
  minify: false,
  outExtension() {
    return { js: '.mjs' };
  },
});
