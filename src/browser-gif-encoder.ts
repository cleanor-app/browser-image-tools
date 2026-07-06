// Dependency-free single-frame GIF89a encoder.
//
// The HTML canvas 2D API cannot export GIF, so we build the file by hand:
//   1. Quantize the RGBA pixels down to a <=256 color palette (median cut).
//   2. Map every pixel to a palette index.
//   3. LZW-compress the index stream (variable-width codes, LSB-first packing).
//   4. Wrap it in the GIF89a header/blocks.
//
// This encoder writes fully opaque frames. Callers that start from images with
// transparency (e.g. PNG) should flatten alpha onto a background color before
// handing pixels to `encodeGif` — GIF only supports 1-bit transparency and we
// deliberately keep the encoder simple and honest about that.

type Rgb = { r: number; g: number; b: number; count: number };

type ColorBox = {
  colors: Rgb[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
};

export type GifEncodeResult = {
  bytes: Uint8Array<ArrayBuffer>;
  paletteSize: number;
  width: number;
  height: number;
};

function buildBox(colors: Rgb[]): ColorBox {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (const c of colors) {
    if (c.r < rMin) rMin = c.r;
    if (c.r > rMax) rMax = c.r;
    if (c.g < gMin) gMin = c.g;
    if (c.g > gMax) gMax = c.g;
    if (c.b < bMin) bMin = c.b;
    if (c.b > bMax) bMax = c.b;
  }
  return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
}

function boxVolumeAxis(box: ColorBox): 'r' | 'g' | 'b' {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= bRange) return 'g';
  return 'b';
}

/**
 * Median-cut quantization. Returns a palette (up to maxColors entries) and a
 * lookup that maps any 24-bit color key to the nearest palette index.
 */
function quantize(
  histogram: Map<number, Rgb>,
  maxColors: number,
): { palette: Array<[number, number, number]> } {
  const uniqueColors = Array.from(histogram.values());
  if (uniqueColors.length === 0) {
    return { palette: [[0, 0, 0]] };
  }

  const boxes: ColorBox[] = [buildBox(uniqueColors)];

  while (boxes.length < maxColors) {
    // Pick the splittable box with the largest single-axis range.
    let target = -1;
    let bestRange = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.colors.length < 2) continue;
      const range = Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
      if (range > bestRange) {
        bestRange = range;
        target = i;
      }
    }
    if (target === -1) break; // nothing left to split

    const box = boxes[target];
    const axis = boxVolumeAxis(box);
    box.colors.sort((a, b) => a[axis] - b[axis]);

    // Split at the weighted median (by pixel count).
    const total = box.colors.reduce((sum, c) => sum + c.count, 0);
    let acc = 0;
    let splitIndex = 0;
    for (let i = 0; i < box.colors.length; i += 1) {
      acc += box.colors[i].count;
      if (acc >= total / 2) {
        splitIndex = i;
        break;
      }
    }
    // Guarantee both halves are non-empty.
    if (splitIndex <= 0) splitIndex = 1;
    if (splitIndex >= box.colors.length) splitIndex = box.colors.length - 1;

    const left = box.colors.slice(0, splitIndex);
    const right = box.colors.slice(splitIndex);
    boxes.splice(target, 1, buildBox(left), buildBox(right));
  }

  const palette: Array<[number, number, number]> = boxes.map((box) => {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let n = 0;
    for (const c of box.colors) {
      rSum += c.r * c.count;
      gSum += c.g * c.count;
      bSum += c.b * c.count;
      n += c.count;
    }
    if (n === 0) return [0, 0, 0];
    return [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
  });

  return { palette };
}

function nearestIndex(
  palette: Array<[number, number, number]>,
  r: number,
  g: number,
  b: number,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Variable-width LZW compression as required by the GIF spec. Codes are packed
 * least-significant-bit first and returned as raw bytes (pre sub-blocking).
 */
function lzwCompress(minCodeSize: number, indices: Uint8Array): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  function writeCode(code: number, size: number): void {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  let codeSize = minCodeSize + 1;
  let dict = new Map<string, number>();
  const resetDict = (): void => {
    dict = new Map();
    for (let i = 0; i < clearCode; i += 1) {
      dict.set(String.fromCharCode(i), i);
    }
  };
  resetDict();
  let nextCode = eoiCode + 1;

  writeCode(clearCode, codeSize);

  if (indices.length === 0) {
    writeCode(eoiCode, codeSize);
    if (bitCount > 0) out.push(bitBuffer & 0xff);
    return Uint8Array.from(out);
  }

  let prefix = String.fromCharCode(indices[0]);
  for (let i = 1; i < indices.length; i += 1) {
    const suffix = String.fromCharCode(indices[i]);
    const combined = prefix + suffix;
    if (dict.has(combined)) {
      prefix = combined;
    } else {
      writeCode(dict.get(prefix) as number, codeSize);
      if (nextCode < 4096) {
        dict.set(combined, nextCode);
        // Grow the code width once the dictionary outgrows the current bits.
        if (nextCode === 1 << codeSize && codeSize < 12) {
          codeSize += 1;
        }
        nextCode += 1;
      } else {
        // Dictionary is full: emit a clear code and start over.
        writeCode(clearCode, codeSize);
        resetDict();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = suffix;
    }
  }

  writeCode(dict.get(prefix) as number, codeSize);
  writeCode(eoiCode, codeSize);
  if (bitCount > 0) out.push(bitBuffer & 0xff);

  return Uint8Array.from(out);
}

/**
 * Encode a single opaque frame as a GIF89a byte stream.
 *
 * @param data   RGBA bytes, length must be width * height * 4.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 */
export function encodeGif(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): GifEncodeResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('GIF encode: width and height must be positive integers.');
  }
  if (data.length < width * height * 4) {
    throw new Error('GIF encode: pixel buffer is smaller than width * height * 4.');
  }

  const pixelCount = width * height;

  // Build a color histogram (alpha is ignored; callers flatten beforehand).
  const histogram = new Map<number, Rgb>();
  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    const existing = histogram.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      histogram.set(key, { r, g, b, count: 1 });
    }
  }

  const { palette } = quantize(histogram, 256);

  // Map every pixel to a palette index, caching by color key.
  const indexCache = new Map<number, number>();
  const indices = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = indexCache.get(key);
    if (idx === undefined) {
      idx = nearestIndex(palette, r, g, b);
      indexCache.set(key, idx);
    }
    indices[p] = idx;
  }

  // GIF color tables must be a power of two, min 2 entries.
  let tableBits = 1;
  while (1 << tableBits < palette.length) tableBits += 1;
  if (tableBits < 1) tableBits = 1;
  const tableSize = 1 << tableBits; // number of palette slots written
  const minCodeSize = Math.max(2, tableBits);

  const lzw = lzwCompress(minCodeSize, indices);

  // ---- Assemble the GIF byte stream ----
  const bytes: number[] = [];
  const pushU16 = (n: number): void => {
    bytes.push(n & 0xff, (n >> 8) & 0xff);
  };

  // Header
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"

  // Logical Screen Descriptor
  pushU16(width);
  pushU16(height);
  // Packed: global color table flag (1) | color resolution (bits-1)
  //         | sort flag (0) | size of GCT (tableBits-1)
  const packed = 0x80 | ((tableBits - 1) << 4) | (tableBits - 1);
  bytes.push(packed);
  bytes.push(0); // background color index
  bytes.push(0); // pixel aspect ratio

  // Global Color Table (tableSize entries of RGB)
  for (let i = 0; i < tableSize; i += 1) {
    if (i < palette.length) {
      bytes.push(palette[i][0], palette[i][1], palette[i][2]);
    } else {
      bytes.push(0, 0, 0);
    }
  }

  // Image Descriptor
  bytes.push(0x2c); // image separator
  pushU16(0); // left
  pushU16(0); // top
  pushU16(width);
  pushU16(height);
  bytes.push(0); // no local color table, no interlace

  // LZW minimum code size
  bytes.push(minCodeSize);

  // Image data as sub-blocks of up to 255 bytes.
  let offset = 0;
  while (offset < lzw.length) {
    const chunk = Math.min(255, lzw.length - offset);
    bytes.push(chunk);
    for (let i = 0; i < chunk; i += 1) {
      bytes.push(lzw[offset + i]);
    }
    offset += chunk;
  }
  bytes.push(0); // block terminator

  // Trailer
  bytes.push(0x3b);

  return {
    bytes: Uint8Array.from(bytes),
    paletteSize: palette.length,
    width,
    height,
  };
}
