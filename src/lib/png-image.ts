import { deflateSync, inflateSync } from "node:zlib";

/**
 * Minimal, dependency-free PNG support for the style subsystem.
 *
 * The brand palette extraction works on decoded RGBA pixels, so the repo
 * carries its own decoder instead of an image library. Scope is deliberate:
 * bit depth 8, color types 0 (grayscale), 2 (RGB), and 6 (RGBA),
 * non-interlaced — everything the committed brand assets use. Anything
 * outside that scope fails loudly with a named reason rather than guessing.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** Pixel data, row-major, 4 bytes (RGBA) per pixel. */
  pixels: Uint8Array;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(12 + data.length);
  writeUint32(frame, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    frame[4 + i] = type.charCodeAt(i);
  }
  frame.set(data, 8);
  writeUint32(frame, 8 + data.length, crc32(frame.subarray(4, 8 + data.length)));
  return frame;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

class PngFormatError extends Error {}

function requireFormat(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new PngFormatError(reason);
}

/** Channels per pixel for the supported color types. */
function channelCount(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // grayscale
    case 2:
      return 3; // RGB
    case 6:
      return 4; // RGBA
    default:
      throw new PngFormatError(
        `Unsupported PNG color type ${colorType}; only 0 (grayscale), 2 (RGB), and 6 (RGBA) are supported.`,
      );
  }
}

/**
 * Reverse a filtered scanline buffer back into raw channel data.
 * Exported for direct testing of the four PNG filter reconstructions.
 */
export function unfilterRows(
  filtered: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array(stride * height);
  const bytesPerRow = stride + 1;
  requireFormat(
    filtered.length === bytesPerRow * height,
    "PNG pixel data does not match the declared dimensions.",
  );

  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * bytesPerRow]!;
    const lineStart = row * bytesPerRow + 1;
    const previousStart = (row - 1) * bytesPerRow + 1;
    for (let x = 0; x < stride; x += 1) {
      const xSrc = filtered[lineStart + x]!;
      const left = x >= channels ? raw[row * stride + x - channels]! : 0;
      const up = row > 0 ? raw[(row - 1) * stride + x]! : 0;
      const upLeft =
        row > 0 && x >= channels
          ? raw[(row - 1) * stride + x - channels]!
          : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = xSrc;
          break;
        case 1: // Sub
          value = xSrc + left;
          break;
        case 2: // Up
          value = xSrc + up;
          break;
        case 3: // Average
          value = xSrc + Math.floor((left + up) / 2);
          break;
        case 4: // Paeth
          {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            const predictor =
              pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
            value = xSrc + predictor;
          }
          break;
        default:
          throw new PngFormatError(
            `Unsupported PNG scanline filter ${filter}.`,
          );
      }
      raw[row * stride + x] = value & 0xff;
    }
  }
  return raw;
}

/** Decode a PNG buffer into an RGBA image. Throws on out-of-scope files. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  for (const [index, expected] of pngSignature.entries()) {
    requireFormat(
      bytes[index] === expected,
      "The file is not a PNG image.",
    );
  }

  let chunkOffset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let idat: Uint8Array[] = [];

  while (chunkOffset + 8 <= bytes.length) {
    const dataLength = readUint32(bytes, chunkOffset);
    const type = String.fromCharCode(
      bytes[chunkOffset + 4]!,
      bytes[chunkOffset + 5]!,
      bytes[chunkOffset + 6]!,
      bytes[chunkOffset + 7]!,
    );
    const dataStart = chunkOffset + 8;
    const data = bytes.subarray(dataStart, dataStart + dataLength);
    requireFormat(
      data.length === dataLength,
      "The PNG chunk is truncated.",
    );

    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      const bitDepth = data[8]!;
      colorType = data[9]!;
      const compression = data[10]!;
      const filterMethod = data[11]!;
      const interlace = data[12]!;
      requireFormat(width > 0 && height > 0, "The PNG has no pixels.");
      requireFormat(bitDepth === 8, "Only 8-bit PNG images are supported.");
      channelCount(colorType); // validates the color type early
      requireFormat(
        compression === 0 && filterMethod === 0,
        "Only standard PNG compression is supported.",
      );
      requireFormat(
        interlace === 0,
        "Interlaced PNG images are not supported.",
      );
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    chunkOffset = dataStart + dataLength + 4; // + CRC
  }

  requireFormat(width > 0, "The PNG has no IHDR header.");
  requireFormat(idat.length > 0, "The PNG has no image data.");

  const channels = channelCount(colorType);
  let filtered: Uint8Array;
  try {
    filtered = inflateSync(
      idat.length === 1 ? idat[0]! : Buffer.concat(idat),
    );
  } catch (cause) {
    throw new PngFormatError("The PNG image data is corrupt.", {
      cause,
    });
  }

  const raw = unfilterRows(filtered, width, height, channels);
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (colorType === 6) {
      pixels.set(raw.subarray(i * 4, i * 4 + 4), i * 4);
    } else if (colorType === 2) {
      pixels[i * 4] = raw[i * 3]!;
      pixels[i * 4 + 1] = raw[i * 3 + 1]!;
      pixels[i * 4 + 2] = raw[i * 3 + 2]!;
      pixels[i * 4 + 3] = 255;
    } else {
      const gray = raw[i]!;
      pixels[i * 4] = gray;
      pixels[i * 4 + 1] = gray;
      pixels[i * 4 + 2] = gray;
      pixels[i * 4 + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** Encode an RGBA image as a minimal 8-bit RGBA PNG. */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, pixels } = image;
  requireFormat(
    pixels.length === width * height * 4,
    "The pixel buffer does not match the declared dimensions.",
  );

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  // Filter type 0 (None) per scanline keeps the encoder honest and the
  // output deterministic; size is irrelevant for these small assets.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));

  const parts = [
    new Uint8Array(pngSignature),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
