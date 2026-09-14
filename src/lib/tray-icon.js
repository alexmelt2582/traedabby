/**
 * Builds the tray icon and the desktop shortcut icon without pulling in any
 * native or third-party image dependency: the ICO container is assembled byte
 * by byte from a DIB (32bpp BGRA plus an AND mask), which every supported
 * Windows version renders correctly.
 *
 * The mark is two overlapping rounded squares, standing for the multi-account
 * corner of the product.
 */

const ICO_HEADER_BYTES = 6;
const ICO_DIRECTORY_BYTES = 16;
const BITMAPINFOHEADER_BYTES = 40;

const BACK_SQUARE = { r: 0x1d, g: 0x9e, b: 0x75, a: 0xff };
const FRONT_SQUARE = { r: 0x9f, g: 0xe1, b: 0xcb, a: 0xff };
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function roundedRectDistance(x, y, box, radius) {
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const halfWidth = (box.right - box.left) / 2;
  const halfHeight = (box.bottom - box.top) / 2;
  const dx = Math.abs(x - centerX) - (halfWidth - radius);
  const dy = Math.abs(y - centerY) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

export function trayIconPixel(x, y, size) {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`invalid icon size: ${size}`);
  if (x < 0 || y < 0 || x >= size || y >= size) return TRANSPARENT;
  const scale = size / 32;
  const back = {
    left: 2 * scale,
    right: 19 * scale,
    top: 5 * scale,
    bottom: 22 * scale,
  };
  const front = {
    left: 12 * scale,
    right: 29 * scale,
    top: 10 * scale,
    bottom: 27 * scale,
  };
  if (roundedRectDistance(x + 0.5, y + 0.5, front, 3.5 * scale) <= 0) return FRONT_SQUARE;
  if (roundedRectDistance(x + 0.5, y + 0.5, back, 3.5 * scale) <= 0) return BACK_SQUARE;
  return TRANSPARENT;
}

/** Rows are stored bottom-up, which is what the DIB format expects. */
function buildXorBitmap(size) {
  const bitmap = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const pixel = trayIconPixel(col, size - 1 - row, size);
      const offset = (row * size + col) * 4;
      bitmap[offset] = pixel.b;
      bitmap[offset + 1] = pixel.g;
      bitmap[offset + 2] = pixel.r;
      bitmap[offset + 3] = pixel.a;
    }
  }
  return bitmap;
}

function buildBitmapInfoHeader(size) {
  const header = Buffer.alloc(BITMAPINFOHEADER_BYTES);
  header.writeUInt32LE(BITMAPINFOHEADER_BYTES, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  return header;
}

/**
 * The AND mask is all zero, so every pixel keeps the alpha from the XOR bitmap.
 * Each mask row is padded to a 4-byte boundary.
 */
function buildAndMask(size) {
  const rowBytes = Math.ceil(size / 32) * 4;
  return Buffer.alloc(rowBytes * size);
}

export function buildTrayIco({ size = 32 } = {}) {
  if (!Number.isInteger(size) || size < 16 || size > 256) {
    throw new Error(`unsupported icon size: ${size}`);
  }
  const image = Buffer.concat([
    buildBitmapInfoHeader(size),
    buildXorBitmap(size),
    buildAndMask(size),
  ]);

  const header = Buffer.alloc(ICO_HEADER_BYTES + ICO_DIRECTORY_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(ICO_HEADER_BYTES + ICO_DIRECTORY_BYTES, 18);

  return Buffer.concat([header, image]);
}

export function trayIconExpectations(size = 32) {
  const xorBytes = size * size * 4;
  const andBytes = Math.ceil(size / 32) * 4 * size;
  const imageBytes = BITMAPINFOHEADER_BYTES + xorBytes + andBytes;
  return {
    xorBytes,
    andBytes,
    imageBytes,
    imageOffset: ICO_HEADER_BYTES + ICO_DIRECTORY_BYTES,
    totalBytes: ICO_HEADER_BYTES + ICO_DIRECTORY_BYTES + imageBytes,
  };
}
