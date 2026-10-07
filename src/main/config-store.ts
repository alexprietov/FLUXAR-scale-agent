/**
 * ConfigStore
 *
 * Almacena configuración NO sensible en JSON.
 * El station token se maneja SEPARADO vía TokenStore (safeStorage).
 *
 * Usa electron-store para persistencia automática.
 */

import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { AppConfig, DeviceLocalConfig } from '../shared/types.js';

const DEFAULT_CONFIG: AppConfig = {
  api_base_url: 'https://ecorecycler.app',
  station_name: null,
  station_branch: null,
  station_id: null,
  device_configs: [],
  autostart: true,
  start_minimized: true,
};

export class ConfigStore {
  private configPath: string;
  private data: AppConfig;

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, 'config.json');
    this.data = this._load();
  }

  private _load(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // config corrupta → usar defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  private _save(): void {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[ConfigStore] Error al guardar:', err);
    }
  }

  get(): AppConfig {
    return { ...this.data };
  }

  setStationMeta(station_id: number, station_name: string, station_branch: string): void {
    this.data.station_id = station_id;
    this.data.station_name = station_name;
    this.data.station_branch = station_branch;
    this._save();
  }

  clearStationMeta(): void {
    this.data.station_id = null;
    this.data.station_name = null;
    this.data.station_branch = null;
    this._save();
  }

  setApiBaseUrl(url: string): void {
    this.data.api_base_url = url;
    this._save();
  }

  setAutostart(value: boolean): void {
    this.data.autostart = value;
    this._save();
  }

  setStartMinimized(value: boolean): void {
    this.data.start_minimized = value;
    this._save();
  }

  saveDeviceConfig(dc: DeviceLocalConfig): void {
    const idx = this.data.device_configs.findIndex(d => d.scale_id === dc.scale_id);
    if (idx >= 0) {
      this.data.device_configs[idx] = dc;
    } else {
      this.data.device_configs.push(dc);
    }
    this._save();
  }

  getDeviceConfig(scale_id: number): DeviceLocalConfig | null {
    return this.data.device_configs.find(d => d.scale_id === scale_id) ?? null;
  }

  setWindowBounds(bounds: AppConfig['window_bounds']): void {
    this.data.window_bounds = bounds;
    this._save();
  }

  /**
   * Retorna el device_identifier estable de esta instalación.
   * Si no existe, genera uno con crypto.randomUUID() y lo persiste.
   *
   * INVARIANTES:
   *  - Se genera UNA sola vez por instalación.
   *  - Persiste entre reinicios de la app y del sistema operativo.
   *  - No contiene información personal ni de red.
   *  - No se regenera tras un enrollment exitoso.
   */
  getOrCreateDeviceIdentifier(): string {
    if (this.data.device_identifier) {
      return this.data.device_identifier;
    }
    const id = randomUUID();
    this.data.device_identifier = id;
    this._save();
    return id;
  }
}
