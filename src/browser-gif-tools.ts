'use client';

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  clamp,
  createCanvas,
  sanitizeHexColor,
  type LoadedRasterImage,
  loadRasterImage,
} from './browser-image-tools';

type FfmpegFetchFile = typeof import('@ffmpeg/util').fetchFile;

type FfmpegRuntime = {
  ffmpeg: FFmpeg;
  fetchFile: FfmpegFetchFile;
};

type ProgressHandler = (progress: number) => void;

export type ExtractedGifFrame = {
  index: number;
  name: string;
  blob: Blob;
};

export type ExtractedVideoPngFrame = {
  index: number;
  name: string;
  blob: Blob;
};

export type GifMetadata = {
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  loopCount: number | null;
  hasTransparency: boolean;
  delaysMs: number[];
};

export type GifResizeMode = 'contain' | 'cover';

export type GifSegment = {
  index: number;
  startMs: number;
  endMs: number;
  blob: Blob;
};

type GifPaletteOptions = {
  maxColors?: number;
  dither?: 'sierra2_4a' | 'bayer';
  bayerScale?: number;
  loopCount?: number;
};

let ffmpegRuntimePromise: Promise<FfmpegRuntime> | null = null;

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

async function cleanupFiles(ffmpeg: FFmpeg, fileNames: string[]) {
  await Promise.allSettled(fileNames.map((fileName) => ffmpeg.deleteFile(fileName)));
}

function getFileExtension(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith('.mov')) {
    return 'mov';
  }

  if (normalized.endsWith('.m4v')) {
    return 'm4v';
  }

  if (normalized.endsWith('.webm')) {
    return 'webm';
  }

  if (normalized.endsWith('.avi')) {
    return 'avi';
  }

  if (normalized.endsWith('.mpeg') || normalized.endsWith('.mpg')) {
    return 'mpeg';
  }

  return 'mp4';
}

function formatSeconds(seconds: number) {
  return Math.max(0, seconds).toFixed(3);
}

function formatMilliseconds(ms: number) {
  return formatSeconds(ms / 1000);
}

function toFfmpegColor(color: string | null) {
  if (!color) {
    return '0x00000000';
  }

  return `0x${sanitizeHexColor(color).slice(1)}`;
}

function getBayerScale(lossyLevel: number) {
  const level = clamp(Math.round(lossyLevel), 0, 3);

  switch (level) {
    case 1:
      return 5;
    case 2:
      return 3;
    case 3:
      return 1;
    default:
      return 5;
  }
}

function getPaletteOptionsForLossyLevel(
  lossyLevel: number,
  colorCount: number,
): Required<GifPaletteOptions> {
  const maxColors = clamp(Math.round(colorCount || 256), 2, 256);
  const level = clamp(Math.round(lossyLevel), 0, 3);

  if (level === 0) {
    return {
      maxColors,
      dither: 'sierra2_4a',
      bayerScale: 5,
      loopCount: 0,
    };
  }

  return {
    maxColors,
    dither: 'bayer',
    bayerScale: getBayerScale(level),
    loopCount: 0,
  };
}

function buildPaletteFilterGraph(
  transformFilters: string[],
  paletteOptions?: GifPaletteOptions,
  inputLabel = '0:v',
) {
  const options = {
    maxColors: clamp(Math.round(paletteOptions?.maxColors ?? 256), 2, 256),
    dither: paletteOptions?.dither ?? 'sierra2_4a',
    bayerScale: clamp(Math.round(paletteOptions?.bayerScale ?? 5), 0, 5),
  };
  const filterPrefix = transformFilters.length ? `${transformFilters.join(',')},` : '';
  const paletteUse =
    options.dither === 'bayer'
      ? `paletteuse=dither=bayer:bayer_scale=${options.bayerScale}`
      : 'paletteuse=dither=sierra2_4a';

  return `[${inputLabel}]${filterPrefix}split[source][render];[source]palettegen=stats_mode=diff:reserve_transparent=1:max_colors=${options.maxColors}[palette];[render][palette]${paletteUse}[out]`;
}

function parseGifMetadataFromBytes(bytes: Uint8Array): GifMetadata {
  if (bytes.length < 13) {
    throw new Error('This GIF file is too small to read.');
  }

  const signature = String.fromCharCode(...bytes.slice(0, 6));

  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new Error('This file does not look like a valid GIF.');
  }

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  let position = 13;

  if (packed & 0x80) {
    const globalColorTableSize = 3 * 2 ** ((packed & 0x07) + 1);
    position += globalColorTableSize;
  }

  let frameCount = 0;
  let durationMs = 0;
  let loopCount: number | null = null;
  let hasTransparency = false;
  let pendingDelayMs = 0;
  const delaysMs: number[] = [];

  while (position < bytes.length) {
    const blockId = bytes[position];

    if (blockId === 0x3b) {
      break;
    }

    if (blockId === 0x21) {
      const extensionLabel = bytes[position + 1];

      if (extensionLabel === 0xf9 && position + 7 < bytes.length) {
        const graphicControlPacked = bytes[position + 3];
        const delayCs = bytes[position + 4] | (bytes[position + 5] << 8);
        pendingDelayMs = Math.max(20, delayCs * 10);
        hasTransparency ||= (graphicControlPacked & 0x01) === 0x01;
        position += 8;
        continue;
      }

      if (extensionLabel === 0xff) {
        const blockSize = bytes[position + 2];
        const appStart = position + 3;
        const appIdentifier = new TextDecoder().decode(bytes.slice(appStart, appStart + blockSize));
        position = appStart + blockSize;

        while (position < bytes.length) {
          const subBlockSize = bytes[position];

          if (subBlockSize === 0) {
            position += 1;
            break;
          }

          if (
            (appIdentifier === 'NETSCAPE2.0' || appIdentifier === 'ANIMEXTS1.0') &&
            subBlockSize >= 3 &&
            bytes[position + 1] === 0x01
          ) {
            loopCount = bytes[position + 2] | (bytes[position + 3] << 8);
          }

          position += 1 + subBlockSize;
        }

        continue;
      }

      position += 2;

      while (position < bytes.length) {
        const subBlockSize = bytes[position];
        position += 1;

        if (subBlockSize === 0) {
          break;
        }

        position += subBlockSize;
      }

      continue;
    }

    if (blockId === 0x2c) {
      frameCount += 1;
      const localPacked = bytes[position + 9];
      position += 10;

      if (localPacked & 0x80) {
        const localColorTableSize = 3 * 2 ** ((localPacked & 0x07) + 1);
        position += localColorTableSize;
      }

      position += 1;

      while (position < bytes.length) {
        const subBlockSize = bytes[position];
        position += 1;

        if (subBlockSize === 0) {
          break;
        }

        position += subBlockSize;
      }

      const delayMs = pendingDelayMs || 100;
      delaysMs.push(delayMs);
      durationMs += delayMs;
      pendingDelayMs = 0;
      continue;
    }

    position += 1;
  }

  return {
    width,
    height,
    frameCount,
    durationMs,
    loopCount,
    hasTransparency,
    delaysMs,
  };
}

async function runProgressTrackedCommand<T>(
  work: (runtime: FfmpegRuntime) => Promise<T>,
  progressHandler?: ProgressHandler,
) {
  const runtime = await getBrowserFfmpegRuntime();

  if (!progressHandler) {
    return await work(runtime);
  }

  const listener = ({ progress }: { progress: number }) => {
    progressHandler(clamp(progress || 0, 0, 1));
  };

  runtime.ffmpeg.on('progress', listener);

  try {
    return await work(runtime);
  } finally {
    runtime.ffmpeg.off('progress', listener);
  }
}

async function writeSourceFile(runtime: FfmpegRuntime, fileName: string, file: File | Blob) {
  await runtime.ffmpeg.writeFile(fileName, await runtime.fetchFile(file));
}

async function readBlobFromFile(ffmpeg: FFmpeg, fileName: string, mimeType: string) {
  const outputData = await ffmpeg.readFile(fileName);
  const outputBytes = normalizeFfmpegOutput(outputData);
  return new Blob([outputBytes], { type: mimeType });
}

async function exportGifWithFilters(params: {
  file: File | Blob;
  inputName: string;
  outputName?: string;
  transformFilters: string[];
  palette?: GifPaletteOptions;
  progressHandler?: ProgressHandler;
}) {
  return await runProgressTrackedCommand(async (runtime) => {
    const outputName = params.outputName ?? 'output.gif';
    const paletteName = `${outputName}.palette.png`;
    const cleanupTargets = [params.inputName, outputName, paletteName];

    try {
      await writeSourceFile(runtime, params.inputName, params.file);

      const filterGraph = buildPaletteFilterGraph(params.transformFilters, params.palette);
      const loopCount = params.palette?.loopCount ?? 0;
      const exitCode = await runtime.ffmpeg.exec([
        '-i',
        params.inputName,
        '-filter_complex',
        filterGraph,
        '-map',
        '[out]',
        '-loop',
        String(loopCount),
        outputName,
      ]);

      if (exitCode !== 0) {
        throw new Error('The GIF export could not be generated locally.');
      }

      return await readBlobFromFile(runtime.ffmpeg, outputName, 'image/gif');
    } finally {
      await cleanupFiles(runtime.ffmpeg, cleanupTargets);
    }
  }, params.progressHandler);
}

export function canUseFfmpegInBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

export async function getBrowserFfmpegRuntime(): Promise<FfmpegRuntime> {
  if (!canUseFfmpegInBrowser()) {
    throw new Error('This browser does not support the local media processing runtime.');
  }

  if (!ffmpegRuntimePromise) {
    ffmpegRuntimePromise = (async () => {
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ]);
      const ffmpeg = new FFmpeg();
      const baseUrl = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/umd';
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        toBlobURL(`${baseUrl}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
        toBlobURL(`${baseUrl}/ffmpeg-core.worker.js`, 'text/javascript'),
      ]);

      await ffmpeg.load({ coreURL, wasmURL, workerURL });

      return { ffmpeg, fetchFile };
    })().catch((error) => {
      ffmpegRuntimePromise = null;
      throw error;
    });
  }

  return ffmpegRuntimePromise;
}

export async function readGifMetadata(file: File) {
  return parseGifMetadataFromBytes(new Uint8Array(await file.arrayBuffer()));
}

export async function extractGifFrames(file: File) {
  const { ffmpeg, fetchFile } = await getBrowserFfmpegRuntime();
  const inputName = 'input.gif';
  const outputPattern = 'frame-%04d.png';
  const cleanupTargets = [inputName];

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const exitCode = await ffmpeg.exec(['-i', inputName, '-vsync', '0', outputPattern]);

    if (exitCode !== 0) {
      throw new Error('The GIF frames could not be extracted locally.');
    }

    const frames: ExtractedGifFrame[] = [];

    for (let index = 1; index < 10_000; index += 1) {
      const fileName = `frame-${String(index).padStart(4, '0')}.png`;

      try {
        const outputData = await ffmpeg.readFile(fileName);
        const bytes = normalizeFfmpegOutput(outputData);
        frames.push({
          index,
          name: fileName,
          blob: new Blob([bytes], { type: 'image/png' }),
        });
        cleanupTargets.push(fileName);
      } catch {
        break;
      }
    }

    if (!frames.length) {
      throw new Error('No GIF frames could be extracted from this file.');
    }

    return frames;
  } finally {
    await cleanupFiles(ffmpeg, cleanupTargets);
  }
}

export async function extractGifPreviewFrame(file: File) {
  const { ffmpeg, fetchFile } = await getBrowserFfmpegRuntime();
  const inputName = 'input.gif';
  const outputName = 'preview-frame.png';
  const cleanupTargets = [inputName, outputName];

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const exitCode = await ffmpeg.exec(['-i', inputName, '-frames:v', '1', outputName]);

    if (exitCode !== 0) {
      throw new Error('A GIF preview frame could not be extracted locally.');
    }

    return await readBlobFromFile(ffmpeg, outputName, 'image/png');
  } finally {
    await cleanupFiles(ffmpeg, cleanupTargets);
  }
}

export async function encodePngSequenceToGif(params: {
  frames: Array<{ blob: Blob; name: string; delayMs: number }>;
  loopCount: number;
  outputName?: string;
}) {
  const { ffmpeg, fetchFile } = await getBrowserFfmpegRuntime();
  const manifestName = 'frames.txt';
  const paletteName = 'palette.png';
  const outputName = params.outputName ?? 'output.gif';
  const cleanupTargets = [manifestName, paletteName, outputName];
  const inputNames: string[] = [];

  try {
    for (let index = 0; index < params.frames.length; index += 1) {
      const frameName = `frame-${String(index + 1).padStart(4, '0')}.png`;
      inputNames.push(frameName);
      cleanupTargets.push(frameName);
      await ffmpeg.writeFile(frameName, await fetchFile(params.frames[index].blob));
    }

    const manifest = buildConcatManifest(
      inputNames,
      params.frames.map((frame) => frame.delayMs),
    );
    await ffmpeg.writeFile(manifestName, manifest);

    const paletteExitCode = await ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifestName,
      '-vf',
      'palettegen=reserve_transparent=1',
      paletteName,
    ]);

    if (paletteExitCode !== 0) {
      throw new Error('The local GIF palette could not be generated.');
    }

    const outputExitCode = await ffmpeg.exec([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifestName,
      '-i',
      paletteName,
      '-lavfi',
      'paletteuse=dither=sierra2_4a',
      '-loop',
      String(params.loopCount),
      outputName,
    ]);

    if (outputExitCode !== 0) {
      throw new Error('The local GIF export could not be assembled.');
    }

    return await readBlobFromFile(ffmpeg, outputName, 'image/gif');
  } finally {
    await cleanupFiles(ffmpeg, cleanupTargets);
  }
}

export async function optimizeGif(params: {
  file: File;
  loopCount: number;
  fpsCap: number | null;
  colorCount: number;
  lossyLevel: number;
  progressHandler?: ProgressHandler;
}) {
  const palette = getPaletteOptionsForLossyLevel(params.lossyLevel, params.colorCount);

  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: params.fpsCap ? [`fps=${clamp(params.fpsCap, 1, 60)}`] : [],
    palette: {
      ...palette,
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function resizeGif(params: {
  file: File;
  width: number;
  height: number;
  fitMode: GifResizeMode;
  background: string | null;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  const targetWidth = Math.max(1, Math.round(params.width));
  const targetHeight = Math.max(1, Math.round(params.height));
  const background = toFfmpegColor(params.background);
  const resizeFilter =
    params.fitMode === 'cover'
      ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`
      : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:${background}`;

  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: [resizeFilter],
    palette: {
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function cropGif(params: {
  file: File;
  x: number;
  y: number;
  width: number;
  height: number;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  const cropFilter = `crop=${Math.max(1, Math.round(params.width))}:${Math.max(1, Math.round(params.height))}:${Math.max(0, Math.round(params.x))}:${Math.max(0, Math.round(params.y))}`;

  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: [cropFilter],
    palette: {
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function changeGifSpeed(params: {
  file: File;
  speedFactor: number;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  const normalizedFactor = Math.max(0.1, params.speedFactor);

  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: [`setpts=${(1 / normalizedFactor).toFixed(6)}*PTS`],
    palette: {
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function reverseGif(params: {
  file: File;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: ['reverse'],
    palette: {
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function trimGif(params: {
  file: File;
  startMs: number;
  endMs: number;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  const startMs = Math.max(0, Math.round(params.startMs));
  const endMs = Math.max(startMs + 20, Math.round(params.endMs));

  return await exportGifWithFilters({
    file: params.file,
    inputName: 'input.gif',
    transformFilters: [
      `trim=start=${formatMilliseconds(startMs)}:end=${formatMilliseconds(endMs)}`,
      'setpts=PTS-STARTPTS',
    ],
    palette: {
      loopCount: params.loopCount,
    },
    progressHandler: params.progressHandler,
  });
}

export async function splitGif(params: {
  file: File;
  splitPointsMs: number[];
  durationMs: number;
  loopCount: number;
  progressHandler?: ProgressHandler;
}) {
  const points = params.splitPointsMs
    .map((value) => Math.round(value))
    .filter((value) => value > 0 && value < params.durationMs)
    .sort((left, right) => left - right);
  const uniquePoints = points.filter((value, index) => index === 0 || value !== points[index - 1]);
  const boundaries = [0, ...uniquePoints, params.durationMs];
  const { ffmpeg, fetchFile } = await getBrowserFfmpegRuntime();
  const inputName = 'input.gif';
  const cleanupTargets = [inputName];
  const segments: GifSegment[] = [];
  const progressHandler = params.progressHandler;
  const segmentCount = Math.max(1, boundaries.length - 1);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(params.file));

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startMs = boundaries[index];
      const endMs = boundaries[index + 1];
      const outputName = `segment-${String(index + 1).padStart(2, '0')}.gif`;
      const paletteName = `segment-${String(index + 1).padStart(2, '0')}.palette.png`;
      cleanupTargets.push(outputName, paletteName);
      const filterGraph = buildPaletteFilterGraph(
        [
          `trim=start=${formatMilliseconds(startMs)}:end=${formatMilliseconds(endMs)}`,
          'setpts=PTS-STARTPTS',
        ],
        {
          loopCount: params.loopCount,
        },
      );
      const exitCode = await ffmpeg.exec([
        '-i',
        inputName,
        '-filter_complex',
        filterGraph,
        '-map',
        '[out]',
        '-loop',
        String(params.loopCount),
        outputName,
      ]);

      if (exitCode !== 0) {
        throw new Error('The GIF could not be split into separate clips locally.');
      }

      segments.push({
        index: index + 1,
        startMs,
        endMs,
        blob: await readBlobFromFile(ffmpeg, outputName, 'image/gif'),
      });

      progressHandler?.((index + 1) / segmentCount);
    }

    return segments;
  } finally {
    await cleanupFiles(ffmpeg, cleanupTargets);
  }
}

export async function convertGifToMp4(params: {
  file: File;
  width: number;
  height: number;
  fps: number | null;
  background: string;
  progressHandler?: ProgressHandler;
}) {
  return await runProgressTrackedCommand(async (runtime) => {
    const inputName = 'input.gif';
    const outputName = 'output.mp4';
    const cleanupTargets = [inputName, outputName];
    const width = Math.max(2, Math.round(params.width / 2) * 2);
    const height = Math.max(2, Math.round(params.height / 2) * 2);
    const filters = [
      `[0:v]${params.fps ? `fps=${clamp(params.fps, 1, 60)},` : ''}scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${toFfmpegColor(params.background)},format=yuv420p[out]`,
    ];

    try {
      await writeSourceFile(runtime, inputName, params.file);

      const exitCode = await runtime.ffmpeg.exec([
        '-i',
        inputName,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[out]',
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
        throw new Error('The GIF could not be converted to MP4 locally.');
      }

      return await readBlobFromFile(runtime.ffmpeg, outputName, 'video/mp4');
    } finally {
      await cleanupFiles(runtime.ffmpeg, cleanupTargets);
    }
  }, params.progressHandler);
}

export async function convertVideoToGif(params: {
  file: File;
  startMs: number;
  endMs: number;
  width: number;
  fps: number;
  loopCount: number;
  qualityPreset: 'high' | 'balanced' | 'smaller';
  progressHandler?: ProgressHandler;
}) {
  const qualityPalette: Record<
    'high' | 'balanced' | 'smaller',
    Required<Pick<GifPaletteOptions, 'maxColors' | 'dither' | 'bayerScale'>>
  > = {
    high: { maxColors: 256, dither: 'sierra2_4a', bayerScale: 5 },
    balanced: { maxColors: 192, dither: 'sierra2_4a', bayerScale: 5 },
    smaller: { maxColors: 128, dither: 'bayer', bayerScale: 3 },
  };

  return await runProgressTrackedCommand(async (runtime) => {
    const inputName = `input.${getFileExtension(params.file.name)}`;
    const outputName = 'output.gif';
    const paletteName = 'output.palette.png';
    const cleanupTargets = [inputName, outputName, paletteName];
    const startSeconds = Math.max(0, params.startMs / 1000);
    const durationSeconds = Math.max(0.05, (params.endMs - params.startMs) / 1000);
    const targetWidth = Math.max(2, Math.round(params.width / 2) * 2);
    const palette = qualityPalette[params.qualityPreset];

    try {
      await writeSourceFile(runtime, inputName, params.file);

      const filterGraph = buildPaletteFilterGraph(
        [`fps=${clamp(params.fps, 1, 60)}`, `scale=${targetWidth}:-1:flags=lanczos`],
        {
          maxColors: palette.maxColors,
          dither: palette.dither,
          bayerScale: palette.bayerScale,
          loopCount: params.loopCount,
        },
      );
      const exitCode = await runtime.ffmpeg.exec([
        '-ss',
        formatSeconds(startSeconds),
        '-t',
        formatSeconds(durationSeconds),
        '-i',
        inputName,
        '-an',
        '-filter_complex',
        filterGraph,
        '-map',
        '[out]',
        '-loop',
        String(params.loopCount),
        outputName,
      ]);

      if (exitCode !== 0) {
        throw new Error('The video clip could not be converted to GIF locally.');
      }

      return await readBlobFromFile(runtime.ffmpeg, outputName, 'image/gif');
    } finally {
      await cleanupFiles(runtime.ffmpeg, cleanupTargets);
    }
  }, params.progressHandler);
}

export async function extractVideoClipFramesAsPng(params: {
  file: File;
  startMs: number;
  endMs: number;
  width: number;
  fps: number;
  progressHandler?: ProgressHandler;
}) {
  return await runProgressTrackedCommand(async (runtime) => {
    const inputName = `input.${getFileExtension(params.file.name)}`;
    const outputPattern = 'frame-%04d.png';
    const cleanupTargets = [inputName];
    const startSeconds = Math.max(0, params.startMs / 1000);
    const durationSeconds = Math.max(0.05, (params.endMs - params.startMs) / 1000);
    const targetWidth = Math.max(2, Math.round(params.width / 2) * 2);

    try {
      await writeSourceFile(runtime, inputName, params.file);

      const exitCode = await runtime.ffmpeg.exec([
        '-ss',
        formatSeconds(startSeconds),
        '-t',
        formatSeconds(durationSeconds),
        '-i',
        inputName,
        '-an',
        '-vf',
        `fps=${clamp(params.fps, 1, 60)},scale=${targetWidth}:-1:flags=lanczos`,
        outputPattern,
      ]);

      if (exitCode !== 0) {
        throw new Error('The video clip frames could not be extracted locally.');
      }

      const frames: ExtractedVideoPngFrame[] = [];

      for (let index = 1; index < 10_000; index += 1) {
        const fileName = `frame-${String(index).padStart(4, '0')}.png`;

        try {
          const outputData = await runtime.ffmpeg.readFile(fileName);
          const bytes = normalizeFfmpegOutput(outputData);
          frames.push({
            index,
            name: fileName,
            blob: new Blob([bytes], { type: 'image/png' }),
          });
          cleanupTargets.push(fileName);
        } catch {
          break;
        }
      }

      if (!frames.length) {
        throw new Error('No PNG frames could be extracted from this video clip.');
      }

      return frames;
    } finally {
      await cleanupFiles(runtime.ffmpeg, cleanupTargets);
    }
  }, params.progressHandler);
}

export async function loadGifFramePreview(frame: ExtractedGifFrame): Promise<LoadedRasterImage> {
  const file = new File([frame.blob], frame.name, { type: 'image/png' });
  return loadRasterImage(file);
}

export async function renderGifFrameBlob(
  image: HTMLImageElement,
  width: number,
  height: number,
  background: string | null = null,
) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not prepare the GIF frame canvas.');
  }

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('The browser could not render the GIF source frame.'));
    }, 'image/png');
  });
}
