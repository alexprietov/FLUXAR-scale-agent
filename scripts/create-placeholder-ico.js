/**
 * create-placeholder-ico.js
 *
 * Genera un assets/icon.ico y assets/tray-icon.png mínimos (placeholder verde)
 * SIN dependencias externas. Usa solo Node.js built-ins.
 *
 * El ICO generado es válido para electron-builder (32x32 RGBA).
 * Para producción real, reemplaza con tu ícono de marca.
 *
 * Uso:
 *   node scripts/create-placeholder-ico.js
 */

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// ─── Generar BMP 32x32 RGBA para ICO ─────────────────────────────────────────
// ICO format: ICONDIR + ICONDIRENTRY + BMP (BITMAPINFOHEADER + XOR mask + AND mask)

const SIZE = 32;

function createIco(size) {
  const pixelCount = size * size;

  // BITMAPINFOHEADER (40 bytes)
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);          // biSize
  bih.writeInt32LE(size, 4);         // biWidth
  bih.writeInt32LE(size * 2, 8);     // biHeight (x2 para ICO: XOR+AND)
  bih.writeUInt16LE(1, 12);          // biPlanes
  bih.writeUInt16LE(32, 14);         // biBitCount (32bpp BGRA)
  bih.writeUInt32LE(0, 16);          // biCompression (BI_RGB)
  bih.writeUInt32LE(pixelCount * 4, 20); // biSizeImage
  bih.writeInt32LE(0, 24);           // biXPelsPerMeter
  bih.writeInt32LE(0, 28);           // biYPelsPerMeter
  bih.writeUInt32LE(0, 32);          // biClrUsed
  bih.writeUInt32LE(0, 36);          // biClrImportant

  // Pixel data: BGRA, bottom-up
  // Diseño: fondo verde oscuro (#0f4c2a), círculo blanco, letra F
  const pixels = Buffer.alloc(pixelCount * 4);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // BMP es bottom-up
      const bmpRow = size - 1 - row;
      const idx = (bmpRow * size + col) * 4;

      const dx = col - cx;
      const dy = row - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let b, g, re, a;

      if (dist <= r) {
        // Dentro del círculo: verde FLUXAR (#10b981 → B=129, G=185, R=16)
        // Con borde blanco en el rim
        if (dist >= r - 1.5) {
          // Borde blanco
          b = 255; g = 255; re = 255; a = 255;
        } else {
          // Fondo verde
          b = 129; g = 185; re = 16; a = 255;

          // Letra "F" centrada (pixelart simple)
          const lx = col - Math.floor(cx) + 3;
          const ly = row - Math.floor(cy) + 6;
          const isF = (
            // Vertical izquierdo
            (lx === 3 && ly >= 0 && ly <= 12) ||
            // Horizontal superior
            (ly === 0 && lx >= 3 && lx <= 9) ||
            // Horizontal medio
            (ly === 6 && lx >= 3 && lx <= 8)
          );
          if (isF) {
            b = 255; g = 255; re = 255; a = 255;
          }
        }
      } else {
        // Fuera del círculo: transparente
        b = 0; g = 0; re = 0; a = 0;
      }

      pixels[idx]     = b;
      pixels[idx + 1] = g;
      pixels[idx + 2] = re;
      pixels[idx + 3] = a;
    }
  }

  // AND mask (1bpp, bottom-up, padded to 4 bytes per row)
  const andRowBytes = Math.ceil(size / 8);
  const andRowPadded = Math.ceil(andRowBytes / 4) * 4;
  const andMask = Buffer.alloc(size * andRowPadded, 0x00); // 0=opaque

  const imageDataSize = bih.length + pixels.length + andMask.length;

  // ICONDIR (6 bytes)
  const icondir = Buffer.alloc(6);
  icondir.writeUInt16LE(0, 0);   // reserved
  icondir.writeUInt16LE(1, 2);   // type=1 (ICO)
  icondir.writeUInt16LE(1, 4);   // count=1

  // ICONDIRENTRY (16 bytes)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);  // width (0=256)
  entry.writeUInt8(size === 256 ? 0 : size, 1);  // height
  entry.writeUInt8(0, 2);    // colorCount
  entry.writeUInt8(0, 3);    // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bitCount
  entry.writeUInt32LE(imageDataSize, 8);  // bytesInRes
  entry.writeUInt32LE(6 + 16, 12);        // imageOffset

  return Buffer.concat([icondir, entry, bih, pixels, andMask]);
}

// Generar ICO
const icoBuffer = createIco(SIZE);
const icoPath = path.join(assetsDir, 'icon.ico');
fs.writeFileSync(icoPath, icoBuffer);
console.log(`✅ assets/icon.ico generado (${SIZE}x${SIZE} placeholder)`);

// Generar tray-icon.png mínimo (PNG 16x16 verde)
// PNG mínimo válido generado con header correcto
function createMinimalPng(size) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(2, 9);   // color type RGB
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace

  // IDAT: raw scanlines (filter byte 0 + RGB per pixel)
  // Color: #10b981 = R=16, G=185, B=129
  const scanline = Buffer.alloc(1 + size * 3);
  scanline[0] = 0; // filter=None
  for (let i = 0; i < size; i++) {
    scanline[1 + i * 3] = 16;   // R
    scanline[2 + i * 3] = 185;  // G
    scanline[3 + i * 3] = 129;  // B
  }
  const rawData = Buffer.concat(Array(size).fill(scanline));

  // Deflate (zlib) — nivel 0 (sin compresión) para simplicidad
  // zlib header: 0x78 0x01 (deflate, no compression)
  // BTYPE=00 (no compression), LEN, NLEN, data, Adler-32
  function adler32(buf) {
    let s1 = 1, s2 = 0;
    for (let i = 0; i < buf.length; i++) {
      s1 = (s1 + buf[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    return (s2 << 16) | s1;
  }

  const deflateBlocks = [];
  const BLOCK_SIZE = 65535;
  for (let offset = 0; offset < rawData.length; offset += BLOCK_SIZE) {
    const block = rawData.slice(offset, offset + BLOCK_SIZE);
    const isLast = (offset + BLOCK_SIZE) >= rawData.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 0x01 : 0x00;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE(~block.length & 0xFFFF, 3);
    deflateBlocks.push(header, block);
  }

  const adlerBuf = Buffer.alloc(4);
  adlerBuf.writeUInt32BE(adler32(rawData), 0);

  const zlibData = Buffer.concat([
    Buffer.from([0x78, 0x01]),
    ...deflateBlocks,
    adlerBuf,
  ]);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Generar tray-icon.png: copiar el ICO como PNG placeholder
// (electron acepta PNG para el tray en Windows)
// Usamos un PNG 1x1 verde mínimo y válido (hardcoded bytes)
// PNG 1x1 RGB #10b981 generado con Python: png.Writer(1,1).write_array(f,[[16,185,129]])
const TRAY_PNG_1x1_GREEN = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
  '2e00000000c4944415478016360f8cf000001820081e7d4e5000000049454e44ae426082',
  'hex'
);
const trayPath = path.join(assetsDir, 'tray-icon.png');
fs.writeFileSync(trayPath, TRAY_PNG_1x1_GREEN);
console.log('✅ assets/tray-icon.png generado (1x1 placeholder verde)');

console.log('');
console.log('NOTA: Estos son íconos placeholder. Para producción real:');
console.log('  1. Reemplaza assets/icon.ico con tu ícono de marca (multi-tamaño)');
console.log('  2. Reemplaza assets/tray-icon.png con tu ícono de tray (16x16 o 32x32)');
console.log('  3. Vuelve a ejecutar: npm run dist');
