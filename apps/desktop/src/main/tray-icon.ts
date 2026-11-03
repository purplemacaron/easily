import { crc32, deflateSync } from "node:zlib";

/**
 * Generates the tray icons at runtime (no binary assets in the repo): a monochrome ring, and the
 * same ring with a filled centre while something is running (S-001). 32x32 RGBA PNG; Windows and
 * Linux scale it down, macOS uses it as a template image.
 */
const SIZE = 32;

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function trayIconPng(running: boolean): Buffer {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  const c = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - c, y - c);
      const ring = d <= 13.5 && d >= 10;
      const dot = running && d <= 6.5;
      const edge = ring ? Math.min(1, 13.5 - d + 0.5, d - 10 + 0.5) : dot ? Math.min(1, 6.5 - d + 0.5) : 0;
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      raw[o] = 17; // #111111, the DESIGN.md ink colour
      raw[o + 1] = 17;
      raw[o + 2] = 17;
      raw[o + 3] = Math.round(Math.max(0, edge) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
