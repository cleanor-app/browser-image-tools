# @cleanor/browser-image-tools

**Compress, convert and resize images in the browser with JavaScript. PNG, JPEG, WebP, AVIF, GIF and ICO, entirely client side: no server, no upload, no API key.**

[![npm](https://img.shields.io/npm/v/@cleanor/browser-image-tools.svg)](https://www.npmjs.com/package/@cleanor/browser-image-tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Types](https://img.shields.io/badge/types-included-blue.svg)](#api)
[![Try it live](https://img.shields.io/badge/try%20it%20live-cleanor.app%2Ftools-0a7cff.svg)](https://cleanor.app/tools)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21217435.svg)](https://doi.org/10.5281/zenodo.21217435)

These are the exact modules behind the free tools at [cleanor.app/tools](https://cleanor.app/tools). Files never leave the device.

## Install

```bash
npm install @cleanor/browser-image-tools
```

```ts
import { loadRasterImage, drawImageToCanvas, canvasToBlob, formatFileSize } from '@cleanor/browser-image-tools';

const source = await loadRasterImage(file); // file: a File from <input type="file">
const { canvas } = drawImageToCanvas(source.element, source.width, source.height);
const compressed = await canvasToBlob(canvas, 'image/webp', 0.8); // quality is 0 to 1
console.log(formatFileSize(file.size), '->', formatFileSize(compressed.size));
```

That is the whole compression path: decode, draw, re-encode. Swap `'image/webp'` for `'image/jpeg'` or `'image/png'`, or pass a smaller width and height to `drawImageToCanvas` to resize while you compress.

Browser only. The modules use `HTMLCanvasElement`, `URL.createObjectURL`, WebCodecs and WebAssembly, so they are not meant for Node.

## API

Shared helpers are exported at the top level. Every format lives in its own namespace: `import { avif, webp, png, jpg, gif, gifEncoder, ico, effects, convolution } from '@cleanor/browser-image-tools'`. Everything ships with TypeScript types.

### Top level (canvas, files, colors)

| Export | Signature | Returns |
| --- | --- | --- |
| `loadRasterImage` | `(file: File)` | `Promise<LoadedRasterImage>` with `element`, `width`, `height`, `fileName`, `mimeType`, `size` |
| `loadImageElementFromBlob` | `(blob: Blob)` | `Promise<HTMLImageElement>` |
| `createCanvas` | `(width: number, height: number)` | `HTMLCanvasElement` |
| `prepareCanvas` | `(width, height, background?: string \| null)` | `{ canvas, context }`, cleared or filled |
| `drawImageToCanvas` | `(image: CanvasImageSource, width, height, background?: string \| null)` | `{ canvas, context }`, image scaled to width x height |
| `getCanvasImageData` | `(canvas: HTMLCanvasElement)` | `ImageData` |
| `canvasToBlob` | `(canvas, mimeType: string, quality?: number)` | `Promise<Blob>`, quality 0 to 1 |
| `canvasToPngBlob` | `(canvas)` | `Promise<Blob>` |
| `triggerDownload` | `(url: string, fileName: string)` | `void`, clicks a temporary `<a download>` |
| `analyzeTransparency` | `(rgba: Uint8ClampedArray \| Uint8Array)` | `TransparencyStats` (opaque, transparent, translucent counts and percentages) |
| `renderAlphaMask` | `(imageData: ImageData)` | `HTMLCanvasElement` of the alpha channel |
| `getDominantColors` | `(rgba: Uint8Array, limit = 8)` | `DominantColor[]` (hex + alpha), median cut via UPNG |
| `applySharpen` | `(imageData: ImageData, strength: number)` | `ImageData` |
| `makeColorTransparent` | `(imageData, targetHex: string, tolerance: number, edgeSmoothing: number)` | `ImageData` |
| `sampleHexColor` | `(imageData, x: number, y: number)` | `string` hex |
| `isRasterImageFile` | `(file: File)` | `boolean` (png, jpeg, webp, gif, bmp) |
| `blobToDataUrl`, `fileToDataUrl` | `(blob: Blob)`, `(file: File)` | `Promise<string>` data URL |
| `splitDataUrl` | `(dataUrl: string)` | `{ mimeType, base64 } \| null` |
| `decodeBase64ToBlob` | `(input: string, fallbackMimeType: string)` | `Blob` |
| `decodeBase64Payload` | `(base64: string)` | `Uint8Array` |
| `normalizeBase64Input`, `extractRawBase64` | `(input: string)` | `string` |
| `formatFileSize` | `(size: number)` | `string` such as `412.5 KB` |
| `getBaseName` | `(fileName: string)` | `string` without the extension |
| `getMimeLabel` | `(mimeType: string)` | `string` such as `WEBP` |
| `formatAspectRatio` | `(width, height)` | `string` such as `16:9` |
| `clamp`, `sanitizeHexColor`, `hexToRgb` | `(value, min, max)`, `(value: string)`, `(value: string)` | `number`, `string`, `{ red, green, blue }` |
| `rasterImageMimeTypes` | const | `Set<string>` |

Types: `LoadedRasterImage`, `DominantColor`, `TransparencyStats`.

### `png`

| Export | Signature | Returns |
| --- | --- | --- |
| `loadPngImage` | `(file: File)` | `Promise<LoadedPngImage>` |
| `isPngFile` | `(file: File)` | `boolean` |
| `readFileAsUint8Array` | `(file: File)` | `Promise<Uint8Array>` |
| `rgbaToPngBlob` | `(rgba, width, height)` | `Promise<Blob>` |
| `canvasToBlob`, `canvasToPngBlob`, `createCanvas`, `prepareCanvas`, `drawImageToCanvas`, `loadImageElementFromBlob`, `triggerDownload`, `formatFileSize`, `getBaseName`, `clamp`, `sanitizeHexColor`, `hexToRgb` | same as top level | same as top level |
| `drawFramedImageToCanvas` | `(image, width, height, mode: 'fit' \| 'fill', background: string \| null)` | `HTMLCanvasElement` |
| `getCanvasRgba` | `(canvas)` | `ImageData` |
| `findAlphaBounds` | `(rgba, width, height, threshold)` | `AlphaBounds \| null` |
| `cropCanvasToBounds` | `(canvas, bounds: AlphaBounds)` | `HTMLCanvasElement` |
| `decodeAnimatedPng` | `(bytes: Uint8Array)` | `DecodedAnimatedPng` (frames, delays, loopCount, animated) |
| `encodeAnimatedPng` | `({ frames, width, height, colorCount, delays?, loopCount? })` | `Uint8Array` APNG |
| `exportAnimatedPngFrameAsBlob` | `(frame: Uint8Array, width, height)` | `Promise<Blob>` |
| `patchApngLoopCount` | `(bytes, loopCount)` | `Uint8Array` |
| `framesAreEqual` | `(left, right)` | `boolean` |
| `mergeDuplicateAnimationFrames` | `(frames, delays)` | `{ frames, delays }` |
| `capAnimationFrameRate` | `(frames, delays, maxFps: number \| null)` | `{ frames, delays }` |
| `getAnimationDuration` | `(delays: number[])` | `number` ms |
| `quantizeRgbaFrame` | `(rgba, paletteSize)` | UPNG quantize result |
| `getPaletteHexes` | `(quantized, limit = 8)` | `{ color, alpha }[]` |
| `extractPaletteEntriesFromRgba` | `(rgba, limit: number \| null = null)` | `PngPaletteEntry[]` (color, alpha, count, percent) |
| `paletteEntriesToCssVariables` | `(entries, prefix = 'png-color')` | `string` |
| `paletteEntriesToJson` | `(entries)` | `string` |
| `renderPngChannelView` | `(imageData, mode: PngChannelView)` | `ImageData` |
| `flattenPngTransparency` | `(image, width, height, { mode, customColor, gradientStart, gradientEnd, direction })` | `HTMLCanvasElement` |
| `extractColorFromPng` | `(imageData, { targetHex, tolerance, edgeSoftness, invert })` | `ImageData` |
| `generatePngOutline` | `(imageData, { thickness, color, mode, edgeSoftness, threshold? })` | `ImageData` |
| `removePngOutlineHalo` | `(imageData, { haloWidth, aggressiveness, preserveInnerDetail, threshold? })` | `ImageData` |
| `buildOutlineSvgPath` | `(imageData, { threshold, simplifyAmount, offset })` | `{ svg, edgeImage }` |
| `createBackgroundTesterContactSheet` | `(image, width, height, items)` | `Promise<HTMLCanvasElement>` |
| `getBackgroundTesterStyle` | `(mode, customColor, gradientStart, gradientEnd, direction)` | CSS style object |
| `getPreviewBackgroundStyle` | `(mode: 'checker' \| 'white' \| 'black')` | CSS style object |
| `createZipBlob` | `(entries: ZipEntry[])` | `Promise<Blob>` (JSZip) |
| `createIcoBuffer` | `(pngBuffers: Array<{ size, buffer }>)` | `Promise<Uint8Array>` |
| `getSavingsPercent` | `(sourceSize, resultSize)` | `number` |

Types: `LoadedPngImage`, `AlphaBounds`, `CanvasFramingMode`, `DecodedAnimatedPng`, `ZipEntry`, `PngPaletteEntry`, `PngChannelView`, `FlattenBackgroundMode`, `GradientDirection`, `OutlineMode`, `BackgroundTesterMode`.

### `jpg`

| Export | Signature | Returns |
| --- | --- | --- |
| `decodeJpegLikeSource` | `(file: File)` | `Promise<DecodedJpgSource>`, decodes JPEG and HEIC/HEIF |
| `encodeJpegBlobFromImageData` | `(imageData, { quality?, progressive?, subsampling? })` | `Promise<Blob>`, MozJPEG WebAssembly, quality 0 to 1 (default 0.84) |
| `encodeJpegBlobFromCrossImage` | `(image, options)` | `Promise<Blob>` |
| `inspectJpegStructure` | `(bytes: Uint8Array)` | `JpegStructureInfo` (component count, progressive, Adobe transform, CMYK-like) |
| `parseExifMetadata` | `(file, bytes, format)` | `Promise<ParsedExifMetadata>` (raw plus normalized camera, ISO, exposure, GPS) |
| `isJpegFile`, `isHeicFile`, `isJpegLikeFile` | `(file: File)` | `boolean` |
| `getJpegLikeFormat` | `(file: File)` | `'jpeg' \| 'heic' \| null` |
| `crossImageToImageData`, `imageDataToCrossImage` | `(image)`, `(imageData)` | `ImageData`, `Image` |
| `imageDataToPngBlob`, `imageDataToPngPreviewUrl` | `(imageData)` | `Promise<Blob>`, `Promise<string>` |
| `createPreviewUrlFromBlob` | `(blob)` | `Promise<string>` |
| `revokeDecodedJpgSource` | `(source)` | `void` |
| `getBestJpgSourcePreview` | `(source)` | `string \| null` |
| `applyArtifactReduction` | `(imageData, strength, detailProtection)` | `ImageData` |
| `applyDenoise` | `(imageData, strength, detailRetention)` | `ImageData` |
| `applyBlackAndWhite` | `(imageData, mode: 'grayscale' \| 'high-contrast', contrast, brightness)` | `ImageData` |
| `applyRedEyeCorrection` | `(imageData, points: RedEyePoint[], intensity)` | `ImageData` |
| `rotateImageData` | `(imageData, degrees, background = '#ffffff')` | `ImageData` |
| `estimateDeskewDegrees` | `(imageData)` | `number` |
| `cleanScanImageData` | `(imageData, { autoDeskew, manualRotateDegrees, whitening, contrastCleanup })` | `{ autoAngle, imageData }` |
| `jpegMimeTypes`, `heicMimeTypes` | const | `Set<string>` |

Types: `JpegLikeFormat`, `JpegSubsamplingPreset`, `JpegStructureInfo`, `NormalizedExifSummary`, `ParsedExifMetadata`, `DecodedJpgSource`, `RedEyePoint`.

### `webp`

| Export | Signature | Returns |
| --- | --- | --- |
| `recompressStillWebp` | `({ file, quality, lossless, methodPreset: 'balanced' \| 'max-quality' \| 'smaller' })` | `Promise<Blob>`, quality 1 to 100 |
| `optimizeWebp` | `({ file, preset: 'balanced' \| 'smaller' \| 'aggressive', fpsCap: number \| null, colorCount: number \| null })` | `Promise<Blob>`, still and animated WebP |
| `readWebpSource` | `(file: File)` | `Promise<DecodedWebpSource>` |
| `readWebpMetadataFromBytes` | `(bytes, fallbackSize?)` | `WebpMetadata`, RIFF chunk parser, no decode |
| `decodeAnimatedWebpFrames` | `(file, progressHandler?)` | `Promise<DecodedWebpFrame[]>`, WebCodecs `ImageDecoder` |
| `encodeAnimatedWebp` | `({ frames, loopCount, quality, method?, progressHandler? })` | `Promise<Blob>`, ffmpeg.wasm `libwebp_anim` |
| `convertWebpToGif` | `({ file, width, fpsCap, loopCount, qualityPreset })` | `Promise<Blob>` |
| `convertWebpToMp4` | `({ file, width, fps, background })` | `Promise<Blob>` |
| `convertVideoToWebp` | `({ file, startMs, endMs, width, fps, loopCount, qualityPreset })` | `Promise<Blob>` |
| `flattenWebpSource` | `({ file, mode, customColor, gradientStart, gradientEnd, direction })` | `Promise<Blob>` |
| `renderStillWebpImageData` | `(file)` | `Promise<ImageData>` |
| `renderFrameToImageData` | `(frame: DecodedWebpFrame)` | `Promise<ImageData>` |
| `renderWebpChannelBlob` | `({ file, channel, frameIndex? })` | `Promise<Blob>` |
| `extractWebpPalette` | `(file, limit, frameIndex = 0)` | `Promise<PngPaletteEntry[]>` |
| `summarizeWebpTransparency` | `(rgba)` | `TransparencyStats` |
| `isWebpFile` | `(file)` | `boolean` |
| `canDecodeAnimatedWebpInBrowser` | `()` | `boolean` |

Types: `WebpMetadata`, `DecodedWebpFrame`, `DecodedWebpSource`, `WebpOptimizationPreset`.

### `avif`

| Export | Signature | Returns |
| --- | --- | --- |
| `convertJpgToAvif` | `({ file, quality })` | `Promise<AvifExportResult>` = `{ blob, previewBlob }`, quality 1 to 100 |
| `convertPngToAvif` | `({ file, quality })` | `Promise<AvifExportResult>` |
| `convertWebpToAvif` | `({ file, quality })` | `Promise<AvifExportResult>`, still WebP only |
| `convertAvifToJpg` | `({ file, quality })` | `Promise<Blob>`, alpha flattened onto white |
| `convertAvifToPng` | `(file: File)` | `Promise<Blob>` |
| `convertAvifToWebp` | `({ file, quality })` | `Promise<Blob>` |
| `optimizeAvif` | `({ file, preset: 'balanced' \| 'smaller' \| 'aggressive' })` | `Promise<AvifExportResult>`, quality 70 / 56 / 42 |
| `recompressStillAvif` | `({ file, quality, effortPreset: 'faster' \| 'balanced' \| 'slower' })` | `Promise<AvifExportResult>`, effort biases quality by -6 / 0 / +4 |
| `readAvifSource` | `(file)` | `Promise<DecodedAvifSource>` (bytes, `ImageData`, width, height, hasAlpha) |
| `createAvifPreviewBlobFromFile` | `(file)` | `Promise<Blob>`, PNG preview |
| `analyzeAvifAlpha` | `(file)` | `Promise<{ source, transparency, alphaBlob, alphaMaskBlob }>` |
| `renderAvifChannelBlob` | `({ file, channel })` | `Promise<Blob>` |
| `canProcessAvifInBrowser` | `()` | `boolean`, checks `ImageDecoder` plus `OffscreenCanvas` |
| `assertAvifRuntime` | `()` | throws if the runtime cannot do AVIF |
| `isAvifFile`, `fileIsJpeg`, `fileIsPng`, `fileIsWebp` | `(file)` | `boolean` |

Types: `AvifMetadata`, `DecodedAvifSource`, `AvifOptimizationPreset`, `AvifEffortPreset`, `AvifExportResult`.

### `gif`, `gifEncoder`, `ico`, `effects`, `convolution`

| Export | Signature | Returns |
| --- | --- | --- |
| `gif.readGifMetadata` | `(file)` | `Promise<GifMetadata>`, pure JS header parse |
| `gif.extractGifFrames` | `(file)` | `Promise<ExtractedGifFrame[]>`, PNG frames |
| `gif.extractGifPreviewFrame` | `(file)` | `Promise<Blob>` |
| `gif.encodePngSequenceToGif` | `({ frames, loopCount, outputName? })` | `Promise<Blob>` |
| `gif.optimizeGif` | `({ file, loopCount, fpsCap, colorCount, lossyLevel, progressHandler? })` | `Promise<Blob>` |
| `gif.resizeGif` | `({ file, width, height, fitMode: 'contain' \| 'cover', background, loopCount })` | `Promise<Blob>` |
| `gif.cropGif` | `({ file, x, y, width, height, loopCount })` | `Promise<Blob>` |
| `gif.trimGif` | `({ file, startMs, endMs, loopCount })` | `Promise<Blob>` |
| `gif.changeGifSpeed` | `({ file, speedFactor, loopCount })` | `Promise<Blob>` |
| `gif.reverseGif` | `({ file, loopCount })` | `Promise<Blob>` |
| `gif.splitGif` | `({ file, splitPointsMs, durationMs, loopCount })` | `Promise<GifSegment[]>` |
| `gif.convertGifToMp4` | `({ file, width, height, fps, background })` | `Promise<Blob>` |
| `gif.convertVideoToGif` | `({ file, startMs, endMs, width, fps, loopCount, qualityPreset })` | `Promise<Blob>` |
| `gif.extractVideoClipFramesAsPng` | `({ file, startMs, endMs, width, fps })` | `Promise<ExtractedVideoPngFrame[]>` |
| `gif.loadGifFramePreview` | `(frame)` | `Promise<LoadedRasterImage>` |
| `gif.renderGifFrameBlob` | `(image, width, height, background = null)` | `Promise<Blob>` |
| `gif.canUseFfmpegInBrowser` | `()` | `boolean` |
| `gif.getBrowserFfmpegRuntime` | `()` | `Promise<{ ffmpeg, fetchFile }>`, loads ffmpeg.wasm once |
| `gifEncoder.encodeGif` | `(data: Uint8ClampedArray \| Uint8Array, width, height)` | `GifEncodeResult` = `{ bytes, paletteSize, width, height }`, dependency-free GIF89a |
| `ico.buildIcoBlob` | `(image: HTMLImageElement, sizes: number[])` | `Promise<Blob>` |
| `ico.encodeIco` | `(images: IcoSourceImage[])` | `Uint8Array` |
| `ico.renderPngAtSize` | `(image, size)` | `Promise<Uint8Array>` |
| `ico.verifyIcoHeader` | `(bytes, expectedCount)` | `boolean` |
| `ico.ICO_SIZE_OPTIONS` | const | `[16, 32, 48, 64, 128, 256]` |
| `effects.FILTER_PRESETS` | const | 14 CSS filter presets: original, grayscale, sepia, invert, brighten, darken, contrast, saturate, faded, blur, vintage, noir, cool, warm |
| `effects.adjustContrast`, `effects.adjustSaturation` | `(data: Uint8ClampedArray, amount: number)` | `void`, in place, 1 = unchanged |
| `effects.addNoise` | `(data, amount, seed)` | `void`, in place, seeded |
| `effects.mulberry32` | `(seed: number)` | `() => number` |
| `effects.sharpen` | `(src, width, height, amount)` | `Uint8ClampedArray` |
| `effects.computeEnlargedSize` | `(naturalWidth, naturalHeight, mode: 'scale' \| 'dimensions', scale, targetWidth, targetHeight, keepAspect)` | `{ width, height }` |
| `convolution.gaussianBlur3x3` | `(src: PixelBuffer)` | `PixelBuffer` |
| `convolution.unsharpMask` | `(src: PixelBuffer, amount: number, threshold = 0)` | `PixelBuffer` |

Types: `GifMetadata`, `ExtractedGifFrame`, `ExtractedVideoPngFrame`, `GifSegment`, `GifResizeMode`, `GifEncodeResult`, `IcoSourceImage`, `FilterPreset`, `EnlargeResult`, `PixelBuffer`.

## Supported formats

| Format | Decode | Encode | How |
| --- | --- | --- | --- |
| PNG | yes | yes | Canvas (`canvasToPngBlob`, `png.rgbaToPngBlob`) |
| APNG | yes | yes | UPNG, pure JS (`png.decodeAnimatedPng`, `png.encodeAnimatedPng`) |
| JPEG | yes | yes | Canvas (`canvasToBlob`), or MozJPEG WebAssembly with progressive and chroma-subsampling control (`jpg.encodeJpegBlobFromImageData`) |
| HEIC / HEIF | yes | no | `jpg.decodeJpegLikeSource`, through the browser `ImageDecoder`. Re-encode to JPEG, WebP or PNG |
| WebP (still) | yes | yes | Canvas, plus `webp.recompressStillWebp` and `webp.optimizeWebp` (OffscreenCanvas encoder, with a pure-JS VP8L lossless fallback) |
| WebP (animated) | yes | yes | Decode with WebCodecs `ImageDecoder`, encode with ffmpeg.wasm `libwebp_anim` |
| AVIF | yes | yes | Browser codec: `ImageDecoder` decodes, `OffscreenCanvas.convertToBlob` encodes. See [docs/avif-encoding-in-the-browser.md](docs/avif-encoding-in-the-browser.md) |
| GIF (animated) | yes | yes | ffmpeg.wasm with a palettegen / paletteuse filter graph |
| GIF (single frame) | n/a | yes | `gifEncoder.encodeGif`, dependency-free GIF89a (median cut plus LZW), opaque frames |
| ICO | no | yes | `ico.buildIcoBlob`, PNG payloads packed into an ICO container, pure JS |
| BMP | yes | no | Recognized by `isRasterImageFile`, decoded by the browser through `loadRasterImage` |
| MP4 | n/a | yes | ffmpeg.wasm (`gif.convertGifToMp4`, `webp.convertWebpToMp4`) |

## Docs

| Question | Doc |
| --- | --- |
| How do I compress an image in JavaScript? | [docs/compress-an-image-in-javascript.md](docs/compress-an-image-in-javascript.md) |
| How do I convert an image to WebP in JavaScript? | [docs/convert-an-image-to-webp-in-javascript.md](docs/convert-an-image-to-webp-in-javascript.md) |
| How does AVIF encoding work in the browser? | [docs/avif-encoding-in-the-browser.md](docs/avif-encoding-in-the-browser.md) |
| How do I resize an image with canvas? | [docs/resize-an-image-with-canvas.md](docs/resize-an-image-with-canvas.md) |

## FAQ

### Does this library upload my images anywhere?

No. Every function runs inside the browser tab, on Canvas 2D, WebCodecs and WebAssembly. There is no server, no API key and no request that carries your pixels. The library makes exactly one kind of network call: the ffmpeg.wasm core files (`ffmpeg-core.js`, `ffmpeg-core.wasm`, `ffmpeg-core.worker.js`) are fetched from the jsDelivr CDN the first time you call a GIF, animated-WebP or MP4 function. Your image is not part of that request. For a fully offline build, self-host those three files and load them yourself.

### Does it work in Safari?

The canvas paths work in any browser with `canvas.toBlob`: PNG, JPEG and WebP encoding, resize, crop, palette and alpha analysis, plus the pure-JS encoders (APNG, single-frame GIF, ICO) and the MozJPEG WebAssembly encoder. The AVIF, HEIC and animated-WebP paths depend on WebCodecs `ImageDecoder` and on `OffscreenCanvas`, which are not present in every browser, so the library ships feature detection instead of guessing:

```ts
import { avif, webp, gif } from '@cleanor/browser-image-tools';

if (avif.canProcessAvifInBrowser()) { /* ImageDecoder and OffscreenCanvas are present */ }
if (webp.canDecodeAnimatedWebpInBrowser()) { /* ImageDecoder is present */ }
if (gif.canUseFfmpegInBrowser()) { /* window, Worker and document are present */ }
```

Call the check first, and fall back to a canvas WebP or JPEG export when it returns `false`.

### What is the bundle size?

Measured on the published build: `dist/index.js` is 563 KB raw and 97 KB gzipped (tsup does not minify). An app that imports only the four canvas helpers from the example above, bundled with esbuild using minify and tree-shaking, measured 228 KB raw and 62 KB gzipped. Most of that is the inlined pure-JS codec library. The heavy codecs are not counted in those numbers: `@ffmpeg/ffmpeg`, `@jsquash/jpeg`, `@pdf-lib/upng`, `jszip` and `exifr` stay external so your bundler can split them per namespace, and ffmpeg.wasm is imported dynamically on first use.

### How does AVIF encoding work in the browser?

This package ships no AVIF encoder. `avif.convertJpgToAvif` and its siblings put the pixels on an `OffscreenCanvas` and call `convertToBlob({ type: 'image/avif', quality })`, so the browser's own AVIF encoder does the work, and decoding runs through the WebCodecs `ImageDecoder`. That keeps the download small at the cost of depending on the runtime: if the browser cannot produce `image/avif`, the call throws rather than silently handing back a PNG. Guard it with `avif.canProcessAvifInBrowser()`. Full detail in [docs/avif-encoding-in-the-browser.md](docs/avif-encoding-in-the-browser.md).

### Is it tied to a framework?

No. It is plain TypeScript with no framework dependency, so it works with React, Vue, Svelte, or a plain `<script type="module">`. The format modules carry a `'use client'` banner, so they drop straight into a Next.js App Router client component.

### Can I run it in Node?

No. The modules need `document`, `HTMLCanvasElement` and `URL.createObjectURL`.

## Related projects

| Project | What it is |
| --- | --- |
| [cleanor-app/cleanor-mcp](https://github.com/cleanor-app/cleanor-mcp) | Zero-auth MCP server that gives AI agents image and developer tools |
| [cleanor-app/cleanor-storage-lab](https://github.com/cleanor-app/cleanor-storage-lab) | Open datasets and benchmarks on device storage and image formats |
| [cleanor-app/image-compressor-chrome-extension](https://github.com/cleanor-app/image-compressor-chrome-extension) | The same pipeline as a Chrome extension |
| [cleanor-app/wordpress-image-optimizer](https://github.com/cleanor-app/wordpress-image-optimizer) | WordPress plugin that compresses and converts media |
| [cleanor-app/figma-image-compressor](https://github.com/cleanor-app/figma-image-compressor) | Figma plugin that compresses images inside a file |

## Try it live

Every namespace backs a free, no-signup tool:

| Do this | Live tool |
| --- | --- |
| Compress any image | [image-converter](https://cleanor.app/tools/image-converter) |
| PNG to WebP | [png-to-webp](https://cleanor.app/tools/png-to-webp) |
| AVIF to JPG, PNG or WebP | [avif-to-jpg](https://cleanor.app/tools/avif-to-jpg), [avif-to-png](https://cleanor.app/tools/avif-to-png), [avif-to-webp](https://cleanor.app/tools/avif-to-webp) |
| Recompress AVIF | [avif-compressor](https://cleanor.app/tools/avif-compressor) |
| Build an animated WebP | [animated-webp-maker](https://cleanor.app/tools/animated-webp-maker) |
| Generate an app-icon pack | [app-icon-pack-generator](https://cleanor.app/tools/app-icon-pack-generator) |

## Contributing

Issues and PRs welcome: bug fixes, new format helpers, and framework examples (React, Vue, Svelte hooks) especially. Build and typecheck before opening a PR:

```bash
npm install
npm run typecheck
npm run build
```

A local checkout pulls `@cross/image` from JSR as a dev dependency, so it needs one line in `.npmrc` (already committed):

```
@jsr:registry=https://npm.jsr.io
```

That library is inlined into `dist/`, so consumers of the published package do not need it.

## Citation

If you use this library in research or a product, please cite it, see [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this repository" button). Authored by Cleanor Labs, [ORCID 0009-0005-4623-961X](https://orcid.org/0009-0005-4623-961X). The archived, citable version has DOI [10.5281/zenodo.21217435](https://doi.org/10.5281/zenodo.21217435).

## License

[MIT](LICENSE) © Cleanor Labs. More open data and tools at [cleanor.app/research](https://cleanor.app/research) and [cleanor.app/tools](https://cleanor.app/tools).
