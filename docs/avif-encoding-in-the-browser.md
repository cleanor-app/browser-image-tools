# How does AVIF encoding work in the browser?

The browser does it. There is no AVIF encoder inside this library and no WebAssembly codec to download: the pixels go onto an `OffscreenCanvas`, and `convertToBlob({ type: 'image/avif', quality })` asks the browser's own AVIF encoder for the bytes. Decoding is the mirror image, through the WebCodecs `ImageDecoder`.

```ts
import { avif, formatFileSize } from '@cleanor/browser-image-tools';

if (!avif.canProcessAvifInBrowser()) throw new Error('This browser cannot process AVIF locally.');

// JPEG in, AVIF out. quality is 1 to 100.
const { blob, previewBlob } = await avif.convertJpgToAvif({ file, quality: 55 });

console.log(formatFileSize(file.size), '->', formatFileSize(blob.size));
// previewBlob is a PNG you can show in an <img>, decoded back from the AVIF that was just written
```

`convertPngToAvif` and `convertWebpToAvif` take the same `{ file, quality }` and return the same `AvifExportResult` of `{ blob, previewBlob }`. `convertWebpToAvif` rejects an animated WebP: AVIF here is still images only.

## Why there is no WebAssembly encoder

A WASM build of libaom or libavif is measured in megabytes, and it would land in the bundle of every user, including the ones who never touch AVIF. Chromium-based browsers already ship an AVIF encoder behind `OffscreenCanvas.convertToBlob`, so this library uses it. The trade is explicit: a tiny download, at the price of depending on the runtime.

That dependency is why the feature check exists:

```ts
avif.canProcessAvifInBrowser(); // true when window.ImageDecoder and window.OffscreenCanvas both exist
avif.assertAvifRuntime();       // same check, throws with a readable message instead
```

`canProcessAvifInBrowser()` returning `true` means the two APIs exist. It cannot promise that this particular engine will actually produce AVIF bytes, so the encode path also verifies the result and throws `AVIF encoding failed locally. ...` when the browser hands back something that is not `image/avif`. Treat AVIF as a progressive enhancement: try it, catch, and fall back to WebP.

```ts
import { avif, webp, loadRasterImage, drawImageToCanvas, canvasToBlob } from '@cleanor/browser-image-tools';

async function toSmallestModernFormat(file: File) {
  if (avif.canProcessAvifInBrowser() && avif.fileIsJpeg(file)) {
    try {
      const { blob } = await avif.convertJpgToAvif({ file, quality: 55 });
      return blob;
    } catch {
      // fall through to WebP
    }
  }

  const source = await loadRasterImage(file);
  const { canvas } = drawImageToCanvas(source.element, source.width, source.height);
  return canvasToBlob(canvas, 'image/webp', 0.8);
}
```

## Quality, presets and effort

AVIF quality here is a `1` to `100` scale that is clamped and rounded before it reaches the browser, then mapped to the `0` to `1` canvas quality. AVIF holds up at much lower numbers than JPEG: 50 to 60 is a normal working range for photographs, where the same number in JPEG would look poor.

Two convenience wrappers exist so you do not have to pick a number:

| Call | Quality used |
| --- | --- |
| `avif.optimizeAvif({ file, preset: 'balanced' })` | 70 |
| `avif.optimizeAvif({ file, preset: 'smaller' })` | 56 |
| `avif.optimizeAvif({ file, preset: 'aggressive' })` | 42 |
| `avif.recompressStillAvif({ file, quality, effortPreset: 'faster' })` | `quality - 6` |
| `avif.recompressStillAvif({ file, quality, effortPreset: 'balanced' })` | `quality` |
| `avif.recompressStillAvif({ file, quality, effortPreset: 'slower' })` | `quality + 4` |

Both take an AVIF file as input and return `{ blob, previewBlob }`. Note what `effortPreset` really is: the browser's canvas API exposes no encoder-effort dial, so "slower" simply asks for a slightly higher quality and "faster" for a slightly lower one. It biases the size and quality trade, it does not change CPU time. That is the honest description of the code.

## Decoding AVIF

```ts
import { avif } from '@cleanor/browser-image-tools';

const source = await avif.readAvifSource(file);
// source.bytes    -> Uint8Array of the original file
// source.imageData -> ImageData, RGBA pixels decoded by ImageDecoder
// source.metadata  -> { width, height, hasAlpha }

const pngBlob = await avif.convertAvifToPng(file);
const jpegBlob = await avif.convertAvifToJpg({ file, quality: 90 }); // alpha is flattened onto white
const webpBlob = await avif.convertAvifToWebp({ file, quality: 82 }); // alpha is preserved
```

`convertAvifToJpg` flattens transparency onto white because JPEG has no alpha channel. If your AVIF has transparency you care about, convert to WebP or PNG instead. To inspect the alpha channel first:

```ts
const { transparency, alphaBlob, alphaMaskBlob } = await avif.analyzeAvifAlpha(file);
console.log(transparency.hasTransparency, transparency.translucentPercent);
```

## Does anything get uploaded?

No. `ImageDecoder` and `OffscreenCanvas` are browser APIs, so both the decode and the encode happen in the tab. The AVIF path makes no network request at all, not even the ffmpeg.wasm fetch that the GIF and video paths use.

## Related

- [Compress an image in JavaScript](compress-an-image-in-javascript.md)
- [Convert an image to WebP in JavaScript](convert-an-image-to-webp-in-javascript.md)
- Full export list in the [README](../README.md#avif)
- Try it without installing anything: [cleanor.app/tools/avif-compressor](https://cleanor.app/tools/avif-compressor)
