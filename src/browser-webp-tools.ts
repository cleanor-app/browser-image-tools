'use client';

import { Image as CrossImage } from '@cross/image';
import { encodePngSequenceToGif, getBrowserFfmpegRuntime } from './browser-gif-tools';
import {
  analyzeTransparency,
  canvasToBlob,
  clamp,
  createCanvas,
  drawImageToCanvas,
  formatFileSize,
  getBaseName,
  loadImageElementFromBlob,
  loadRasterImage,
  sanitizeHexColor,
} from './browser-image-tools';
import {
  capAnimationFrameRate,
  createZipBlob,
  extractPaletteEntriesFromRgba,
  flattenPngTransparency,
  getAnimationDuration,
  paletteEntriesToCssVariables,
  paletteEntriesToJson,
  renderPngChannelView,
  rgbaToPngBlob,
  type FlattenBackgroundMode,
  type GradientDirection,
  type PngChannelView,
  type PngPaletteEntry,
} from './browser-png-tools';

type ProgressHandler = (progress: number) => void;

export type WebpMetadata = {
  width: number;
  height: number;
  animated: boolean;
  frameCount: number;
  durationMs: number;
  loopCount: number | null;
  hasAlpha: boolean;
  delaysMs: number[];
};

export type DecodedWebpFrame = {
  index: number;
  name: string;
  blob: Blob;
  rgba: Uint8Array;
  width: number;
  height: number;
  delayMs: number;
};

export type DecodedWebpSource = {
  file: File;
  bytes: Uint8Array;
  metadata: WebpMetadata;
  loadedImage: Awaited<ReturnType<typeof loadRasterImage>>;
};

export type WebpOptimizationPreset = 'balanced' | 'smaller' | 'aggressive';

function readUint32LE(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function normalizeFfmpegOutput(data: string | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function buildConcatManifest(frameNames: string[], delays: number[]) {
  const lines: string[] = [];

  frameNames.forEach((frameName, index) => {
    const safeName = frameName.replace(/'/g, "'\\''");
    lines.push(`file '${safeName}'`);
    lines.push(`duration ${Math.max(0.02, delays[index] / 1000).toFixed(3)}`);
  });

  if (frameNames.length) {
    const lastFrame = frameNames[frameNames.length - 1].replace(/'/g, "'\\''");
    lines.push(`file '${lastFrame}'`);
  }

  return `${lines.join('\n')}\n`;
}

async function cleanupFiles(
  ffmpeg: Awaited<ReturnType<typeof getBrowserFfmpegRuntime>>['ffmpeg'],
  fileNames: string[],
) {
  await Promise.allSettled(fileNames.map((fileName) => ffmpeg.deleteFile(fileName)));
}

async function readBlobFromFile(
  ffmpeg: Awaited<ReturnType<typeof getBrowserFfmpegRuntime>>['ffmpeg'],
  fileName: string,
  mimeType: string,
) {
  const outputData = await ffmpeg.readFile(fileName);
  const outputBytes = normalizeFfmpegOutput(outputData);
  return new Blob([outputBytes], { type: mimeType });
}

async function createStillWebpBlobFromImageData(
  imageData: ImageData,
  options: {
    quality: number;
    lossless: boolean;
  },
) {
  const image = CrossImage.fromRGBA(
    imageData.width,
    imageData.height,
    new Uint8Array(imageData.data),
  );
  const encoded = await image.encode('webp', {
    quality: clamp(Math.round(options.quality), 1, 100),
    lossless: options.lossless,
  } as never);
  return new Blob([Uint8Array.from(encoded)], { type: 'image/webp' });
}

function getOptimizationQuality(preset: WebpOptimizationPreset) {
  if (preset === 'smaller') {
    return 68;
  }

  if (preset === 'aggressive') {
    return 52;
  }

  return 82;
}

function getCompressionLevel(preset: WebpOptimizationPreset, method?: number | null) {
  if (typeof method === 'number') {
    return clamp(Math.round(method), 0, 6);
  }

  if (preset === 'aggressive') {
    return 6;
  }

  if (preset === 'smaller') {
    return 5;
  }

  return 4;
}

function createAnimatedDecodeError() {
  return new Error(
    'This browser could not decode animated WebP frames locally. Try a modern Chromium or Safari build.',
  );
}

function canvasFromVideoFrame(frame: VideoFrame) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
  }

  return createCanvas(frame.displayWidth, frame.displayHeight);
}

function isCanvas2DContext(
  context: OffscreenCanvasRenderingContext2D | RenderingContext | null,
): context is CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  return !!context && 'clearRect' in context && 'drawImage' in context && 'getImageData' in context;
}

async function canvasLikeToPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type: 'image/png' });
  }

  return await canvasToBlob(canvas, 'image/png');
}

function isWebpRiff(bytes: Uint8Array) {
  if (bytes.length < 12) {
    return false;
  }

  return (
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  );
}

export function isWebpFile(file: File) {
  return file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp');
}

export function canDecodeAnimatedWebpInBrowser() {
  return typeof window !== 'undefined' && typeof ImageDecoder !== 'undefined';
}

export function readWebpMetadataFromBytes(
  bytes: Uint8Array,
  fallbackSize?: { width: number; height: number },
): WebpMetadata {
  if (!isWebpRiff(bytes)) {
    throw new Error('Choose one WebP file for this tool.');
  }

  let width = fallbackSize?.width ?? 0;
  let height = fallbackSize?.height ?? 0;
  let animated = false;
  let frameCount = 1;
  let durationMs = 0;
  let loopCount: number | null = null;
  let hasAlpha = false;
  const delaysMs: number[] = [];
  let position = 12;

  while (position + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(
      bytes[position],
      bytes[position + 1],
      bytes[position + 2],
      bytes[position + 3],
    );
    const chunkSize = readUint32LE(bytes, position + 4);
    const dataStart = position + 8;
    const dataEnd = dataStart + chunkSize;

    if (dataEnd > bytes.length) {
      break;
    }

    const chunkData = bytes.slice(dataStart, dataEnd);

    if (chunkType === 'VP8X' && chunkData.length >= 10) {
      const flags = chunkData[0];
      animated ||= (flags & 0x02) !== 0;
      hasAlpha ||= (flags & 0x10) !== 0;
      width ||= readUint24LE(chunkData, 4) + 1;
      height ||= readUint24LE(chunkData, 7) + 1;
    } else if (chunkType === 'ANIM' && chunkData.length >= 6) {
      animated = true;
      loopCount = readUint16LE(chunkData, 4);
      frameCount = 0;
    } else if (chunkType === 'ANMF' && chunkData.length >= 16) {
      animated = true;
      frameCount += 1;
      const frameDuration = Math.max(20, readUint24LE(chunkData, 12));
      durationMs += frameDuration;
      delaysMs.push(frameDuration);
      const frameWidth = readUint24LE(chunkData, 6) + 1;
      const frameHeight = readUint24LE(chunkData, 9) + 1;
      width = Math.max(width, frameWidth);
      height = Math.max(height, frameHeight);
      hasAlpha ||= (chunkData[15] & 0x02) === 0;
    } else if (chunkType === 'ALPH') {
      hasAlpha = true;
    } else if (chunkType === 'VP8L') {
      hasAlpha = true;
    }

    position = dataEnd + (chunkSize % 2 === 1 ? 1 : 0);
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    animated,
    frameCount: animated ? Math.max(1, frameCount) : 1,
    durationMs: animated ? Math.max(20, durationMs) : 0,
    loopCount,
    hasAlpha,
    delaysMs: animated ? delaysMs : [100],
  };
}

export async function readWebpSource(file: File): Promise<DecodedWebpSource> {
  if (!isWebpFile(file)) {
    throw new Error('Choose one WebP file for this tool.');
  }

  const [bytes, loadedImage] = await Promise.all([
    new Uint8Array(await file.arrayBuffer()),
    loadRasterImage(file),
  ]);

  return {
    file,
    bytes,
    loadedImage,
    metadata: readWebpMetadataFromBytes(bytes, {
      width: loadedImage.width,
      height: loadedImage.height,
    }),
  };
}

export async function decodeAnimatedWebpFrames(
  file: File,
  progressHandler?: ProgressHandler,
): Promise<DecodedWebpFrame[]> {
  if (!canDecodeAnimatedWebpInBrowser()) {
    throw createAnimatedDecodeError();
  }

  const source = await readWebpSource(file);

  if (!source.metadata.animated) {
    throw new Error(
      'This WebP is static. Use WebP Quality Recompressor or WebP Optimizer instead.',
    );
  }

  const decoder = new ImageDecoder({ data: source.bytes, type: 'image/webp' });
  const frames: DecodedWebpFrame[] = [];

  try {
    for (let index = 0; index < source.metadata.frameCount; index += 1) {
      const result = await decoder.decode({ frameIndex: index });
      const videoFrame = result.image;
      const canvas = canvasFromVideoFrame(videoFrame);
      const context = canvas.getContext('2d');

      if (!isCanvas2DContext(context)) {
        videoFrame.close();
        throw createAnimatedDecodeError();
      }

      context.clearRect(0, 0, videoFrame.displayWidth, videoFrame.displayHeight);
      context.drawImage(videoFrame, 0, 0);

      const imageData = context.getImageData(
        0,
        0,
        videoFrame.displayWidth,
        videoFrame.displayHeight,
      );
      const blob = await canvasLikeToPngBlob(canvas);
      videoFrame.close();

      frames.push({
        index: index + 1,
        name: `frame-${String(index + 1).padStart(4, '0')}.png`,
        blob,
        rgba: new Uint8Array(imageData.data),
        width: imageData.width,
        height: imageData.height,
        delayMs: source.metadata.delaysMs[index] ?? 100,
      });
      progressHandler?.((index + 1) / Math.max(1, source.metadata.frameCount));
    }
  } finally {
    decoder.close();
  }

  return frames;
}

export async function encodeAnimatedWebp(params: {
  frames: Array<{ blob: Blob; delayMs: number }>;
  loopCount: number;
  quality: number;
  method?: number;
  progressHandler?: ProgressHandler;
}) {
  const runtime = await getBrowserFfmpegRuntime();
  const manifestName = 'frames.txt';
  const outputName = 'output.webp';
  const cleanupTargets = [manifestName, outputName];
  const inputNames: string[] = [];

  try {
    for (let index = 0; index < params.frames.length; index += 1) {
      const frameName = `frame-${String(index + 1).padStart(4, '0')}.png`;
      inputNames.push(frameName);
      cleanupTargets.push(frameName);
      await runtime.ffmpeg.writeFile(frameName, await runtime.fetchFile(params.frames[index].blob));
      params.progressHandler?.((index + 1) / Math.max(params.frames.length * 2, 1));
    }

    const manifest = buildConcatManifest(
      inputNames,
      params.frames.map((frame) => frame.delayMs),
    );
    await runtime.ffmpeg.writeFile(manifestName, manifest);

    const exitCode = await runtime.ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifestName,
      '-an',
      '-c:v',
      'libwebp_anim',
      '-quality',
      String(clamp(Math.round(params.quality), 1, 100)),
      '-compression_level',
      String(getCompressionLevel('balanced', params.method ?? 4)),
      '-loop',
      String(Math.max(0, Math.round(params.loopCount))),
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error('The animated WebP could not be encoded locally.');
    }

    params.progressHandler?.(1);
    return await readBlobFromFile(runtime.ffmpeg, outputName, 'image/webp');
  } finally {
    await cleanupFiles(runtime.ffmpeg, cleanupTargets);
  }
}

async function encodePngSequenceToMp4(params: {
  frames: Array<{ blob: Blob; delayMs: number }>;
  width: number;
  height: number;
  fps: number | null;
  background: string;
}) {
  const runtime = await getBrowserFfmpegRuntime();
  const manifestName = 'frames.txt';
  const outputName = 'output.mp4';
  const cleanupTargets = [manifestName, outputName];
  const inputNames: string[] = [];
  const evenWidth = Math.max(2, Math.round(params.width / 2) * 2);
  const evenHeight = Math.max(2, Math.round(params.height / 2) * 2);

  try {
    for (let index = 0; index < params.frames.length; index += 1) {
      const frameName = `frame-${String(index + 1).padStart(4, '0')}.png`;
      inputNames.push(frameName);
      cleanupTargets.push(frameName);
      await runtime.ffmpeg.writeFile(frameName, await runtime.fetchFile(params.frames[index].blob));
    }

    await runtime.ffmpeg.writeFile(
      manifestName,
      buildConcatManifest(
        inputNames,
        params.frames.map((frame) => frame.delayMs),
      ),
    );

    const filterGraph = `${
      params.fps ? `fps=${clamp(params.fps, 1, 60)},` : ''
    }scale=${evenWidth}:${evenHeight}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${evenWidth}:${evenHeight}:(ow-iw)/2:(oh-ih)/2:${sanitizeHexColor(params.background)},format=yuv420p`;
    const exitCode = await runtime.ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifestName,
      '-vf',
      filterGraph,
      '-movflags',
      '+faststart',
      '-an',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error('The MP4 could not be generated from these WebP frames locally.');
    }

    return await readBlobFromFile(runtime.ffmpeg, outputName, 'video/mp4');
  } finally {
    await cleanupFiles(runtime.ffmpeg, cleanupTargets);
  }
}

function getAnimatedWebpQualityPreset(preset: 'high' | 'balanced' | 'smaller') {
  if (preset === 'smaller') {
    return { quality: 62, method: 6 };
  }

  if (preset === 'high') {
    return { quality: 88, method: 4 };
  }

  return { quality: 76, method: 5 };
}

export async function convertVideoToWebp(params: {
  file: File;
  startMs: number;
  endMs: number;
  width: number;
  fps: number;
  loopCount: number;
  qualityPreset: 'high' | 'balanced' | 'smaller';
}) {
  const runtime = await getBrowserFfmpegRuntime();
  const inputName = `input.${params.file.name.split('.').pop()?.toLowerCase() || 'mp4'}`;
  const outputName = 'output.webp';
  const cleanupTargets = [inputName, outputName];
  const startSeconds = Math.max(0, params.startMs / 1000);
  const durationSeconds = Math.max(0.05, (params.endMs - params.startMs) / 1000);
  const targetWidth = Math.max(2, Math.round(params.width / 2) * 2);
  const quality = getAnimatedWebpQualityPreset(params.qualityPreset);

  try {
    await runtime.ffmpeg.writeFile(inputName, await runtime.fetchFile(params.file));
    const exitCode = await runtime.ffmpeg.exec([
      '-ss',
      startSeconds.toFixed(3),
      '-t',
      durationSeconds.toFixed(3),
      '-i',
      inputName,
      '-an',
      '-vf',
      `fps=${clamp(params.fps, 1, 60)},scale=${targetWidth}:-1:flags=lanczos`,
      '-c:v',
      'libwebp_anim',
      '-quality',
      String(quality.quality),
      '-compression_level',
      String(quality.method),
      '-loop',
      String(Math.max(0, params.loopCount)),
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error('The video clip could not be converted to animated WebP locally.');
    }

    return await readBlobFromFile(runtime.ffmpeg, outputName, 'image/webp');
  } finally {
    await cleanupFiles(runtime.ffmpeg, cleanupTargets);
  }
}

export async function optimizeWebp(params: {
  file: File;
  preset: WebpOptimizationPreset;
  fpsCap: number | null;
  colorCount: number | null;
}) {
  const source = await readWebpSource(params.file);

  if (!source.metadata.animated) {
    const { canvas, context } = drawImageToCanvas(
      source.loadedImage.element,
      source.loadedImage.width,
      source.loadedImage.height,
      null,
    );
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const posterizeLevel =
      params.colorCount && params.colorCount < 256
        ? Math.max(2, Math.round(256 / Math.max(2, params.colorCount / 2)))
        : 1;

    if (posterizeLevel > 1) {
      for (let index = 0; index < imageData.data.length; index += 4) {
        imageData.data[index] = Math.round(imageData.data[index] / posterizeLevel) * posterizeLevel;
        imageData.data[index + 1] =
          Math.round(imageData.data[index + 1] / posterizeLevel) * posterizeLevel;
        imageData.data[index + 2] =
          Math.round(imageData.data[index + 2] / posterizeLevel) * posterizeLevel;
      }
    }

    return await createStillWebpBlobFromImageData(imageData, {
      quality: getOptimizationQuality(params.preset),
      lossless: false,
    });
  }

  const decodedFrames = await decodeAnimatedWebpFrames(params.file);
  let rgbaFrames = decodedFrames.map((frame) => frame.rgba);
  let delays = decodedFrames.map((frame) => frame.delayMs);

  if (params.fpsCap) {
    const capped = capAnimationFrameRate(rgbaFrames, delays, params.fpsCap);
    rgbaFrames = capped.frames;
    delays = capped.delays;
  }

  const pngFrames = await Promise.all(
    rgbaFrames.map(async (rgba, index) => ({
      blob: await rgbaToPngBlob(rgba, decodedFrames[0].width, decodedFrames[0].height),
      delayMs: delays[index] ?? 100,
    })),
  );

  return await encodeAnimatedWebp({
    frames: pngFrames,
    loopCount: source.metadata.loopCount ?? 0,
    quality: getOptimizationQuality(params.preset),
    method: getCompressionLevel(params.preset),
  });
}

export async function convertWebpToGif(params: {
  file: File;
  width: number;
  fpsCap: number | null;
  loopCount: number | null;
  qualityPreset: 'high' | 'balanced' | 'smaller';
}) {
  const source = await readWebpSource(params.file);

  if (!source.metadata.animated) {
    throw new Error('This WebP is static. Use Image Converter if you only need a still GIF.');
  }

  const frames = await decodeAnimatedWebpFrames(params.file);
  const maxWidth = Math.max(2, Math.round(params.width));
  const resizedFrames = await Promise.all(
    frames.map(async (frame) => {
      const element = await loadImageElementFromBlob(frame.blob);
      const aspect = frame.height / Math.max(1, frame.width);
      const height = Math.max(2, Math.round(maxWidth * aspect));
      const { canvas } = drawImageToCanvas(element, maxWidth, height, null);
      return {
        blob: await canvasToBlob(canvas, 'image/png'),
        delayMs: frame.delayMs,
      };
    }),
  );
  const qualityPreset = getAnimatedWebpQualityPreset(params.qualityPreset);
  const effectiveFrames =
    params.fpsCap && params.fpsCap > 0
      ? await Promise.all(
          capAnimationFrameRate(
            frames.map((frame) => frame.rgba),
            frames.map((frame) => frame.delayMs),
            params.fpsCap,
          ).frames.map(async (rgba, index) => ({
            blob: await rgbaToPngBlob(
              rgba,
              Math.max(2, Math.round(maxWidth)),
              Math.max(2, Math.round(maxWidth * (frames[0].height / Math.max(1, frames[0].width)))),
            ),
            name: `frame-${String(index + 1).padStart(4, '0')}.png`,
            delayMs:
              capAnimationFrameRate(
                frames.map((frame) => frame.rgba),
                frames.map((frame) => frame.delayMs),
                params.fpsCap,
              ).delays[index] ?? 100,
          })),
        )
      : resizedFrames.map((frame, index) => ({
          ...frame,
          name: `frame-${String(index + 1).padStart(4, '0')}.png`,
        }));

  return await encodePngSequenceToGif({
    frames: effectiveFrames,
    loopCount: params.loopCount ?? source.metadata.loopCount ?? 0,
    outputName: `webp-${qualityPreset.quality}.gif`,
  });
}

export async function convertWebpToMp4(params: {
  file: File;
  width: number;
  fps: number | null;
  background: string;
}) {
  const source = await readWebpSource(params.file);

  if (!source.metadata.animated) {
    throw new Error('This WebP is static. Use Image Converter or WebP Optimizer instead.');
  }

  const frames = await decodeAnimatedWebpFrames(params.file);
  const maxWidth = Math.max(2, Math.round(params.width));
  const renderedFrames = await Promise.all(
    frames.map(async (frame) => {
      const image = await loadImageElementFromBlob(frame.blob);
      const aspect = frame.height / Math.max(1, frame.width);
      const height = Math.max(2, Math.round(maxWidth * aspect));
      const canvas = flattenPngTransparency(image, maxWidth, height, {
        mode: 'custom-solid',
        customColor: params.background,
        gradientStart: params.background,
        gradientEnd: params.background,
        direction: 'to-bottom',
      });

      return {
        blob: await canvasToBlob(canvas, 'image/png'),
        delayMs: frame.delayMs,
      };
    }),
  );

  const outputHeight = Math.max(
    2,
    Math.round(maxWidth * (frames[0].height / Math.max(1, frames[0].width))),
  );

  return await encodePngSequenceToMp4({
    frames: renderedFrames,
    width: maxWidth,
    height: outputHeight,
    fps: params.fps,
    background: params.background,
  });
}

export async function renderStillWebpImageData(file: File) {
  const loaded = await loadRasterImage(file);
  const { context, canvas } = drawImageToCanvas(loaded.element, loaded.width, loaded.height, null);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function renderFrameToImageData(frame: DecodedWebpFrame) {
  const element = await loadImageElementFromBlob(frame.blob);
  const { context, canvas } = drawImageToCanvas(element, frame.width, frame.height, null);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function renderWebpChannelBlob(params: {
  file: File;
  channel: PngChannelView;
  frameIndex?: number;
}) {
  const source = await readWebpSource(params.file);
  const imageData = source.metadata.animated
    ? await renderFrameToImageData(
        (await decodeAnimatedWebpFrames(params.file))[params.frameIndex ?? 0],
      )
    : await renderStillWebpImageData(params.file);
  const rendered = renderPngChannelView(imageData, params.channel);
  return await rgbaToPngBlob(rendered.data, rendered.width, rendered.height);
}

export async function extractWebpPalette(
  file: File,
  limit: number | null,
  frameIndex = 0,
): Promise<PngPaletteEntry[]> {
  const source = await readWebpSource(file);
  const imageData = source.metadata.animated
    ? await renderFrameToImageData((await decodeAnimatedWebpFrames(file))[frameIndex]!)
    : await renderStillWebpImageData(file);
  return extractPaletteEntriesFromRgba(imageData.data, limit);
}

export async function flattenWebpSource(params: {
  file: File;
  mode: FlattenBackgroundMode;
  customColor: string;
  gradientStart: string;
  gradientEnd: string;
  direction: GradientDirection;
}) {
  const source = await readWebpSource(params.file);

  if (!source.metadata.animated) {
    const canvas = flattenPngTransparency(
      source.loadedImage.element,
      source.loadedImage.width,
      source.loadedImage.height,
      {
        mode: params.mode,
        customColor: params.customColor,
        gradientStart: params.gradientStart,
        gradientEnd: params.gradientEnd,
        direction: params.direction,
      },
    );
    return await canvasToBlob(canvas, 'image/webp', 0.92);
  }

  const frames = await decodeAnimatedWebpFrames(params.file);
  const flattenedFrames = await Promise.all(
    frames.map(async (frame) => {
      const image = await loadImageElementFromBlob(frame.blob);
      const canvas = flattenPngTransparency(image, frame.width, frame.height, {
        mode: params.mode,
        customColor: params.customColor,
        gradientStart: params.gradientStart,
        gradientEnd: params.gradientEnd,
        direction: params.direction,
      });
      return {
        blob: await canvasToBlob(canvas, 'image/png'),
        delayMs: frame.delayMs,
      };
    }),
  );

  return await encodeAnimatedWebp({
    frames: flattenedFrames,
    loopCount: source.metadata.loopCount ?? 0,
    quality: 86,
    method: 4,
  });
}

export async function recompressStillWebp(params: {
  file: File;
  quality: number;
  lossless: boolean;
  methodPreset: 'balanced' | 'max-quality' | 'smaller';
}) {
  const source = await readWebpSource(params.file);

  if (source.metadata.animated) {
    throw new Error('This WebP is animated. Use WebP Optimizer for animated WebP files.');
  }

  const imageData = await renderStillWebpImageData(params.file);
  const adjustedQuality =
    params.methodPreset === 'smaller'
      ? clamp(params.quality - 8, 1, 100)
      : params.methodPreset === 'balanced'
        ? clamp(params.quality - 3, 1, 100)
        : clamp(params.quality, 1, 100);

  return await createStillWebpBlobFromImageData(imageData, {
    quality: adjustedQuality,
    lossless: params.lossless,
  });
}

export function summarizeWebpTransparency(rgba: Uint8ClampedArray | Uint8Array) {
  return analyzeTransparency(rgba);
}

export {
  createZipBlob,
  extractPaletteEntriesFromRgba,
  formatFileSize,
  getAnimationDuration,
  getBaseName,
};
export { paletteEntriesToCssVariables, paletteEntriesToJson, renderPngChannelView };
