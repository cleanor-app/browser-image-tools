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
  // NOTE: @cross/image is deliberately NOT external — it is a JSR-only package
  // (aliased via npm:@jsr/...), so leaving it external would make
  // `npm install` fail for anyone without the JSR registry configured. It is
  // pure JS with no sub-deps, so we inline it into the bundle instead.
  external: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@jsquash/jpeg', '@pdf-lib/upng', 'jszip', 'exifr'],
});
