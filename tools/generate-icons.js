// One-off generator for the PWA icons: a rounded indigo tile with a white
// checkmark, written as PNGs using only Node built-ins (zlib for deflate+crc).
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const BG = [91, 108, 249]; // #5b6cf9
const OUT = path.join(__dirname, "..", "public", "icons");

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function writePng(file, size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log("wrote", file, png.length, "bytes");
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// coverage 0..1 for smooth (anti-aliased) edges
function smooth(dist, edge) {
  return Math.max(0, Math.min(1, edge - dist + 0.5));
}

function render(size, { rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512; // design coordinates are on a 512 grid
  const radius = 110 * s;
  // checkmark polyline points (512 grid), sized to leave maskable-safe padding
  const A = [148 * s, 268 * s], B = [226 * s, 346 * s], C = [372 * s, 184 * s];
  const stroke = 33 * s;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;

      // rounded-rect alpha
      let alpha = 1;
      if (rounded) {
        const qx = Math.max(Math.abs(cx - size / 2) - (size / 2 - radius), 0);
        const qy = Math.max(Math.abs(cy - size / 2) - (size / 2 - radius), 0);
        alpha = smooth(Math.hypot(qx, qy), radius);
      }

      // white check over background
      const d = Math.min(
        distToSegment(cx, cy, A[0], A[1], B[0], B[1]),
        distToSegment(cx, cy, B[0], B[1], C[0], C[1])
      );
      const ink = smooth(d, stroke);
      const i = (y * size + x) * 4;
      px[i] = Math.round(BG[0] + (255 - BG[0]) * ink);
      px[i + 1] = Math.round(BG[1] + (255 - BG[1]) * ink);
      px[i + 2] = Math.round(BG[2] + (255 - BG[2]) * ink);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

fs.mkdirSync(OUT, { recursive: true });
writePng(path.join(OUT, "icon-512.png"), 512, render(512, { rounded: true }));
writePng(path.join(OUT, "icon-192.png"), 192, render(192, { rounded: true }));
// Apple touch icons must be opaque full-bleed squares; iOS rounds them itself.
writePng(path.join(OUT, "apple-touch-icon.png"), 180, render(180, { rounded: false }));
