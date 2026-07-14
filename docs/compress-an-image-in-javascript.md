# How do I compress an image in JavaScript?

Decode the file, draw it to a canvas, and re-encode it at a lower quality. That is three calls, it runs in the browser, and nothing is uploaded.

```ts
import { loadRasterImage, drawImageToCanvas, canvasToBlob, formatFileSize } from '@cleanor/browser-image-tools';

const source = await loadRasterImage(file); // file: a File from <input type="file">
const { canvas } = drawImageToCanvas(source.element, source.width, source.height);
const compressed = await canvasToBlob(canvas, 'image/webp', 0.8); // quality is 0 to 1

console.log(formatFileSize(file.size), '->', formatFileSize(compressed.size));
```

`compressed` is a `Blob`. Upload it, put it in a `FormData`, or hand it to `triggerDownload(URL.createObjectURL(compressed), 'photo.webp')`.

## Choosing the encoder

Three knobs decide the output size: the **format**, the **quality**, and the **pixel dimensions**.

`canvasToBlob(canvas, mimeType, quality)` is the generic path. It accepts `'image/webp'`, `'image/jpeg'` and `'image/png'` (PNG ignores `quality`, it is lossless). WebP at 0.8 is the safe default for photographs. If the source has transparency, WebP and PNG keep it, JPEG does not.

For JPEG specifically, this library also exposes a MozJPEG WebAssembly encoder, which usually beats the browser's canvas JPEG at the same visual quality and gives you progressive scans and chroma-subsampling control:

```ts
import { jpg } from '@cleanor/browser-image-tools';

const source = await jpg.decodeJpegLikeSource(file); // JPEG, HEIC and HEIF
const blob = await jpg.encodeJpegBlobFromCrossImage(source.image, {
  quality: 0.72,        // 0 to 1, default 0.84
  progressive: true,
  subsampling: '420',   // 'auto' | '444' | '420'
});

jpg.revokeDecodedJpgSource(source); // release the preview object URLs
```

`decodeJpegLikeSource` also decodes HEIC and HEIF, which is how you turn an iPhone photo into a small JPEG without a server. That path uses the browser's `ImageDecoder`, so wrap it in a `try` and fall back if the browser cannot decode `image/heic`.

To re-compress an existing WebP without going through a canvas round trip:

```ts
import { webp } from '@cleanor/browser-image-tools';

const smaller = await webp.recompressStillWebp({
  file,                     // a still .webp
  quality: 75,              // 1 to 100 here, not 0 to 1
  lossless: false,
  methodPreset: 'balanced', // 'balanced' | 'max-quality' | 'smaller'
});
```

Note the quality scales differ on purpose: `canvasToBlob` follows the DOM (`0` to `1`), the format namespaces follow their codecs (`1` to `100`).

## Compressing to a target file size

There is no magic "make it 200 KB" flag in any browser encoder, because the encoder cannot know the output size until it has encoded. The honest way is a short search over quality, which is cheap since every attempt is local:

```ts
import { loadRasterImage, drawImageToCanvas, canvasToBlob } from '@cleanor/browser-image-tools';

async function compressToTarget(file: File, targetBytes: number) {
  const source = await loadRasterImage(file);
  const { canvas } = drawImageToCanvas(source.element, source.width, source.height);

  let best = await canvasToBlob(canvas, 'image/webp', 0.9);

  for (const quality of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    if (best.size <= targetBytes) break;
    best = await canvasToBlob(canvas, 'image/webp', quality);
  }

  return best; // may still exceed the target: then resize, see below
}
```

If quality alone will not get you there, shrink the pixels. Dimensions dominate file size, and a 4000 px photo displayed in a 900 px column is 95% waste. Pass the target size straight into `drawImageToCanvas`:

```ts
const scale = 1600 / source.width;
const { canvas } = drawImageToCanvas(source.element, 1600, Math.round(source.height * scale));
```

See [resize-an-image-with-canvas.md](resize-an-image-with-canvas.md) for the fit and fill variants, and for sharpening after a downscale.

## Reporting the result

```ts
import { png, formatFileSize } from '@cleanor/browser-image-tools';

const saved = png.getSavingsPercent(file.size, compressed.size); // 0 if the result got bigger
console.log(`${formatFileSize(file.size)} -> ${formatFileSize(compressed.size)} (${saved}% smaller)`);
```

`getSavingsPercent` returns `0` rather than a negative number when the re-encode came out larger, which is a real outcome: re-encoding an already optimized JPEG at high quality can grow it. Always compare and keep the smaller of the two.

## Why do this in the browser?

- **Privacy.** The bytes never leave the device, so there is nothing to leak, log or delete afterwards.
- **Cost.** No image server to run, scale or pay for.
- **Latency.** No upload round trip, so compression starts the moment the user picks the file.

## Related

- [Convert an image to WebP in JavaScript](convert-an-image-to-webp-in-javascript.md)
- [AVIF encoding in the browser](avif-encoding-in-the-browser.md)
- [Resize an image with canvas](resize-an-image-with-canvas.md)
- Full export list in the [README](../README.md#api)
- Try it without installing anything: [cleanor.app/tools/image-compressor](https://cleanor.app/tools/image-compressor)
