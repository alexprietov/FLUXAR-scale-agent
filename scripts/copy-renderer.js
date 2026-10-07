// Copia index.html y renderer.js compilado al directorio dist/renderer/
//
// Con rootDir="src" en tsconfig.renderer.json, tsc emite:
//   dist/renderer-ts/renderer/renderer.js   (desde src/renderer/renderer.ts)
//   dist/renderer-ts/shared/types.js        (desde src/shared/types.ts)
//
// Electron carga dist/renderer/index.html, que a su vez carga ./renderer.js
// Por tanto copiamos ambos archivos a dist/renderer/.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const destDir = path.join(root, 'dist/renderer');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

// 1. Copiar index.html
const htmlSrc = path.join(root, 'src/renderer/index.html');
const htmlDest = path.join(destDir, 'index.html');
fs.copyFileSync(htmlSrc, htmlDest);
console.log('Copiado: src/renderer/index.html -> dist/renderer/index.html');

// 2. Copiar renderer.js compilado
// Con rootDir="src", tsc emite src/renderer/renderer.ts -> dist/renderer-ts/renderer/renderer.js
const jsSrc = path.join(root, 'dist/renderer-ts/renderer/renderer.js');
const jsDest = path.join(destDir, 'renderer.js');
fs.copyFileSync(jsSrc, jsDest);
console.log('Copiado: dist/renderer-ts/renderer/renderer.js -> dist/renderer/renderer.js');
