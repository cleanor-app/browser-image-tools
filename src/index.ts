// @cleanor/browser-image-tools
// Privacy-first image processing that runs entirely in the browser.
// Files never leave the device: everything is canvas / WebAssembly on the client.
//
// Shared helpers (canvas, file-size, color, download) are exported at the top level
// from the image base module. Each format lives in its own namespace to keep the API
// tidy and collision-free:
//
//   import { png, webp, avif, gif, ico, effects, convolution, formatFileSize } from '@cleanor/browser-image-tools'
//   const out = await webp.encodeToWebp(file, { quality: 80 })

export * from './browser-image-tools';

export * as png from './browser-png-tools';
export * as jpg from './browser-jpg-tools';
export * as webp from './browser-webp-tools';
export * as avif from './browser-avif-tools';
export * as gif from './browser-gif-tools';
export * as gifEncoder from './browser-gif-encoder';
export * as ico from './browser-ico-encoder';
export * as effects from './browser-image-effects-tools';
export * as convolution from './browser-image-convolution';
