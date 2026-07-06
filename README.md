# @cleanor/browser-image-tools

**Privacy-first image processing that runs entirely in the browser.** Convert, compress, resize and encode **PNG, JPEG, WebP, AVIF, GIF and ICO** on the client using Canvas and WebAssembly. The bytes never leave the device — there is no server, no upload, no API key.

[![npm](https://img.shields.io/npm/v/@cleanor/browser-image-tools.svg)](https://www.npmjs.com/package/@cleanor/browser-image-tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Types](https://img.shields.io/badge/types-included-blue.svg)](#)

Extracted from the [Cleanor](https://cleanor.app/tools) browser tools, which run these same modules in production. Framework-agnostic: works with React, Vue, Svelte, or plain `<script type="module">`.

## Why

Most "image optimizer" libraries either run on a server (your users' photos leave their machine) or wrap a single codec. This is the whole client-side image pipeline Cleanor ships — decode, analyze, transform, and re-encode across formats — with **nothing sent anywhere.** Ideal for privacy-sensitive apps, offline PWAs, and anywhere you don't want to pay for or operate an image backend.

## Install

```bash
npm install @cleanor/browser-image-tools
```

This package pulls in WebAssembly codecs (`@jsquash/jpeg`, `@ffmpeg/ffmpeg`) via a `@jsr` dependency, so add this once to your `.npmrc`:

```
@jsr:registry=https://npm.jsr.io
```

## Usage

Shared helpers are top-level; each format lives in its own namespace.

```ts
import { avif, ico, webp, gif, loadImageElementFromBlob, formatFileSize } from '@cleanor/browser-image-tools';

// AVIF → JPEG, fully in the browser
const jpegBlob = await avif.convertAvifToJpg({ file: avifFile, quality: 90 });

// Build a multi-resolution .ico from any image
const img = await loadImageElementFromBlob(pngFile);
const icoBlob = await ico.buildIcoBlob(img, [16, 32, 48, 256]);

// Re-encode / shrink a WebP (incl. animated) with a preset
const smaller = await webp.optimizeWebp({ file: webpFile, preset: 'smaller', fpsCap: null });

// Optimize a GIF
const gifOut = await gif.optimizeGif({ file: gifFile, loopCount: 0, fpsCap: 15 });

console.log('saved to', formatFileSize(jpegBlob.size));
```

Everything is fully typed — explore the API through your editor's autocomplete on each namespace.

## What's included

| Namespace | Highlights |
| --- | --- |
| `png` | decode/encode, palette + alpha analysis, animated PNG (APNG), zip bundling |
| `jpg` | JPEG/HEIC detection, structure inspection, encode via WASM |
| `webp` | metadata, animated WebP decode/encode, video→WebP, `optimizeWebp` |
| `avif` | decode, and convert AVIF → JPG / PNG / WebP |
| `gif` | frame extraction, encode, `optimizeGif`, `resizeGif` (ffmpeg.wasm) |
| `gifEncoder` | low-level GIF encoder |
| `ico` | `buildIcoBlob`, multi-size `.ico` encoding |
| `effects` | image effect filters |
| `convolution` | convolution kernels (blur/sharpen/edge) |
| top-level | canvas helpers, `loadRasterImage`, color utils, `formatFileSize`, download helpers |

## Notes

- **Browser only.** These modules use `HTMLCanvasElement`, `createImageBitmap`, `URL.createObjectURL`, and WASM. They are not meant for Node.
- Heavy codecs (`@ffmpeg/ffmpeg`, `@jsquash/jpeg`) are kept **external** so your bundler can code-split and lazy-load them. Only the format namespaces you import pull their deps in.
- The GIF/WebP video paths load `ffmpeg.wasm` on first use.

## License

[MIT](LICENSE) © Cleanor Labs. See more open data and tools at [cleanor.app/research](https://cleanor.app/research).
