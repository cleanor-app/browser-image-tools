'use client';

import UPNGDefault from '@pdf-lib/upng';

const UPNG = UPNGDefault as unknown as typeof import('@pdf-lib/upng');

export const rasterImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

export type LoadedRasterImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
  fileName: string;
  mimeType: string;
  size: number;
};

export type DominantColor = {
  color: string;
  alpha: number;
};

export type TransparencyStats = {
  pixelCount: number;
  opaquePixels: number;
  transparentPixels: number;
  translucentPixels: number;
  opaquePercent: number;
  transparentPercent: number;
  translucentPercent: number;
  hasTransparency: boolean;
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

function gcd(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b) {
    [a, b] = [b, a % b];
  }

  return a || 1;
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

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

export function getMimeLabel(mimeType: string) {
  if (!mimeType) {
    return 'Auto';
  }

  const label = mimeType.replace('image/', '').toUpperCase();
  return label === 'JPEG' ? 'JPG' : label;
}

export function formatAspectRatio(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return 'Unknown';
  }

  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function isRasterImageFile(file: File) {
  return rasterImageMimeTypes.has(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

export function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function prepareCanvas(width: number, height: number, background: string | null = null) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not prepare a canvas for this image.');
  }

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  return { canvas, context };
}

export function drawImageToCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  background: string | null = null,
) {
  const { canvas, context } = prepareCanvas(width, height, background);
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context };
}

export function getCanvasImageData(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not read image pixels from the canvas.');
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('The browser could not encode this image export.'));
      },
      mimeType,
      quality,
    );
  });
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return canvasToBlob(canvas, 'image/png');
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

export async function loadRasterImage(file: File): Promise<LoadedRasterImage> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('This image format could not be opened in your browser.'));
      image.src = objectUrl;
    });

    return {
      element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      fileName: file.name,
      mimeType: file.type || 'image/png',
      size: file.size,
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

export async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The browser could not read this file as Base64.'));
    reader.readAsDataURL(blob);
  });
}

export async function fileToDataUrl(file: File) {
  return blobToDataUrl(file);
}

export function splitDataUrl(dataUrl: string) {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1] || 'image/png',
    base64: match[2],
  };
}

export function normalizeBase64Input(input: string) {
  return input.trim().replace(/\s+/g, '');
}

export function decodeBase64Payload(base64: string) {
  const normalized = normalizeBase64Input(base64);

  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    throw new Error('This Base64 payload could not be decoded.');
  }
}

export function decodeBase64ToBlob(input: string, fallbackMimeType: string) {
  const dataUrl = splitDataUrl(input);
  const mimeType = dataUrl?.mimeType || fallbackMimeType;
  const bytes = decodeBase64Payload(dataUrl?.base64 || input);

  return new Blob([bytes], { type: mimeType });
}

export function extractRawBase64(dataUrl: string) {
  const parsed = splitDataUrl(dataUrl);
  return parsed?.base64 ?? normalizeBase64Input(dataUrl);
}

export function analyzeTransparency(rgba: Uint8ClampedArray | Uint8Array): TransparencyStats {
  let opaquePixels = 0;
  let transparentPixels = 0;
  let translucentPixels = 0;

  for (let index = 3; index < rgba.length; index += 4) {
    const alpha = rgba[index];

    if (alpha === 255) {
      opaquePixels += 1;
    } else if (alpha === 0) {
      transparentPixels += 1;
    } else {
      translucentPixels += 1;
    }
  }

  const pixelCount = rgba.length / 4;

  return {
    pixelCount,
    opaquePixels,
    transparentPixels,
    translucentPixels,
    opaquePercent: pixelCount ? Math.round((opaquePixels / pixelCount) * 100) : 0,
    transparentPercent: pixelCount ? Math.round((transparentPixels / pixelCount) * 100) : 0,
    translucentPercent: pixelCount ? Math.round((translucentPixels / pixelCount) * 100) : 0,
    hasTransparency: transparentPixels > 0 || translucentPixels > 0,
  };
}

export function renderAlphaMask(imageData: ImageData) {
  const canvas = createCanvas(imageData.width, imageData.height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not render the alpha preview.');
  }

  const output = context.createImageData(imageData.width, imageData.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    output.data[index] = alpha;
    output.data[index + 1] = alpha;
    output.data[index + 2] = alpha;
    output.data[index + 3] = 255;
  }

  context.putImageData(output, 0, 0);

  return canvas;
}

export function getDominantColors(rgba: Uint8Array, limit = 8): DominantColor[] {
  const result = UPNG.quantize(toArrayBuffer(rgba), Math.max(limit, 2));

  return result.plte.slice(0, limit).flatMap((entry) => {
    const rgbaValue =
      typeof entry === 'number'
        ? entry
        : typeof entry?.est?.rgba === 'number'
          ? entry.est.rgba
          : typeof entry?.rgba === 'number'
            ? entry.rgba
            : null;

    if (rgbaValue === null) {
      return [];
    }

    const color = unpackRgbaInt(rgbaValue);

    return {
      color: `#${[color.red, color.green, color.blue]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')}`,
      alpha: color.alpha,
    };
  });
}

export function applySharpen(imageData: ImageData, strength: number) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data);
  const safeStrength = clamp(strength, 0, 1.5);
  const center = 5 + safeStrength * 4;
  const side = -1 - safeStrength;
  const kernel = [0, side, 0, side, center, side, 0, side, 0];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let kernelIndex = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sourceIndex = ((y + offsetY) * width + (x + offsetX)) * 4;
          const weight = kernel[kernelIndex];
          red += data[sourceIndex] * weight;
          green += data[sourceIndex + 1] * weight;
          blue += data[sourceIndex + 2] * weight;
          alpha += data[sourceIndex + 3] * weight;
          kernelIndex += 1;
        }
      }

      const outputIndex = (y * width + x) * 4;
      output[outputIndex] = clamp(Math.round(red), 0, 255);
      output[outputIndex + 1] = clamp(Math.round(green), 0, 255);
      output[outputIndex + 2] = clamp(Math.round(blue), 0, 255);
      output[outputIndex + 3] = clamp(Math.round(alpha), 0, 255);
    }
  }

  return new ImageData(output, width, height);
}

export function makeColorTransparent(
  imageData: ImageData,
  targetHex: string,
  tolerance: number,
  edgeSmoothing: number,
) {
  const output = new Uint8ClampedArray(imageData.data);
  const target = hexToRgb(targetHex);
  const safeTolerance = clamp(tolerance, 0, 255);
  const safeEdgeSmoothing = clamp(edgeSmoothing, 0, 255);

  for (let index = 0; index < output.length; index += 4) {
    const red = output[index];
    const green = output[index + 1];
    const blue = output[index + 2];
    const alpha = output[index + 3];
    const distance = Math.sqrt(
      (red - target.red) ** 2 + (green - target.green) ** 2 + (blue - target.blue) ** 2,
    );

    if (distance <= safeTolerance) {
      output[index + 3] = 0;
      continue;
    }

    if (safeEdgeSmoothing > 0 && distance <= safeTolerance + safeEdgeSmoothing) {
      const ratio = (distance - safeTolerance) / safeEdgeSmoothing;
      output[index + 3] = clamp(Math.round(alpha * ratio), 0, 255);
    }
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export function sampleHexColor(imageData: ImageData, x: number, y: number) {
  const safeX = clamp(Math.round(x), 0, imageData.width - 1);
  const safeY = clamp(Math.round(y), 0, imageData.height - 1);
  const index = (safeY * imageData.width + safeX) * 4;

  return `#${[imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}
