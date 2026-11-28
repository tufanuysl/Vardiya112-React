import { apiUrl, getCapacitorPlugins } from './nativeBridge';

export interface TurkishProvince {
  plate: string;
  name: string;
  lat: number;
  lng: number;
}

export const TURKISH_PROVINCES: TurkishProvince[] = [
  { plate: '01', name: 'Adana', lat: 37.0, lng: 35.3213 },
  { plate: '02', name: 'Adıyaman', lat: 37.7648, lng: 38.2786 },
  { plate: '03', name: 'Afyonkarahisar', lat: 38.7507, lng: 30.5567 },
  { plate: '04', name: 'Ağrı', lat: 39.7191, lng: 43.0503 },
  { plate: '68', name: 'Aksaray', lat: 38.3687, lng: 34.037 },
  { plate: '05', name: 'Amasya', lat: 40.6499, lng: 35.8353 },
  { plate: '06', name: 'Ankara', lat: 39.9334, lng: 32.8597 },
  { plate: '07', name: 'Antalya', lat: 36.8969, lng: 30.7133 },
  { plate: '75', name: 'Ardahan', lat: 41.1105, lng: 42.7022 },
  { plate: '08', name: 'Artvin', lat: 41.1828, lng: 41.8183 },
  { plate: '09', name: 'Aydın', lat: 37.856, lng: 27.8416 },
  { plate: '10', name: 'Balıkesir', lat: 39.6484, lng: 27.8826 },
  { plate: '74', name: 'Bartın', lat: 41.6344, lng: 32.3375 },
  { plate: '72', name: 'Batman', lat: 37.8812, lng: 41.1351 },
  { plate: '69', name: 'Bayburt', lat: 40.2552, lng: 40.2249 },
  { plate: '11', name: 'Bilecik', lat: 40.1451, lng: 29.9799 },
  { plate: '12', name: 'Bingöl', lat: 38.8855, lng: 40.4966 },
  { plate: '13', name: 'Bitlis', lat: 38.4006, lng: 42.1095 },
  { plate: '14', name: 'Bolu', lat: 40.735, lng: 31.6061 },
  { plate: '15', name: 'Burdur', lat: 37.7204, lng: 30.2908 },
  { plate: '16', name: 'Bursa', lat: 40.1885, lng: 29.061 },
  { plate: '17', name: 'Çanakkale', lat: 40.1553, lng: 26.4142 },
  { plate: '18', name: 'Çankırı', lat: 40.6013, lng: 33.6134 },
  { plate: '19', name: 'Çorum', lat: 40.5506, lng: 34.9556 },
  { plate: '20', name: 'Denizli', lat: 37.7765, lng: 29.0864 },
  { plate: '21', name: 'Diyarbakır', lat: 37.9144, lng: 40.2306 },
  { plate: '81', name: 'Düzce', lat: 40.8438, lng: 31.1565 },
  { plate: '22', name: 'Edirne', lat: 41.6771, lng: 26.5557 },
  { plate: '23', name: 'Elazığ', lat: 38.681, lng: 39.2264 },
  { plate: '24', name: 'Erzincan', lat: 39.75, lng: 39.5 },
  { plate: '25', name: 'Erzurum', lat: 39.9055, lng: 41.2658 },
  { plate: '26', name: 'Eskişehir', lat: 39.7767, lng: 30.5206 },
  { plate: '27', name: 'Gaziantep', lat: 37.0662, lng: 37.3833 },
  { plate: '28', name: 'Giresun', lat: 40.9128, lng: 38.3895 },
  { plate: '29', name: 'Gümüşhane', lat: 40.4603, lng: 39.4814 },
  { plate: '30', name: 'Hakkari', lat: 37.5744, lng: 43.7408 },
  { plate: '31', name: 'Hatay', lat: 36.2023, lng: 36.1613 },
  { plate: '76', name: 'Iğdır', lat: 39.9237, lng: 44.045 },
  { plate: '32', name: 'Isparta', lat: 37.7648, lng: 30.5566 },
  { plate: '34', name: 'İstanbul', lat: 41.0082, lng: 28.9784 },
  { plate: '35', name: 'İzmir', lat: 38.4237, lng: 27.1428 },
  { plate: '46', name: 'Kahramanmaraş', lat: 37.5858, lng: 36.9371 },
  { plate: '78', name: 'Karabük', lat: 41.2061, lng: 32.6204 },
  { plate: '70', name: 'Karaman', lat: 37.1759, lng: 33.2287 },
  { plate: '36', name: 'Kars', lat: 40.6013, lng: 43.0975 },
  { plate: '37', name: 'Kastamonu', lat: 41.3887, lng: 33.7827 },
  { plate: '38', name: 'Kayseri', lat: 38.7312, lng: 35.4787 },
  { plate: '71', name: 'Kırıkkale', lat: 39.8468, lng: 33.5153 },
  { plate: '39', name: 'Kırklareli', lat: 41.7333, lng: 27.2167 },
  { plate: '40', name: 'Kırşehir', lat: 39.1425, lng: 34.1709 },
  { plate: '79', name: 'Kilis', lat: 36.7184, lng: 37.1212 },
  { plate: '41', name: 'Kocaeli', lat: 40.7654, lng: 29.9408 },
  { plate: '42', name: 'Konya', lat: 37.8746, lng: 32.4932 },
  { plate: '43', name: 'Kütahya', lat: 39.4167, lng: 29.9833 },
  { plate: '44', name: 'Malatya', lat: 38.3552, lng: 38.3095 },
  { plate: '45', name: 'Manisa', lat: 38.6191, lng: 27.4289 },
  { plate: '47', name: 'Mardin', lat: 37.3212, lng: 40.7245 },
  { plate: '33', name: 'Mersin', lat: 36.8121, lng: 34.6415 },
  { plate: '48', name: 'Muğla', lat: 37.2153, lng: 28.3636 },
  { plate: '49', name: 'Muş', lat: 38.7432, lng: 41.5064 },
  { plate: '50', name: 'Nevşehir', lat: 38.6244, lng: 34.7239 },
  { plate: '51', name: 'Niğde', lat: 37.9667, lng: 34.6833 },
  { plate: '52', name: 'Ordu', lat: 40.9839, lng: 37.8764 },
  { plate: '80', name: 'Osmaniye', lat: 37.0742, lng: 36.2478 },
  { plate: '53', name: 'Rize', lat: 41.0201, lng: 40.5234 },
  { plate: '54', name: 'Sakarya', lat: 40.7569, lng: 30.3783 },
  { plate: '55', name: 'Samsun', lat: 41.2867, lng: 36.33 },
  { plate: '56', name: 'Siirt', lat: 37.9333, lng: 41.95 },
  { plate: '57', name: 'Sinop', lat: 42.0231, lng: 35.1531 },
  { plate: '58', name: 'Sivas', lat: 39.7477, lng: 37.0179 },
  { plate: '63', name: 'Şanlıurfa', lat: 37.1591, lng: 38.7969 },
  { plate: '73', name: 'Şırnak', lat: 37.5164, lng: 42.4611 },
  { plate: '59', name: 'Tekirdağ', lat: 40.9833, lng: 27.5167 },
  { plate: '60', name: 'Tokat', lat: 40.3167, lng: 36.55 },
  { plate: '61', name: 'Trabzon', lat: 41.0015, lng: 39.7178 },
  { plate: '62', name: 'Tunceli', lat: 39.1079, lng: 39.5401 },
  { plate: '64', name: 'Uşak', lat: 38.6823, lng: 29.4082 },
  { plate: '65', name: 'Van', lat: 38.4891, lng: 43.4089 },
  { plate: '77', name: 'Yalova', lat: 40.65, lng: 29.2667 },
  { plate: '66', name: 'Yozgat', lat: 39.8181, lng: 34.8147 },
  { plate: '67', name: 'Zonguldak', lat: 41.4564, lng: 31.7987 },
];

export const DEFAULT_WEATHER_CITY = 'İstanbul';

export function getProvinceByName(cityName?: string): TurkishProvince {
  const target = (cityName || DEFAULT_WEATHER_CITY).trim().toLocaleLowerCase('tr-TR');
  return (
    TURKISH_PROVINCES.find((p) => p.name.toLocaleLowerCase('tr-TR') === target) ||
    TURKISH_PROVINCES.find((p) => p.name === DEFAULT_WEATHER_CITY) ||
    TURKISH_PROVINCES[0]
  );
}

export function findNearestProvinceByCoords(lat: number, lng: number): TurkishProvince {
  let best = TURKISH_PROVINCES[0];
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const prov of TURKISH_PROVINCES) {
    const dLat = prov.lat - lat;
    const dLng = (prov.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const distSq = dLat * dLat + dLng * dLng;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = prov;
    }
  }
  return best;
}

export interface LiveWeatherInfo {
  city: string;
  temp: number;
  feelsLike: number;
  weatherCode: number;
  isDay: boolean;
  label: string;
  emoji: string;
  updatedAt: number;
}

export function describeWeatherCode(
  code: number,
  isDay: boolean
): { label: string; emoji: string } {
  if (code === 0) return { label: 'Açık', emoji: isDay ? '☀️' : '🌙' };
  if (code === 1) return { label: 'Az Bulutlu', emoji: isDay ? '🌤️' : '🌙' };
  if (code === 2) return { label: 'Parçalı Bulutlu', emoji: isDay ? '⛅' : '☁️' };
  if (code === 3) return { label: 'Çok Bulutlu', emoji: '☁️' };
  if (code === 45 || code === 48) return { label: 'Sisli', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Çiseleyen', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Yağmurlu', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Karlı', emoji: '❄️' };
  if (code >= 80 && code <= 82) return { label: 'Sağanak', emoji: '🌧️' };
  if (code === 85 || code === 86) return { label: 'Kar Yağışlı', emoji: '🌨️' };
  if (code >= 95 && code <= 99) return { label: 'Fırtınalı', emoji: '⛈️' };
  return { label: 'Bulutlu', emoji: isDay ? '🌤️' : '☁️' };
}

function mapWttrCodeToWmo(wttrCode: number): number {
  if (wttrCode === 113) return 0;
  if (wttrCode === 116) return 2;
  if (wttrCode === 119 || wttrCode === 122) return 3;
  if (wttrCode === 143 || wttrCode === 248 || wttrCode === 260) return 45;
  if (wttrCode >= 176 && wttrCode <= 266) return 51;
  if (wttrCode >= 293 && wttrCode <= 314) return 61;
  if (wttrCode >= 317 && wttrCode <= 338) return 71;
  if (wttrCode >= 353 && wttrCode <= 365) return 80;
  if (wttrCode >= 368 && wttrCode <= 377) return 85;
  if (wttrCode >= 386 && wttrCode <= 395) return 95;
  return 2;
}

const WEATHER_CACHE_KEY = 'VARDIYA_112_WEATHER_CACHE_V1';
const WEATHER_FRESH_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

// Deduplicate simultaneous weather fetches for the same city
const inFlightRequests = new Map<string, Promise<LiveWeatherInfo | null>>();

export function loadCachedWeather(cityName?: string): LiveWeatherInfo | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveWeatherInfo;
    const targetCity = getProvinceByName(cityName).name;
    if (!parsed || parsed.city !== targetCity || typeof parsed.temp !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedWeather(info: LiveWeatherInfo) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(info));
  } catch {
    // ignore storage quota errors
  }
}

async function fetchJsonWithTimeout(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any | null> {
  // Prefer native CapacitorHttp plugin inside Android/iOS APKs when installed
  // (bypasses any Android WebView CORS restrictions and uses native OkHttp stack)
  const plugins = getCapacitorPlugins();
  if (plugins?.CapacitorHttp && typeof plugins.CapacitorHttp.get === 'function') {
    try {
      const nativeRes = await plugins.CapacitorHttp.get({
        url,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        headers: { Accept: 'application/json' },
      });
      if (nativeRes && nativeRes.status >= 200 && nativeRes.status < 300) {
        if (typeof nativeRes.data === 'string') {
          return JSON.parse(nativeRes.data);
        }
        return nativeRes.data;
      }
    } catch {
      // Fall through to standard fetch
    }
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function parseOpenMeteoResponse(city: string, payload: any): LiveWeatherInfo | null {
  const cur = payload?.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return null;
  const code = typeof cur.weather_code === 'number' ? cur.weather_code : 0;
  const isDay = cur.is_day !== 0;
  const { label, emoji } = describeWeatherCode(code, isDay);
  return {
    city,
    temp: Math.round(cur.temperature_2m),
    feelsLike:
      typeof cur.apparent_temperature === 'number'
        ? Math.round(cur.apparent_temperature)
        : Math.round(cur.temperature_2m),
    weatherCode: code,
    isDay,
    label,
    emoji,
    updatedAt: Date.now(),
  };
}

function parseWttrResponse(city: string, payload: any): LiveWeatherInfo | null {
  const cur = Array.isArray(payload?.current_condition) ? payload.current_condition[0] : null;
  if (!cur) return null;
  const tempNum = Number(cur.temp_C);
  if (!Number.isFinite(tempNum)) return null;
  const feelsNum = Number(cur.FeelsLikeC);
  const wttrCode = Number(cur.weatherCode) || 116;
  const wmoCode = mapWttrCodeToWmo(wttrCode);
  const hourNow = new Date().getHours();
  const isDay = hourNow >= 6 && hourNow < 19;
  const { label, emoji } = describeWeatherCode(wmoCode, isDay);

  return {
    city,
    temp: Math.round(tempNum),
    feelsLike: Number.isFinite(feelsNum) ? Math.round(feelsNum) : Math.round(tempNum),
    weatherCode: wmoCode,
    isDay,
    label,
    emoji,
    updatedAt: Date.now(),
  };
}

export async function fetchLiveWeatherForCity(
  cityName?: string,
  forceRefresh = false
): Promise<LiveWeatherInfo | null> {
  const province = getProvinceByName(cityName);

  // Return fresh cached data without redundant network requests unless forced
  const cached = loadCachedWeather(province.name);
  if (!forceRefresh && cached && Date.now() - cached.updatedAt < WEATHER_FRESH_MS) {
    return cached;
  }

  // If offline, immediately return cached data without waiting for timeouts
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return cached;
  }

  // Deduplicate concurrent requests for the same city
  const existingPromise = inFlightRequests.get(province.name);
  if (existingPromise) {
    return existingPromise;
  }

  const requestPromise = (async (): Promise<LiveWeatherInfo | null> => {
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${province.lat}&longitude=${province.lng}&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=Europe%2FIstanbul`;

    // 1. Primary Direct API: Open-Meteo (fast, reliable, zero API key, native APK compatible)
    const primaryData = await fetchJsonWithTimeout(openMeteoUrl);
    const parsedPrimary = parseOpenMeteoResponse(province.name, primaryData);
    if (parsedPrimary) {
      saveCachedWeather(parsedPrimary);
      return parsedPrimary;
    }

    // 2. Secondary Direct Backup API: wttr.in JSON API (independent provider for APK resilience)
    const wttrUrl = `https://wttr.in/${province.lat},${province.lng}?format=j1`;
    const wttrData = await fetchJsonWithTimeout(wttrUrl);
    const parsedWttr = parseWttrResponse(province.name, wttrData);
    if (parsedWttr) {
      saveCachedWeather(parsedWttr);
      return parsedWttr;
    }

    // 3. Tertiary Backend Proxy API (/api/weather with server-side caching & multi-provider failover)
    const proxyData = await fetchJsonWithTimeout(
      apiUrl(`/api/weather?lat=${province.lat}&lng=${province.lng}`)
    );
    const parsedProxy =
      parseOpenMeteoResponse(province.name, proxyData) ||
      parseWttrResponse(province.name, proxyData);
    if (parsedProxy) {
      saveCachedWeather(parsedProxy);
      return parsedProxy;
    }

    return cached;
  })();

  inFlightRequests.set(province.name, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(province.name);
  }
}
