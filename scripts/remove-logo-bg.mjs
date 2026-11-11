// Deterministic color-to-alpha for the Olivia storefront logo (1.13.1, #332).
//
// The committed fallback logo carried a baked flat background (cream). This
// script converts that background color to REAL transparency — same artwork,
// no invented pixels: every pixel's alpha comes from its distance to the
// dominant background color with distance thresholds, and antialiased edges
// are unblended so they keep their hue.
//
// Zero dependencies: a minimal PNG codec (8-bit RGB/RGBA, no interlace) on
// top of node:zlib. Fails closed on anything it does not understand.
//
// Usage: node scripts/remove-logo-bg.mjs <input.png> <output.png> [tLow=40] [tHigh=150]

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

// ── PNG decode (8-bit, colorType 2 RGB / 6 RGBA, non-interlaced) ──────────

function parsePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const chunks = [];
  let off = 8;
  while (off < buffer.length) {
    const length = buffer.readUInt32BE(off);
    const type = buffer.toString("ascii", off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + length);
    chunks.push({ type, data });
    off += 12 + length;
    if (type === "IEND") break;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("missing IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 2 ? 3 : 4;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));

  const stride = width * channels;
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
        case 0: value = byte; break;               // None
        case 1: value = byte + left; break;        // Sub
        case 2: value = byte + up; break;          // Up
        case 3: value = byte + ((left + up) >> 1); break; // Average
        case 4: {                                  // Paeth
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

// ── PNG encode (8-bit RGBA, filter 0) ──────────────────────────────────────

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
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
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
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colorType: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Color-to-alpha ─────────────────────────────────────────────────────────

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/remove-logo-bg.mjs <input.png> <output.png>");
  process.exit(1);
}

const png = parsePng(readFileSync(input));
if (png.channels !== 3) throw new Error("input already has an alpha channel; nothing to do");

// The background is the DOMINANT color of the image (a flat backdrop beats
// artwork by area). A slightly darker frame tone nearby also belongs to the
// backdrop — the distance thresholds below absorb it.
const counts = new Map();
for (let p = 0; p < png.width * png.height; p++) {
  const i = p * 3;
  const key = (png.pixels[i] << 16) | (png.pixels[i + 1] << 8) | png.pixels[i + 2];
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
const bg = [(dominant >> 16) & 0xff, (dominant >> 8) & 0xff, dominant & 0xff];

const rgba = Buffer.alloc(png.width * png.height * 4);
let transparent = 0;
let kept = 0;
// Flat-artwork thresholds (color distance to the background): at or below
// T_LOW the pixel IS background; at or above T_HIGH it IS artwork and keeps
// its original color untouched. Between them (antialiased edges) the alpha
// interpolates and the color is unblended so it keeps its hue.
const T_LOW = Number(process.argv[4] ?? 40);
const T_HIGH = Number(process.argv[5] ?? 150);
for (let p = 0; p < png.width * png.height; p++) {
  const i = p * 3;
  const o = p * 4;
  const rgb = [png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]];
  const distance = Math.sqrt(
    (rgb[0] - bg[0]) ** 2 + (rgb[1] - bg[1]) ** 2 + (rgb[2] - bg[2]) ** 2
  );
  if (distance <= T_LOW) {
    transparent++;
    // Keep the backdrop RGB under alpha 0 — naive flatteners then show the
    // original look instead of black; alpha-aware renderers ignore it.
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 0;
  } else if (distance >= T_HIGH) {
    kept++;
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
  } else {
    const a = (distance - T_LOW) / (T_HIGH - T_LOW);
    rgba[o] = Math.max(0, Math.min(255, Math.round(bg[0] + (rgb[0] - bg[0]) / a)));
    rgba[o + 1] = Math.max(0, Math.min(255, Math.round(bg[1] + (rgb[1] - bg[1]) / a)));
    rgba[o + 2] = Math.max(0, Math.min(255, Math.round(bg[2] + (rgb[2] - bg[2]) / a)));
    rgba[o + 3] = Math.round(a * 255);
  }
}

writeFileSync(output, writePngRgba(png.width, png.height, rgba));

const total = png.width * png.height;
const cornerCheck = ((x, y) => rgba[((y * png.width + x) * 4) + 3]);
const corners = [
  cornerCheck(0, 0), cornerCheck(png.width - 1, 0),
  cornerCheck(0, png.height - 1), cornerCheck(png.width - 1, png.height - 1),
];
console.log(`background (dominant color): rgb(${bg.join(",")})`);
console.log(`pixels: ${total} · fully transparent: ${transparent} (${(transparent / total * 100).toFixed(1)}%) · opaque artwork: ${kept} (${(kept / total * 100).toFixed(1)}%)`);
console.log(`corner alphas (must be 0): ${corners.join(", ")}`);
if (corners.some((alpha) => alpha !== 0)) {
  console.error("FAIL: corners are not transparent — background sample was wrong");
  process.exit(1);
}
console.log(`wrote ${output} (${png.width}x${png.height}, RGBA)`);
