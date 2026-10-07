/**
 * generate-icons.js
 *
 * Genera assets/icon.ico y assets/tray-icon.png a partir de assets/icon.png.
 *
 * Uso:
 *   node scripts/generate-icons.js
 *
 * Requiere: npm install --save-dev @electron/rebuild png2icons
 * O alternativa sin dependencias extra: usar ImageMagick en Windows/Linux.
 *
 * Si no tienes png2icons, usa el método manual descrito en BUILD-WINDOWS.md.
 */

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
const iconPng = path.join(assetsDir, 'icon.png');
const iconIco = path.join(assetsDir, 'icon.ico');
const trayPng = path.join(assetsDir, 'tray-icon.png');

if (!fs.existsSync(iconPng)) {
  console.error('ERROR: assets/icon.png no encontrado.');
  console.error('Coloca tu ícono PNG (256x256 o mayor) en assets/icon.png y vuelve a ejecutar.');
  process.exit(1);
}

// Intentar usar png2icons si está disponible
try {
  const png2icons = require('png2icons');
  const input = fs.readFileSync(iconPng);

  // Generar ICO (multi-tamaño: 16, 32, 48, 64, 128, 256)
  const icoBuffer = png2icons.createICO(input, png2icons.BILINEAR, 0, true, true);
  if (icoBuffer) {
    fs.writeFileSync(iconIco, icoBuffer);
    console.log('✅ assets/icon.ico generado');
  } else {
    console.error('ERROR: png2icons no pudo generar el ICO');
    process.exit(1);
  }

  // Copiar como tray-icon.png (16x16 o 32x32 recomendado para tray)
  fs.copyFileSync(iconPng, trayPng);
  console.log('✅ assets/tray-icon.png copiado');

} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.log('png2icons no instalado. Usando método alternativo...');
    console.log('');
    console.log('OPCIÓN A — Instalar png2icons:');
    console.log('  npm install --save-dev png2icons');
    console.log('  node scripts/generate-icons.js');
    console.log('');
    console.log('OPCIÓN B — Convertir manualmente:');
    console.log('  1. Ve a https://convertico.com o https://icoconvert.com');
    console.log('  2. Sube assets/icon.png');
    console.log('  3. Descarga el ICO y guárdalo como assets/icon.ico');
    console.log('  4. Copia assets/icon.png como assets/tray-icon.png');
    console.log('');
    console.log('OPCIÓN C — ImageMagick (si está instalado):');
    console.log('  magick convert assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico');
    console.log('  copy assets\\icon.png assets\\tray-icon.png');
    process.exit(1);
  }
  throw e;
}
