// Genera le icone PNG (casa bianca con martelletto su fondo blu) senza dipendenze.
import fs from 'node:fs';
import zlib from 'node:zlib';

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const BLUE = [29, 78, 216], WHITE = [255, 255, 255], GOLD = [251, 191, 36];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let c = BLUE;
    // tetto (triangolo)
    const roof = v >= 0.22 && v <= 0.5 && Math.abs(u - 0.5) <= (v - 0.22) * 1.25;
    // corpo casa
    const body = u >= 0.27 && u <= 0.73 && v >= 0.48 && v <= 0.8;
    // porta
    const door = u >= 0.44 && u <= 0.56 && v >= 0.62 && v <= 0.8;
    if (roof || body) c = WHITE;
    if (door) c = BLUE;
    // martelletto d'asta (in basso a destra)
    const head = u >= 0.62 && u <= 0.86 && v >= 0.6 && v <= 0.7;
    const handle = Math.abs((u - 0.74) - (v - 0.7) * -0.0) <= 0.025 && v >= 0.7 && v <= 0.88;
    if (head || handle) c = GOLD;
    set(x, y, c);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync('site/icons', { recursive: true });
fs.writeFileSync('site/icons/icon-192.png', png(192));
fs.writeFileSync('site/icons/icon-512.png', png(512));
fs.writeFileSync('site/icons/apple-touch-icon.png', png(180));
console.log('icone create');
