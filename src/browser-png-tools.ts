'use client';

import UPNGDefault from '@pdf-lib/upng';
import JSZip from 'jszip';

const UPNG = UPNGDefault as unknown as typeof import('@pdf-lib/upng');

export type LoadedPngImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
};

export type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type CanvasFramingMode = 'fit' | 'fill';

export type DecodedAnimatedPng = {
  width: number;
  height: number;
  frames: Uint8Array[];
  delays: number[];
  loopCount: number;
  animated: boolean;
};

export type ZipEntry = {
  name: string;
  data: ArrayBuffer | Blob | string | Uint8Array;
};

export type PngPaletteEntry = {
  key: string;
  color: string;
  alpha: number;
  count: number;
  percent: number;
};

export type PngChannelView = 'rgb' | 'red' | 'green' | 'blue' | 'alpha' | 'alpha-mask';

export type FlattenBackgroundMode = 'white' | 'black' | 'custom-solid' | 'two-stop-gradient';

export type GradientDirection = 'to-bottom' | 'to-right' | 'to-bottom-right' | 'to-bottom-left';

export type OutlineMode = 'outside' | 'centered';

export type BackgroundTesterMode =
  | 'white'
  | 'black'
  | 'checker'
  | 'custom-solid'
  | 'custom-gradient';

type Point = {
  x: number;
  y: number;
};

function toArrayBuffer(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function unpackRgbaInt(rgba: number) {
  return {
    red: rgba & 255,
    green: (rgba >>> 8) & 255,
    blue: (rgba >>> 16) & 255,
    alpha: ((rgba >>> 24) & 255) / 255,
  };
}

function packRgba(red: number, green: number, blue: number, alpha: number) {
  return ((red & 255) | ((green & 255) << 8) | ((blue & 255) << 16) | ((alpha & 255) << 24)) >>> 0;
}

function rgbaIntToHex(rgba: number) {
  const color = unpackRgbaInt(rgba);
  return `#${[color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];

    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 1) === 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getChunkType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7],
  );
}

export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function getBaseName(fileName: string) {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

export function isPngFile(file: File) {
  return file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getSavingsPercent(sourceSize: number, resultSize: number) {
  if (!sourceSize || resultSize >= sourceSize) {
    return 0;
  }

  return Math.round(((sourceSize - resultSize) / sourceSize) * 100);
}

export function sanitizeHexColor(value: string) {
  const normalized = value.trim().replace(/^#/, '');

  if (/^[0-9a-f]{3}$/i.test(normalized) || /^[0-9a-f]{6}$/i.test(normalized)) {
    return `#${normalized}`;
  }

  return '#ffffff';
}

export function hexToRgb(value: string) {
  const normalized = sanitizeHexColor(value).slice(1);
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => `${channel}${channel}`)
          .join('')
      : normalized;

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export async function readFileAsUint8Array(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function loadPngImage(file: File): Promise<LoadedPngImage> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This PNG could not be opened in your browser.'));
      image.src = objectUrl;
    });

    return {
      element,
      width: element.naturalWidth,
      height: element.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadImageElementFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The browser could not prepare the preview image.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function drawImageToCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  background: string | null = null,
) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not prepare a canvas for this PNG.');
  }

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);

  return { canvas, context };
}

export function prepareCanvas(width: number, height: number, background: string | null = null) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not prepare a canvas for this PNG.');
  }

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  return { canvas, context };
}

export function drawFramedImageToCanvas(
  image: HTMLImageElement,
  width: number,
  height: number,
  mode: CanvasFramingMode,
  background: string | null,
) {
  const { canvas, context } = prepareCanvas(width, height, background);
  const scale =
    mode === 'fill'
      ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
      : Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  return canvas;
}

export function getCanvasRgba(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not read PNG pixels from the canvas.');
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function findAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): AlphaBounds | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];

      if (alpha < threshold) {
        continue;
      }

      if (x < left) {
        left = x;
      }

      if (x > right) {
        right = x;
      }

      if (y < top) {
        top = y;
      }

      if (y > bottom) {
        bottom = y;
      }
    }
  }

  if (right < left || bottom < top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

export function cropCanvasToBounds(sourceCanvas: HTMLCanvasElement, bounds: AlphaBounds) {
  const canvas = createCanvas(bounds.width, bounds.height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not crop this PNG.');
  }

  context.drawImage(
    sourceCanvas,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  return canvas;
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('The browser could not encode this PNG export.'));
      },
      mimeType,
      quality,
    );
  });
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return canvasToBlob(canvas, 'image/png');
}

export async function rgbaToPngBlob(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  const { canvas, context } = prepareCanvas(width, height, null);
  const copy = new Uint8ClampedArray(rgba.length);
  copy.set(rgba);
  context.putImageData(new ImageData(copy, width, height), 0, 0);
  return await canvasToPngBlob(canvas);
}

export function triggerDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function createZipBlob(entries: ZipEntry[]) {
  const zip = new JSZip();

  entries.forEach((entry) => {
    zip.file(entry.name, entry.data);
  });

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function createIcoBuffer(pngBuffers: Array<{ size: number; buffer: Uint8Array }>) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = pngBuffers.length * directoryEntrySize;
  const totalImageBytes = pngBuffers.reduce((sum, entry) => sum + entry.buffer.byteLength, 0);
  const output = new Uint8Array(headerSize + directorySize + totalImageBytes);
  const view = new DataView(output.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, pngBuffers.length, true);

  let imageOffset = headerSize + directorySize;

  pngBuffers.forEach((entry, index) => {
    const offset = headerSize + index * directoryEntrySize;
    const iconSize = entry.size >= 256 ? 0 : entry.size;

    view.setUint8(offset, iconSize);
    view.setUint8(offset + 1, iconSize);
    view.setUint8(offset + 2, 0);
    view.setUint8(offset + 3, 0);
    view.setUint16(offset + 4, 1, true);
    view.setUint16(offset + 6, 32, true);
    view.setUint32(offset + 8, entry.buffer.byteLength, true);
    view.setUint32(offset + 12, imageOffset, true);
    output.set(entry.buffer, imageOffset);
    imageOffset += entry.buffer.byteLength;
  });

  return output;
}

export function decodeAnimatedPng(bytes: Uint8Array): DecodedAnimatedPng {
  const image = UPNG.decode(toArrayBuffer(bytes));
  const rgbaFrames = UPNG.toRGBA8(image).map((frame) => new Uint8Array(frame));
  const frameDelays =
    image.frames.length > 0 ? image.frames.map((frame) => Math.max(20, frame.delay || 20)) : [100];

  return {
    width: image.width,
    height: image.height,
    frames: rgbaFrames,
    delays: frameDelays,
    loopCount: image.tabs.acTL?.num_plays ?? 0,
    animated: rgbaFrames.length > 1,
  };
}

export async function exportAnimatedPngFrameAsBlob(
  frame: Uint8Array,
  width: number,
  height: number,
) {
  return await rgbaToPngBlob(frame, width, height);
}

export function encodeAnimatedPng(params: {
  frames: Uint8Array[];
  width: number;
  height: number;
  colorCount: number;
  delays?: number[];
  loopCount?: number;
}) {
  const encoded = new Uint8Array(
    UPNG.encode(
      params.frames.map((frame) => toArrayBuffer(frame)),
      params.width,
      params.height,
      params.colorCount,
      params.delays,
    ),
  );

  if (params.frames.length > 1 && params.loopCount !== undefined) {
    patchApngLoopCount(encoded, params.loopCount);
  }

  return encoded;
}

export function patchApngLoopCount(bytes: Uint8Array, loopCount: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const type = getChunkType(bytes, offset);

    if (type === 'acTL') {
      view.setUint32(offset + 12, loopCount, false);
      const crcStart = offset + 4;
      const crcEnd = crcStart + 4 + length;
      const crc = crc32(bytes.slice(crcStart, crcEnd));
      view.setUint32(crcEnd, crc, false);
      return bytes;
    }

    offset += length + 12;
  }

  return bytes;
}

export function framesAreEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function mergeDuplicateAnimationFrames(frames: Uint8Array[], delays: number[]) {
  if (frames.length <= 1) {
    return { frames, delays };
  }

  const mergedFrames: Uint8Array[] = [frames[0]];
  const mergedDelays: number[] = [Math.max(20, delays[0] ?? 20)];

  for (let index = 1; index < frames.length; index += 1) {
    const currentFrame = frames[index];
    const currentDelay = Math.max(20, delays[index] ?? 20);
    const lastIndex = mergedFrames.length - 1;

    if (framesAreEqual(mergedFrames[lastIndex], currentFrame)) {
      mergedDelays[lastIndex] += currentDelay;
      continue;
    }

    mergedFrames.push(currentFrame);
    mergedDelays.push(currentDelay);
  }

  return {
    frames: mergedFrames,
    delays: mergedDelays,
  };
}

export function capAnimationFrameRate(
  frames: Uint8Array[],
  delays: number[],
  maxFps: number | null,
) {
  if (!maxFps || frames.length <= 1) {
    return { frames, delays };
  }

  const targetDelay = Math.max(20, Math.round(1000 / maxFps));
  const nextFrames: Uint8Array[] = [];
  const nextDelays: number[] = [];
  let currentFrame = frames[0];
  let accumulatedDelay = Math.max(20, delays[0] ?? 20);

  for (let index = 1; index < frames.length; index += 1) {
    if (accumulatedDelay < targetDelay) {
      accumulatedDelay += Math.max(20, delays[index] ?? 20);
      continue;
    }

    nextFrames.push(currentFrame);
    nextDelays.push(accumulatedDelay);
    currentFrame = frames[index];
    accumulatedDelay = Math.max(20, delays[index] ?? 20);
  }

  nextFrames.push(currentFrame);
  nextDelays.push(accumulatedDelay);

  return mergeDuplicateAnimationFrames(nextFrames, nextDelays);
}

export function quantizeRgbaFrame(rgba: Uint8Array, paletteSize: number) {
  return UPNG.quantize(toArrayBuffer(rgba), paletteSize);
}

export function getPaletteHexes(quantized: ReturnType<typeof quantizeRgbaFrame>, limit = 8) {
  return quantized.plte.slice(0, limit).flatMap((entry) => {
    const rgba =
      typeof entry === 'number'
        ? entry
        : typeof entry?.est?.rgba === 'number'
          ? entry.est.rgba
          : typeof entry?.rgba === 'number'
            ? entry.rgba
            : null;

    if (rgba === null) {
      return [];
    }

    const color = unpackRgbaInt(rgba);

    return {
      color: `#${[color.red, color.green, color.blue]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`,
      alpha: color.alpha,
    };
  });
}

export function extractPaletteEntriesFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  limit: number | null = null,
) {
  const counts = new Map<number, number>();

  for (let index = 0; index < rgba.length; index += 4) {
    const key = packRgba(rgba[index], rgba[index + 1], rgba[index + 2], rgba[index + 3]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const totalPixels = rgba.length / 4;
  const entries = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit && limit > 0 ? limit : undefined)
    .map(([key, count]) => ({
      key: String(key),
      color: rgbaIntToHex(key),
      alpha: Math.round(unpackRgbaInt(key).alpha * 1000) / 1000,
      count,
      percent: totalPixels ? Math.round((count / totalPixels) * 1000) / 10 : 0,
    })) satisfies PngPaletteEntry[];

  return entries;
}

export function paletteEntriesToCssVariables(entries: PngPaletteEntry[], prefix = 'png-color') {
  return entries
    .map((entry, index) => `--${prefix}-${String(index + 1).padStart(2, '0')}: ${entry.color};`)
    .join('\n');
}

export function paletteEntriesToJson(entries: PngPaletteEntry[]) {
  return JSON.stringify(entries, null, 2);
}

export function renderPngChannelView(imageData: ImageData, mode: PngChannelView) {
  if (mode === 'rgb') {
    return imageData;
  }

  const output = new Uint8ClampedArray(imageData.data.length);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const alpha = imageData.data[index + 3];
    let value = 0;

    switch (mode) {
      case 'red':
        value = red;
        break;
      case 'green':
        value = green;
        break;
      case 'blue':
        value = blue;
        break;
      case 'alpha':
        value = alpha;
        break;
      case 'alpha-mask':
        value = alpha >= 16 ? 255 : 0;
        break;
      default:
        value = 0;
    }

    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
    output[index + 3] = 255;
  }

  return new ImageData(output, imageData.width, imageData.height);
}

function computeAlphaField(imageData: ImageData, threshold: number, offset = 0) {
  const width = imageData.width;
  const height = imageData.height;
  const source = new Uint8Array(width * height);

  for (let index = 0; index < source.length; index += 1) {
    source[index] = imageData.data[index * 4 + 3] >= threshold ? 1 : 0;
  }

  if (offset === 0) {
    return source;
  }

  const radius = Math.abs(Math.round(offset));
  const next = new Uint8Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;

      if (offset > 0) {
        let solid = false;

        for (let offsetY = -radius; offsetY <= radius && !solid; offsetY += 1) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            if (offsetX * offsetX + offsetY * offsetY > radius * radius) {
              continue;
            }

            const nextX = x + offsetX;
            const nextY = y + offsetY;

            if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
              continue;
            }

            if (source[nextY * width + nextX] === 1) {
              solid = true;
              break;
            }
          }
        }

        next[index] = solid ? 1 : 0;
        continue;
      }

      let keep = source[index] === 1;

      for (let offsetY = -radius; offsetY <= radius && keep; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (offsetX * offsetX + offsetY * offsetY > radius * radius) {
            continue;
          }

          const nextX = x + offsetX;
          const nextY = y + offsetY;

          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            keep = false;
            break;
          }

          if (source[nextY * width + nextX] === 0) {
            keep = false;
            break;
          }
        }
      }

      next[index] = keep ? 1 : 0;
    }
  }

  return next;
}

function distanceToMask(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
) {
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        continue;
      }

      if (mask[nextY * width + nextX] === 0) {
        continue;
      }

      const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

      if (distance < bestDistance) {
        bestDistance = distance;
      }
    }
  }

  return Number.isFinite(bestDistance) ? bestDistance : null;
}

export function generatePngOutline(
  imageData: ImageData,
  options: {
    thickness: number;
    color: string;
    mode: OutlineMode;
    edgeSoftness: number;
    threshold?: number;
  },
) {
  const width = imageData.width;
  const height = imageData.height;
  const output = new Uint8ClampedArray(imageData.data);
  const threshold = clamp(options.threshold ?? 16, 1, 255);
  const thickness = clamp(Math.round(options.thickness), 1, 128);
  const softness = clamp(Math.round(options.edgeSoftness), 0, 128);
  const radius = Math.max(1, thickness + softness);
  const sourceMask = computeAlphaField(imageData, threshold, 0);
  const expandedMask = computeAlphaField(imageData, threshold, radius);
  const color = hexToRgb(options.color);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const rgbaIndex = pixelIndex * 4;

      if (expandedMask[pixelIndex] === 0) {
        continue;
      }

      if (options.mode === 'outside' && sourceMask[pixelIndex] === 1) {
        continue;
      }

      const sourceAlpha = output[rgbaIndex + 3] / 255;
      const distance = distanceToMask(sourceMask, width, height, x, y, radius);
      const distanceFromShape = distance ?? radius + 1;

      if (distanceFromShape > radius) {
        continue;
      }

      let outlineAlpha = 1;

      if (distanceFromShape > thickness) {
        const fadeSpan = Math.max(1, softness);
        outlineAlpha = clamp(1 - (distanceFromShape - thickness) / fadeSpan, 0, 1);
      }

      if (options.mode === 'centered' && sourceMask[pixelIndex] === 1) {
        outlineAlpha = Math.max(outlineAlpha, 0.42 * (1 - sourceAlpha));
      }

      const nextAlpha = clamp(Math.round(outlineAlpha * 255), 0, 255);
      const mixedAlpha = nextAlpha + Math.round(sourceAlpha * 255 * (1 - nextAlpha / 255));

      output[rgbaIndex] = Math.round(
        color.red * (nextAlpha / 255) + output[rgbaIndex] * (1 - nextAlpha / 255),
      );
      output[rgbaIndex + 1] = Math.round(
        color.green * (nextAlpha / 255) + output[rgbaIndex + 1] * (1 - nextAlpha / 255),
      );
      output[rgbaIndex + 2] = Math.round(
        color.blue * (nextAlpha / 255) + output[rgbaIndex + 2] * (1 - nextAlpha / 255),
      );
      output[rgbaIndex + 3] = clamp(mixedAlpha, 0, 255);
    }
  }

  return new ImageData(output, width, height);
}

export function removePngOutlineHalo(
  imageData: ImageData,
  options: {
    haloWidth: number;
    aggressiveness: number;
    preserveInnerDetail: number;
    threshold?: number;
  },
) {
  const width = imageData.width;
  const height = imageData.height;
  const output = new Uint8ClampedArray(imageData.data);
  const threshold = clamp(options.threshold ?? 16, 1, 255);
  const haloWidth = clamp(Math.round(options.haloWidth), 1, 128);
  const aggressiveness = clamp(options.aggressiveness, 0, 1);
  const preserve = clamp(options.preserveInnerDetail, 0, 1);
  const solidMask = computeAlphaField(imageData, threshold, 0);
  const innerMask = computeAlphaField(
    imageData,
    threshold,
    -Math.max(1, Math.round(haloWidth * preserve)),
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const rgbaIndex = pixelIndex * 4;

      if (solidMask[pixelIndex] === 0) {
        continue;
      }

      if (innerMask[pixelIndex] === 1) {
        continue;
      }

      const distance = distanceToMask(innerMask, width, height, x, y, haloWidth) ?? 0;
      const boundaryFactor = clamp(1 - distance / Math.max(1, haloWidth), 0, 1);
      const alpha = output[rgbaIndex + 3];
      const alphaScale = 1 - aggressiveness * boundaryFactor * 0.9;
      output[rgbaIndex + 3] = clamp(Math.round(alpha * alphaScale), 0, 255);
    }
  }

  return new ImageData(output, width, height);
}

function drawCanvasBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: FlattenBackgroundMode,
  customColor: string,
  gradientStart: string,
  gradientEnd: string,
  direction: GradientDirection,
) {
  if (mode === 'white') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return;
  }

  if (mode === 'black') {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    return;
  }

  if (mode === 'custom-solid') {
    context.fillStyle = sanitizeHexColor(customColor);
    context.fillRect(0, 0, width, height);
    return;
  }

  let x1 = 0;
  const y1 = 0;
  let x2 = 0;
  let y2 = height;

  if (direction === 'to-right') {
    x2 = width;
    y2 = 0;
  } else if (direction === 'to-bottom-right') {
    x2 = width;
    y2 = height;
  } else if (direction === 'to-bottom-left') {
    x1 = width;
    x2 = 0;
    y2 = height;
  }

  const gradient = context.createLinearGradient(x1, y1, x2, y2);
  gradient.addColorStop(0, sanitizeHexColor(gradientStart));
  gradient.addColorStop(1, sanitizeHexColor(gradientEnd));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

export function flattenPngTransparency(
  image: CanvasImageSource,
  width: number,
  height: number,
  options: {
    mode: FlattenBackgroundMode;
    customColor: string;
    gradientStart: string;
    gradientEnd: string;
    direction: GradientDirection;
  },
) {
  const { canvas, context } = prepareCanvas(width, height, null);
  drawCanvasBackground(
    context,
    width,
    height,
    options.mode,
    options.customColor,
    options.gradientStart,
    options.gradientEnd,
    options.direction,
  );
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

export function extractColorFromPng(
  imageData: ImageData,
  options: {
    targetHex: string;
    tolerance: number;
    edgeSoftness: number;
    invert: boolean;
  },
) {
  const output = new Uint8ClampedArray(imageData.data);
  const target = hexToRgb(options.targetHex);
  const tolerance = clamp(options.tolerance, 0, 255);
  const softness = clamp(options.edgeSoftness, 0, 255);

  for (let index = 0; index < output.length; index += 4) {
    const red = output[index];
    const green = output[index + 1];
    const blue = output[index + 2];
    const alpha = output[index + 3];
    const distance = Math.sqrt(
      (red - target.red) ** 2 + (green - target.green) ** 2 + (blue - target.blue) ** 2,
    );
    const matched = distance <= tolerance;
    const withinSoftEdge = softness > 0 && distance <= tolerance + softness;
    const keepMatched = !options.invert;

    if (matched) {
      output[index + 3] = keepMatched ? alpha : 0;
      continue;
    }

    if (withinSoftEdge) {
      const ratio = clamp((distance - tolerance) / Math.max(1, softness), 0, 1);
      output[index + 3] = keepMatched ? Math.round(alpha * (1 - ratio)) : Math.round(alpha * ratio);
      continue;
    }

    output[index + 3] = keepMatched ? 0 : alpha;
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export function getBackgroundTesterStyle(
  mode: BackgroundTesterMode,
  customColor: string,
  gradientStart: string,
  gradientEnd: string,
  direction: GradientDirection,
) {
  if (mode === 'white') {
    return { background: '#ffffff' };
  }

  if (mode === 'black') {
    return { background: '#000000' };
  }

  if (mode === 'checker') {
    return getPreviewBackgroundStyle('checker');
  }

  if (mode === 'custom-solid') {
    return { background: sanitizeHexColor(customColor) };
  }

  let directionCss = 'to bottom';

  if (direction === 'to-right') {
    directionCss = 'to right';
  } else if (direction === 'to-bottom-right') {
    directionCss = 'to bottom right';
  } else if (direction === 'to-bottom-left') {
    directionCss = 'to bottom left';
  }

  return {
    background: `linear-gradient(${directionCss}, ${sanitizeHexColor(gradientStart)}, ${sanitizeHexColor(gradientEnd)})`,
  };
}

export async function createBackgroundTesterContactSheet(
  image: CanvasImageSource,
  width: number,
  height: number,
  items: Array<{
    label: string;
    mode: FlattenBackgroundMode;
    customColor: string;
    gradientStart: string;
    gradientEnd: string;
    direction: GradientDirection;
  }>,
) {
  const columns = items.length >= 4 ? 2 : 1;
  const rows = Math.ceil(items.length / columns);
  const gap = 28;
  const labelHeight = 48;
  const canvasWidth = columns * width + (columns + 1) * gap;
  const canvasHeight = rows * (height + labelHeight) + (rows + 1) * gap;
  const { canvas, context } = prepareCanvas(canvasWidth, canvasHeight, '#f4f1eb');

  context.fillStyle = '#1f2438';
  context.font = '600 20px system-ui';

  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (width + gap);
    const y = gap + row * (height + labelHeight + gap);
    const sample = flattenPngTransparency(image, width, height, {
      mode: item.mode,
      customColor: item.customColor,
      gradientStart: item.gradientStart,
      gradientEnd: item.gradientEnd,
      direction: item.direction,
    });

    context.drawImage(sample, x, y + labelHeight, width, height);
    context.fillText(item.label, x, y + 28);
  });

  return await canvasToPngBlob(canvas);
}

function buildOutlineMask(imageData: ImageData, threshold: number, offset: number) {
  const mask = computeAlphaField(imageData, threshold, offset);
  const width = imageData.width;
  const height = imageData.height;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const rgbaIndex = pixelIndex * 4;

      if (mask[pixelIndex] === 0) {
        continue;
      }

      const touchesTransparency =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        mask[pixelIndex - 1] === 0 ||
        mask[pixelIndex + 1] === 0 ||
        mask[pixelIndex - width] === 0 ||
        mask[pixelIndex + width] === 0;

      if (!touchesTransparency) {
        continue;
      }

      output[rgbaIndex] = 0;
      output[rgbaIndex + 1] = 0;
      output[rgbaIndex + 2] = 0;
      output[rgbaIndex + 3] = 255;
    }
  }

  return {
    mask,
    edgeImage: new ImageData(output, width, height),
  };
}

function simplifyRectLoop(points: Point[], simplifyAmount: number) {
  if (points.length <= 2) {
    return points;
  }

  const simplified: Point[] = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const isCollinear =
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y);

    if (isCollinear) {
      continue;
    }

    simplified.push(current);
  }

  simplified.push(points[points.length - 1]);

  if (simplifyAmount <= 0) {
    return simplified;
  }

  const skip = clamp(Math.round(simplifyAmount), 0, 12);

  if (skip <= 1 || simplified.length <= 6) {
    return simplified;
  }

  return simplified.filter(
    (point, index) => index === 0 || index === simplified.length - 1 || index % skip === 0,
  );
}

function buildEdgeLoops(mask: Uint8Array, width: number, height: number) {
  const segments = new Map<string, Point>();

  const addSegment = (from: Point, to: Point) => {
    segments.set(`${from.x},${from.y}->${to.x},${to.y}`, to);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) {
        continue;
      }

      const north = y === 0 ? 0 : mask[(y - 1) * width + x];
      const east = x === width - 1 ? 0 : mask[y * width + (x + 1)];
      const south = y === height - 1 ? 0 : mask[(y + 1) * width + x];
      const west = x === 0 ? 0 : mask[y * width + (x - 1)];

      if (north === 0) {
        addSegment({ x, y }, { x: x + 1, y });
      }

      if (east === 0) {
        addSegment({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      }

      if (south === 0) {
        addSegment({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      }

      if (west === 0) {
        addSegment({ x, y: y + 1 }, { x, y });
      }
    }
  }

  const unused = new Set(segments.keys());
  const loops: Point[][] = [];

  while (unused.size > 0) {
    const firstKey = unused.values().next().value as string;
    const [startRaw, endRaw] = firstKey.split('->');
    const parsePoint = (value: string) => {
      const [x, y] = value.split(',').map((entry) => Number(entry));
      return { x, y };
    };
    const start = parsePoint(startRaw);
    let current = parsePoint(endRaw);
    const loop: Point[] = [start, current];
    unused.delete(firstKey);

    while (!(current.x === start.x && current.y === start.y)) {
      const nextPrefix = `${current.x},${current.y}->`;
      const nextKey = Array.from(unused).find((key) => key.startsWith(nextPrefix));

      if (!nextKey) {
        break;
      }

      const [, nextRaw] = nextKey.split('->');
      current = parsePoint(nextRaw);
      loop.push(current);
      unused.delete(nextKey);
    }

    loops.push(loop);
  }

  return loops;
}

export function buildOutlineSvgPath(
  imageData: ImageData,
  options: {
    threshold: number;
    simplifyAmount: number;
    offset: number;
  },
) {
  const threshold = clamp(Math.round(options.threshold), 1, 255);
  const offset = clamp(Math.round(options.offset), -64, 64);
  const { mask, edgeImage } = buildOutlineMask(imageData, threshold, offset);
  const loops = buildEdgeLoops(mask, imageData.width, imageData.height)
    .map((loop) => simplifyRectLoop(loop, options.simplifyAmount))
    .filter((loop) => loop.length >= 3);

  const pathData = loops
    .map((loop) => {
      const [first, ...rest] = loop;
      const commands = [`M ${first.x} ${first.y}`];
      rest.forEach((point) => {
        commands.push(`L ${point.x} ${point.y}`);
      });
      commands.push('Z');
      return commands.join(' ');
    })
    .join(' ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageData.width} ${imageData.height}" fill="none" stroke="#111111" stroke-width="1" shape-rendering="crispEdges"><path d="${pathData}" fill="none"/></svg>`;

  return {
    svg,
    edgeImage,
  };
}

export function getPreviewBackgroundStyle(mode: 'checker' | 'white' | 'black') {
  switch (mode) {
    case 'white':
      return { background: '#ffffff' };
    case 'black':
      return { background: '#121212' };
    case 'checker':
    default:
      return {
        backgroundColor: '#f3f4f7',
        backgroundImage:
          'linear-gradient(45deg, rgba(28,32,46,0.06) 25%, transparent 25%), linear-gradient(-45deg, rgba(28,32,46,0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(28,32,46,0.06) 75%), linear-gradient(-45deg, transparent 75%, rgba(28,32,46,0.06) 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
      };
  }
}

export function getAnimationDuration(delays: number[]) {
  return delays.reduce((sum, delay) => sum + Math.max(20, delay || 20), 0);
}
