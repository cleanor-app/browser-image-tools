import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  // Keep the heavy runtime deps external so consumers control bundling.
  external: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@jsquash/jpeg', '@cross/image', '@pdf-lib/upng', 'jszip', 'exifr'],
});
