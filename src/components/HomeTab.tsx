import React, { useState, useMemo } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import {
  parseHM,
  querySingleDayForGroup,
  getEffectiveGroupIdxForDate,
  whoIsOnDutyAt,
  toISODate,
  createLocalDate,
  trDateFormatter,
} from '../shiftEngine';
import { Real3DEarth } from './Real3DEarth';

interface HomeTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
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
}

export const HomeTab: React.FC<HomeTabProps> = ({
  settings,
  refHistory,
  notes,
  dutyQueryTime,
  isLiveDutyMode,
  onResetLive,
  singleQueryDate,
  onSingleDateChange,
  onOpenQuickNote,
  onOpenSettings,
}) => {
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | null>(null);

  const isLight = settings.theme === 'light';
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

  // Monthly statistics (Nöbet gün, Dinlenme gün, Toplam saat) for the user's own schedule
  const monthlyStats = useMemo(() => {
    const year = queryD.getFullYear();
    const month = queryD.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();

    if (!isConfigured) {
      return { dutyDays: 0, restDays: daysInMonth, totalHours: 0 };
    }

    let dutyDays = 0;
    let totalHours = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = querySingleDayForGroup(iso, null, settings, refHistory, notes);
      if (info.dayShift || info.nightShift) {
        dutyDays++;
        if (info.dayShift) totalHours += info.dayShift.durationHours;
        if (info.nightShift) totalHours += info.nightShift.durationHours;
      }
    }

    return {
      dutyDays,
      restDays: Math.max(0, daysInMonth - dutyDays),
      totalHours: Math.round(totalHours),
    };
  }, [queryD, settings, refHistory, notes, isConfigured]);

  // User's primary status text for the bottom split card (only the user's status, no extra description line)
  const { bigStatus, accentBarColor } = useMemo(() => {
    if (!isConfigured) {
      return {
        bigStatus: 'Kurulum Bekleniyor',
        accentBarColor: 'bg-rose-500',
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

  const activeGroupMembers = currentSh ? settings.groupMembers[currentSh.groupIdx] || '' : '';

  const shiftLabel = !isConfigured
    ? 'Hazır'
    : currentSh
    ? curIsNight
      ? 'Akşam Nöbeti'
      : 'Gündüz Nöbeti'
    : 'Nöbetçi Yok';

  const isTodaySelected = singleQueryDate === toISODate(new Date());

  return (
    <div className="h-full max-h-full w-full flex flex-col items-center justify-center gap-3 py-0.5 px-3 select-none">
      {/* 1. 3D EARTH HERO WITH CENTERED OVERLAY & CURVED ARC */}
      <div className="w-full flex-shrink-0 flex items-center justify-center relative z-0">
        <Real3DEarth
          groupName={isConfigured && currentSh ? currentSh.groupName : isConfigured ? '--' : '112'}
          shiftType={shiftLabel}
          isNight={curIsNight}
          isLight={isLight}
          members={isConfigured ? activeGroupMembers : ''}
          remainText={remainText}
          progressFrac={progressFrac}
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
      <div className="w-full max-w-sm">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(5, settings.numGroups)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: settings.numGroups }, (_, i) => {
            const gInfo = querySingleDayForGroup(singleQueryDate, i, settings, refHistory, []);
            const isHighlighted = i === effectiveMyGroupIdx;

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
              ? isLight
                ? 'border-2 !border-rose-500 ring-1 ring-rose-500/30 shadow-sm'
                : 'border-2 !border-rose-500 ring-1 ring-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.28)]'
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
                  className={`text-sm font-extrabold leading-none truncate max-w-full ${
                    isHighlighted
                      ? 'text-rose-400'
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

                <span className={`text-[9.5px] sm:text-[10px] font-bold leading-none tracking-tighter whitespace-nowrap ${labelColorClass}`}>
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Inline Group Members Preview when any group box is tapped */}
        {selectedGroupIdx !== null && selectedGroupIdx < settings.numGroups && (
          <div
            className={`mt-2 px-3 py-2 rounded-2xl border text-xs flex items-center justify-between animate-fade-in ${
              isLight
                ? 'bg-slate-100/95 border-slate-200 text-slate-800'
                : 'bg-[#111622]/95 border-rose-500/30 text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-xs leading-none">👥</span>
              <span className="font-bold text-rose-400 shrink-0">
                {settings.groupNames[selectedGroupIdx] || `${selectedGroupIdx + 1}. Grup`}:
              </span>
              <span className={`truncate font-medium ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                {settings.groupMembers[selectedGroupIdx]?.trim() || 'Personel tanımlanmamış'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedGroupIdx(null)}
              className="text-[11px] font-bold text-slate-400 hover:text-rose-400 ml-2 shrink-0 cursor-pointer"
            >
              Kapat
            </button>
          </div>
        )}
      </div>

      {/* 4. BOTTOM SPLIT STATUS & MONTHLY SUMMARY CARD */}
      <div
        onClick={() => {
          if (isConfigured) {
            onOpenQuickNote(singleQueryDate);
          } else {
            onOpenSettings();
          }
        }}
        className={`w-full max-w-sm rounded-3xl border p-3.5 sm:p-4 transition cursor-pointer ${
          isLight
            ? 'bg-gradient-to-r from-rose-50/90 via-white to-rose-50/70 border-rose-200 shadow-sm'
            : 'bg-gradient-to-r from-[#171320] via-[#21121f] to-[#2c121e] border-rose-500/30 shadow-lg'
        }`}
      >
        <div className="grid grid-cols-[1.15fr_auto_1fr] items-center gap-3">
          {/* Left Column: Today's Status (Only User's Status) */}
          <div className="flex flex-col justify-center text-left min-w-0">
            <div className="text-[11px] font-semibold text-slate-400 truncate">
              {isTodaySelected ? 'Bugünün Durumu' : trDateFormatter(singleQueryDate)}
            </div>

            <div
              className={`mt-1 text-xl sm:text-2xl font-black tracking-tight leading-tight truncate ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {bigStatus}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <span className={`w-10 h-1 rounded-full ${accentBarColor}`} />
              {myInfo.notes.length > 0 && (
                <span className="text-[10px] font-bold text-amber-400">
                  • {myInfo.notes.length} Not
                </span>
              )}
            </div>
          </div>

          {/* Vertical Divider */}
          <div className={`w-px h-14 ${isLight ? 'bg-rose-200/80' : 'bg-white/10'}`} />

          {/* Right Column: Monthly Stats */}
          <div className="flex flex-col justify-center gap-1.5 text-xs font-bold">
            <div className="flex items-center gap-2">
              <span className="text-xs leading-none">📅</span>
              <span className={isLight ? 'text-slate-800' : 'text-slate-100'}>
                Nöbet: {monthlyStats.dutyDays} gün
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs leading-none">🛋️</span>
              <span className={isLight ? 'text-slate-800' : 'text-slate-100'}>
                Dinlenme: {monthlyStats.restDays} gün
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs leading-none">🕗</span>
              <span className={isLight ? 'text-slate-800' : 'text-slate-100'}>
                Toplam: {monthlyStats.totalHours} sa
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
