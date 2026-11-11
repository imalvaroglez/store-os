// Normalize the official Olivia logo for the storefront (1.13.1, #332).
//
// Takes the designer's RGBA PNG (any size), crops to the alpha bounding box
// and downsamples with a box filter to a max edge (default 600px — the same
// ceiling the site editor applies to uploaded logos). Deterministic: no
// format conversion, no color shifts, only geometry (crop) and area-averaged
// downscale. Zero dependencies, same minimal PNG codec as remove-logo-bg.mjs.
//
// Usage: node scripts/normalize-logo.mjs <input.png> <output.png> [maxEdge=600]

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

function parsePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const chunks = [];
  let off = 8;
  while (off < buffer.length) {
    const length = buffer.readUInt32BE(off);
    const type = buffer.toString("ascii", off + 4, off + 8);
    chunks.push({ type, data: buffer.subarray(off + 8, off + 8 + length) });
    off += 12 + length;
    if (type === "IEND") break;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const pixels = Buffer.alloc(width * height * channels);
  let inOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inOff++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[inOff++];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowStart - stride + x - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = byte; break;
        case 1: value = byte + left; break;
        case 2: value = byte + up; break;
        case 3: value = byte + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = byte + pred; break;
        }
        default: throw new Error(`unknown filter ${filter}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(...buffers) {
  let c = 0xffffffff;
  for (const buffer of buffers) for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePngRgba(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const [input, output, maxEdgeArg] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/normalize-logo.mjs <input.png> <output.png> [maxEdge=600]");
  process.exit(1);
}
const maxEdge = Number(maxEdgeArg ?? 600);
const png = parsePng(readFileSync(input));
if (png.channels !== 4) throw new Error("input has no alpha channel");

// 1. Crop to the alpha bounding box (trim transparent margins).
let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    if (png.pixels[(y * png.width + x) * 4 + 3] > 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error("fully transparent image");
const cropW = maxX - minX + 1;
const cropH = maxY - minY + 1;

// 2. Box-filter downscale (area average, straight alpha) to maxEdge.
const scale = Math.min(1, maxEdge / Math.max(cropW, cropH));
const outW = Math.max(1, Math.round(cropW * scale));
const outH = Math.max(1, Math.round(cropH * scale));
const out = Buffer.alloc(outW * outH * 4);
for (let y = 0; y < outH; y++) {
  // Crop-relative box [ry0, ry1)×[rx0, rx1), THEN offset by the crop origin —
  // offsetting twice (minY inside and outside the max) was the bug that
  // smeared the sample box across transparent margins.
  const ry0 = Math.floor((y * cropH) / outH);
  const ry1 = Math.max(ry0 + 1, Math.floor(((y + 1) * cropH) / outH));
  const sy0 = minY + ry0;
  const sy1 = minY + ry1;
  for (let x = 0; x < outW; x++) {
    const rx0 = Math.floor((x * cropW) / outW);
    const rx1 = Math.max(rx0 + 1, Math.floor(((x + 1) * cropW) / outW));
    const sx0 = minX + rx0;
    const sx1 = minX + rx1;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = sy0; sy < sy1; sy++) {
      for (let sx = sx0; sx < sx1; sx++) {
        const i = (sy * png.width + sx) * 4;
        r += png.pixels[i]; g += png.pixels[i + 1]; b += png.pixels[i + 2]; a += png.pixels[i + 3]; n++;
      }
    }
    const o = (y * outW + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
  }
}
writeFileSync(output, writePngRgba(outW, outH, out));
console.log(`cropped ${png.width}x${png.height} → ${cropW}x${cropH}, wrote ${outW}x${outH} (${(readFileSync(output).length / 1024).toFixed(0)} KB)`);
