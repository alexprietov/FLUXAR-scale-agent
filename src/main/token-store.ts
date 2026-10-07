/**
 * TokenStore — v2
 *
 * REGLA DE PRODUCCIÓN (packaged/real mode):
 *   - Token SOLO se persiste si safeStorage.isEncryptionAvailable() === true
 *   - Si NO disponible: NO guardar, NO base64, NO plaintext → lanzar error
 *   - Enrollment debe abortar de forma segura
 *
 * MOCK/DEVELOPMENT:
 *   - Guarda placeholder no sensible (no es token real)
 *   - Base64 permitido SOLO para el placeholder mock
 *
 * INVARIANTES:
 *   - Token NUNCA en logs
 *   - Token NUNCA expuesto al renderer
 *   - Base64 NUNCA como fallback de producción
 */

import path from 'path';
import fs from 'fs';
import log from 'electron-log';

export class SafeStorageUnavailableError extends Error {
  constructor() {
    super(
      'No fue posible proteger de forma segura la credencial de esta estación. ' +
      'El sistema operativo no tiene disponible el almacenamiento seguro (safeStorage). ' +
      'Intenta reiniciar la aplicación o contacta a soporte técnico.'
    );
    this.name = 'SafeStorageUnavailableError';
  }
}

export class TokenStore {
  private tokenPath: string;
  private safeStorage: Electron.SafeStorage | null;
  private mockMode: boolean;

  // Token en memoria — NUNCA expuesto al renderer
  private _memoryToken: string | null = null;

  constructor(userDataPath: string, safeStorage: Electron.SafeStorage | null, mockMode: boolean) {
    this.tokenPath = path.join(userDataPath, 'station.enc');
    this.safeStorage = safeStorage;
    this.mockMode = mockMode;
  }

  hasToken(): boolean {
    // Primero verificar memoria (más rápido y seguro)
    if (this._memoryToken !== null) return true;
    return fs.existsSync(this.tokenPath);
  }

  /**
   * Guarda el token.
   *
   * PRODUCCIÓN: requiere safeStorage disponible. Si no → lanza SafeStorageUnavailableError.
   * MOCK: guarda placeholder base64 (no es token real).
   *
   * @throws SafeStorageUnavailableError si en producción safeStorage no está disponible
   */
  saveToken(token: string): void {
    // NUNCA loguear el token ni parte de él

    if (this.mockMode) {
      // Mock: placeholder no sensible
      const placeholder = Buffer.from('MOCK_PLACEHOLDER:' + Date.now()).toString('base64');
      fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
      fs.writeFileSync(this.tokenPath, placeholder);
      // En memoria guardamos el token mock para que loadToken() funcione en tests
      this._memoryToken = token;
      log.info('[TokenStore] Token mock guardado en memoria (placeholder en disco)');
      return;
    }

    // ── PRODUCCIÓN ──────────────────────────────────────────────────────────────
    // Base64 NO es cifrado. Si safeStorage no está disponible, abortar.
    if (!this.safeStorage?.isEncryptionAvailable()) {
      log.error('[TokenStore] safeStorage no disponible — enrollment abortado');
      throw new SafeStorageUnavailableError();
    }

    const encrypted = this.safeStorage.encryptString(token);
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
    fs.writeFileSync(this.tokenPath, encrypted);
    this._memoryToken = token;
    log.info('[TokenStore] Token guardado cifrado con safeStorage');
  }

  /**
   * Carga el token desde disco (o memoria si ya está cargado).
   * Retorna null si no existe o no se puede descifrar.
   */
  loadToken(): string | null {
    // Si ya está en memoria, retornar directamente
    if (this._memoryToken !== null) return this._memoryToken;

    if (!fs.existsSync(this.tokenPath)) return null;

    try {
      const data = fs.readFileSync(this.tokenPath);

      if (this.mockMode) {
        // En mock mode el token real está solo en memoria
        // Si no está en memoria (ej. reinicio), no hay token válido
        log.info('[TokenStore] Mock mode: token no disponible tras reinicio (esperado)');
        return null;
      }

      // ── PRODUCCIÓN ────────────────────────────────────────────────────────────
      if (!this.safeStorage?.isEncryptionAvailable()) {
        // safeStorage no disponible — no podemos descifrar
        // Eliminar el archivo para forzar re-enrollment
        log.warn('[TokenStore] safeStorage no disponible al cargar — eliminando token');
        this.clearToken();
        return null;
      }

      const token = this.safeStorage.decryptString(data);
      this._memoryToken = token;
      return token;
    } catch (err) {
      log.error('[TokenStore] Error al cargar token:', (err as Error).message);
      return null;
    }
  }

  clearToken(): void {
    this._memoryToken = null;
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
      log.info('[TokenStore] Token eliminado');
    } catch (err) {
      log.error('[TokenStore] Error al eliminar token:', err);
    }
  }

  /**
   * Retorna si el token está disponible en memoria (sin tocar disco).
   * Usado para verificar que el renderer nunca recibe el token.
   */
  hasTokenInMemory(): boolean {
    return this._memoryToken !== null;
  }
}
