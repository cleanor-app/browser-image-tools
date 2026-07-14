"use client";

import { Image as CrossImage } from "@cross/image";
import {
  analyzeTransparency,
  clamp,
  drawImageToCanvas,
  formatFileSize,
  loadRasterImage,
} from "./browser-image-tools";
import {
  isWebpRiff,
  renderStillWebpImageData,
  readWebpSource,
} from "./browser-webp-tools";
import {
  renderPngChannelView,
  rgbaToPngBlob,
  type PngChannelView,
} from "./browser-png-tools";

export type AvifMetadata = {
  width: number;
  height: number;
  hasAlpha: boolean;
};

export type DecodedAvifSource = {
  file: File;
  bytes: Uint8Array;
  imageData: ImageData;
  metadata: AvifMetadata;
};

export type AvifOptimizationPreset = "balanced" | "smaller" | "aggressive";
export type AvifEffortPreset = "faster" | "balanced" | "slower";

export type AvifExportResult = {
  blob: Blob;
  previewBlob: Blob;
};

function createUnsupportedError() {
  return new Error(
    "This browser cannot process AVIF locally yet. Try a modern Chromium or Safari build with ImageDecoder and OffscreenCanvas support.",
  );
}

function normalizeAvifQuality(quality: number) {
  return clamp(Math.round(quality), 1, 100);
}

function getOptimizationQuality(preset: AvifOptimizationPreset) {
  if (preset === "smaller") {
    return 56;
  }

  if (preset === "aggressive") {
    return 42;
  }

  return 70;
}

function applyEffortBias(quality: number, preset: AvifEffortPreset) {
  if (preset === "faster") {
    return clamp(quality - 6, 1, 100);
  }

  if (preset === "slower") {
    return clamp(quality + 4, 1, 100);
  }

  return clamp(quality, 1, 100);
}

function createImageDataFromRgba(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
) {
  return new ImageData(new Uint8ClampedArray(rgba), width, height);
}

function flattenImageDataOntoWhite(imageData: ImageData) {
  const output = new Uint8ClampedArray(imageData.data.length);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3] / 255;
    const inverseAlpha = 1 - alpha;
    output[index] = Math.round(
      imageData.data[index] * alpha + 255 * inverseAlpha,
    );
    output[index + 1] = Math.round(
      imageData.data[index + 1] * alpha + 255 * inverseAlpha,
    );
    output[index + 2] = Math.round(
      imageData.data[index + 2] * alpha + 255 * inverseAlpha,
    );
    output[index + 3] = 255;
  }

  return new ImageData(output, imageData.width, imageData.height);
}

function createCrossImage(imageData: ImageData) {
  return CrossImage.fromRGBA(
    imageData.width,
    imageData.height,
    new Uint8Array(imageData.data),
  );
}

async function decodeAvifBytes(bytes: Uint8Array) {
  assertAvifRuntime();

  try {
    const image = await CrossImage.decode(bytes);
    return createImageDataFromRgba(image.width, image.height, image.data);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `This AVIF file could not be decoded locally. ${error.message}`
        : "This AVIF file could not be decoded locally.",
    );
  }
}

async function encodeImageDataToAvif(
  imageData: ImageData,
  quality: number,
): Promise<Uint8Array> {
  assertAvifRuntime();

  try {
    const encoded = await createCrossImage(imageData).encode("avif", {
      quality: normalizeAvifQuality(quality),
    } as never);
    return Uint8Array.from(encoded);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `AVIF encoding failed locally. ${error.message}`
        : "AVIF encoding failed locally.",
    );
  }
}

async function createAvifPreviewBlob(bytes: Uint8Array) {
  const previewImageData = await decodeAvifBytes(bytes);
  return await rgbaToPngBlob(
    previewImageData.data,
    previewImageData.width,
    previewImageData.height,
  );
}

async function createExportResultFromImageData(
  imageData: ImageData,
  quality: number,
): Promise<AvifExportResult> {
  const encoded = await encodeImageDataToAvif(imageData, quality);
  const [previewBlob] = await Promise.all([createAvifPreviewBlob(encoded)]);

  return {
    blob: new Blob([Uint8Array.from(encoded)], { type: "image/avif" }),
    previewBlob,
  };
}

async function loadStillRasterImageData(file: File) {
  const loadedImage = await loadRasterImage(file);
  const { context } = drawImageToCanvas(
    loadedImage.element,
    loadedImage.width,
    loadedImage.height,
  );
  return context.getImageData(0, 0, loadedImage.width, loadedImage.height);
}

async function loadStillWebpImageData(file: File) {
  const source = await readWebpSource(file);

  if (source.metadata.animated) {
    throw new Error(
      "This WebP is animated. Use Animated WebP Maker, WebP Optimizer, or WebP Frame Extractor instead.",
    );
  }

  return await renderStillWebpImageData(file);
}

export function canProcessAvifInBrowser() {
  return (
    typeof window !== "undefined" &&
    typeof window.ImageDecoder !== "undefined" &&
    typeof window.OffscreenCanvas !== "undefined"
  );
}

export function assertAvifRuntime() {
  if (!canProcessAvifInBrowser()) {
    throw createUnsupportedError();
  }
}

export function isAvifFile(file: File) {
  return (
    file.type === "image/avif" || file.name.toLowerCase().endsWith(".avif")
  );
}

export async function readAvifSource(file: File): Promise<DecodedAvifSource> {
  if (!isAvifFile(file)) {
    throw new Error("Choose one AVIF file for this tool.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageData = await decodeAvifBytes(bytes);
  const transparency = analyzeTransparency(imageData.data);

  return {
    file,
    bytes,
    imageData,
    metadata: {
      width: imageData.width,
      height: imageData.height,
      hasAlpha: transparency.hasTransparency,
    },
  };
}

export async function createAvifPreviewBlobFromFile(file: File) {
  const source = await readAvifSource(file);
  return await rgbaToPngBlob(
    source.imageData.data,
    source.imageData.width,
    source.imageData.height,
  );
}

export async function convertAvifToJpg(params: {
  file: File;
  quality: number;
}) {
  const source = await readAvifSource(params.file);
  const flattened = flattenImageDataOntoWhite(source.imageData);
  const encoded = await createCrossImage(flattened).encode("jpeg", {
    quality: normalizeAvifQuality(params.quality),
  } as never);

  return new Blob([Uint8Array.from(encoded)], { type: "image/jpeg" });
}

export async function convertAvifToPng(file: File) {
  const source = await readAvifSource(file);
  return await rgbaToPngBlob(
    source.imageData.data,
    source.imageData.width,
    source.imageData.height,
  );
}

export async function convertAvifToWebp(params: {
  file: File;
  quality: number;
}) {
  const source = await readAvifSource(params.file);
  const encoded = await createCrossImage(source.imageData).encode("webp", {
    quality: normalizeAvifQuality(params.quality),
    lossless: false,
  } as never);

  // @cross/image verifies the runtime really produced AVIF and does not verify it produced WebP,
  // so a browser with no WebP encoder hands back a PNG and this would label it image/webp. The
  // AVIF encoder above cannot do that to us; this one can.
  const bytes = Uint8Array.from(encoded);
  if (!isWebpRiff(bytes)) {
    throw new Error(
      "This browser could not encode WebP locally, and handed back another format instead. Try a Chromium or Firefox build.",
    );
  }

  return new Blob([bytes], { type: "image/webp" });
}

export async function convertJpgToAvif(params: {
  file: File;
  quality: number;
}) {
  if (!fileIsJpeg(params.file)) {
    throw new Error("Choose one JPG or JPEG file for this tool.");
  }

  const imageData = await loadStillRasterImageData(params.file);
  return await createExportResultFromImageData(imageData, params.quality);
}

export async function convertPngToAvif(params: {
  file: File;
  quality: number;
}) {
  if (!fileIsPng(params.file)) {
    throw new Error("Choose one PNG file for this tool.");
  }

  const imageData = await loadStillRasterImageData(params.file);
  return await createExportResultFromImageData(imageData, params.quality);
}

export async function convertWebpToAvif(params: {
  file: File;
  quality: number;
}) {
  if (!fileIsWebp(params.file)) {
    throw new Error("Choose one still WebP file for this tool.");
  }

  const imageData = await loadStillWebpImageData(params.file);
  return await createExportResultFromImageData(imageData, params.quality);
}

export async function optimizeAvif(params: {
  file: File;
  preset: AvifOptimizationPreset;
}) {
  const source = await readAvifSource(params.file);
  return await createExportResultFromImageData(
    source.imageData,
    getOptimizationQuality(params.preset),
  );
}

export async function recompressStillAvif(params: {
  file: File;
  quality: number;
  effortPreset: AvifEffortPreset;
}) {
  const source = await readAvifSource(params.file);
  return await createExportResultFromImageData(
    source.imageData,
    applyEffortBias(params.quality, params.effortPreset),
  );
}

export async function renderAvifChannelBlob(params: {
  file: File;
  channel: PngChannelView;
}) {
  const source = await readAvifSource(params.file);
  const rendered = renderPngChannelView(source.imageData, params.channel);
  return await rgbaToPngBlob(rendered.data, rendered.width, rendered.height);
}

export async function analyzeAvifAlpha(file: File) {
  const source = await readAvifSource(file);
  const transparency = analyzeTransparency(source.imageData.data);
  const alphaBlob = await renderAvifChannelBlob({
    file,
    channel: "alpha",
  });
  const alphaMaskBlob = await renderAvifChannelBlob({
    file,
    channel: "alpha-mask",
  });

  return {
    source,
    transparency,
    alphaBlob,
    alphaMaskBlob,
  };
}

export function fileIsJpeg(file: File) {
  return file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
}

export function fileIsPng(file: File) {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

export function fileIsWebp(file: File) {
  return file.type === "image/webp" || /\.webp$/i.test(file.name);
}

export { formatFileSize };
