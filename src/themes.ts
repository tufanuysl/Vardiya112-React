import { AppThemeId } from './types';

export interface ThemePreset {
  id: AppThemeId;
  name: string;
  subtitle: string;
  worldArtifactLabel: string;
  emoji: string;
  isLight: boolean;
  bgPrimary: string;
  textPrimary: string;
  modalBgClass: string;
  dockBgClass: string;
  dockActiveBtnClass: string;
  summaryCardClass: string;
  summaryDividerClass: string;
  summaryKickerClass: string;
  highlightFrameClass: string;
  highlightTextClass: string;
  popoverBorderClass: string;
  accentHex: string;
  earthAtmosphereHex: number;
  earthRimHex: number;
  earthCircleStroke: string;
  skyTopRgba: string;
  skyMidRgba: string;
  skyZenithRgba: string;
  previewSwatches: [string, string, string];
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'dark',
    name: 'Gece Uzay',
    subtitle: 'Klasik koyu lacivert ve kızıl vurgu',
    worldArtifactLabel: '🛰️ Yörünge Uydusu, Ay ve Kayan Yıldız',
    emoji: '🌙',
    isLight: false,
    bgPrimary: '#090D16',
    textPrimary: '#F1F5F9',
    modalBgClass: 'bg-[#0F172A] border-slate-800',
    dockBgClass: 'bg-[#111622]/95 border-slate-800/90 shadow-black/50',
    dockActiveBtnClass: 'bg-white text-slate-950 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#171320] via-[#21121f] to-[#2c121e] border-rose-500/30 shadow-lg',
    summaryDividerClass: 'bg-white/10',
    summaryKickerClass: 'text-rose-400/90',
    highlightFrameClass:
      'border-2 !border-rose-500 ring-1 ring-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.28)]',
    highlightTextClass: 'text-rose-400',
    popoverBorderClass: 'bg-[#111622]/98 border-rose-500/40 text-slate-100 shadow-black/80',
    accentHex: '#f43f5e',
    earthAtmosphereHex: 0x3b4fd8,
    earthRimHex: 0x6366f1,
    earthCircleStroke: 'rgba(99, 102, 241, 0.22)',
    skyTopRgba: 'rgba(11, 17, 42, 0.92)',
    skyMidRgba: 'rgba(12, 18, 40, 0.56)',
    skyZenithRgba: 'rgba(59, 130, 246, 0.10)',
    previewSwatches: ['#090D16', '#1E1B4B', '#F43F5E'],
  },
  {
    id: 'light',
    name: 'Gündüz Açık',
    subtitle: 'Ferah mavi gökyüzü ve aydınlık görünüm',
    worldArtifactLabel: '☀️ Parlak Güneş, Süzülen Bulutlar ve Gündüz Küresi',
    emoji: '☀️',
    isLight: true,
    bgPrimary: '#F8FAFC',
    textPrimary: '#0F172A',
    modalBgClass: 'bg-[#F8FAFC] border-slate-200',
    dockBgClass: 'bg-white/95 border-slate-200/90 shadow-slate-200/50',
    dockActiveBtnClass: 'bg-slate-900 text-white shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-rose-50/90 via-white to-rose-50/70 border-rose-200 shadow-sm',
    summaryDividerClass: 'bg-rose-200/80',
    summaryKickerClass: 'text-rose-600/90',
    highlightFrameClass: 'border-2 !border-rose-500 ring-1 ring-rose-500/30 shadow-sm',
    highlightTextClass: 'text-rose-500',
    popoverBorderClass: 'bg-white/98 border-rose-200 text-slate-800 shadow-slate-300/70',
    accentHex: '#f43f5e',
    earthAtmosphereHex: 0x38bdf8,
    earthRimHex: 0xfef9c3,
    earthCircleStroke: 'rgba(14, 165, 233, 0.26)',
    skyTopRgba: 'rgba(56, 189, 248, 0.52)',
    skyMidRgba: 'rgba(125, 211, 252, 0.34)',
    skyZenithRgba: 'rgba(254, 240, 138, 0.45)',
    previewSwatches: ['#F8FAFC', '#BAE6FD', '#F43F5E'],
  },
  {
    id: 'emerald',
    name: '112 Zümrüt',
    subtitle: 'Acil sağlık yeşili ve kuzey ışıkları atmosferi',
    worldArtifactLabel: '🌌 3D Kuzey Işıkları (Aurora) ve 112 Sinyal Halkası',
    emoji: '🚑',
    isLight: false,
    bgPrimary: '#06120E',
    textPrimary: '#ECFDF5',
    modalBgClass: 'bg-[#091914] border-emerald-900/60',
    dockBgClass: 'bg-[#0B1D17]/95 border-emerald-800/50 shadow-black/60',
    dockActiveBtnClass: 'bg-emerald-400 text-slate-950 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#091e18] via-[#0d2922] to-[#0a221c] border-emerald-500/35 shadow-lg',
    summaryDividerClass: 'bg-emerald-400/15',
    summaryKickerClass: 'text-emerald-400',
    highlightFrameClass:
      'border-2 !border-emerald-400 ring-1 ring-emerald-400/35 shadow-[0_0_15px_rgba(16,185,129,0.28)]',
    highlightTextClass: 'text-emerald-400',
    popoverBorderClass: 'bg-[#0B1D17]/98 border-emerald-500/40 text-emerald-50 shadow-black/80',
    accentHex: '#10b981',
    earthAtmosphereHex: 0x10b981,
    earthRimHex: 0xa7f3d0,
    earthCircleStroke: 'rgba(16, 185, 129, 0.28)',
    skyTopRgba: 'rgba(6, 48, 38, 0.88)',
    skyMidRgba: 'rgba(10, 39, 32, 0.55)',
    skyZenithRgba: 'rgba(16, 185, 129, 0.16)',
    previewSwatches: ['#06120E', '#065F46', '#10B981'],
  },
  {
    id: 'ocean',
    name: 'Okyanus Mavisi',
    subtitle: 'Derin okyanus laciverti ve turkuaz parıltı',
    worldArtifactLabel: '🌊 Biyolüminesans Akıntı Halkaları ve Buzul Ay',
    emoji: '🌊',
    isLight: false,
    bgPrimary: '#06101E',
    textPrimary: '#F0F9FF',
    modalBgClass: 'bg-[#0A182B] border-sky-900/60',
    dockBgClass: 'bg-[#0B192C]/95 border-sky-800/50 shadow-black/60',
    dockActiveBtnClass: 'bg-sky-400 text-slate-950 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#09192b] via-[#0c233d] to-[#0a2b46] border-sky-500/35 shadow-lg',
    summaryDividerClass: 'bg-sky-400/15',
    summaryKickerClass: 'text-sky-400',
    highlightFrameClass:
      'border-2 !border-sky-400 ring-1 ring-sky-400/35 shadow-[0_0_15px_rgba(56,189,248,0.28)]',
    highlightTextClass: 'text-sky-400',
    popoverBorderClass: 'bg-[#0B192C]/98 border-sky-500/40 text-sky-50 shadow-black/80',
    accentHex: '#0ea5e9',
    earthAtmosphereHex: 0x0ea5e9,
    earthRimHex: 0xbae6fd,
    earthCircleStroke: 'rgba(14, 165, 233, 0.28)',
    skyTopRgba: 'rgba(8, 35, 68, 0.90)',
    skyMidRgba: 'rgba(10, 28, 54, 0.58)',
    skyZenithRgba: 'rgba(14, 165, 233, 0.18)',
    previewSwatches: ['#06101E', '#075985', '#38BDF8'],
  },
  {
    id: 'sunset',
    name: 'Kızıl Şafak',
    subtitle: 'Sıcak kehribar ve alacakaranlık atmosferi',
    worldArtifactLabel: '🪐 Satürn Tipi Altın Gezegen Halkaları ve Çift Uydu',
    emoji: '🌅',
    isLight: false,
    bgPrimary: '#130B09',
    textPrimary: '#FFF7ED',
    modalBgClass: 'bg-[#1C110E] border-amber-900/50',
    dockBgClass: 'bg-[#1D120F]/95 border-amber-800/50 shadow-black/60',
    dockActiveBtnClass: 'bg-amber-400 text-slate-950 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#21120e] via-[#2c1610] to-[#361a12] border-amber-500/35 shadow-lg',
    summaryDividerClass: 'bg-amber-400/15',
    summaryKickerClass: 'text-amber-400',
    highlightFrameClass:
      'border-2 !border-amber-400 ring-1 ring-amber-400/35 shadow-[0_0_15px_rgba(245,158,11,0.28)]',
    highlightTextClass: 'text-amber-400',
    popoverBorderClass: 'bg-[#1D120F]/98 border-amber-500/40 text-amber-50 shadow-black/80',
    accentHex: '#f59e0b',
    earthAtmosphereHex: 0xf59e0b,
    earthRimHex: 0xfde68a,
    earthCircleStroke: 'rgba(245, 158, 11, 0.28)',
    skyTopRgba: 'rgba(58, 22, 14, 0.88)',
    skyMidRgba: 'rgba(42, 18, 15, 0.55)',
    skyZenithRgba: 'rgba(245, 158, 11, 0.16)',
    previewSwatches: ['#130B09', '#78350F', '#F59E0B'],
  },
  {
    id: 'amethyst',
    name: 'Kozmik Mor',
    subtitle: 'Derin nebula moru ve eflatun yansımalar',
    worldArtifactLabel: '🔮 3D Kristal Usturlap Çemberleri ve Sarmal Nebula',
    emoji: '🔮',
    isLight: false,
    bgPrimary: '#0D0818',
    textPrimary: '#FAF5FF',
    modalBgClass: 'bg-[#150D26] border-purple-900/60',
    dockBgClass: 'bg-[#160E29]/95 border-purple-800/50 shadow-black/60',
    dockActiveBtnClass: 'bg-purple-400 text-slate-950 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#1a0f2e] via-[#24133d] to-[#2e1549] border-purple-500/35 shadow-lg',
    summaryDividerClass: 'bg-purple-400/15',
    summaryKickerClass: 'text-purple-300',
    highlightFrameClass:
      'border-2 !border-purple-400 ring-1 ring-purple-400/35 shadow-[0_0_15px_rgba(168,85,247,0.3)]',
    highlightTextClass: 'text-purple-300',
    popoverBorderClass: 'bg-[#160E29]/98 border-purple-500/40 text-purple-50 shadow-black/80',
    accentHex: '#a855f7',
    earthAtmosphereHex: 0xa855f7,
    earthRimHex: 0xf3e8ff,
    earthCircleStroke: 'rgba(168, 85, 247, 0.28)',
    skyTopRgba: 'rgba(38, 16, 68, 0.88)',
    skyMidRgba: 'rgba(28, 12, 52, 0.55)',
    skyZenithRgba: 'rgba(168, 85, 247, 0.17)',
    previewSwatches: ['#0D0818', '#581C87', '#A855F7'],
  },
  {
    id: 'amoled',
    name: 'OLED Tam Siyah',
    subtitle: 'Gece nöbetleri için sıfır parlama ve pil tasarrufu',
    worldArtifactLabel: '🌑 Tam Güneş Tutulması (Elmas Halka) ve Taktik Jeodezik Ağ',
    emoji: '🖤',
    isLight: false,
    bgPrimary: '#000000',
    textPrimary: '#F8FAFC',
    modalBgClass: 'bg-[#09090B] border-zinc-800',
    dockBgClass: 'bg-[#09090B]/95 border-zinc-800 shadow-black',
    dockActiveBtnClass: 'bg-white text-black shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-[#09090b] via-[#121216] to-[#181218] border-zinc-800 shadow-lg',
    summaryDividerClass: 'bg-zinc-800',
    summaryKickerClass: 'text-rose-400',
    highlightFrameClass:
      'border-2 !border-rose-500 ring-1 ring-rose-500/40 shadow-[0_0_14px_rgba(244,63,94,0.25)]',
    highlightTextClass: 'text-rose-400',
    popoverBorderClass: 'bg-[#09090B]/98 border-zinc-700 text-zinc-100 shadow-black',
    accentHex: '#f43f5e',
    earthAtmosphereHex: 0x3b82f6,
    earthRimHex: 0x93c5fd,
    earthCircleStroke: 'rgba(255, 255, 255, 0.16)',
    skyTopRgba: 'rgba(5, 8, 18, 0.92)',
    skyMidRgba: 'rgba(3, 5, 12, 0.70)',
    skyZenithRgba: 'rgba(59, 130, 246, 0.08)',
    previewSwatches: ['#000000', '#18181B', '#F43F5E'],
  },
  {
    id: 'sand',
    name: 'Sıcak Kum',
    subtitle: 'Göz yormayan krem kağıt dokusu ve sıcak tonlar',
    worldArtifactLabel: '🧭 Antik Pirinç Pusula Çemberi ve Çöl Güneşi',
    emoji: '🏜️',
    isLight: true,
    bgPrimary: '#F5F2EB',
    textPrimary: '#1C1917',
    modalBgClass: 'bg-[#F5F2EB] border-stone-300',
    dockBgClass: 'bg-[#FAF8F5]/95 border-stone-300/90 shadow-stone-300/50',
    dockActiveBtnClass: 'bg-stone-900 text-amber-50 shadow-xs',
    summaryCardClass:
      'bg-gradient-to-r from-amber-100/75 via-[#FAF8F5] to-orange-100/65 border-amber-300/90 shadow-sm',
    summaryDividerClass: 'bg-amber-300/80',
    summaryKickerClass: 'text-orange-700',
    highlightFrameClass: 'border-2 !border-orange-600 ring-1 ring-orange-500/30 shadow-sm',
    highlightTextClass: 'text-orange-600',
    popoverBorderClass: 'bg-[#FAF8F5]/98 border-amber-300 text-stone-800 shadow-stone-300/70',
    accentHex: '#ea580c',
    earthAtmosphereHex: 0xf59e0b,
    earthRimHex: 0xfef3c7,
    earthCircleStroke: 'rgba(234, 88, 12, 0.25)',
    skyTopRgba: 'rgba(251, 191, 36, 0.36)',
    skyMidRgba: 'rgba(253, 230, 138, 0.24)',
    skyZenithRgba: 'rgba(254, 243, 199, 0.4)',
    previewSwatches: ['#F5F2EB', '#FDE68A', '#EA580C'],
  },
];

export function getThemePreset(themeId?: string): ThemePreset {
  return THEME_PRESETS.find((t) => t.id === themeId) || THEME_PRESETS[0];
}

export function isLightTheme(themeId?: string): boolean {
  return getThemePreset(themeId).isLight;
}

export interface SunTimesInfo {
  sunrise: Date;
  sunset: Date;
  sunriseText: string;
  sunsetText: string;
  isDaytime: boolean;
  usingCustomLocation: boolean;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function computeSolarEventLocalHours(
  date: Date,
  lat: number,
  lng: number,
  isSunrise: boolean
): number {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diffMs = date.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diffMs / 86400000);

  const lngHour = lng / 15;
  const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;

  const meanAnomaly = 0.9856 * t - 3.289;
  let trueLng =
    meanAnomaly +
    1.916 * Math.sin(meanAnomaly * DEG_TO_RAD) +
    0.02 * Math.sin(2 * meanAnomaly * DEG_TO_RAD) +
    282.634;
  trueLng = ((trueLng % 360) + 360) % 360;

  let rightAsc = RAD_TO_DEG * Math.atan(0.91764 * Math.tan(trueLng * DEG_TO_RAD));
  rightAsc = ((rightAsc % 360) + 360) % 360;
  const lQuadrant = Math.floor(trueLng / 90) * 90;
  const raQuadrant = Math.floor(rightAsc / 90) * 90;
  rightAsc = (rightAsc + (lQuadrant - raQuadrant)) / 15;

  const sinDec = 0.39782 * Math.sin(trueLng * DEG_TO_RAD);
  const cosDec = Math.cos(Math.asin(sinDec));

  // Official sunrise/sunset zenith = 90°50' (90.8333°)
  const cosH =
    (Math.cos(90.8333 * DEG_TO_RAD) - sinDec * Math.sin(lat * DEG_TO_RAD)) /
    (cosDec * Math.cos(lat * DEG_TO_RAD));

  if (cosH > 1) return isSunrise ? 7 : 17; // Fallback for polar night
  if (cosH < -1) return isSunrise ? 4 : 22; // Fallback for midnight sun

  const hDeg = isSunrise
    ? 360 - RAD_TO_DEG * Math.acos(cosH)
    : RAD_TO_DEG * Math.acos(cosH);
  const hHours = hDeg / 15;

  const localMeanTime = hHours + rightAsc - 0.06571 * t - 6.622;
  const utHours = (((localMeanTime - lngHour) % 24) + 24) % 24;

  const localOffsetHours = -date.getTimezoneOffset() / 60;
  return (((utHours + localOffsetHours) % 24) + 24) % 24;
}

export function calculateSunTimes(
  date: Date = new Date(),
  customLat?: number,
  customLng?: number
): SunTimesInfo {
  const hasCustom =
    typeof customLat === 'number' &&
    typeof customLng === 'number' &&
    Number.isFinite(customLat) &&
    Number.isFinite(customLng);

  // Default to Ankara/Turkey center when in TRT (+3), otherwise estimate solar meridian from local timezone
  const localOffsetHours = -date.getTimezoneOffset() / 60;
  const lat = hasCustom ? customLat : 39.9334;
  const lng = hasCustom
    ? customLng
    : Math.abs(localOffsetHours - 3) < 0.1
    ? 32.8597
    : localOffsetHours * 15;

  const sunriseHours = computeSolarEventLocalHours(date, lat, lng, true);
  const sunsetHours = computeSolarEventLocalHours(date, lat, lng, false);

  const toLocalDate = (hoursFloat: number) => {
    const totalMinutes = Math.round(hoursFloat * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0);
  };

  const sunrise = toLocalDate(sunriseHours);
  const sunset = toLocalDate(sunsetHours);
  const pad = (n: number) => String(n).padStart(2, '0');

  const nowMs = date.getTime();
  const isDaytime = nowMs >= sunrise.getTime() && nowMs < sunset.getTime();

  return {
    sunrise,
    sunset,
    sunriseText: `${pad(sunrise.getHours())}:${pad(sunrise.getMinutes())}`,
    sunsetText: `${pad(sunset.getHours())}:${pad(sunset.getMinutes())}`,
    isDaytime,
    usingCustomLocation: hasCustom,
  };
}

export function resolveEffectiveThemeId(
  settings: {
    theme: AppThemeId;
    autoThemeEnabled?: boolean;
    autoThemeDay?: AppThemeId;
    autoThemeNight?: AppThemeId;
    autoThemeLat?: number;
    autoThemeLng?: number;
  },
  now: Date = new Date()
): AppThemeId {
  if (!settings.autoThemeEnabled) {
    return settings.theme || 'dark';
  }
  const sun = calculateSunTimes(now, settings.autoThemeLat, settings.autoThemeLng);
  if (sun.isDaytime) {
    const dayTheme = settings.autoThemeDay || 'light';
    return getThemePreset(dayTheme).isLight ? dayTheme : 'light';
  }
  const nightTheme = settings.autoThemeNight || 'dark';
  return !getThemePreset(nightTheme).isLight ? nightTheme : 'dark';
}
