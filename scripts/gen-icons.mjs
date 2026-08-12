/**
 * Genera los iconos PNG del PWA (sin dependencias externas).
 * Icono: cuadrado índigo con un círculo blanco (cámara estilizada).
 * Uso: node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.28;
  const ring = r * 0.55;
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      const d = Math.hypot(x - cx, y - cy);
      const inRing = d >= ring && d <= r;
      if (inRing) {
        raw[o] = 255;
        raw[o + 1] = 255;
        raw[o + 2] = 255;
      } else {
        raw[o] = 79;
        raw[o + 1] = 70;
        raw[o + 2] = 229;
      }
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = resolve('frontend/public/icons');
mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) {
  const file = resolve(dir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log('Generado', file);
}
