import { readFileSync, writeFileSync } from 'fs';

const file = 'src/renderer/renderer.ts';
const content = readFileSync(file, 'utf8');

const start = content.indexOf('\nfunction renderDevices(devices: DeviceState[]): void {');
const end = content.indexOf('\n// \u2500\u2500\u2500 Render prueba local', start);
if (start === -1 || end === -1) {
  console.error(`ERROR: start=${start}, end=${end}`);
  process.exit(1);
}
console.log(`Block found: chars ${start}-${end}`);

const newBlock = `
function renderDevices(devices: DeviceState[]): void {
  const list = document.getElementById('devices-list');
  if (!list) return;

  if (!devices || devices.length === 0) {
    list.innerHTML = \`
      <div class="empty-state">
        <h3>Sin b\u00e1sculas configuradas</h3>
        <p>Configura las b\u00e1sculas desde el m\u00f3dulo de B\u00e1sculas en FLUXAR.</p>
      </div>\`;
    return;
  }

  list.innerHTML = devices.map(d => {
    // \u2500\u2500 Peso
    const hasWeight = typeof d.weight_kg === 'number' && Number.isFinite(d.weight_kg);
    const weightText = hasWeight ? (d.weight_kg as number).toFixed(2) + ' kg' : '\u2014 kg';
    const weightNonPositive = hasWeight && (d.weight_kg as number) <= 0;

    // \u2500\u2500 Estabilidad
    const stabilityLabel = d.is_stable ? 'ESTABLE' : 'EN MOVIMIENTO';
    const stabilityClass = d.is_stable ? 'stability-stable' : 'stability-moving';

    // \u2500\u2500 Capturable (indicador visual \u2014 backend es autoridad)
    const showNotCapturable = hasWeight && (weightNonPositive || !d.is_stable || !d.serial_open);

    // \u2500\u2500 Conexi\u00f3n serial
    const serialLabel = d.serial_open ? 'Conectada' : 'Desconectada';
    const serialClass = d.serial_open ? 'serial-open' : 'serial-closed';

    // \u2500\u2500 \u00daltima lectura
    let lastReadLabel = '\u2014';
    if (d.last_reading_at) {
      const agoMs = Date.now() - d.last_reading_at;
      if (agoMs < 5000) lastReadLabel = 'ahora';
      else if (agoMs < 60000) lastReadLabel = \`hace \${Math.floor(agoMs / 1000)}s\`;
      else lastReadLabel = new Date(d.last_reading_at).toLocaleTimeString('es-MX');
    }

    // \u2500\u2500 Meta serial
    const comPort = d.com_port || '\u2014';
    const metaSerial = \`\${escHtml(comPort)} \u00b7 \${escHtml(d.protocol)}\`;

    // \u2500\u2500 Error
    const errorHtml = d.last_error
      ? \`<div class="device-error">\${escHtml(d.last_error)}</div>\`
      : '';

    return \`
      <div class="device-card">
        <div class="device-header">
          <div class="device-name">\${escHtml(d.name)}</div>
          <div class="device-serial-badge \${serialClass}">\${serialLabel}</div>
        </div>
        <div class="device-weight-row">
          <span class="device-weight-value">\${weightText}</span>
          \${showNotCapturable ? '<span class="device-not-capturable">NO CAPTURABLE</span>' : ''}
        </div>
        <div class="device-stability \${stabilityClass}">\${stabilityLabel}</div>
        <div class="device-footer">
          <span class="device-meta">\${metaSerial}</span>
          <span class="device-last-read">\u00daltima lectura: \${lastReadLabel}</span>
        </div>
        \${errorHtml}
      </div>\`;
  }).join('');
}`;

const newContent = content.slice(0, start) + newBlock + content.slice(end);
writeFileSync(file, newContent, 'utf8');
console.log('OK: renderDevices reemplazado');
