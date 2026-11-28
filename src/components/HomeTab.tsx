import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import {
  parseHM,
  querySingleDayForGroup,
  getEffectiveGroupIdxForDate,
  getEffectiveGroupMembersForShift,
  whoIsOnDutyAt,
  toISODate,
  createLocalDate,
  addDays,
  trDateFormatter,
} from '../shiftEngine';
import { Real3DEarth } from './Real3DEarth';
import { CalendarTab } from './CalendarTab';
import { getThemePreset } from '../themes';
import {
  DEFAULT_WEATHER_CITY,
  LiveWeatherInfo,
  fetchLiveWeatherForCity,
  getProvinceByName,
  loadCachedWeather,
} from '../utils/weather';

interface HomeTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  allNotes?: NoteItem[];
  isAdminBureauMode?: boolean;
  pendingLeaveRequestsCount?: number;
  activeProfileName?: string;
  dutyQueryDate: string;
  dutyQueryTime: string;
  isLiveDutyMode: boolean;
  onDutyDateChange: (date: string) => void;
  onDutyTimeChange: (time: string) => void;
  onResetLive: () => void;
  singleQueryDate: string;
  onSingleDateChange: (date: string) => void;
  onOpenQuickNote: (date: string) => void;
  onOpenSettings: () => void;
  onOpenBureauModal?: (
    section?: 'units' | 'identity' | 'shift_ref' | 'personnel' | 'records' | 'admins'
  ) => void;
  onOpenAnnouncementModal?: () => void;
  calendarYear?: number;
  calendarMonth?: number;
  calendarGroupIdx?: number;
  onMonthChange?: (year: number, month: number) => void;
  onGroupChange?: (idx: number) => void;
  onOpenRosterTable?: () => void;
  isActive?: boolean;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  settings,
  refHistory,
  notes,
  allNotes,
  isAdminBureauMode = false,
  pendingLeaveRequestsCount = 0,
  activeProfileName,
  dutyQueryTime,
  isLiveDutyMode,
  onDutyDateChange,
  onDutyTimeChange,
  onResetLive,
  singleQueryDate,
  onSingleDateChange,
  onOpenQuickNote,
  onOpenSettings,
  onOpenBureauModal,
  onOpenAnnouncementModal,
  calendarYear,
  calendarMonth,
  calendarGroupIdx = -2,
  onMonthChange,
  onGroupChange,
  onOpenRosterTable,
  isActive = true,
}) => {
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | null>(null);

  const selectedCityName = getProvinceByName(settings.weatherCity || DEFAULT_WEATHER_CITY).name;
  const [weather, setWeather] = useState<LiveWeatherInfo | null>(() =>
    loadCachedWeather(selectedCityName)
  );
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  const refreshWeather = useCallback(
    async (city: string, force = false) => {
      setWeatherLoading(true);
      const fresh = await fetchLiveWeatherForCity(city, force);
      if (fresh) {
        setWeather(fresh);
      }
      setWeatherLoading(false);
    },
    []
  );

  useEffect(() => {
    const cached = loadCachedWeather(selectedCityName);
    setWeather(cached);
    void refreshWeather(selectedCityName, false);

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void refreshWeather(selectedCityName, false);
      }
    }, 15 * 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const latest = loadCachedWeather(selectedCityName);
        if (!latest || Date.now() - latest.updatedAt > 10 * 60 * 1000) {
          void refreshWeather(selectedCityName, false);
        }
      }
    };
    const handleOnline = () => {
      void refreshWeather(selectedCityName, true);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [selectedCityName, refreshWeather]);

  const themePreset = getThemePreset(settings.theme);
  const isLight = themePreset.isLight;
  const isConfigured = refHistory && refHistory.length > 0;

  const [h, m] = parseHM(dutyQueryTime);
  const queryD = useMemo(() => {
    try {
      return createLocalDate(singleQueryDate);
    } catch {
      return new Date();
    }
  }, [singleQueryDate]);

  const queryDT = useMemo(() => {
    const d = new Date(queryD);
    d.setHours(h, m, 0, 0);
    return d;
  }, [queryD, h, m]);

  // Active shift at queryDT
  const currentShifts = useMemo(
    () => whoIsOnDutyAt(queryDT, settings, refHistory),
    [queryDT, settings, refHistory]
  );
  const currentSh = currentShifts[0] || null;
  const [dayStartH] = parseHM(settings.dayStart);
  const [nightStartH] = parseHM(settings.nightStart);
  const curIsNight = currentSh
    ? currentSh.shiftType === 'AKSAM'
    : h >= nightStartH || h < dayStartH;

  // Progress & remaining time of active shift
  const { progressFrac, remainText } = useMemo(() => {
    if (!currentSh) {
      return { progressFrac: 0, remainText: '' };
    }
    const totalMs = Math.max(1, currentSh.endDT.getTime() - currentSh.startDT.getTime());
    const elMs = queryDT.getTime() - currentSh.startDT.getTime();
    const frac = Math.min(1, Math.max(0, elMs / totalMs));
    const remMin = Math.max(0, Math.floor((currentSh.endDT.getTime() - queryDT.getTime()) / 60000));
    const remH = Math.floor(remMin / 60);
    const remM = remMin % 60;
    return {
      progressFrac: frac,
      remainText: `${remH} sa ${remM} dk kaldı`,
    };
  }, [currentSh, queryDT]);

  // Effective group index on singleQueryDate (moves to the swapped partner's group on swap days)
  const effectiveMyGroupIdx = useMemo(
    () => getEffectiveGroupIdxForDate(singleQueryDate, settings, refHistory, notes),
    [singleQueryDate, settings, refHistory, notes]
  );

  // User's own personal status for the bottom summary card (always shows only the user's own status)
  const myInfo = useMemo(
    () => querySingleDayForGroup(singleQueryDate, null, settings, refHistory, notes),
    [singleQueryDate, settings, refHistory, notes]
  );

  // Next upcoming shift for the bottom card
  const nextShiftText = useMemo(() => {
    if (!isConfigured) return 'Kurulum bekleniyor';
    for (let offset = 1; offset <= 14; offset++) {
      const nextISO = toISODate(addDays(queryD, offset));
      const info = querySingleDayForGroup(nextISO, null, settings, refHistory, notes);
      if (info.dayShift || info.nightShift) {
        const typeLbl = settings.is24HourSystem
          ? '24s'
          : info.dayShift
          ? '☀️ Gündüz'
          : '🌙 Gece';
        const dayLbl = offset === 1 ? 'Yarın' : `${offset} gün sonra`;
        return `${dayLbl} • ${typeLbl}`;
      }
    }
    return 'Planlı nöbet yok';
  }, [queryD, settings, refHistory, notes, isConfigured]);

  // User's primary status text for the bottom split card (only the user's status, no extra description line)
  const { bigStatus, accentBarColor } = useMemo(() => {
    if (!isConfigured) {
      return {
        bigStatus: 'Kurulum Bekleniyor',
        accentBarColor: 'bg-rose-500',
      };
    }
    if (myInfo.statusText.startsWith('🟪 İzinli')) {
      return {
        bigStatus: 'İzinli / Raporlu',
        accentBarColor: 'bg-purple-500',
      };
    }
    if (myInfo.statusText.startsWith('🟨 İcap Nöbeti')) {
      const isAksam = myInfo.statusText.includes('(A)');
      return {
        bigStatus: isAksam ? 'İcap Nöbeti (A)' : 'İcap Nöbeti (S)',
        accentBarColor: 'bg-yellow-400',
      };
    }
    const hasSwap =
      myInfo.statusText.includes('🔄') ||
      myInfo.statusText.includes('Becayiş') ||
      myInfo.statusText.includes('ile değişti');
    if (hasSwap) {
      if (myInfo.dayShift) {
        return {
          bigStatus: 'Gündüz (Becayiş)',
          accentBarColor: 'bg-amber-500',
        };
      }
      if (myInfo.nightShift) {
        return {
          bigStatus: 'Akşam (Becayiş)',
          accentBarColor: 'bg-rose-500',
        };
      }
      return {
        bigStatus: 'Becayiş İzinli',
        accentBarColor: 'bg-sky-500',
      };
    }
    if (myInfo.dayShift) {
      return {
        bigStatus: 'Gündüz Nöbeti',
        accentBarColor: 'bg-amber-500',
      };
    }
    if (myInfo.nightShift) {
      return {
        bigStatus: 'Akşam Nöbeti',
        accentBarColor: 'bg-rose-500',
      };
    }
    if (myInfo.morningCarryover) {
      return {
        bigStatus: 'Sabah Çıkışı',
        accentBarColor: 'bg-sky-400',
      };
    }
    return {
      bigStatus: 'İstirahat',
      accentBarColor: 'bg-slate-500',
    };
  }, [myInfo, isConfigured]);

  const activeGroupMemberDetails = useMemo(() => {
    if (!currentSh) {
      return { membersText: '', memberItems: [] };
    }
    const shiftStartISO = toISODate(currentSh.startDT);
    return getEffectiveGroupMembersForShift(
      shiftStartISO,
      currentSh.groupIdx,
      currentSh.shiftType,
      settings,
      refHistory,
      allNotes || notes,
      activeProfileName
    );
  }, [currentSh, settings, refHistory, allNotes, notes, activeProfileName]);

  const activeGroupMembers = activeGroupMemberDetails.membersText;
  const activeGroupMemberItems = activeGroupMemberDetails.memberItems;

  const shiftLabel = !isConfigured
    ? 'Hazır'
    : currentSh
    ? curIsNight
      ? 'Akşam Nöbeti'
      : 'Gündüz Nöbeti'
    : 'Nöbetçi Yok';

  const isTodaySelected = singleQueryDate === toISODate(new Date());

  const groupStatusList = useMemo(
    () =>
      Array.from({ length: settings.numGroups }, (_, i) =>
        querySingleDayForGroup(singleQueryDate, i, settings, refHistory, [])
      ),
    [singleQueryDate, settings, refHistory]
  );

  // General institution summary for Admin (İdari Büro) mode on singleQueryDate
  const adminDailySummary = useMemo(() => {
    const sourceNotes = allNotes || notes;
    let dayGroupIdx = -1;
    let nightGroupIdx = -1;
    groupStatusList.forEach((gInfo, idx) => {
      if (gInfo.dayShift) dayGroupIdx = idx;
      if (gInfo.nightShift) nightGroupIdx = idx;
    });

    const formatShortGroup = (gIdx: number) => {
      if (gIdx < 0) return '-';
      const raw = (settings.groupNames[gIdx] || `${gIdx + 1}. Grup`).trim();
      return raw;
    };

    const countGroupMembers = (gIdx: number) => {
      if (gIdx < 0) return 0;
      return (settings.groupMembers[gIdx] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean).length;
    };

    const dayMembersCount = countGroupMembers(dayGroupIdx);
    const nightMembersCount =
      settings.is24HourSystem || nightGroupIdx === dayGroupIdx
        ? 0
        : countGroupMembers(nightGroupIdx);
    const totalDutyMembers = dayMembersCount + nightMembersCount;

    const totalUnitMembers = Array.from({ length: settings.numGroups }, (_, g) =>
      countGroupMembers(g)
    ).reduce((a, b) => a + b, 0);

    const dayNotes = sourceNotes.filter((n) => n.date === singleQueryDate);
    let leaveCount = 0;
    let icapCount = 0;
    let swapCount = 0;
    for (const n of dayNotes) {
      const lower = `${n.type} ${n.desc}`.toLocaleLowerCase('tr-TR');
      if (
        n.type === 'İzin / Rapor' ||
        lower.includes('izin') ||
        lower.includes('rapor')
      ) {
        leaveCount++;
      } else if (n.type === 'İcap Nöbeti' || lower.includes('icap')) {
        icapCount++;
      } else if (n.type === 'Nöbet Değişimi') {
        swapCount++;
      }
    }

    const headline = !isConfigured
      ? 'Kurum Kurulumu Bekleniyor'
      : settings.is24HourSystem
      ? `24s: ${formatShortGroup(dayGroupIdx)}`
      : `☀️ ${formatShortGroup(dayGroupIdx)} · 🌙 ${formatShortGroup(nightGroupIdx)}`;

    const subParts: string[] = [];
    if (totalDutyMembers > 0) {
      subParts.push(`Nöbette ${totalDutyMembers} kişi`);
    } else if (totalUnitMembers > 0) {
      subParts.push(`Toplam ${totalUnitMembers} personel`);
    } else {
      subParts.push(`${settings.numGroups} Grup Aktif`);
    }

    if (leaveCount > 0) {
      subParts.push(`${leaveCount} İzinli`);
    } else {
      subParts.push('İzinli yok');
    }

    if (icapCount > 0) {
      subParts.push(`${icapCount} İcap`);
    }
    if (swapCount > 0) {
      subParts.push(`${swapCount} Değişim`);
    }
    if (pendingLeaveRequestsCount > 0) {
      subParts.push(`${pendingLeaveRequestsCount} Onay Bekliyor`);
    }

    return {
      headline,
      subline: subParts.join(' · '),
      leaveCount,
      icapCount,
      swapCount,
    };
  }, [
    allNotes,
    notes,
    groupStatusList,
    settings.groupNames,
    settings.groupMembers,
    settings.is24HourSystem,
    settings.numGroups,
    singleQueryDate,
    isConfigured,
    pendingLeaveRequestsCount,
  ]);

  const effectiveBigStatus = isAdminBureauMode ? adminDailySummary.headline : bigStatus;
  const effectiveSubStatus = isAdminBureauMode ? adminDailySummary.subline : nextShiftText;
  const effectiveAccentBarColor = isAdminBureauMode
    ? pendingLeaveRequestsCount > 0
      ? 'bg-amber-400'
      : 'bg-rose-500'
    : accentBarColor;

  const pctNum = Math.round(Math.min(100, Math.max(0, progressFrac * 100)));

  if (isAdminBureauMode) {
    return (
      <div className="h-full max-h-full w-full flex flex-col items-center justify-start gap-2.5 pt-3 sm:pt-4 pb-2 px-2.5 overflow-y-auto overflow-x-hidden select-none">
        {/* 1. TOP ADMIN HEADER: Framed Miniature 3D Rotating Earth on Left + Flush-Aligned Horizontal Bar Column on Right */}
        <div className="w-full max-w-[400px] flex items-stretch gap-2 shrink-0">
          {/* Top-Left Framed 112 Acil Çağrı Merkezi & Selected Province Badge Card (No 3D Earth in Admin Mode) */}
          <div
            className={`w-[98px] sm:w-[104px] rounded-2xl border p-2 shrink-0 flex flex-col items-center justify-center relative overflow-hidden shadow-xs ${
              isLight
                ? 'bg-white/95 border-slate-200/90'
                : 'bg-[#101521]/95 border-slate-800/90'
            }`}
          >
            {/* Top Overlapping Province Pill */}
            <div className="relative z-10 -mb-2 px-2.5 py-0.5 rounded-full bg-gradient-to-b from-[#ef4444] to-[#dc2626] border border-rose-300/80 shadow-[0_2px_6px_rgba(220,38,38,0.45)] max-w-[88px] flex items-center justify-center">
              <span className="font-display text-[8.5px] sm:text-[9px] font-black tracking-wider text-white uppercase leading-none truncate">
                {selectedCityName.toLocaleUpperCase('tr-TR')}
              </span>
            </div>

            {/* Official 112 Acil Çağrı Merkezi Two-Tone Emblem */}
            <div className="w-full max-w-[78px] rounded-[14px] overflow-hidden border-[1.5px] border-[#ef4444] shadow-[0_4px_14px_rgba(220,38,38,0.32)] flex flex-col">
              {/* Upper Red Block: 112 */}
              <div className="bg-gradient-to-b from-[#e11d48] via-[#dc2626] to-[#b91c1c] pt-2.5 pb-1 px-1 flex items-center justify-center">
                <span className="font-display text-[25px] sm:text-[27px] font-black leading-none tracking-tight text-white drop-shadow-xs tabular-nums">
                  112
                </span>
              </div>

              {/* Lower White Block: ACİL ÇAĞRI MERKEZİ */}
              <div className="bg-white py-1 px-1 flex flex-col items-center justify-center">
                <span className="font-display text-[10.5px] sm:text-[11px] font-black leading-none tracking-tight text-[#dc2626]">
                  ACİL
                </span>
                <span className="font-display text-[6.3px] sm:text-[6.8px] font-extrabold leading-tight tracking-tight text-[#dc2626] mt-0.5 whitespace-nowrap">
                  ÇAĞRI MERKEZİ
                </span>
              </div>
            </div>
          </div>

          {/* Right: Horizontally Aligned Bar-Form Info Container (flex-1 min-w-0, stretched to match Earth card height) */}
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5">
            {/* Bar 1 (Primary Live Shift Progress Bar Box) */}
            <div
              className={`relative flex-1 w-full min-w-0 rounded-2xl border px-3 py-2 flex flex-col justify-between gap-1.5 overflow-hidden transition shadow-xs ${
                isLight
                  ? 'bg-white/95 border-slate-200/90'
                  : 'bg-[#101521]/95 border-slate-800/90'
              }`}
            >
              {/* Live Shift Progress Fill inside the Bar Box */}
              <div
                className="absolute inset-y-0 left-0 pointer-events-none transition-all duration-500 ease-out"
                style={{
                  width: `${pctNum}%`,
                  background: curIsNight
                    ? isLight
                      ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.18) 0%, rgba(129, 140, 248, 0.30) 100%)'
                      : 'linear-gradient(90deg, rgba(79, 70, 229, 0.26) 0%, rgba(99, 102, 241, 0.40) 100%)'
                    : isLight
                    ? 'linear-gradient(90deg, rgba(245, 158, 11, 0.16) 0%, rgba(251, 191, 36, 0.30) 100%)'
                    : 'linear-gradient(90deg, rgba(217, 119, 6, 0.22) 0%, rgba(245, 158, 11, 0.36) 100%)',
                }}
              />

              {/* Bottom Progress Accent Track */}
              <div
                className={`absolute inset-x-0 bottom-0 h-[2.5px] pointer-events-none ${
                  isLight ? 'bg-slate-200/80' : 'bg-slate-800/90'
                }`}
              >
                <div
                  className="h-full transition-all duration-500 ease-out"
                  style={{
                    width: `${pctNum}%`,
                    backgroundColor: themePreset.accentHex,
                  }}
                />
              </div>

              {/* Upper Horizontal Line: Active Group + Shift Badge + Remaining Time (%) */}
              <div
                className={`relative z-10 flex items-center justify-between gap-1.5 min-w-0 pb-1 border-b ${
                  isLight ? 'border-slate-200/70' : 'border-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: themePreset.accentHex }}
                  />
                  <span
                    className={`font-display text-[13.5px] sm:text-[14.5px] font-black tracking-tight leading-none truncate min-w-0 ${
                      isLight ? 'text-slate-900' : 'text-white'
                    }`}
                    title={isConfigured && currentSh ? currentSh.groupName : '112'}
                  >
                    {isConfigured && currentSh ? currentSh.groupName : isConfigured ? '--' : '112'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenBureauModal?.('shift_ref')}
                    title="Vardiya Saatleri ve Referans Ayarlarını Aç"
                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold leading-none truncate shrink-0 border transition cursor-pointer ${
                      curIsNight
                        ? isLight
                          ? 'bg-indigo-100/90 hover:bg-indigo-200 border-indigo-300 text-indigo-800'
                          : 'bg-indigo-950/80 hover:bg-indigo-900 border-indigo-400/40 text-indigo-200'
                        : isLight
                        ? 'bg-amber-100/90 hover:bg-amber-200 border-amber-300 text-amber-800'
                        : 'bg-amber-950/80 hover:bg-amber-900 border-amber-400/40 text-amber-200'
                    }`}
                  >
                    {curIsNight ? '🌙 Gece' : '☀️ Gündüz'}
                  </button>
                </div>

                {remainText ? (
                  <div
                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold tabular-nums whitespace-nowrap shrink-0 ${
                      isLight
                        ? 'bg-slate-100/90 text-slate-700'
                        : 'bg-slate-900/75 text-slate-200'
                    }`}
                  >
                    <span style={{ color: themePreset.accentHex }}>%{pctNum}</span>
                    <span className="mx-0.5 opacity-50">•</span>
                    <span>{remainText}</span>
                  </div>
                ) : null}
              </div>

              {/* Lower Section: Complete On-Duty Personnel List */}
              <div className="relative z-10 flex flex-wrap items-center gap-1 min-w-0">
                {isConfigured && activeGroupMemberItems.length > 0 ? (
                  activeGroupMemberItems.map((item, idx) => (
                    <span
                      key={`${item.name}-${idx}`}
                      className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-bold leading-tight break-words inline-flex items-center gap-0.5 border ${
                        item.isSwappedIn
                          ? isLight
                            ? 'bg-emerald-50/95 text-emerald-800 border-emerald-300'
                            : 'bg-emerald-950/75 text-emerald-200 border-emerald-500/40'
                          : item.isExtraShift || item.isIcap
                          ? isLight
                            ? 'bg-amber-50/95 text-amber-900 border-amber-300'
                            : 'bg-amber-950/75 text-amber-200 border-amber-500/40'
                          : isLight
                          ? 'bg-slate-100/95 text-slate-800 border-slate-200/90'
                          : 'bg-slate-900/80 text-slate-100 border-slate-700/70'
                      }`}
                    >
                      {item.isSwappedIn && <span className="text-[8.5px]">🔄</span>}
                      {item.isExtraShift && <span className="text-[8.5px]">➕</span>}
                      {item.isIcap && <span className="text-[8.5px]">🟨</span>}
                      <span>{item.name}</span>
                    </span>
                  ))
                ) : (
                  <span
                    className={`text-[10px] font-semibold leading-tight ${
                      isLight ? 'text-slate-600' : 'text-slate-300'
                    }`}
                  >
                    {isConfigured
                      ? 'Bu vardiyada aktif nöbetçi personel bulunmuyor'
                      : 'Kurum vardiya kurulumu bekleniyor'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 2. EMBEDDED CALENDAR + 5 GROUP CARDS + MONTHLY ROSTER TABLE BUTTON + ADMIN PANEL, ANNOUNCEMENT & SETTINGS BUTTONS */}
        {typeof calendarYear === 'number' &&
          typeof calendarMonth === 'number' &&
          onMonthChange &&
          onGroupChange &&
          onOpenRosterTable && (
            <div className="w-full flex flex-col items-center shrink-0">
              <CalendarTab
                settings={settings}
                refHistory={refHistory}
                notes={notes}
                allNotes={allNotes}
                isAdminBureauMode={true}
                embeddedInAdminHome={true}
                pendingLeaveRequestsCount={pendingLeaveRequestsCount}
                calendarYear={calendarYear}
                calendarMonth={calendarMonth}
                calendarGroupIdx={calendarGroupIdx}
                onMonthChange={onMonthChange}
                onGroupChange={onGroupChange}
                onDayClick={onOpenQuickNote}
                singleQueryDate={singleQueryDate}
                dutyQueryTime={dutyQueryTime}
                isLiveDutyMode={isLiveDutyMode}
                onSingleDateChange={onSingleDateChange}
                onDutyDateChange={onDutyDateChange}
                onDutyTimeChange={onDutyTimeChange}
                onResetLive={onResetLive}
                onOpenRosterTable={onOpenRosterTable}
                onOpenBureauModal={onOpenBureauModal}
                onOpenAnnouncementModal={onOpenAnnouncementModal}
                onOpenSettings={onOpenSettings}
              />
            </div>
          )}
      </div>
    );
  }

  return (
    <div className="h-full max-h-full w-full flex flex-col items-center justify-center gap-3 py-0.5 px-3 select-none">
      {/* 1. 3D EARTH HERO WITH CENTERED OVERLAY & CURVED ARC */}
      <div className="w-full flex-shrink-0 flex items-center justify-center relative z-0">
        <Real3DEarth
          groupName={isConfigured && currentSh ? currentSh.groupName : isConfigured ? '--' : '112'}
          shiftType={shiftLabel}
          isNight={curIsNight}
          isLight={isLight}
          themeId={settings.theme}
          members={isConfigured ? activeGroupMembers : ''}
          remainText={remainText}
          progressFrac={progressFrac}
          isPaused={!isActive}
        />

        {/* If user selected a custom date/time from Calendar tab, show a compact badge to return to Live */}
        {(!isLiveDutyMode || !isTodaySelected) && (
          <button
            type="button"
            onClick={() => {
              setSelectedGroupIdx(null);
              onSingleDateChange(toISODate(new Date()));
              onResetLive();
            }}
            className="absolute bottom-1 z-30 px-3 py-1 rounded-full bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-400/50 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-lg cursor-pointer transition"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-200 animate-pulse" />
            <span>
              {trDateFormatter(singleQueryDate)} {dutyQueryTime} • Canlıya Dön
            </span>
          </button>
        )}
      </div>

      {/* 2. FIVE VERTICAL GROUP CARDS WITH EXPRESSIVE ICONS (1, 2, 3, 4, 5) */}
      <div className="w-full max-w-sm mt-[15px] relative z-30">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(5, settings.numGroups)}, minmax(0, 1fr))`,
          }}
        >
          {groupStatusList.map((gInfo, i) => {
            const isHighlighted = isAdminBureauMode
              ? currentSh
                ? i === currentSh.groupIdx
                : Boolean(gInfo.dayShift)
              : i === effectiveMyGroupIdx;

            let statusLabel = 'İstirahat';
            let iconEmoji = '🛋️';
            let cardBgClass = isLight
              ? 'bg-slate-100/95 border-slate-200/90 text-slate-600'
              : 'bg-[#101521]/95 border-slate-800/90 text-slate-400';
            let labelColorClass = isLight ? 'text-slate-500' : 'text-slate-400';

            if (isConfigured) {
              if (gInfo.nightShift) {
                statusLabel = 'Gece';
                iconEmoji = '🌙';
                cardBgClass = isLight
                  ? 'bg-indigo-50/95 border-indigo-300'
                  : 'bg-[#13162b]/95 border-indigo-500/40';
                labelColorClass = isLight ? 'text-indigo-700' : 'text-indigo-300';
              } else if (gInfo.dayShift) {
                statusLabel = 'Gündüz';
                iconEmoji = '☀️';
                cardBgClass = isLight
                  ? 'bg-amber-50/95 border-amber-300'
                  : 'bg-[#1f1912]/95 border-amber-500/45';
                labelColorClass = isLight ? 'text-amber-700' : 'text-amber-300';
              } else if (gInfo.morningCarryover) {
                statusLabel = 'Sabah çıkış';
                iconEmoji = '🌅';
                cardBgClass = isLight
                  ? 'bg-sky-50/95 border-sky-300'
                  : 'bg-[#0f1d27]/95 border-sky-500/45';
                labelColorClass = isLight ? 'text-sky-700' : 'text-sky-300';
              }
            }

            const highlightFrameClass = isHighlighted
              ? themePreset.highlightFrameClass
              : 'border';

            const rawName = settings.groupNames[i] || `${i + 1}. Grup`;
            const shortHeader = rawName === `${i + 1}. Grup` ? `${i + 1}` : rawName.replace('. Grup', '');

            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedGroupIdx(selectedGroupIdx === i ? null : i)}
                className={`py-2 px-1 rounded-2xl flex flex-col items-center justify-between min-h-[88px] transition cursor-pointer ${cardBgClass} ${highlightFrameClass}`}
              >
                <span
                  className={`font-display text-[15px] font-extrabold tracking-tight leading-none truncate max-w-full ${
                    isHighlighted
                      ? themePreset.highlightTextClass
                      : isLight
                      ? 'text-slate-800'
                      : 'text-white'
                  }`}
                >
                  {shortHeader}
                </span>

                <span className="text-2xl leading-none my-1 select-none" aria-hidden="true">
                  {iconEmoji}
                </span>

                <span className={`text-[10px] font-semibold leading-none tracking-[-0.01em] whitespace-nowrap ${labelColorClass}`}>
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Floating Group Members Popover when any group box is tapped (multi-line wrapped, no truncation, with Becayiş replacement) */}
        {selectedGroupIdx !== null && selectedGroupIdx < settings.numGroups && (() => {
          const selGroupInfo = querySingleDayForGroup(
            singleQueryDate,
            selectedGroupIdx,
            settings,
            refHistory,
            []
          );
          const effDateISO = selGroupInfo.dayShift
            ? singleQueryDate
            : selGroupInfo.nightShift
            ? singleQueryDate
            : selGroupInfo.morningCarryover
            ? toISODate(selGroupInfo.morningCarryover.startDT)
            : singleQueryDate;
          const effShiftType: 'GUNDUZ' | 'AKSAM' | null = selGroupInfo.dayShift
            ? 'GUNDUZ'
            : selGroupInfo.nightShift
            ? 'AKSAM'
            : selGroupInfo.morningCarryover
            ? 'AKSAM'
            : null;

          const { memberItems } = getEffectiveGroupMembersForShift(
            effDateISO,
            selectedGroupIdx,
            effShiftType,
            settings,
            refHistory,
            allNotes || notes,
            activeProfileName
          );

          return (
            <div
              className={`absolute left-0 right-0 top-full mt-2 z-40 p-3 rounded-2xl border shadow-2xl backdrop-blur-md animate-fade-in flex flex-col gap-2 ${themePreset.popoverBorderClass}`}
            >
              <div className="flex items-center justify-between gap-2 border-b pb-1.5 border-slate-500/15">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs leading-none">👥</span>
                  <span className={`text-xs font-extrabold ${themePreset.highlightTextClass}`}>
                    {settings.groupNames[selectedGroupIdx] || `${selectedGroupIdx + 1}. Grup`} Personelleri
                  </span>
                  {memberItems.length > 0 && (
                    <span className="text-[10px] font-bold text-slate-400">
                      ({memberItems.length} Kişi)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedGroupIdx(null)}
                  className="text-[11px] font-bold text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded-lg cursor-pointer"
                >
                  Kapat ✕
                </button>
              </div>

              {memberItems.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                  {memberItems.map((item, idx) => (
                    <span
                      key={`${item.name}-${idx}`}
                      className={`px-2.5 py-1 rounded-xl text-[11.5px] font-semibold leading-snug break-words flex items-center gap-1 ${
                        item.isSwappedIn
                          ? isLight
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                          : isLight
                          ? 'bg-slate-100 text-slate-800 border border-slate-200/80'
                          : 'bg-slate-800/90 text-slate-100 border border-slate-700/70'
                      }`}
                    >
                      {item.isSwappedIn && <span className="text-[10px]">🔄</span>}
                      <span>{item.name}</span>
                      {item.isSwappedIn && item.replacedName && (
                        <span className="text-[10px] opacity-75 font-medium">
                          ({item.replacedName} yerine)
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 py-1">
                  Bu grup için henüz personel tanımlanmamış.
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 4. BOTTOM SPLIT STATUS & LIVE WEATHER CARD */}
      <div
        className={`w-full max-w-sm rounded-3xl border p-3.5 sm:p-4 overflow-hidden transition ${themePreset.summaryCardClass}`}
      >
        <div className="grid grid-cols-[1.12fr_auto_0.95fr] items-center gap-2.5 sm:gap-3">
          {/* Left Column: Today's Status & Next Shift (or General Institution Summary in Admin Mode) */}
          <div
            onClick={() => {
              if (isAdminBureauMode && onOpenBureauModal) {
                onOpenBureauModal();
              }
            }}
            className={`flex flex-col justify-center text-left min-w-0 overflow-hidden ${
              isAdminBureauMode && onOpenBureauModal ? 'cursor-pointer' : ''
            }`}
          >
            <div
              className={`text-[10px] font-extrabold uppercase tracking-[0.12em] truncate ${themePreset.summaryKickerClass}`}
            >
              {isAdminBureauMode
                ? isTodaySelected
                  ? 'Bugünün Durumu · İdari Büro'
                  : `${trDateFormatter(singleQueryDate)} · İdari Büro`
                : isTodaySelected
                ? 'Bugünün Durumu'
                : trDateFormatter(singleQueryDate)}
            </div>

            <div
              className={`font-display mt-1 font-extrabold tracking-[-0.02em] leading-snug break-words ${
                effectiveBigStatus.length > 18
                  ? 'text-[13px] sm:text-[14.5px]'
                  : effectiveBigStatus.length > 14
                  ? 'text-[14.5px] sm:text-[16px]'
                  : effectiveBigStatus.length > 11
                  ? 'text-[16.5px] sm:text-[18px]'
                  : 'text-[19px] sm:text-[21px]'
              } ${isLight ? 'text-slate-900' : 'text-white'}`}
              title={effectiveBigStatus}
            >
              {effectiveBigStatus}
            </div>

            <div className="mt-1.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className={`w-2 h-2 rounded-full shrink-0 ${effectiveAccentBarColor}`} />
              {!isAdminBureauMode && myInfo.notes.length > 0 ? (
                <span
                  className="text-[10px] sm:text-[10.5px] font-bold text-amber-400 truncate min-w-0 flex-1"
                  title={`${myInfo.notes.length} Not • ${effectiveSubStatus}`}
                >
                  {myInfo.notes.length} Not • {effectiveSubStatus}
                </span>
              ) : (
                <span
                  className={`text-[10px] sm:text-[10.5px] font-semibold truncate min-w-0 flex-1 ${
                    isAdminBureauMode && pendingLeaveRequestsCount > 0
                      ? 'text-amber-400 font-bold'
                      : isLight
                      ? 'text-slate-600'
                      : 'text-slate-300/95'
                  }`}
                  title={effectiveSubStatus}
                >
                  {effectiveSubStatus}
                </span>
              )}
            </div>
          </div>

          {/* Vertical Divider */}
          <div className={`w-px h-14 shrink-0 ${themePreset.summaryDividerClass}`} />

          {/* Right Column: Selected Province Live Weather */}
          <div className="flex flex-col justify-center text-left min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] leading-none shrink-0">📍</span>
                <span
                  className={`text-[10px] font-extrabold uppercase tracking-[0.1em] truncate ${themePreset.summaryKickerClass}`}
                >
                  {selectedCityName}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void refreshWeather(selectedCityName, true);
                }}
                className={`px-1 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer shrink-0 ${
                  weatherLoading ? 'animate-spin opacity-70' : ''
                } ${
                  isLight
                    ? 'text-slate-500 hover:text-slate-900 hover:bg-black/5'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Hava Durumunu Güncelle"
                aria-label="Hava Durumunu Güncelle"
              >
                ↻
              </button>
            </div>

            <div
              className={`font-display mt-1 flex items-center gap-1.5 text-[19px] sm:text-[21px] font-extrabold tracking-[-0.02em] leading-tight tabular-nums ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {weather ? (
                <>
                  <span className="text-[18px] leading-none shrink-0">{weather.emoji}</span>
                  <span>{weather.temp}°</span>
                </>
              ) : (
                <span className="text-[16px] opacity-60">
                  {weatherLoading ? '...' : '--°'}
                </span>
              )}
            </div>

            <div
              className={`mt-1.5 text-[10px] sm:text-[10.5px] font-semibold leading-tight truncate ${
                isLight ? 'text-slate-600' : 'text-slate-300/95'
              }`}
              title={weather ? `${weather.label} · His. ${weather.feelsLike}°` : undefined}
            >
              {weather
                ? `${weather.label} · His. ${weather.feelsLike}°`
                : weatherLoading
                ? 'Hava durumu alınıyor...'
                : 'Hava durumu alınamadı'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
