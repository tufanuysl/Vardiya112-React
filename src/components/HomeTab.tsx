import React, { useState, useMemo } from 'react';
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
import { getThemePreset } from '../themes';

const DAILY_DUTY_QUOTES: Array<{ text: string; tag: string }> = [
  {
    text: 'Bir hayat kurtarmak, bütün insanlığı yaşatmak gibidir.',
    tag: 'Günün Sözü',
  },
  {
    text: 'Zorluklar gece gibidir; sabırla görev yapanın ufku her zaman aydınlanır.',
    tag: 'Nöbet Motivasyonu',
  },
  {
    text: 'Sakin kalmak, en kritik anda en doğru kararı vermenin anahtarıdır.',
    tag: '112 Ruhu',
  },
  {
    text: 'İyi bir ekip, en uzun nöbeti bile güven ve huzurla kısaltır.',
    tag: 'Ekip Ruhu',
  },
  {
    text: 'Başkalarının en zor anında yanında olmak, en onurlu görevdir.',
    tag: 'Görev Bilinci',
  },
  {
    text: 'Dinlenmek vazgeçmek değil, yeni bir nöbete güç toplamaktır.',
    tag: 'İstirahat & Denge',
  },
  {
    text: 'Her siren sesi bir umut, her müdahale yeni bir başlangıçtır.',
    tag: 'Acil Çağrı',
  },
  {
    text: 'Geceyi aydınlatan yıldızlar değil, görev başında uyanık kalan yüreklerdir.',
    tag: 'Gece Nöbeti',
  },
  {
    text: 'Tecrübe, soğukkanlılıkla birleştiğinde imkânsız görüneni başarır.',
    tag: 'Profesyonellik',
  },
  {
    text: 'Zamanla yarışanların en büyük gücü, birbirine duyduğu güvendir.',
    tag: 'Dayanışma',
  },
  {
    text: 'Umut, en karanlık gecede bile nöbeti devralmaya hazır olmaktır.',
    tag: 'Umut & Azim',
  },
  {
    text: 'Bir tebessüm ve sakin bir ses tonu, en güçlü ilk yardımdır.',
    tag: 'İnsan Odaklı',
  },
];

interface HomeTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
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
}

export const HomeTab: React.FC<HomeTabProps> = ({
  settings,
  refHistory,
  notes,
  activeProfileName,
  dutyQueryTime,
  isLiveDutyMode,
  onResetLive,
  singleQueryDate,
  onSingleDateChange,
  onOpenQuickNote,
  onOpenSettings,
}) => {
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | null>(null);
  const [quoteOffset, setQuoteOffset] = useState<number>(0);

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

  // Next upcoming shift & Daily Quote for the bottom card
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

  const activeQuote = useMemo(() => {
    const daySeed =
      queryD.getFullYear() * 372 + (queryD.getMonth() + 1) * 31 + queryD.getDate();
    const idx = (daySeed + quoteOffset) % DAILY_DUTY_QUOTES.length;
    return DAILY_DUTY_QUOTES[idx];
  }, [queryD, quoteOffset]);

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

  const activeGroupMembers = useMemo(() => {
    if (!currentSh) return '';
    const shiftStartISO = toISODate(currentSh.startDT);
    return getEffectiveGroupMembersForShift(
      shiftStartISO,
      currentSh.groupIdx,
      currentSh.shiftType,
      settings,
      refHistory,
      notes,
      activeProfileName
    ).membersText;
  }, [currentSh, settings, refHistory, notes, activeProfileName]);

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
          themeId={settings.theme}
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
      <div className="w-full max-w-sm mt-[15px] relative z-30">
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
            notes,
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

      {/* 4. BOTTOM SPLIT STATUS & DAILY QUOTE CARD */}
      <div
        onClick={() => {
          if (isConfigured) {
            onOpenQuickNote(singleQueryDate);
          } else {
            onOpenSettings();
          }
        }}
        className={`w-full max-w-sm rounded-3xl border p-3.5 sm:p-4 transition cursor-pointer ${themePreset.summaryCardClass}`}
      >
        <div className="grid grid-cols-[1.05fr_auto_1.2fr] items-center gap-3">
          {/* Left Column: Today's Status & Next Shift */}
          <div className="flex flex-col justify-center text-left min-w-0">
            <div
              className={`text-[10px] font-extrabold uppercase tracking-[0.14em] truncate ${themePreset.summaryKickerClass}`}
            >
              {isTodaySelected ? 'Bugünün Durumu' : trDateFormatter(singleQueryDate)}
            </div>

            <div
              className={`font-display mt-1 text-[20px] sm:text-[22px] font-extrabold tracking-[-0.02em] leading-tight truncate ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              {bigStatus}
            </div>

            <div className="mt-2 flex items-center gap-1.5 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${accentBarColor}`} />
              {myInfo.notes.length > 0 ? (
                <span className="text-[10.5px] font-bold text-amber-400 whitespace-nowrap">
                  {myInfo.notes.length} Not • {nextShiftText}
                </span>
              ) : (
                <span
                  className={`text-[10.5px] font-semibold whitespace-nowrap ${
                    isLight ? 'text-slate-600' : 'text-slate-300/95'
                  }`}
                >
                  {nextShiftText}
                </span>
              )}
            </div>
          </div>

          {/* Vertical Divider */}
          <div className={`w-px h-14 ${themePreset.summaryDividerClass}`} />

          {/* Right Column: Motivational Duty Quote (Tap ↻ to cycle quote) */}
          <div className="flex flex-col justify-between min-w-0 text-left">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span
                className={`text-[9.5px] font-extrabold uppercase tracking-wider truncate ${themePreset.summaryKickerClass}`}
              >
                ✨ {activeQuote.tag}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuoteOffset((prev) => prev + 1);
                }}
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer shrink-0 ${
                  isLight
                    ? 'text-slate-500 hover:text-slate-900 hover:bg-black/5'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Başka Söz Göster"
                aria-label="Başka Söz Göster"
              >
                ↻
              </button>
            </div>

            <p
              className={`text-[11px] sm:text-[11.5px] font-medium italic leading-snug line-clamp-3 ${
                isLight ? 'text-slate-700' : 'text-slate-200/95'
              }`}
            >
              “{activeQuote.text}”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
