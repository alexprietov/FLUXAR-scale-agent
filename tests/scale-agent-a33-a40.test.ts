/**
 * A33–A40: Smoke tests de estructura de build + Prueba Local UI
 *
 * A33 — package.json.main apunta al archivo que realmente produce el build
 * A34 — main.ts carga renderer/index.html desde la ruta correcta post-build
 * A35 — main.ts carga preload/preload.js desde la ruta correcta post-build
 * A36 — pantalla no vinculada expone "Probar báscula localmente"
 * A37 — pantalla no vinculada expone "Vincular con FLUXAR"
 * A38 — prueba local genera 0 API calls (no llama fetch/http)
 * A39 — puede listar puertos sin enrollment (IPC LIST_PORTS no requiere token)
 * A40 — no existe COM4 hardcoded en runtime (renderer.ts, local-test-manager.ts)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readPkg(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function readMainTs(): string {
  return fs.readFileSync(path.join(ROOT, 'src/main/main.ts'), 'utf8');
}

function readRendererTs(): string {
  return fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.ts'), 'utf8');
}

function readLocalTestManagerTs(): string {
  return fs.readFileSync(path.join(ROOT, 'src/main/local-test-manager.ts'), 'utf8');
}

function readIndexHtml(): string {
  return fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
}

// ─── A33: package.json.main apunta al archivo real del build ─────────────────

describe('A33 — package.json.main vs build output', () => {
  it('package.json.main debe existir en dist/ después del build', () => {
    const pkg = readPkg();
    const mainField = pkg['main'] as string;
    expect(mainField, 'package.json debe tener campo "main"').toBeTruthy();

    const mainPath = path.join(ROOT, mainField);
    expect(
      fs.existsSync(mainPath),
      `package.json.main="${mainField}" → archivo no existe en dist/.\n` +
      `Ruta buscada: ${mainPath}\n` +
      `Esto significa que el build genera el JS en otra ruta. ` +
      `Verifica tsconfig.main.json rootDir y outDir.`
    ).toBe(true);
  });

  it('package.json.main debe ser un archivo .js', () => {
    const pkg = readPkg();
    const mainField = pkg['main'] as string;
    expect(mainField).toMatch(/\.js$/);
  });
});

// ─── A34: main.ts → renderer/index.html path correcto ────────────────────────

describe('A34 — main.ts renderer path', () => {
  it('el path de renderer en main.ts debe resolver a dist/renderer/index.html', () => {
    const mainTs = readMainTs();

    // Extraer el path relativo usado en loadFile
    const match = mainTs.match(/path\.join\(__dirname,\s*['"]([^'"]+index\.html)['"]\)/);
    expect(match, 'main.ts debe tener path.join(__dirname, "...index.html")').toBeTruthy();

    const relPath = match![1];

    // Simular __dirname = dist/main/main (con rootDir="src" en tsconfig.main.json)
    const simulatedDirname = path.join(ROOT, 'dist/main/main');
    const resolvedPath = path.resolve(simulatedDirname, relPath);
    const expectedPath = path.join(ROOT, 'dist/renderer/index.html');

    expect(
      resolvedPath,
      `main.ts usa path.join(__dirname, "${relPath}")\n` +
      `Con __dirname=dist/main/main/ resuelve a: ${resolvedPath}\n` +
      `Esperado: ${expectedPath}\n` +
      `Ajusta el path relativo en main.ts.`
    ).toBe(expectedPath);

    expect(
      fs.existsSync(resolvedPath),
      `El archivo resuelto no existe: ${resolvedPath}\n` +
      `Ejecuta npm run build primero.`
    ).toBe(true);
  });
});

// ─── A35: main.ts → preload/preload.js path correcto ─────────────────────────

describe('A35 — main.ts preload path', () => {
  it('el path de preload en main.ts debe resolver a dist/preload/preload/preload.js', () => {
    const mainTs = readMainTs();

    const match = mainTs.match(/path\.join\(__dirname,\s*['"]([^'"]+preload\.js)['"]\)/);
    expect(match, 'main.ts debe tener path.join(__dirname, "...preload.js")').toBeTruthy();

    const relPath = match![1];
    const simulatedDirname = path.join(ROOT, 'dist/main/main');
    const resolvedPath = path.resolve(simulatedDirname, relPath);
    const expectedPath = path.join(ROOT, 'dist/preload/preload/preload.js');

    expect(
      resolvedPath,
      `main.ts usa path.join(__dirname, "${relPath}")\n` +
      `Con __dirname=dist/main/main/ resuelve a: ${resolvedPath}\n` +
      `Esperado: ${expectedPath}`
    ).toBe(expectedPath);

    expect(
      fs.existsSync(resolvedPath),
      `El archivo preload resuelto no existe: ${resolvedPath}`
    ).toBe(true);
  });
});

// ─── A36: pantalla no vinculada expone "Probar báscula localmente" ────────────

describe('A36 — Prueba Local visible antes del enrollment', () => {
  it('index.html debe tener un elemento con texto de prueba local', () => {
    const html = readIndexHtml();
    // Buscar texto que indique la opción de prueba local
    const hasLocalTestOption =
      html.includes('Probar báscula localmente') ||
      html.includes('PRUEBA LOCAL') ||
      html.includes('btn-go-local-test');
    expect(
      hasLocalTestOption,
      'index.html no contiene la opción "Probar báscula localmente" ni btn-go-local-test.\n' +
      'La pantalla sin vincular debe mostrar dos acciones: Prueba Local y Vincular.'
    ).toBe(true);
  });

  it('index.html debe tener btn-go-local-test en la pantalla sin vincular', () => {
    const html = readIndexHtml();
    expect(html).toContain('btn-go-local-test');
  });

  it('renderer.ts debe manejar el click en btn-go-local-test', () => {
    const rendererTs = readRendererTs();
    expect(rendererTs).toContain('btn-go-local-test');
    expect(rendererTs).toContain('showLocalTestUI');
  });

  it('index.html debe tener la sección page-local-test', () => {
    const html = readIndexHtml();
    expect(html).toContain('page-local-test');
  });
});

// ─── A37: pantalla no vinculada expone "Vincular con FLUXAR" ─────────────────

describe('A37 — Vincular visible en pantalla sin vincular', () => {
  it('index.html debe tener btn-go-enroll', () => {
    const html = readIndexHtml();
    expect(html).toContain('btn-go-enroll');
  });

  it('index.html debe tener el formulario de enrollment', () => {
    const html = readIndexHtml();
    expect(html).toContain('enroll-code');
    expect(html).toContain('btn-enroll');
  });
});

// ─── A38: prueba local genera 0 API calls ─────────────────────────────────────

describe('A38 — Prueba Local no llama API', () => {
  it('local-test-manager.ts no debe importar api-client ni fetch', () => {
    const ltm = readLocalTestManagerTs();
    expect(ltm).not.toContain('api-client');
    expect(ltm).not.toContain('FluxarApiClient');
    expect(ltm).not.toContain("import fetch");
    expect(ltm).not.toContain('node-fetch');
  });

  it('local-test-manager.ts no debe hacer llamadas HTTP', () => {
    const ltm = readLocalTestManagerTs();
    // No debe haber llamadas a fetch, axios, http, https
    expect(ltm).not.toMatch(/\bfetch\s*\(/);
    expect(ltm).not.toMatch(/axios\s*\./);
    expect(ltm).not.toMatch(/require\s*\(\s*['"]https?['"]\s*\)/);
  });

  it('local-test-manager.ts no debe requerir station_token ni llamar enrollment', () => {
    const ltm = readLocalTestManagerTs();
    expect(ltm).not.toContain('station_token');
    // No debe haber llamadas a enroll() ni importar el flujo de enrollment
    // (la palabra puede aparecer en comentarios descriptivos, pero no en código)
    expect(ltm).not.toMatch(/\benroll\s*\(/);
    expect(ltm).not.toMatch(/enrollmentCode/);
    expect(ltm).not.toMatch(/enroll_code/);
  });
});

// ─── A39: listar puertos no requiere enrollment ───────────────────────────────

describe('A39 — listPorts sin enrollment', () => {
  it('IPC LIST_PORTS en main.ts no debe verificar token ni linked', () => {
    const mainTs = readMainTs();

    // Extraer el handler de LIST_PORTS
    const listPortsMatch = mainTs.match(
      /ipcMain\.handle\(IPC\.LIST_PORTS[\s\S]*?\}\s*\)/
    );
    expect(listPortsMatch, 'main.ts debe tener handler para IPC.LIST_PORTS').toBeTruthy();

    const handlerCode = listPortsMatch![0];
    // El handler no debe verificar token ni linked
    expect(handlerCode).not.toContain('station_token');
    expect(handlerCode).not.toContain('linked');
    expect(handlerCode).not.toContain('isLinked');
  });

  it('preload.ts expone listPorts sin condición de enrollment', () => {
    const preloadTs = fs.readFileSync(
      path.join(ROOT, 'src/preload/preload.ts'), 'utf8'
    );
    expect(preloadTs).toContain('listPorts');
    // listPorts no debe estar condicionado
    const listPortsIdx = preloadTs.indexOf('listPorts');
    const snippet = preloadTs.slice(Math.max(0, listPortsIdx - 50), listPortsIdx + 100);
    expect(snippet).not.toContain('if (linked)');
    expect(snippet).not.toContain('if (!linked)');
  });
});

// ─── A40: no existe COM4 hardcoded en runtime ─────────────────────────────────

describe('A40 — sin COM4 hardcoded en runtime', () => {
  it('renderer.ts no debe tener COM4 hardcoded', () => {
    const rendererTs = readRendererTs();
    expect(rendererTs).not.toMatch(/['"`]COM4['"`]/);
    expect(rendererTs).not.toMatch(/com_port\s*[:=]\s*['"`]COM4['"`]/);
  });

  it('local-test-manager.ts no debe tener COM4 hardcoded', () => {
    const ltm = readLocalTestManagerTs();
    expect(ltm).not.toMatch(/['"`]COM4['"`]/);
  });

  it('main.ts no debe tener COM4 hardcoded', () => {
    const mainTs = readMainTs();
    expect(mainTs).not.toMatch(/['"`]COM4['"`]/);
  });

  it('index.html no debe tener COM4 hardcoded', () => {
    const html = readIndexHtml();
    expect(html).not.toMatch(/COM4/);
  });
});
