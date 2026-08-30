import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const size = 512;
const raw = Buffer.alloc((size * 4 + 1) * size);
const rgba = (x, y, color) => {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
};
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const edge = 112;
    const corner = (x < edge && y < edge && (x - edge) ** 2 + (y - edge) ** 2 > edge ** 2)
      || (x >= size - edge && y < edge && (x - size + edge) ** 2 + (y - edge) ** 2 > edge ** 2)
      || (x < edge && y >= size - edge && (x - edge) ** 2 + (y - size + edge) ** 2 > edge ** 2)
      || (x >= size - edge && y >= size - edge && (x - size + edge) ** 2 + (y - size + edge) ** 2 > edge ** 2);
    const base = corner ? [0, 0, 0, 0] : [23, 22, 26, 255];
    const l = x >= 120 && x < 198 && y >= 112 && y < 400 && (y < 332 || x < 392);
    const accent = y >= 77 && y < 95 && x >= 98 && x < 220;
    rgba(x, y, accent ? [224, 138, 114, 255] : l ? [102, 203, 186, 255] : base);
  }
}

const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
mkdirSync("apps/desktop/src-tauri/icons", { recursive: true });
writeFileSync("apps/desktop/src-tauri/icons/icon.png", png);
console.log("ICON PASS");
