'use client';

import { Image as CrossImage, type ImageMetadata as CrossImageMetadata } from '@cross/image';
import { encode as encodeMozJpeg } from '@jsquash/jpeg';
import * as exifr from 'exifr';
import { canvasToBlob, clamp, prepareCanvas } from './browser-image-tools';

export const jpegMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']);
export const heicMimeTypes = new Set(['image/heic', 'image/heif', 'image/heic-sequence']);

export type JpegLikeFormat = 'jpeg' | 'heic';
export type JpegSubsamplingPreset = 'auto' | '444' | '420';

export type JpegStructureInfo = {
  componentCount: number | null;
  isProgressive: boolean;
  adobeTransform: number | null;
  isCmykLike: boolean;
};

export type NormalizedExifSummary = {
  camera: string | null;
  lens: string | null;
  iso: number | null;
  exposureTime: number | null;
  exposureLabel: string | null;
  aperture: number | null;
  focalLength: number | null;
  captureDate: string | null;
  orientation: number | null;
  dpiX: number | null;
  dpiY: number | null;
  gps: {
    latitude: number;
    longitude: number;
  } | null;
};

export type ParsedExifMetadata = {
  raw: Record<string, unknown> | null;
  summary: NormalizedExifSummary;
};

export type DecodedJpgSource = {
  file: File;
  bytes: Uint8Array;
  format: JpegLikeFormat;
  image: CrossImage;
  width: number;
  height: number;
  nativePreviewUrl: string | null;
  decodedPreviewUrl: string;
  metadata: CrossImageMetadata | undefined;
  jpegStructure: JpegStructureInfo | null;
};

function hasExtension(fileName: string, pattern: RegExp) {
  return pattern.test(fileName);
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function serializeJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeJsonValue(entry),
      ]),
    );
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

function formatCaptureDate(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatExposureLabel(value: number | null) {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}s`;
  }

  return `1/${Math.max(1, Math.round(1 / value))}s`;
}

function getAdobApp14Transform(bytes: Uint8Array, segmentStart: number, segmentEnd: number) {
  if (segmentEnd - segmentStart < 12) {
    return null;
  }

  const signature = String.fromCharCode(
    bytes[segmentStart],
    bytes[segmentStart + 1],
    bytes[segmentStart + 2],
    bytes[segmentStart + 3],
    bytes[segmentStart + 4],
  );

  if (signature !== 'Adobe') {
    return null;
  }

  return bytes[segmentStart + 11] ?? null;
}

export function isJpegFile(file: File) {
  return jpegMimeTypes.has(file.type) || hasExtension(file.name, /\.jpe?g$/i);
}

export function isHeicFile(file: File) {
  return heicMimeTypes.has(file.type) || hasExtension(file.name, /\.hei[cf]$/i);
}

export function isJpegLikeFile(file: File) {
  return isJpegFile(file) || isHeicFile(file);
}

export function getJpegLikeFormat(file: File): JpegLikeFormat | null {
  if (isHeicFile(file)) {
    return 'heic';
  }

  if (isJpegFile(file)) {
    return 'jpeg';
  }

  return null;
}

export function inspectJpegStructure(bytes: Uint8Array): JpegStructureInfo {
  let position = 2;
  let componentCount: number | null = null;
  let isProgressive = false;
  let adobeTransform: number | null = null;

  while (position < bytes.length - 1) {
    if (bytes[position] !== 0xff) {
      position += 1;
      continue;
    }

    const marker = bytes[position + 1];
    position += 2;

    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      continue;
    }

    if (position + 1 >= bytes.length) {
      break;
    }

    const segmentLength = (bytes[position] << 8) | bytes[position + 1];

    if (segmentLength < 2 || position + segmentLength > bytes.length) {
      break;
    }

    const segmentStart = position + 2;
    const segmentEnd = position + segmentLength;

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      segmentEnd - segmentStart >= 6
    ) {
      componentCount = bytes[segmentStart + 5] ?? componentCount;
      isProgressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
    }

    if (marker === 0xee) {
      adobeTransform = getAdobApp14Transform(bytes, segmentStart, segmentEnd);
    }

    position += segmentLength;
  }

  const isCmykLike =
    componentCount === 4 || adobeTransform === 2 || (adobeTransform === 0 && componentCount === 4);

  return {
    componentCount,
    isProgressive,
    adobeTransform,
    isCmykLike,
  };
}

export function crossImageToImageData(image: CrossImage) {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

export function imageDataToCrossImage(imageData: ImageData) {
  return CrossImage.fromRGBA(imageData.width, imageData.height, new Uint8Array(imageData.data));
}

export async function imageDataToPngBlob(imageData: ImageData) {
  const { canvas, context } = prepareCanvas(imageData.width, imageData.height);
  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

export async function imageDataToPngPreviewUrl(imageData: ImageData) {
  const blob = await imageDataToPngBlob(imageData);
  return URL.createObjectURL(blob);
}

export async function decodeJpegLikeSource(file: File): Promise<DecodedJpgSource> {
  const format = getJpegLikeFormat(file);

  if (!format) {
    throw new Error('Choose a JPG, JPEG, HEIC, or HEIF image.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = await CrossImage.decode(bytes, format, {
    tolerantDecoding: true,
    runtimeDecoding: 'prefer',
  });
  const decodedPreviewUrl = await imageDataToPngPreviewUrl(crossImageToImageData(image));
  const nativePreviewUrl = format === 'jpeg' ? URL.createObjectURL(file) : null;

  return {
    file,
    bytes,
    format,
    image,
    width: image.width,
    height: image.height,
    nativePreviewUrl,
    decodedPreviewUrl,
    metadata: image.metadata,
    jpegStructure: format === 'jpeg' ? inspectJpegStructure(bytes) : null,
  };
}

export function revokeDecodedJpgSource(source: DecodedJpgSource | null) {
  if (!source) {
    return;
  }

  if (source.nativePreviewUrl) {
    URL.revokeObjectURL(source.nativePreviewUrl);
  }

  URL.revokeObjectURL(source.decodedPreviewUrl);
}

export function getBestJpgSourcePreview(source: DecodedJpgSource | null) {
  if (!source) {
    return null;
  }

  return source.nativePreviewUrl ?? source.decodedPreviewUrl;
}

export async function encodeJpegBlobFromImageData(
  imageData: ImageData,
  options: {
    quality?: number;
    progressive?: boolean;
    subsampling?: JpegSubsamplingPreset;
  } = {},
) {
  const quality = clamp(Math.round((options.quality ?? 0.84) * 100), 1, 100);
  const subsampling = options.subsampling ?? 'auto';
  const encoded = await encodeMozJpeg(imageData, {
    quality,
    baseline: !options.progressive,
    progressive: Boolean(options.progressive),
    optimize_coding: true,
    auto_subsample: subsampling === 'auto',
    chroma_subsample: subsampling === '420' ? 2 : 1,
  });

  return new Blob([encoded], { type: 'image/jpeg' });
}

export async function encodeJpegBlobFromCrossImage(
  image: CrossImage,
  options: {
    quality?: number;
    progressive?: boolean;
    subsampling?: JpegSubsamplingPreset;
  } = {},
) {
  return encodeJpegBlobFromImageData(crossImageToImageData(image), options);
}

export async function createPreviewUrlFromBlob(blob: Blob) {
  return URL.createObjectURL(blob);
}

function blendChannel(source: number, target: number, amount: number) {
  return clamp(Math.round(source + (target - source) * amount), 0, 255);
}

export function applyArtifactReduction(
  imageData: ImageData,
  strength: number,
  detailProtection: number,
) {
  const original = imageData.data;
  const smoothed = imageDataToCrossImage(imageData)
    .gaussianBlur(0.6 + clamp(strength, 0, 1) * 1.8)
    .medianFilter(clamp(Math.round(strength * 1.5), 0, 2));
  const smoothedData = crossImageToImageData(smoothed).data;
  const output = new Uint8ClampedArray(original.length);
  const safeStrength = clamp(strength, 0, 1);
  const safeDetailProtection = clamp(detailProtection, 0, 1);

  for (let index = 0; index < original.length; index += 4) {
    const delta =
      Math.abs(original[index] - smoothedData[index]) +
      Math.abs(original[index + 1] - smoothedData[index + 1]) +
      Math.abs(original[index + 2] - smoothedData[index + 2]);
    const detailFactor = clamp(delta / 110, 0, 1);
    const blend = safeStrength * (1 - detailFactor * safeDetailProtection);

    output[index] = blendChannel(original[index], smoothedData[index], blend);
    output[index + 1] = blendChannel(original[index + 1], smoothedData[index + 1], blend);
    output[index + 2] = blendChannel(original[index + 2], smoothedData[index + 2], blend);
    output[index + 3] = original[index + 3];
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export function applyDenoise(imageData: ImageData, strength: number, detailRetention: number) {
  const original = imageData.data;
  const filtered = imageDataToCrossImage(imageData)
    .medianFilter(clamp(Math.round(1 + strength * 2), 1, 3))
    .gaussianBlur(0.8 + clamp(strength, 0, 1) * 1.3);
  const filteredData = crossImageToImageData(filtered).data;
  const output = new Uint8ClampedArray(original.length);
  const safeStrength = clamp(strength, 0, 1);
  const safeDetailRetention = clamp(detailRetention, 0, 1);

  for (let index = 0; index < original.length; index += 4) {
    const detail =
      Math.abs(original[index] - filteredData[index]) +
      Math.abs(original[index + 1] - filteredData[index + 1]) +
      Math.abs(original[index + 2] - filteredData[index + 2]);
    const blend = safeStrength * (1 - clamp(detail / 90, 0, 1) * safeDetailRetention);

    output[index] = blendChannel(original[index], filteredData[index], blend);
    output[index + 1] = blendChannel(original[index + 1], filteredData[index + 1], blend);
    output[index + 2] = blendChannel(original[index + 2], filteredData[index + 2], blend);
    output[index + 3] = original[index + 3];
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export function applyBlackAndWhite(
  imageData: ImageData,
  mode: 'grayscale' | 'high-contrast',
  contrast: number,
  brightness: number,
) {
  const output = new Uint8ClampedArray(imageData.data.length);
  const contrastFactor = 1 + clamp(contrast, -1, 1) * 1.6;
  const brightnessOffset = clamp(brightness, -1, 1) * 90;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const luminance =
      imageData.data[index] * 0.2126 +
      imageData.data[index + 1] * 0.7152 +
      imageData.data[index + 2] * 0.0722;
    let adjusted = (luminance - 128) * contrastFactor + 128 + brightnessOffset;

    if (mode === 'high-contrast') {
      adjusted = adjusted >= 150 ? 255 : adjusted <= 105 ? 0 : adjusted > 127 ? 255 : 0;
    }

    const value = clamp(Math.round(adjusted), 0, 255);
    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
    output[index + 3] = imageData.data[index + 3];
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export type RedEyePoint = {
  x: number;
  y: number;
  radius: number;
};

export function applyRedEyeCorrection(
  imageData: ImageData,
  points: RedEyePoint[],
  intensity: number,
) {
  const output = new Uint8ClampedArray(imageData.data);
  const safeIntensity = clamp(intensity, 0, 1);

  for (const point of points) {
    const minX = Math.max(0, Math.floor(point.x - point.radius));
    const maxX = Math.min(imageData.width - 1, Math.ceil(point.x + point.radius));
    const minY = Math.max(0, Math.floor(point.y - point.radius));
    const maxY = Math.min(imageData.height - 1, Math.ceil(point.y + point.radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const deltaX = x - point.x;
        const deltaY = y - point.y;
        const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);

        if (distance > point.radius) {
          continue;
        }

        const ratio = 1 - distance / Math.max(point.radius, 1);
        const index = (y * imageData.width + x) * 4;
        const red = output[index];
        const green = output[index + 1];
        const blue = output[index + 2];
        const average = (green + blue) / 2;

        if (red < average * 1.08) {
          continue;
        }

        const amount = safeIntensity * ratio;
        const target = average * 0.78;
        const corrected = blendChannel(red, target, amount);

        output[index] = corrected;
        output[index + 1] = blendChannel(green, target, amount * 0.35);
        output[index + 2] = blendChannel(blue, target, amount * 0.35);
      }
    }
  }

  return new ImageData(output, imageData.width, imageData.height);
}

function resizeImageData(imageData: ImageData, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(imageData.width, imageData.height));
  const width = Math.max(1, Math.round(imageData.width * scale));
  const height = Math.max(1, Math.round(imageData.height * scale));
  const { canvas, context } = prepareCanvas(width, height, '#ffffff');
  const source = prepareCanvas(imageData.width, imageData.height);
  source.context.putImageData(imageData, 0, 0);
  context.drawImage(source.canvas, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export function rotateImageData(imageData: ImageData, degrees: number, background = '#ffffff') {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = Math.max(1, Math.round(imageData.width * cos + imageData.height * sin));
  const height = Math.max(1, Math.round(imageData.width * sin + imageData.height * cos));
  const source = prepareCanvas(imageData.width, imageData.height);
  source.context.putImageData(imageData, 0, 0);

  const { canvas, context } = prepareCanvas(width, height, background);
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(source.canvas, -imageData.width / 2, -imageData.height / 2);
  return context.getImageData(0, 0, width, height);
}

function scoreDeskewAngle(imageData: ImageData, angle: number) {
  const rotated = rotateImageData(imageData, angle, '#ffffff');
  const rowScores = new Array(rotated.height).fill(0);

  for (let y = 0; y < rotated.height; y += 1) {
    let darkness = 0;

    for (let x = 0; x < rotated.width; x += 2) {
      const index = (y * rotated.width + x) * 4;
      const luminance =
        rotated.data[index] * 0.2126 +
        rotated.data[index + 1] * 0.7152 +
        rotated.data[index + 2] * 0.0722;
      darkness += 255 - luminance;
    }

    rowScores[y] = darkness;
  }

  const average = rowScores.reduce((sum, value) => sum + value, 0) / Math.max(rowScores.length, 1);
  return rowScores.reduce((sum, value) => sum + (value - average) ** 2, 0);
}

export function estimateDeskewDegrees(imageData: ImageData) {
  const downscaled = resizeImageData(imageData, 240);
  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let angle = -6; angle <= 6; angle += 0.5) {
    const score = scoreDeskewAngle(downscaled, angle);

    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

function normalizeScanChannels(imageData: ImageData, whitening: number, contrastCleanup: number) {
  const output = new Uint8ClampedArray(imageData.data.length);
  const safeWhitening = clamp(whitening, 0, 1);
  const safeContrast = 1 + clamp(contrastCleanup, 0, 1) * 1.8;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const alpha = imageData.data[index + 3];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const desaturated = luminance + (red - luminance) * 0.18;
    const contrasted = (desaturated - 128) * safeContrast + 128 + safeWhitening * 30;
    const whitened =
      contrasted > 185 ? contrasted + (255 - contrasted) * safeWhitening : contrasted;
    const value = clamp(Math.round(whitened), 0, 255);

    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
    output[index + 3] = alpha;
  }

  return new ImageData(output, imageData.width, imageData.height);
}

export function cleanScanImageData(
  imageData: ImageData,
  options: {
    autoDeskew: boolean;
    manualRotateDegrees: number;
    whitening: number;
    contrastCleanup: number;
  },
) {
  const autoAngle = options.autoDeskew ? estimateDeskewDegrees(imageData) : 0;
  const rotated = rotateImageData(
    imageData,
    autoAngle + clamp(options.manualRotateDegrees, -15, 15),
    '#ffffff',
  );
  const cleaned = normalizeScanChannels(rotated, options.whitening, options.contrastCleanup);

  return {
    autoAngle,
    imageData: cleaned,
  };
}

export async function parseExifMetadata(
  file: File,
  bytes: Uint8Array,
  format: JpegLikeFormat,
): Promise<ParsedExifMetadata> {
  let raw: Record<string, unknown> | null = null;

  try {
    const parsed = await exifr.parse(file, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'LensMake',
        'ISO',
        'ExposureTime',
        'FNumber',
        'FocalLength',
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'Orientation',
        'XResolution',
        'YResolution',
        'latitude',
        'longitude',
      ],
      translateValues: false,
      reviveValues: true,
      gps: true,
    });
    raw = toRecord(serializeJsonValue(parsed));
  } catch {
    raw = null;
  }

  let fallbackMetadata: CrossImageMetadata | undefined;

  try {
    fallbackMetadata = await CrossImage.extractMetadata(bytes, format);
  } catch {
    fallbackMetadata = undefined;
  }

  const rawRecord = raw ?? {};
  const captureDate =
    (rawRecord.DateTimeOriginal as Date | undefined) ??
    (rawRecord.CreateDate as Date | undefined) ??
    (rawRecord.ModifyDate as Date | undefined) ??
    fallbackMetadata?.creationDate;
  const exposureTime =
    toFiniteNumber(rawRecord.ExposureTime) ?? fallbackMetadata?.exposureTime ?? null;
  const summary: NormalizedExifSummary = {
    camera:
      [rawRecord.Make, rawRecord.Model]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ') ||
      [fallbackMetadata?.cameraMake, fallbackMetadata?.cameraModel]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ') ||
      null,
    lens:
      [rawRecord.LensMake, rawRecord.LensModel]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ') ||
      [fallbackMetadata?.lensMake, fallbackMetadata?.lensModel]
        .filter((value) => typeof value === 'string' && value.trim())
        .join(' ') ||
      null,
    iso: toFiniteNumber(rawRecord.ISO) ?? fallbackMetadata?.iso ?? null,
    exposureTime,
    exposureLabel: formatExposureLabel(exposureTime),
    aperture: toFiniteNumber(rawRecord.FNumber) ?? fallbackMetadata?.fNumber ?? null,
    focalLength: toFiniteNumber(rawRecord.FocalLength) ?? fallbackMetadata?.focalLength ?? null,
    captureDate: formatCaptureDate(captureDate),
    orientation: toFiniteNumber(rawRecord.Orientation) ?? fallbackMetadata?.orientation ?? null,
    dpiX: toFiniteNumber(rawRecord.XResolution) ?? fallbackMetadata?.dpiX ?? null,
    dpiY: toFiniteNumber(rawRecord.YResolution) ?? fallbackMetadata?.dpiY ?? null,
    gps:
      toFiniteNumber(rawRecord.latitude) !== null && toFiniteNumber(rawRecord.longitude) !== null
        ? {
            latitude: Number(toFiniteNumber(rawRecord.latitude)?.toFixed(6)),
            longitude: Number(toFiniteNumber(rawRecord.longitude)?.toFixed(6)),
          }
        : fallbackMetadata?.latitude !== undefined && fallbackMetadata?.longitude !== undefined
          ? {
              latitude: Number(fallbackMetadata.latitude.toFixed(6)),
              longitude: Number(fallbackMetadata.longitude.toFixed(6)),
            }
          : null,
  };

  return {
    raw: raw ? (serializeJsonValue(raw) as Record<string, unknown>) : null,
    summary,
  };
}
