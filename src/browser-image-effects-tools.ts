// Pure, framework-free pixel helpers for the browser image effect tools.
// These operate on plain RGBA byte arrays so they can be unit-tested and reused
// across the effects gallery, the deep-fry meme tool, and the enlarger.

export type FilterPreset = {
  id: string;
  label: string;
  // A CSS filter string applied to a 2D canvas context. Uses the live
  // `intensity` value (0..1) so a single slider can drive every look.
  filter: (intensity: number) => string;
};

// One-click looks for the effects gallery. Each returns a CSS `filter` string.
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'original', label: 'Original', filter: () => 'none' },
  {
    id: 'grayscale',
    label: 'Grayscale',
    filter: (i) => `grayscale(${i})`,
  },
  {
    id: 'sepia',
    label: 'Sepia',
    filter: (i) => `sepia(${i})`,
  },
  {
    id: 'invert',
    label: 'Invert',
    filter: (i) => `invert(${i})`,
  },
  {
    id: 'brighten',
    label: 'Brighten',
    filter: (i) => `brightness(${1 + i * 0.6})`,
  },
  {
    id: 'darken',
    label: 'Darken',
    filter: (i) => `brightness(${1 - i * 0.45})`,
  },
  {
    id: 'contrast',
    label: 'High contrast',
    filter: (i) => `contrast(${1 + i * 0.8})`,
  },
  {
    id: 'saturate',
    label: 'Saturate',
    filter: (i) => `saturate(${1 + i * 1.5})`,
  },
  {
    id: 'faded',
    label: 'Faded',
    filter: (i) =>
      `saturate(${1 - i * 0.55}) brightness(${1 + i * 0.12}) contrast(${1 - i * 0.15})`,
  },
  {
    id: 'blur',
    label: 'Soft blur',
    filter: (i) => `blur(${(i * 6).toFixed(2)}px)`,
  },
  {
    id: 'vintage',
    label: 'Vintage',
    filter: (i) =>
      `sepia(${i * 0.6}) saturate(${1 + i * 0.3}) contrast(${1 + i * 0.15}) brightness(${1 + i * 0.05})`,
  },
  {
    id: 'noir',
    label: 'Noir',
    filter: (i) => `grayscale(${i}) contrast(${1 + i * 0.6}) brightness(${1 - i * 0.1})`,
  },
  {
    id: 'cool',
    label: 'Cool tint',
    filter: (i) => `hue-rotate(${i * 25}deg) saturate(${1 + i * 0.25}) brightness(${1 + i * 0.03})`,
  },
  {
    id: 'warm',
    label: 'Warm tint',
    filter: (i) =>
      `sepia(${i * 0.35}) hue-rotate(-${i * 12}deg) saturate(${1 + i * 0.35}) brightness(${1 + i * 0.05})`,
  },
];

// Clamp a number into the 0..255 byte range.
function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

// Adjust contrast in place. `amount` is a multiplier where 1 = unchanged.
export function adjustContrast(data: Uint8ClampedArray, amount: number): void {
  const intercept = 128 * (1 - amount);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampByte(data[i] * amount + intercept);
    data[i + 1] = clampByte(data[i + 1] * amount + intercept);
    data[i + 2] = clampByte(data[i + 2] * amount + intercept);
  }
}

// Adjust saturation in place. `amount` is a multiplier where 1 = unchanged.
export function adjustSaturation(data: Uint8ClampedArray, amount: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Rec. 601 luma as the desaturated grey point.
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = clampByte(grey + (r - grey) * amount);
    data[i + 1] = clampByte(grey + (g - grey) * amount);
    data[i + 2] = clampByte(grey + (b - grey) * amount);
  }
}

// Deterministic pseudo-random generator so "re-randomize" is reproducible per seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Add uniform noise in place using a seeded generator. `amount` is 0..1.
export function addNoise(data: Uint8ClampedArray, amount: number, seed: number): void {
  const rand = mulberry32(seed);
  const range = amount * 90;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * range;
    data[i] = clampByte(data[i] + n);
    data[i + 1] = clampByte(data[i + 1] + n);
    data[i + 2] = clampByte(data[i + 2] + n);
  }
}

// Sharpen using a 3x3 convolution kernel. Returns a new byte array; alpha is
// copied from the source. `amount` blends the kernel strength (0 = identity).
export function sharpen(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const center = 1 + 4 * amount;
  const side = -amount;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const up = y > 0 ? src[idx - width * 4 + c] : src[idx + c];
        const down = y < height - 1 ? src[idx + width * 4 + c] : src[idx + c];
        const left = x > 0 ? src[idx - 4 + c] : src[idx + c];
        const right = x < width - 1 ? src[idx + 4 + c] : src[idx + c];
        out[idx + c] = clampByte(src[idx + c] * center + (up + down + left + right) * side);
      }
      out[idx + 3] = src[idx + 3];
    }
  }
  return out;
}

// Compute output dimensions for the enlarger given a mode and constraints.
export type EnlargeResult = { width: number; height: number };

export function computeEnlargedSize(
  naturalWidth: number,
  naturalHeight: number,
  mode: 'scale' | 'dimensions',
  scale: number,
  targetWidth: number,
  targetHeight: number,
  keepAspect: boolean,
): EnlargeResult {
  if (mode === 'scale') {
    return {
      width: Math.max(1, Math.round(naturalWidth * scale)),
      height: Math.max(1, Math.round(naturalHeight * scale)),
    };
  }
  if (keepAspect) {
    const w = targetWidth > 0 ? targetWidth : naturalWidth;
    const ratio = w / naturalWidth;
    return { width: Math.round(w), height: Math.max(1, Math.round(naturalHeight * ratio)) };
  }
  return {
    width: Math.max(1, Math.round(targetWidth > 0 ? targetWidth : naturalWidth)),
    height: Math.max(1, Math.round(targetHeight > 0 ? targetHeight : naturalHeight)),
  };
}
