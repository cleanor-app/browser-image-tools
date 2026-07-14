# How do I convert an image to WebP in JavaScript?

Draw the image to a canvas and export it with the MIME type `image/webp`. It works for PNG, JPEG, GIF (first frame) and BMP sources, and it runs entirely in the browser.

```ts
import { loadRasterImage, drawImageToCanvas, canvasToBlob, getBaseName, triggerDownload } from '@cleanor/browser-image-tools';

const source = await loadRasterImage(file); // file: a File from <input type="file">
const { canvas } = drawImageToCanvas(source.element, source.width, source.height);
const webpBlob = await canvasToBlob(canvas, 'image/webp', 0.85); // quality is 0 to 1

triggerDownload(URL.createObjectURL(webpBlob), `${getBaseName(file.name)}.webp`);
```

That is the whole conversion.

One gotcha worth knowing: when a browser does not support the requested MIME type, the HTML spec tells `canvas.toBlob` to fall back to PNG rather than fail. So the honest support check is to look at what came back:

```ts
const blob = await canvasToBlob(canvas, 'image/webp', 0.85);
const isWebp = blob.type === 'image/webp'; // false means the browser fell back to PNG
```

## Transparency

WebP supports an alpha channel, so a transparent PNG converts to a transparent WebP with no extra work: pass `null` as the background (the default) and `drawImageToCanvas` clears the canvas before drawing.

If you want the transparency flattened onto a colour or a gradient instead, use the PNG helper and then encode:

```ts
import { png, canvasToBlob } from '@cleanor/browser-image-tools';

const image = await png.loadPngImage(file);
const flattened = png.flattenPngTransparency(image.element, image.width, image.height, {
  mode: 'custom-solid',        // 'white' | 'black' | 'custom-solid' | 'two-stop-gradient'
  customColor: '#101828',
  gradientStart: '#101828',
  gradientEnd: '#475467',
  direction: 'to-bottom',      // 'to-bottom' | 'to-right' | 'to-bottom-right' | 'to-bottom-left'
});

const webpBlob = await canvasToBlob(flattened, 'image/webp', 0.85);
```

Before you decide, ask the pixels whether there is any transparency at all:

```ts
import { loadRasterImage, drawImageToCanvas, getCanvasImageData, analyzeTransparency } from '@cleanor/browser-image-tools';

const source = await loadRasterImage(file);
const { canvas } = drawImageToCanvas(source.element, source.width, source.height);
const stats = analyzeTransparency(getCanvasImageData(canvas).data);

console.log(stats.hasTransparency, stats.transparentPercent, stats.translucentPercent);
```

## Converting AVIF to WebP

An AVIF source cannot go through the plain canvas path in every browser, so the `avif` namespace decodes it with WebCodecs first:

```ts
import { avif } from '@cleanor/browser-image-tools';

if (!avif.canProcessAvifInBrowser()) throw new Error('This browser cannot decode AVIF locally.');

const webpBlob = await avif.convertAvifToWebp({ file, quality: 82 }); // quality 1 to 100
```

## Re-compressing an existing WebP

If the input is already WebP, do not round trip it through a canvas at default quality. Use the codec path, which keeps the pixels and only re-encodes:

```ts
import { webp } from '@cleanor/browser-image-tools';

const smaller = await webp.recompressStillWebp({
  file,
  quality: 78,              // 1 to 100
  lossless: false,
  methodPreset: 'smaller',  // 'balanced' | 'max-quality' | 'smaller'
});
```

`recompressStillWebp` throws on an animated WebP by design. For animated input, `webp.optimizeWebp` handles both cases: it re-encodes a still image, and for an animation it decodes the frames, optionally caps the frame rate, and re-encodes with ffmpeg.wasm.

```ts
const optimized = await webp.optimizeWebp({
  file,
  preset: 'smaller',   // 'balanced' | 'smaller' | 'aggressive' -> quality 82 / 68 / 52
  fpsCap: 15,          // number | null, animated input only
  colorCount: null,    // number | null, posterizes a still image when below 256
});
```

## Is it lossy or lossless?

Both are available. `canvasToBlob(canvas, 'image/webp', quality)` is lossy for any quality below 1. `webp.recompressStillWebp({ ..., lossless: true })` produces lossless VP8L, which is the right choice for screenshots, logos and flat-colour UI art, where lossy WebP smears text edges. For photographs, lossy WebP at 0.8 to 0.85 is almost always the smaller file.

## What about metadata?

The canvas path drops EXIF, including orientation and GPS. That is usually what you want when you publish an image on the web. If you need to read the EXIF before it is dropped, do it first:

```ts
import { jpg } from '@cleanor/browser-image-tools';

const bytes = new Uint8Array(await file.arrayBuffer());
const { summary } = await jpg.parseExifMetadata(file, bytes, 'jpeg');
console.log(summary.camera, summary.iso, summary.exposureLabel, summary.gps);
```

## Browser support

The still-WebP path needs nothing more than `canvas.toBlob`, unlike the AVIF path which needs WebCodecs. Verify at runtime with the `blob.type` check above rather than sniffing the user agent.

Animated WebP is the exception. Decoding its frames needs `ImageDecoder`, and encoding them needs ffmpeg.wasm, so both are feature detected:

```ts
import { webp, gif } from '@cleanor/browser-image-tools';

webp.canDecodeAnimatedWebpInBrowser(); // ImageDecoder is present
gif.canUseFfmpegInBrowser();           // window, Worker and document are present
```

## Related

- [Compress an image in JavaScript](compress-an-image-in-javascript.md)
- [AVIF encoding in the browser](avif-encoding-in-the-browser.md)
- [Resize an image with canvas](resize-an-image-with-canvas.md)
- Try it without installing anything: [cleanor.app/tools/png-to-webp](https://cleanor.app/tools/png-to-webp)
