# How do I resize an image with canvas?

Create a canvas at the target size, draw the image into it, and export the canvas. `drawImageToCanvas` is that whole sequence in one call, and the scaling is done by the browser's own resampler.

```ts
import { loadRasterImage, drawImageToCanvas, canvasToBlob } from '@cleanor/browser-image-tools';

const source = await loadRasterImage(file); // file: a File from <input type="file">

const targetWidth = 1600;
const targetHeight = Math.round(source.height * (targetWidth / source.width)); // keep the aspect ratio

const { canvas } = drawImageToCanvas(source.element, targetWidth, targetHeight);
const resized = await canvasToBlob(canvas, 'image/webp', 0.85);
```

`drawImageToCanvas(image, width, height, background = null)` returns `{ canvas, context }`. With `background` left as `null` the canvas is cleared first, so transparency survives. Pass a hex colour such as `'#ffffff'` and the image is drawn on top of a filled rectangle instead, which is what you want before a JPEG export.

## Fit or fill inside a fixed box

The snippet above stretches the image to exactly the width and height you pass, so if your numbers do not match the source aspect ratio, the image distorts. When you need a fixed output box (a thumbnail grid, an OG image, an app icon), use the framing helper. It computes the scale for you and centres the result.

```ts
import { png, canvasToBlob } from '@cleanor/browser-image-tools';

const image = await png.loadPngImage(file);

// 'fit': the whole image is visible, padding is filled with the background
const contained = png.drawFramedImageToCanvas(image.element, 1200, 630, 'fit', '#0b1120');

// 'fill': the box is fully covered, overflow is cropped, nothing is distorted
const covered = png.drawFramedImageToCanvas(image.element, 1200, 630, 'fill', null);

const ogImage = await canvasToBlob(contained, 'image/jpeg', 0.9);
```

`drawFramedImageToCanvas` takes any `HTMLImageElement`, not only a PNG, despite living in the `png` namespace.

## Computing the target size

`effects.computeEnlargedSize` centralizes the arithmetic behind a typical resize form, where the user either scales by a factor or types explicit dimensions:

```ts
import { effects } from '@cleanor/browser-image-tools';

// Scale mode: 0.5 halves both sides.
effects.computeEnlargedSize(4032, 3024, 'scale', 0.5, 0, 0, true);
// -> { width: 2016, height: 1512 }

// Dimensions mode with keepAspect: the height is derived from the width.
effects.computeEnlargedSize(4032, 3024, 'dimensions', 1, 1600, 0, true);
// -> { width: 1600, height: 1200 }
```

Every returned dimension is rounded and floored at 1 px, so a canvas is never created with a zero side.

## Cropping

To crop, draw the region you want and export only that. For the common case of trimming transparent padding away from a PNG, the library finds the bounds for you:

```ts
import { png } from '@cleanor/browser-image-tools';

const image = await png.loadPngImage(file);
const { canvas } = png.drawImageToCanvas(image.element, image.width, image.height);
const rgba = png.getCanvasRgba(canvas).data;

const bounds = png.findAlphaBounds(rgba, image.width, image.height, 8); // alpha threshold 0 to 255

if (bounds) {
  const cropped = png.cropCanvasToBounds(canvas, bounds); // HTMLCanvasElement, tightly trimmed
  const blob = await png.canvasToPngBlob(cropped);
}
```

`findAlphaBounds` returns `null` when every pixel is below the threshold, which means the image is effectively empty. Check it before you use the result.

## Downscaling makes images soft, so sharpen

Any resampler loses high-frequency detail. After a large reduction, a light sharpen restores the perceived crispness. Two options ship here, both pure functions on pixel buffers:

```ts
import { getCanvasImageData, applySharpen, convolution } from '@cleanor/browser-image-tools';

const imageData = getCanvasImageData(canvas);

// 3x3 sharpen kernel, strength clamped to 0 to 1.5
const sharpened = applySharpen(imageData, 0.6);

// or an unsharp mask, which is gentler on noise thanks to the threshold
const masked = convolution.unsharpMask(
  { width: imageData.width, height: imageData.height, data: imageData.data },
  0.8,  // amount, typically 0.2 to 3
  6,    // threshold 0 to 255, skips small differences so noise is not amplified
);
```

Put the pixels back on a canvas with `context.putImageData(sharpened, 0, 0)` before exporting, or use `png.rgbaToPngBlob(masked.data, masked.width, masked.height)` to go straight to a PNG blob.

## Building an icon set

Repeated resizes into one file is exactly what an `.ico` is, so that case has a helper:

```ts
import { loadImageElementFromBlob, ico } from '@cleanor/browser-image-tools';

const element = await loadImageElementFromBlob(file);
const icoBlob = await ico.buildIcoBlob(element, [16, 32, 48, 256]); // ico.ICO_SIZE_OPTIONS lists all six
```

Each size is rendered on its own canvas with `imageSmoothingQuality = 'high'`, encoded as a PNG, and packed into an ICO container. The header is verified before the blob is returned.

## Related

- [Compress an image in JavaScript](compress-an-image-in-javascript.md)
- [Convert an image to WebP in JavaScript](convert-an-image-to-webp-in-javascript.md)
- Full export list in the [README](../README.md#api)
- Try it without installing anything: [cleanor.app/tools](https://cleanor.app/tools)
