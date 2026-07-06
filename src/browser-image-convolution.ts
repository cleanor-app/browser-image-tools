// Hand-rolled image convolution helpers for sharpening. Operates on plain
// pixel buffers so the math is testable and free of DOM assumptions; the caller
// supplies width/height/data from an ImageData object.

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function clamp(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}

function indexOf(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

/**
 * Separable 3x3 Gaussian blur with kernel [1, 2, 1] / 4 on each axis. Edges use
 * clamped (nearest-pixel) sampling. Alpha is preserved.
 */
export function gaussianBlur3x3(src: PixelBuffer): PixelBuffer {
  const { width, height, data } = src;
  const temp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);

  // Horizontal pass.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      const centerIndex = indexOf(x, y, width);
      for (let c = 0; c < 3; c += 1) {
        const value =
          data[indexOf(left, y, width) + c] +
          2 * data[centerIndex + c] +
          data[indexOf(right, y, width) + c];
        temp[centerIndex + c] = value / 4;
      }
      temp[centerIndex + 3] = data[centerIndex + 3];
    }
  }

  // Vertical pass.
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - 1);
    const bottom = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const centerIndex = indexOf(x, y, width);
      for (let c = 0; c < 3; c += 1) {
        const value =
          temp[indexOf(x, top, width) + c] +
          2 * temp[centerIndex + c] +
          temp[indexOf(x, bottom, width) + c];
        out[centerIndex + c] = value / 4;
      }
      out[centerIndex + 3] = temp[centerIndex + 3];
    }
  }

  return { width, height, data: out };
}

/**
 * Unsharp mask: out = original + amount * (original - blurred), clamped to
 * [0, 255] per channel. `amount` of 0 returns the original; typical values are
 * 0.2 to 3. `threshold` (0-255) skips small differences to avoid amplifying
 * noise. The returned buffer is a new Uint8ClampedArray; alpha is preserved.
 */
export function unsharpMask(src: PixelBuffer, amount: number, threshold = 0): PixelBuffer {
  const { width, height, data } = src;
  const strength = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (strength === 0) {
    return { width, height, data: new Uint8ClampedArray(data) };
  }
  const blurred = gaussianBlur3x3(src);
  const out = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const original = data[i + c];
      const diff = original - blurred.data[i + c];
      if (Math.abs(diff) < threshold) {
        out[i + c] = original;
      } else {
        out[i + c] = clamp(original + strength * diff);
      }
    }
    out[i + 3] = data[i + 3];
  }

  return { width, height, data: out };
}
