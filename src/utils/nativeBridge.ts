// Runtime-safe Capacitor Native & API Bridge
// Works seamlessly on Web, PWA, and Capacitor Android/iOS APKs
// without requiring native Capacitor packages at Vite build time.

export const DEFAULT_CLOUD_API_BASE =
  'https://ais-pre-5pef5obhvgovpp2guu4e54-398735320015.europe-west1.run.app';

const PREF_KEY_API_BASE = 'VARDIYA_112_API_BASE_URL';

interface CapacitorWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, any>;
  };
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as CapacitorWindow).Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') {
    try {
      if (cap.isNativePlatform()) return true;
    } catch {
      // ignore
    }
  }
  const proto = window.location?.protocol || '';
  if (proto === 'capacitor:' || proto === 'ionic:' || proto === 'file:') {
    return true;
  }
  const ua = navigator.userAgent || '';
  // Android WebView user-agent contains "; wv)" or "Version/4.0 Chrome/..." inside APK
  if (/; wv\)/i.test(ua) && !window.location?.hostname?.endsWith('.run.app')) {
    return true;
  }
  // Capacitor Android serves assets on https://localhost or http://localhost (without Vite dev port)
  if (
    (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1') &&
    window.location?.port !== '3000' &&
    window.location?.port !== '5173'
  ) {
    return true;
  }
  return false;
}

export function getCapacitorPlugins(): Record<string, any> | null {
  if (typeof window === 'undefined') return null;
  return (window as CapacitorWindow).Capacitor?.Plugins || null;
}

export function isTrustedApiBaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') {
      return (
        parsed.hostname.endsWith('.run.app') ||
        (typeof window !== 'undefined' && parsed.hostname === window.location?.hostname)
      );
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getCustomApiBaseUrl(): string {
  try {
    const stored = localStorage.getItem(PREF_KEY_API_BASE)?.trim() || '';
    if (!stored) return '';
    if (!isTrustedApiBaseUrl(stored)) {
      localStorage.removeItem(PREF_KEY_API_BASE);
      return '';
    }
    return stored;
  } catch {
    return '';
  }
}

export function setCustomApiBaseUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean && isTrustedApiBaseUrl(clean)) {
      localStorage.setItem(PREF_KEY_API_BASE, clean);
    } else {
      localStorage.removeItem(PREF_KEY_API_BASE);
    }
  } catch {
    // ignore
  }
}

export function getApiBaseUrl(): string {
  const custom = getCustomApiBaseUrl();
  if (custom) return custom;

  const envUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (envUrl) {
    const cleanEnv = envUrl.replace(/\/+$/, '');
    if (isTrustedApiBaseUrl(cleanEnv)) return cleanEnv;
  }

  if (isCapacitorNative()) {
    return DEFAULT_CLOUD_API_BASE;
  }

  return '';
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function toAbsoluteApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const base = getApiBaseUrl();
  if (base) return `${base}${normalizedPath}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${normalizedPath}`;
  }
  return normalizedPath;
}

export function getNativeSpeechRecognitionPlugin(): any | null {
  const plugins = getCapacitorPlugins();
  if (!plugins) return null;
  return plugins.SpeechRecognition || null;
}

export function isSafeExternalHttpUrl(rawUrl: string): boolean {
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : DEFAULT_CLOUD_API_BASE;
    const parsed = new URL(rawUrl, base);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openExternalSystemUrl(url: string): Promise<boolean> {
  if (!isSafeExternalHttpUrl(url)) {
    return false;
  }
  const plugins = getCapacitorPlugins();
  if (plugins?.Browser && typeof plugins.Browser.open === 'function') {
    try {
      await plugins.Browser.open({ url });
      return true;
    } catch {
      // fall through to anchor navigation
    }
  }

  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    try {
      window.location.href = url;
      return true;
    } catch {
      return false;
    }
  }
}

export interface NativeFileShareOptions {
  fileName: string;
  mimeType: string;
  textContent?: string;
  base64Content?: string;
  title?: string;
  text?: string;
  dialogTitle?: string;
  preferFileOpener?: boolean;
}

export async function shareOrOpenNativeFile(
  options: NativeFileShareOptions
): Promise<{ handled: boolean; method?: string }> {
  if (!isCapacitorNative()) {
    return { handled: false };
  }

  const plugins = getCapacitorPlugins();
  const Filesystem = plugins?.Filesystem;
  if (!Filesystem || typeof Filesystem.writeFile !== 'function') {
    return { handled: false };
  }

  try {
    const writeParams: Record<string, any> = {
      path: options.fileName,
      directory: 'CACHE',
      recursive: true,
    };

    if (typeof options.base64Content === 'string') {
      writeParams.data = options.base64Content;
    } else {
      writeParams.data = options.textContent || '';
      writeParams.encoding = 'utf8';
    }

    const writeRes = await Filesystem.writeFile(writeParams);
    let fileUri: string | undefined = writeRes?.uri;

    if (!fileUri && typeof Filesystem.getUri === 'function') {
      const uriRes = await Filesystem.getUri({
        path: options.fileName,
        directory: 'CACHE',
      });
      fileUri = uriRes?.uri;
    }

    if (!fileUri) {
      return { handled: false };
    }

    // 1. Prefer direct native FileOpener for .ics so Calendar app opens immediately
    const FileOpener = plugins?.FileOpener || plugins?.CapawesomeFileOpener;
    if (options.preferFileOpener && FileOpener) {
      try {
        if (typeof FileOpener.open === 'function') {
          await FileOpener.open({
            filePath: fileUri,
            contentType: options.mimeType,
          });
          return { handled: true, method: 'file-opener' };
        }
        if (typeof FileOpener.openFile === 'function') {
          await FileOpener.openFile({
            path: fileUri,
            mimeType: options.mimeType,
          });
          return { handled: true, method: 'file-opener' };
        }
      } catch {
        // Fall through to Share plugin
      }
    }

    // 2. Native Android/iOS Share Sheet via @capacitor/share
    const Share = plugins?.Share;
    if (Share && typeof Share.share === 'function') {
      try {
        await Share.share({
          title: options.title || options.fileName,
          text: options.text,
          url: fileUri,
          files: [fileUri],
          dialogTitle: options.dialogTitle || options.title || 'Paylaş',
        });
        return { handled: true, method: 'capacitor-share' };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/cancel|abort|dismiss/i.test(msg)) {
          return { handled: true, method: 'cancelled' };
        }
      }
    }

    return { handled: false };
  } catch {
    return { handled: false };
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

export interface NativeCoordinatesResult {
  lat: number;
  lng: number;
}

/**
 * Unified Geolocation permission & position helper for both Capacitor Android/iOS APKs
 * (`@capacitor/geolocation` plugin) and Web/PWA (`navigator.geolocation`).
 */
export async function requestCurrentLocation(
  timeoutMs = 10000
): Promise<NativeCoordinatesResult> {
  const plugins = getCapacitorPlugins();
  const CapGeo = plugins?.Geolocation;

  // 1. Capacitor Native Geolocation plugin (@capacitor/geolocation)
  if (CapGeo && typeof CapGeo.getCurrentPosition === 'function') {
    try {
      if (typeof CapGeo.checkPermissions === 'function') {
        const status = await CapGeo.checkPermissions();
        const locState = status?.location || status?.coarseLocation;
        if (locState !== 'granted' && typeof CapGeo.requestPermissions === 'function') {
          const req = await CapGeo.requestPermissions();
          const afterState = req?.location || req?.coarseLocation;
          if (afterState === 'denied') {
            throw new Error('PERMISSION_DENIED');
          }
        }
      }
      const pos = await CapGeo.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: 5 * 60 * 1000,
      });
      if (pos?.coords && typeof pos.coords.latitude === 'number') {
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/denied|PERMISSION_DENIED/i.test(msg)) {
        throw new Error('Konum izni reddedildi. Lütfen telefon ayarlarından konum izni verin.');
      }
      // Fall through to standard WebView navigator.geolocation
    }
  }

  // 2. Standard Web / Android WebView Geolocation API
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Cihazınızda konum servisi desteklenmiyor.');
  }

  return new Promise<NativeCoordinatesResult>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        if (err.code === 1) {
          reject(new Error('Konum izni reddedildi. Lütfen uygulama izinlerinden konumu açın.'));
        } else if (err.code === 2) {
          reject(new Error('GPS / Konum bilgisi alınamadı. Konum servisinizin açık olduğundan emin olun.'));
        } else {
          reject(new Error('Konum alma süresi doldu.'));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: 5 * 60 * 1000,
      }
    );
  });
}
