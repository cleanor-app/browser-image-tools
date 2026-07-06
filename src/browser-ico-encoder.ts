// Dependency-free Windows .ICO encoder that packs one or more sizes by
// embedding PNG-encoded images inside the ICO container. Modern Windows,
// browsers, and icon tooling all accept PNG-compressed ICO entries, which
// keeps this encoder tiny while still supporting large sizes such as 256x256.
//
// Container layout:
//   ICONDIR      (6 bytes)                  -> reserved, type, image count
//   ICONDIRENTRY (16 bytes per image)       -> per-size metadata + offset
//   PNG payloads (one blob per image)       -> raw PNG bytes, concatenated

export type IcoSourceImage = {
  size: number;
  png: Uint8Array;
};

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

/**
 * Pack one or more PNG payloads into a single ICO byte array.
 * Each source image should already be a square PNG whose pixel dimensions
 * match its declared `size`.
 */
export function encodeIco(images: IcoSourceImage[]): Uint8Array {
  if (!images.length) {
    throw new Error('At least one image size is required to build an ICO file.');
  }

  const count = images.length;
  const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE * count;
  const payloadSize = images.reduce((total, image) => total + image.png.byteLength, 0);
  const buffer = new ArrayBuffer(headerSize + payloadSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // ICONDIR header.
  view.setUint16(0, 0, true); // reserved, must be 0
  view.setUint16(2, 1, true); // image type: 1 = icon
  view.setUint16(4, count, true); // number of images

  let payloadOffset = headerSize;

  images.forEach((image, index) => {
    const entryOffset = ICONDIR_SIZE + ICONDIRENTRY_SIZE * index;
    // Widths/heights of 256 are stored as 0 per the ICO specification.
    const dimension = image.size >= 256 ? 0 : image.size;

    view.setUint8(entryOffset, dimension); // width
    view.setUint8(entryOffset + 1, dimension); // height
    view.setUint8(entryOffset + 2, 0); // color palette count (0 = no palette)
    view.setUint8(entryOffset + 3, 0); // reserved, must be 0
    view.setUint16(entryOffset + 4, 1, true); // color planes
    view.setUint16(entryOffset + 6, 32, true); // bits per pixel
    view.setUint32(entryOffset + 8, image.png.byteLength, true); // size of PNG data
    view.setUint32(entryOffset + 12, payloadOffset, true); // offset of PNG data

    bytes.set(image.png, payloadOffset);
    payloadOffset += image.png.byteLength;
  });

  return bytes;
}

/**
 * Sanity-check the first bytes of an encoded ICO buffer. Returns true when the
 * reserved field is 0, the type is 1 (icon), and the declared image count
 * matches what we expect. Useful as a runtime guard before download.
 */
export function verifyIcoHeader(bytes: Uint8Array, expectedCount: number): boolean {
  if (bytes.byteLength < ICONDIR_SIZE) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reserved = view.getUint16(0, true);
  const type = view.getUint16(2, true);
  const count = view.getUint16(4, true);

  return reserved === 0 && type === 1 && count === expectedCount && count > 0;
}

/**
 * Render a loaded image into a square PNG of the requested size and return the
 * raw PNG bytes. Runs entirely on an offscreen canvas in the browser.
 */
export async function renderPngAtSize(image: HTMLImageElement, size: number): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('ICO rendering is only available in the browser.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Your browser could not prepare the icon canvas.');
  }

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });

  if (!blob) {
    throw new Error('Your browser could not encode the icon image.');
  }

  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Build a downloadable ICO blob from a loaded image and a list of sizes.
 * Verifies the container header before returning so a malformed file never
 * reaches the user.
 */
export async function buildIcoBlob(image: HTMLImageElement, sizes: number[]): Promise<Blob> {
  const uniqueSizes = Array.from(new Set(sizes)).sort((a, b) => a - b);

  if (!uniqueSizes.length) {
    throw new Error('Pick at least one icon size to include.');
  }

  const images: IcoSourceImage[] = [];

  for (const size of uniqueSizes) {
    const png = await renderPngAtSize(image, size);
    images.push({ size, png });
  }

  const bytes = encodeIco(images);

  if (!verifyIcoHeader(bytes, images.length)) {
    throw new Error('The generated ICO file failed its header check.');
  }

  return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/x-icon' });
}

export const ICO_SIZE_OPTIONS = [16, 32, 48, 64, 128, 256] as const;
