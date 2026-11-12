import React, { useMemo, useState, useRef } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import {
  querySingleDayForGroup,
  getEffectiveGroupIdxForDate,
  buildICSContent,
  toISODate,
  trDateFormatter,
} from '../shiftEngine';
import { ChevronLeft, ChevronRight, Download, Share2, Copy, Check } from 'lucide-react';
import { useShare } from '../hooks/useShare';

interface CalendarTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  calendarYear: number;
  calendarMonth: number; // 1-12
  calendarGroupIdx: number; // -1 for auto / my group
  onMonthChange: (year: number, month: number) => void;
  onGroupChange: (idx: number) => void;
  onDayClick: (isoDate: string) => void;
  singleQueryDate: string;
  dutyQueryTime: string;
  isLiveDutyMode: boolean;
  onSingleDateChange: (date: string) => void;
  onDutyDateChange: (date: string) => void;
  onDutyTimeChange: (time: string) => void;
  onResetLive: () => void;
}

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export const CalendarTab: React.FC<CalendarTabProps> = ({
  settings,
  refHistory,
  notes,
  calendarYear,
  calendarMonth,
  calendarGroupIdx,
  onMonthChange,
  onGroupChange,
  onDayClick,
  singleQueryDate,
  isLiveDutyMode,
  onSingleDateChange,
  onDutyDateChange,
  onResetLive,
}) => {
  const isLight = settings.theme === 'light';
  const nowDate = new Date();
  const todayISO = toISODate(nowDate);
  const isCurrentMonth =
    calendarYear === nowDate.getFullYear() && calendarMonth === nowDate.getMonth() + 1;
  const isTodaySelected = singleQueryDate === todayISO;
  const { shareElement } = useShare();
  const screenRef = useRef<HTMLDivElement>(null);
  const [shiftFilter, setShiftFilter] = useState<'all' | 'day' | 'night'>('all');
  const [copiedSchedule, setCopiedSchedule] = useState(false);

  const handlePrevMonth = () => {
    if (calendarMonth === 1) {
      onMonthChange(calendarYear - 1, 12);
    } else {
      onMonthChange(calendarYear, calendarMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 12) {
      onMonthChange(calendarYear + 1, 1);
    } else {
      onMonthChange(calendarYear, calendarMonth + 1);
    }
  };

  const isGuestAllGroups = calendarGroupIdx === -2;

  const formatCompactGroupLabel = (gIdx: number): string => {
    const raw = (settings.groupNames[gIdx] || `${gIdx + 1}. Grup`).trim();
    const matchNum = raw.match(/^(\d+)\.\s*Grup$/i) || raw.match(/^Grup\s*(\d+)$/i);
    if (matchNum) {
      return `${matchNum[1]}.G`;
    }
    const cleaned = raw.replace(/\.?\s*Grup$/i, '').trim();
    return cleaned.length > 5 ? cleaned.slice(0, 5) : cleaned;
  };

  const { cells, dayCount, nightCount, restCount, totalHours } = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth - 1, 1);
    const lastDay = new Date(calendarYear, calendarMonth, 0).getDate();
    const startWeekday = (firstDay.getDay() + 6) % 7;

    let dayC = 0;
    let nightC = 0;
    let restC = 0;
    let hours = 0;

    const cellList: Array<{
      dayNum: number | null;
      isoDate: string;
      shiftKind: 'none' | 'day' | 'night' | '24h';
      shortLabel: string;
      dayGroupLabel: string;
      nightGroupLabel: string;
      hasNote: boolean;
      isSwap: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < startWeekday; i++) {
      cellList.push({
        dayNum: null,
        isoDate: '',
        shiftKind: 'none',
        shortLabel: '',
        dayGroupLabel: '',
        nightGroupLabel: '',
        hasNote: false,
        isSwap: false,
        isToday: false,
      });
    }

    const isConfigured = refHistory && refHistory.length > 0;

    for (let d = 1; d <= lastDay; d++) {
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = querySingleDayForGroup(
        iso,
        calendarGroupIdx >= 0 ? calendarGroupIdx : null,
        settings,
        refHistory,
        notes
      );

      const isSwapTargetDay = (notes || []).some(
        (it) =>
          it.type === 'Nöbet Değişimi' &&
          it.swapTargetDate &&
          it.swapTargetDate.trim() === iso
      );
      const hasRegularNote = (notes || []).some(
        (it) => it.type !== 'Nöbet Değişimi' && it.date === iso
      );

      let shiftKind: 'none' | 'day' | 'night' | '24h' = 'none';
      let shortLabel = '';

      if (settings.is24HourSystem) {
        if (info.dayShift || info.nightShift) {
          shiftKind = '24h';
          shortLabel = '24s';
          dayC++;
          hours += 24.0;
        } else {
          restC++;
        }
      } else {
        if (info.dayShift) {
          shiftKind = 'day';
          shortLabel = 'Gündüz';
          dayC++;
          hours += info.dayShift.durationHours;
        } else if (info.nightShift) {
          shiftKind = 'night';
          shortLabel = 'Gece';
          nightC++;
          hours += info.nightShift.durationHours;
        } else {
          restC++;
        }
      }

      // Compute which group is working Morning (Gündüz) and Night (Gece) on this day for Guest / All-Groups view
      // Pass [] for notes so individual swaps never erase a group's shift or overwrite another group's slot
      let dayGroupLabel = '-';
      let nightGroupLabel = '-';
      if (isConfigured) {
        for (let g = 0; g < settings.numGroups; g++) {
          const gInfo = querySingleDayForGroup(iso, g, settings, refHistory, []);
          const lbl = formatCompactGroupLabel(g);
          if (gInfo.dayShift) dayGroupLabel = lbl;
          if (gInfo.nightShift) nightGroupLabel = lbl;
        }
      }

      cellList.push({
        dayNum: d,
        isoDate: iso,
        shiftKind,
        shortLabel,
        dayGroupLabel,
        nightGroupLabel,
        hasNote: hasRegularNote,
        isSwap: isSwapTargetDay,
        isToday: iso === todayISO,
      });
    }

    // Pad only to complete the last week row (28, 35, or 42 cells) so active weeks can be vertically centered inside the fixed-height card
    while (cellList.length % 7 !== 0) {
      cellList.push({
        dayNum: null,
        isoDate: '',
        shiftKind: 'none',
        shortLabel: '',
        dayGroupLabel: '',
        nightGroupLabel: '',
        hasNote: false,
        isSwap: false,
        isToday: false,
      });
    }

    return {
      cells: cellList,
      dayCount: dayC,
      nightCount: nightC,
      restCount: restC,
      totalHours: Math.round(hours),
    };
  }, [calendarYear, calendarMonth, calendarGroupIdx, settings, refHistory, notes, todayISO]);

  const handleExportICS = () => {
    const icsContent = buildICSContent(
      calendarYear,
      calendarMonth,
      calendarGroupIdx >= 0 ? calendarGroupIdx : -1,
      settings,
      refHistory,
      notes
    );
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vardiya_${calendarYear}_${String(calendarMonth).padStart(2, '0')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyMonthText = async () => {
    const lastDay = new Date(calendarYear, calendarMonth, 0).getDate();

    if (isGuestAllGroups) {
      const lines: string[] = [
        `Tüm Gruplar - ${MONTH_NAMES_TR[calendarMonth - 1]} ${calendarYear} Nöbet Çizelgesi`,
      ];
      for (let d = 1; d <= lastDay; d++) {
        const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dt = new Date(calendarYear, calendarMonth - 1, d);
        const wd = WEEKDAYS[(dt.getDay() + 6) % 7];
        let dayG = '-';
        let nightG = '-';
        for (let g = 0; g < settings.numGroups; g++) {
          const gInfo = querySingleDayForGroup(iso, g, settings, refHistory, []);
          const gName = settings.groupNames[g] || `${g + 1}. Grup`;
          if (gInfo.dayShift) dayG = gName;
          if (gInfo.nightShift) nightG = gName;
        }
        lines.push(`${trDateFormatter(iso)} ${wd} -> ☀️ Gündüz: ${dayG} | 🌙 Gece: ${nightG}`);
      }
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        setCopiedSchedule(true);
        window.setTimeout(() => setCopiedSchedule(false), 2000);
      } catch {
        // ignore
      }
      return;
    }

    const firstInfo = querySingleDayForGroup(
      `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-01`,
      calendarGroupIdx >= 0 ? calendarGroupIdx : null,
      settings,
      refHistory,
      notes
    );
    const lines: string[] = [
      `${firstInfo.groupName} - ${MONTH_NAMES_TR[calendarMonth - 1]} ${calendarYear} Nöbet Listesi`,
    ];

    for (let d = 1; d <= lastDay; d++) {
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = querySingleDayForGroup(
        iso,
        calendarGroupIdx >= 0 ? calendarGroupIdx : null,
        settings,
        refHistory,
        notes
      );
      if (info.dayShift || info.nightShift) {
        const dt = new Date(calendarYear, calendarMonth - 1, d);
        const wd = WEEKDAYS[(dt.getDay() + 6) % 7];
        const label = settings.is24HourSystem
          ? '24 Saat'
          : info.dayShift
          ? 'Gündüz'
          : 'Gece';
        lines.push(`${trDateFormatter(iso)} ${wd}: ${label}`);
      }
    }

    lines.push(`Toplam: ${dayCount + nightCount} nöbet (${totalHours} saat)`);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedSchedule(true);
      window.setTimeout(() => setCopiedSchedule(false), 2000);
    } catch {
      // ignore
    }
  };

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleDayPointerDown = (isoDate: string) => {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(15);
        }
      } catch {
        // ignore
      }
      onSingleDateChange(isoDate);
      onDutyDateChange(isoDate);
      onDayClick(isoDate);
    }, 420);
  };

  const handleDayPointerUpOrCancel = () => {
    clearLongPressTimer();
  };

  const handleDayShortClick = (isoDate: string) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    onSingleDateChange(isoDate);
    onDutyDateChange(isoDate);
  };

  const isConfigured = refHistory && refHistory.length > 0;
  const effectiveGroupIdx = useMemo(
    () => getEffectiveGroupIdxForDate(singleQueryDate, settings, refHistory, notes),
    [singleQueryDate, settings, refHistory, notes]
  );

  return (
    <div
      ref={screenRef}
      className="h-full max-h-full w-full max-w-[400px] mx-auto flex flex-col items-center justify-center gap-2 select-none"
    >
      {/* 1. SPACIOUS ROUNDED CALENDAR CARD (Fixed height, days vertically centered inside) */}
      <div
        className={`w-full rounded-3xl border p-3.5 flex flex-col transition ${
          isLight
            ? 'bg-white/95 border-slate-200 shadow-sm'
            : 'bg-[#111622]/90 border-slate-800/90 shadow-lg'
        }`}
      >
        {/* Card Top Title, Guest/Group Switcher & Export Actions */}
        <div className="flex items-center justify-between gap-1.5 mb-2 px-0.5 flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="text-base font-black tracking-tight truncate">
              {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear}
            </h2>

            {/* Quick 1-Tap Misafir (All Groups) Toggle Button */}
            <button
              type="button"
              onClick={() => onGroupChange(isGuestAllGroups ? -1 : -2)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border transition cursor-pointer no-share shrink-0 flex items-center gap-1 ${
                isGuestAllGroups
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-xs'
                  : isLight
                  ? 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                  : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Misafir / Tüm Gruplar Görünümü"
            >
              <span>👥</span>
              <span>Misafir</span>
            </button>

            {/* Group Selector Dropdown */}
            <select
              value={calendarGroupIdx}
              onChange={(e) => onGroupChange(parseInt(e.target.value, 10))}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border outline-none cursor-pointer transition no-share shrink-0 ${
                isGuestAllGroups
                  ? isLight
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                  : isLight
                  ? 'bg-rose-50 border-rose-200 text-rose-600'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              <option value={-2} className="bg-slate-900 text-white">
                Tüm Gruplar
              </option>
              <option value={-1} className="bg-slate-900 text-white">
                Grubum
              </option>
              {Array.from({ length: settings.numGroups }, (_, i) => (
                <option key={i} value={i} className="bg-slate-900 text-white">
                  {settings.groupNames[i] || `${i + 1}. Grup`}
                </option>
              ))}
            </select>
          </div>

          {/* Export / Share Icons */}
          <div className="flex items-center gap-0.5 no-share shrink-0">
            <button
              type="button"
              onClick={handleCopyMonthText}
              className={`p-1.5 rounded-full transition cursor-pointer ${
                copiedSchedule
                  ? 'text-emerald-500'
                  : isLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Metin Olarak Kopyala"
              aria-label="Kopyala"
            >
              {copiedSchedule ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleExportICS}
              className={`p-1.5 rounded-full transition cursor-pointer ${
                isLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Takvime Ekle (.ics)"
              aria-label="İndir"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (screenRef.current) {
                  shareElement(
                    screenRef.current,
                    `vardiya-${calendarYear}-${String(calendarMonth).padStart(2, '0')}.png`
                  );
                }
              }}
              className={`p-1.5 rounded-full transition cursor-pointer ${
                isLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Görsel Paylaş"
              aria-label="Paylaş"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Weekday Header */}
        <div
          className={`grid grid-cols-7 gap-1.5 text-center pb-1.5 mb-1.5 border-b flex-shrink-0 ${
            isLight ? 'border-slate-200/80' : 'border-slate-800/80'
          }`}
        >
          {WEEKDAYS.map((wd, i) => (
            <div
              key={wd}
              className={`text-[10px] font-extrabold uppercase tracking-wider ${
                i >= 5
                  ? isLight
                    ? 'text-rose-500/80'
                    : 'text-rose-400/80'
                  : 'text-slate-400'
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        {/* Fixed-Height Vertically Centered Day Grid Container (Spacious height across 4, 5, and 6 week months!) */}
        <div className="h-[306px] sm:h-[318px] w-full flex flex-col justify-center">
          <div className="w-full grid grid-cols-7 gap-1.5">
            {cells.map((cell, idx) => {
              if (!cell.dayNum) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className={`h-[46px] sm:h-[48px] rounded-xl border border-transparent ${
                      isLight ? 'bg-slate-50/40' : 'bg-slate-900/20'
                    }`}
                  />
                );
              }

              const isSelectedDay = cell.isoDate === singleQueryDate;

              // MODE A: MISAFIR / TÜM GRUPLAR SPLIT CELL VIEW (Top: Morning Group, Bottom: Night Group)
              if (isGuestAllGroups) {
                const dimMorning = shiftFilter === 'night';
                const dimNight = shiftFilter === 'day';

                return (
                  <button
                    key={cell.isoDate}
                    type="button"
                    onPointerDown={() => handleDayPointerDown(cell.isoDate)}
                    onPointerUp={handleDayPointerUpOrCancel}
                    onPointerLeave={handleDayPointerUpOrCancel}
                    onPointerCancel={handleDayPointerUpOrCancel}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => handleDayShortClick(cell.isoDate)}
                    className={`relative h-[46px] sm:h-[48px] rounded-xl border flex flex-col overflow-hidden transition cursor-pointer ${
                      isLight
                        ? 'bg-slate-100 border-slate-200/90'
                        : 'bg-[#0c101a] border-slate-800/90'
                    } ${
                      cell.isToday
                        ? 'ring-2 ring-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.25)]'
                        : isSelectedDay
                        ? 'ring-2 ring-rose-500 border-rose-500'
                        : ''
                    }`}
                  >
                    {/* Top Mini Day Number Header */}
                    <div
                      className={`h-[14px] w-full px-1 flex items-center justify-between shrink-0 ${
                        cell.isToday
                          ? 'bg-sky-500/20 text-sky-400'
                          : isLight
                          ? 'bg-slate-200/70 text-slate-700'
                          : 'bg-slate-900/90 text-slate-300'
                      }`}
                    >
                      <span className="text-[9.5px] font-black leading-none mx-auto">
                        {cell.dayNum}
                      </span>
                      {(cell.isSwap || cell.hasNote) && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            cell.isSwap ? 'bg-sky-400' : 'bg-amber-400'
                          }`}
                        />
                      )}
                    </div>

                    {/* Upper Split Half: Sabah / Gündüz Group */}
                    <div
                      className={`flex-1 w-full flex items-center justify-center gap-0.5 px-0.5 transition ${
                        isLight
                          ? 'bg-amber-100/85 text-amber-900'
                          : 'bg-amber-500/20 text-amber-300'
                      } ${dimMorning ? 'opacity-20' : 'opacity-100'}`}
                    >
                      <span className="text-[7px] leading-none shrink-0">☀️</span>
                      <span className="text-[8px] font-extrabold leading-none tracking-tighter truncate">
                        {cell.dayGroupLabel}
                      </span>
                    </div>

                    {/* Lower Split Half: Gece / Akşam Group */}
                    <div
                      className={`flex-1 w-full flex items-center justify-center gap-0.5 px-0.5 border-t transition ${
                        isLight
                          ? 'bg-indigo-100/85 text-indigo-900 border-indigo-200/60'
                          : 'bg-indigo-500/25 text-indigo-200 border-white/5'
                      } ${dimNight ? 'opacity-20' : 'opacity-100'}`}
                    >
                      <span className="text-[7px] leading-none shrink-0">🌙</span>
                      <span className="text-[8px] font-extrabold leading-none tracking-tighter truncate">
                        {cell.nightGroupLabel}
                      </span>
                    </div>
                  </button>
                );
              }

              // MODE B: SINGLE GROUP VIEW (Grubum or 1..5. Grup)
              const isDimmed =
                (shiftFilter === 'day' && cell.shiftKind !== 'day' && cell.shiftKind !== '24h') ||
                (shiftFilter === 'night' && cell.shiftKind !== 'night');

              let cellStyle = isLight
                ? 'bg-slate-100/70 hover:bg-slate-200/70 border-slate-200/60 text-slate-600'
                : 'bg-slate-900/50 hover:bg-slate-800/70 border-slate-800/60 text-slate-400';
              let badgeColor = '';

              if (cell.shiftKind === 'day') {
                cellStyle = isLight
                  ? 'bg-amber-50 hover:bg-amber-100/80 border-amber-300 text-amber-950'
                  : 'bg-[#1f1912] hover:bg-[#292015] border-amber-500/40 text-amber-100';
                badgeColor = isLight ? 'text-amber-700' : 'text-amber-300';
              } else if (cell.shiftKind === 'night') {
                cellStyle = isLight
                  ? 'bg-rose-50 hover:bg-rose-100/80 border-rose-300 text-rose-950'
                  : 'bg-[#1c1222] hover:bg-[#25162d] border-rose-500/40 text-rose-100';
                badgeColor = isLight ? 'text-rose-700' : 'text-rose-300';
              } else if (cell.shiftKind === '24h') {
                cellStyle = isLight
                  ? 'bg-rose-50 hover:bg-rose-100/80 border-rose-300 text-rose-950'
                  : 'bg-[#1c1222] hover:bg-[#25162d] border-rose-500/40 text-rose-100';
                badgeColor = isLight ? 'text-rose-700' : 'text-rose-300';
              }

              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  onPointerDown={() => handleDayPointerDown(cell.isoDate)}
                  onPointerUp={handleDayPointerUpOrCancel}
                  onPointerLeave={handleDayPointerUpOrCancel}
                  onPointerCancel={handleDayPointerUpOrCancel}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => handleDayShortClick(cell.isoDate)}
                  className={`relative h-[46px] sm:h-[48px] px-0.5 rounded-xl border flex flex-col items-center justify-center gap-1 overflow-hidden transition cursor-pointer ${cellStyle} ${
                    cell.isToday
                      ? 'ring-2 ring-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.25)]'
                      : isSelectedDay
                      ? 'ring-2 ring-rose-500 border-rose-500'
                      : ''
                  } ${isDimmed ? 'opacity-20' : 'opacity-100'}`}
                >
                  {/* Note / Swap Indicator Dot */}
                  {(cell.isSwap || cell.hasNote) && (
                    <span
                      className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
                        cell.isSwap ? 'bg-sky-400' : 'bg-amber-400'
                      }`}
                    />
                  )}

                  {/* Day Number */}
                  <span
                    className={`text-xs leading-none ${
                      cell.isToday
                        ? 'font-black text-sky-400'
                        : cell.shiftKind !== 'none'
                        ? 'font-extrabold'
                        : 'font-semibold'
                    }`}
                  >
                    {cell.dayNum}
                  </span>

                  {/* Shift Label (Fits cleanly inside narrow cells with zero overflow) */}
                  {cell.shortLabel ? (
                    <span
                      className={`text-[8.5px] sm:text-[9px] font-bold tracking-tight leading-none max-w-full truncate ${badgeColor}`}
                    >
                      {cell.shortLabel}
                    </span>
                  ) : (
                    <span className="text-[8px] font-medium text-slate-500/60 leading-none">-</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. FIVE GROUP STATUS CARDS FOR THE SELECTED DAY (Distinct status colors + clear red highlight frame) */}
      <div className="w-full flex-shrink-0">
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(5, settings.numGroups)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: settings.numGroups }, (_, i) => {
            const gInfo = querySingleDayForGroup(singleQueryDate, i, settings, refHistory, []);
            const isHighlighted =
              calendarGroupIdx >= 0 ? i === calendarGroupIdx : i === effectiveGroupIdx;

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
                : 'border-2 !border-rose-500 ring-1 ring-rose-500/30 shadow-[0_0_14px_rgba(244,63,94,0.28)]'
              : 'border';

            const rawName = settings.groupNames[i] || `${i + 1}. Grup`;
            const shortHeader =
              rawName === `${i + 1}. Grup` ? `${i + 1}` : rawName.replace('. Grup', '');

            return (
              <button
                key={i}
                type="button"
                onClick={() => onGroupChange(calendarGroupIdx === i ? -1 : i)}
                className={`py-2 px-1 rounded-2xl flex flex-col items-center justify-between min-h-[70px] transition cursor-pointer ${cardBgClass} ${highlightFrameClass}`}
              >
                <span
                  className={`text-xs font-extrabold leading-none truncate max-w-full ${
                    isHighlighted
                      ? 'text-rose-400'
                      : isLight
                      ? 'text-slate-800'
                      : 'text-white'
                  }`}
                >
                  {shortHeader}
                </span>

                <span className="text-xl leading-none my-0.5 select-none" aria-hidden="true">
                  {iconEmoji}
                </span>

                <span
                  className={`text-[9px] sm:text-[9.5px] font-bold leading-none tracking-tighter whitespace-nowrap max-w-full ${labelColorClass}`}
                >
                  {statusLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. THUMB-ZONE MONTH & CANLI BAR */}
      <div
        data-no-swipe="true"
        className="w-full flex items-center gap-2 flex-shrink-0 relative z-30 no-share"
      >
        {/* Left Pill: Month Navigation (< Kasım 2026 >) */}
        <div
          className={`flex-1 h-10 rounded-full border flex items-center justify-between px-1 transition ${
            isLight
              ? 'bg-slate-100/95 border-slate-200 text-slate-800 shadow-xs'
              : 'bg-[#111622]/95 border-slate-800 text-slate-100 shadow-md'
          }`}
        >
          <button
            type="button"
            onClick={handlePrevMonth}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer active:scale-95 ${
              isLight
                ? 'hover:bg-slate-200/80 text-slate-700'
                : 'hover:bg-slate-800 text-slate-200'
            }`}
            aria-label="Önceki Ay"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-extrabold tracking-tight truncate px-1">
            {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear}
          </span>

          <button
            type="button"
            onClick={handleNextMonth}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer active:scale-95 ${
              isLight
                ? 'hover:bg-slate-200/80 text-slate-700'
                : 'hover:bg-slate-800 text-slate-200'
            }`}
            aria-label="Sonraki Ay"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Right Pill: Always-present "Canlı" reset button */}
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            onMonthChange(now.getFullYear(), now.getMonth() + 1);
            onSingleDateChange(toISODate(now));
            onResetLive();
          }}
          className={`h-10 px-4 rounded-full border text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
            isCurrentMonth && isLiveDutyMode && isTodaySelected
              ? 'bg-emerald-600/80 border-emerald-400/40 text-white shadow-sm'
              : isLight
              ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
              : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/70'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
          <span>Canlı</span>
        </button>
      </div>

      {/* 4. BOTTOM FILTER & MONTHLY SUMMARY CARD */}
      <div
        className={`w-full rounded-3xl border p-2.5 flex flex-col gap-2 flex-shrink-0 no-share ${
          isLight
            ? 'bg-gradient-to-r from-rose-50/90 via-white to-rose-50/70 border-rose-200 shadow-sm'
            : 'bg-gradient-to-r from-[#171320] via-[#21121f] to-[#2c121e] border-rose-500/30 shadow-lg'
        }`}
      >
        {/* Filter Pills */}
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => setShiftFilter('all')}
            className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
              shiftFilter === 'all'
                ? isLight
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white/15 text-white border border-white/15'
                : 'text-slate-400 hover:text-white bg-black/20'
            }`}
          >
            {isGuestAllGroups ? 'Tümü (Sabah+Gece)' : `Tümü (${dayCount + nightCount})`}
          </button>

          <button
            type="button"
            onClick={() => setShiftFilter(shiftFilter === 'day' ? 'all' : 'day')}
            className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
              shiftFilter === 'day'
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-amber-300 bg-black/20'
            }`}
          >
            <span className="text-[11px] leading-none">☀️</span>
            <span>{isGuestAllGroups ? 'Sabah' : `Gündüz (${dayCount})`}</span>
          </button>

          {!settings.is24HourSystem && (
            <button
              type="button"
              onClick={() => setShiftFilter(shiftFilter === 'night' ? 'all' : 'night')}
              className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                shiftFilter === 'night'
                  ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                  : 'text-slate-400 hover:text-rose-300 bg-black/20'
              }`}
            >
              <span className="text-[11px] leading-none">🌙</span>
              <span>{isGuestAllGroups ? 'Gece' : `Gece (${nightCount})`}</span>
            </button>
          )}
        </div>

        {/* Monthly Summary Row or Guest Legend */}
        <div
          className={`flex items-center justify-around pt-1.5 border-t text-[10.5px] font-bold ${
            isLight ? 'border-rose-200/70 text-slate-700' : 'border-white/10 text-slate-200'
          }`}
        >
          {isGuestAllGroups ? (
            <>
              <div className="flex items-center gap-1 text-amber-400">
                <span>☀️</span>
                <span>Sabah: {settings.dayStart}-{settings.dayEnd}</span>
              </div>
              <div className="flex items-center gap-1 text-rose-300">
                <span>🌙</span>
                <span>Gece: {settings.nightStart}-{settings.nightEnd}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <span>📅</span>
                <span>Nöbet: {dayCount + nightCount} gün</span>
              </div>
              <div className="flex items-center gap-1">
                <span>🛋️</span>
                <span>Dinlenme: {restCount} gün</span>
              </div>
              <div className="flex items-center gap-1">
                <span>🕗</span>
                <span>Toplam: {totalHours} sa</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
