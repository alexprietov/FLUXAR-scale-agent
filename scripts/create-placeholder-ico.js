/**
 * create-placeholder-ico.js
 *
 * Genera assets/icon.ico multiresolución (16/32/48/64/128/256 px) y
 * assets/tray-icon.png (32x32) para FLUXAR Scale Agent.
 *
 * ESTRATEGIA SEGURA:
 *   - Si assets/icon.ico ya existe Y contiene un frame >=256x256, NO lo sobreescribe.
 *   - Si assets/icon.ico no existe o es un placeholder pequeño (<256), lo genera.
 *   - Si assets/tray-icon.png no existe o es <=4 bytes, lo genera.
 *
 * Esto garantiza que un icon.ico válido versionado en el repo nunca sea
 * reemplazado por un placeholder durante GitHub Actions.
 *
 * Sin dependencias externas — solo Node.js built-ins.
 *
 * Uso:
 *   node scripts/create-placeholder-ico.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// ─── Helpers ICO ──────────────────────────────────────────────────────────────

/**
 * Lee el ICO en icoPath y devuelve la dimensión máxima encontrada.
 * Devuelve 0 si el archivo no existe o no es un ICO válido.
 */
function icoMaxDimension(icoPath) {
  try {
    const buf = fs.readFileSync(icoPath);
    if (buf.length < 6) return 0;
    const reserved = buf.readUInt16LE(0);
    const type     = buf.readUInt16LE(2);
    const count    = buf.readUInt16LE(4);
    if (reserved !== 0 || type !== 1 || count === 0) return 0;
    let maxDim = 0;
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16;
      if (off + 16 > buf.length) break;
      const w = buf.readUInt8(off);
      const h = buf.readUInt8(off + 1);
      const actualW = w === 0 ? 256 : w;
      const actualH = h === 0 ? 256 : h;
      maxDim = Math.max(maxDim, actualW, actualH);
    }
    return maxDim;
  } catch (_) {
    return 0;
  }
}

// ─── Helpers PNG (stdlib zlib) ────────────────────────────────────────────────

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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * Genera un PNG RGBA de `size`x`size` con un hexágono verde FLUXAR y letra F blanca.
 * Usa zlib.deflateRawSync (disponible en Node.js built-in).
 */
function renderIconPng(size) {
  // Paleta
  const BG   = [16, 185, 129, 255];   // #10b981
  const DARK = [11, 130, 90,  255];   // borde
  const WHT  = [255, 255, 255, 255];
  const TRP  = [0,   0,   0,   0  ];

  const pixels = new Array(size * size).fill(null).map(() => [...TRP]);

  const cx = size / 2;
  const cy = size / 2;
  const pad = size * 0.06;
  const hexR = size / 2 - pad;

  // Hexágono pointy-top
  function inHex(x, y, r) {
    const dx = x - cx, dy = y - cy;
    const q  = (2 / 3 * dx) / r;
    const r2 = (-1 / 3 * dx + Math.sqrt(3) / 3 * dy) / r;
    const s  = -q - r2;
    return Math.max(Math.abs(q), Math.abs(r2), Math.abs(s)) <= 1.0;
  }

  function blend(dst, src) {
    const a = src[3] / 255;
    return [
      Math.round(src[0] * a + dst[0] * (1 - a)),
      Math.round(src[1] * a + dst[1] * (1 - a)),
      Math.round(src[2] * a + dst[2] * (1 - a)),
      Math.min(255, dst[3] + src[3]),
    ];
  }

  function setPixel(x, y, color) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    pixels[y * size + x] = blend(pixels[y * size + x], color);
  }

  // Dibujar hexágono
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inHex(x, y, hexR + 1)) setPixel(x, y, DARK);
      if (inHex(x, y, hexR))     setPixel(x, y, BG);
    }
  }

  // Letra F
  const stroke = Math.max(1, Math.floor(size / 15));
  const fh = Math.floor(size * 0.52);
  const fw = Math.floor(fh * 0.55);
  const x0 = Math.floor(cx - fw / 2);
  const y0 = Math.floor(cy - fh / 2);

  // Trazo vertical
  for (let y = y0; y < y0 + fh; y++)
    for (let x = x0; x < x0 + stroke; x++) setPixel(x, y, WHT);
  // Trazo superior
  for (let y = y0; y < y0 + stroke; y++)
    for (let x = x0; x < x0 + fw; x++) setPixel(x, y, WHT);
  // Trazo medio
  const midY = y0 + Math.floor(fh * 0.45);
  const midW = Math.floor(fw * 0.80);
  for (let y = midY; y < midY + stroke; y++)
    for (let x = x0; x < x0 + midW; x++) setPixel(x, y, WHT);

  // Construir raw scanlines RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter=None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixels[y * size + x];
      const base = y * (1 + size * 4) + 1 + x * 4;
      raw[base]     = r;
      raw[base + 1] = g;
      raw[base + 2] = b;
      raw[base + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8,  8);  // bit depth
  ihdr.writeUInt8(6,  9);  // color type RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Construir ICO multiresolución ────────────────────────────────────────────

function buildMultiIco(sizes) {
  const frames = sizes.map(s => renderIconPng(s));

  // ICONDIR (6 bytes)
  const icondir = Buffer.alloc(6);
  icondir.writeUInt16LE(0, 0);
  icondir.writeUInt16LE(1, 2);
  icondir.writeUInt16LE(sizes.length, 4);

  // Directory entries (16 bytes cada uno)
  const headerSize = 6 + 16 * sizes.length;
  const entries = [];
  let dataOffset = headerSize;
  for (let i = 0; i < sizes.length; i++) {
    const s   = sizes[i];
    const png = frames[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s === 256 ? 0 : s, 0);
    entry.writeUInt8(s === 256 ? 0 : s, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1,  4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(dataOffset,  12);
    entries.push(entry);
    dataOffset += png.length;
  }

  return Buffer.concat([icondir, ...entries, ...frames]);
}

// ─── Generar icon.ico si es necesario ────────────────────────────────────────

const icoPath = path.join(assetsDir, 'icon.ico');
const existingMaxDim = icoMaxDimension(icoPath);

if (existingMaxDim >= 256) {
  console.log(`✅ assets/icon.ico ya es válido (max ${existingMaxDim}x${existingMaxDim}) — no se sobreescribe.`);
} else {
  const SIZES = [16, 32, 48, 64, 128, 256];
  const icoBuffer = buildMultiIco(SIZES);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`✅ assets/icon.ico generado (${SIZES.join('/')} px, ${icoBuffer.length} bytes)`);
}

// ─── Generar tray-icon.png si es necesario ────────────────────────────────────

const trayPath = path.join(assetsDir, 'tray-icon.png');
const trayExists = fs.existsSync(trayPath);
const traySize   = trayExists ? fs.statSync(trayPath).size : 0;

if (trayExists && traySize > 100) {
  console.log(`✅ assets/tray-icon.png ya existe (${traySize} bytes) — no se sobreescribe.`);
} else {
  const trayPng = renderIconPng(32);
  fs.writeFileSync(trayPath, trayPng);
  console.log(`✅ assets/tray-icon.png generado (32x32, ${trayPng.length} bytes)`);
}

// ─── Verificación final ───────────────────────────────────────────────────────

const finalMaxDim = icoMaxDimension(icoPath);
const pass = finalMaxDim >= 256;
console.log('');
console.log(`Validación electron-builder (icon.ico >=256x256): ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
if (!pass) {
  console.error('ERROR: icon.ico no cumple el requisito mínimo de 256x256');
  process.exit(1);
}
