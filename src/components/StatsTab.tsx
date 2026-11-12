import React, { useMemo, useState } from 'react';
import { AppSettings, NoteItem, RefRecord, ShiftInstance } from '../types';
import {
  querySingleDayForGroup,
  toISODate,
  addDays,
  trDateFormatter,
  formatTimeHHMM,
} from '../shiftEngine';
import {
  Sun,
  Moon,
  Clock,
  CalendarCheck,
  Users,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ShieldAlert,
  Calendar,
  Award,
} from 'lucide-react';

interface StatsTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  calendarYear: number;
  calendarMonth: number; // 1-12
  onMonthChange: (year: number, month: number) => void;
  onJumpToDate: (isoDate: string) => void;
  onOpenSettings: () => void;
}

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

const WEEKDAYS_LONG = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
];

export const StatsTab: React.FC<StatsTabProps> = ({
  settings,
  refHistory,
  notes,
  calendarYear,
  calendarMonth,
  onMonthChange,
  onJumpToDate,
  onOpenSettings,
}) => {
  const isLight = settings.theme === 'light';
  const isConfigured = refHistory && refHistory.length > 0;
  const [viewMode, setViewMode] = useState<'upcoming' | 'groups' | 'yearly'>('upcoming');

  const activeGroupIdx = useMemo(() => {
    if (!isConfigured) return 0;
    return refHistory[refHistory.length - 1].myGroupIdx;
  }, [refHistory, isConfigured]);

  const activeGroupName =
    settings.groupNames[activeGroupIdx] || `${activeGroupIdx + 1}. Grup`;

  // 1. Compute Upcoming 5 Shifts for User's Group from Now
  const upcomingShifts = useMemo(() => {
    if (!isConfigured) return [];
    const now = new Date();
    const list: Array<{
      isoDate: string;
      weekday: string;
      shift: ShiftInstance;
      isActiveNow: boolean;
      hoursUntil: number;
      daysUntil: number;
      isSwapped: boolean;
    }> = [];

    for (let offset = -1; offset <= 30 && list.length < 5; offset++) {
      const d = addDays(now, offset);
      const iso = toISODate(d);
      const info = querySingleDayForGroup(iso, null, settings, refHistory, notes);
      const sh = info.dayShift || info.nightShift;
      if (!sh) continue;

      const isActiveNow =
        now.getTime() >= sh.startDT.getTime() && now.getTime() < sh.endDT.getTime();
      const isFuture = sh.startDT.getTime() > now.getTime();

      if (isActiveNow || isFuture) {
        const diffMs = Math.max(0, sh.startDT.getTime() - now.getTime());
        const totalHoursUntil = Math.floor(diffMs / 3600000);
        const daysUntil = Math.floor(totalHoursUntil / 24);
        const hoursUntil = totalHoursUntil % 24;
        const wd = WEEKDAYS_LONG[(d.getDay() + 6) % 7];

        list.push({
          isoDate: iso,
          weekday: wd,
          shift: sh,
          isActiveNow,
          hoursUntil,
          daysUntil,
          isSwapped: info.statusText.includes('🔄'),
        });
      }
    }
    return list;
  }, [isConfigured, settings, refHistory, notes]);

  // 2. Selected Month Detailed Breakdown for User's Group
  const monthMetrics = useMemo(() => {
    const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    let dayShifts = 0;
    let nightShifts = 0;
    let weekendShifts = 0;
    let restDays = 0;
    let totalHours = 0;
    let swapCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      const info = querySingleDayForGroup(iso, null, settings, refHistory, notes);
      const dt = new Date(calendarYear, calendarMonth - 1, d);
      const isWeekend = (dt.getDay() + 6) % 7 >= 5;

      if (info.statusText.includes('🔄')) {
        swapCount++;
      }

      const sh = info.dayShift || info.nightShift;
      if (sh) {
        if (info.dayShift) dayShifts++;
        else nightShifts++;
        if (isWeekend) weekendShifts++;
        totalHours += sh.durationHours;
      } else {
        restDays++;
      }
    }

    return {
      daysInMonth,
      dayShifts,
      nightShifts,
      totalShifts: dayShifts + nightShifts,
      weekendShifts,
      restDays,
      totalHours: Math.round(totalHours),
      swapCount,
    };
  }, [calendarYear, calendarMonth, settings, refHistory, notes]);

  // 3. All Groups Comparison for Selected Month
  const groupComparison = useMemo(() => {
    if (!isConfigured) return [];
    const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    return Array.from({ length: settings.numGroups }, (_, gIdx) => {
      let dCount = 0;
      let nCount = 0;
      let wkCount = 0;
      let hrs = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(
          d
        ).padStart(2, '0')}`;
        const info = querySingleDayForGroup(iso, gIdx, settings, refHistory, notes);
        const dt = new Date(calendarYear, calendarMonth - 1, d);
        const isWeekend = (dt.getDay() + 6) % 7 >= 5;
        const sh = info.dayShift || info.nightShift;
        if (sh) {
          if (info.dayShift) dCount++;
          else nCount++;
          if (isWeekend) wkCount++;
          hrs += sh.durationHours;
        }
      }

      return {
        groupIdx: gIdx,
        groupName: settings.groupNames[gIdx] || `${gIdx + 1}. Grup`,
        members: settings.groupMembers[gIdx] || '',
        dayShifts: dCount,
        nightShifts: nCount,
        weekendShifts: wkCount,
        totalHours: Math.round(hrs),
      };
    });
  }, [isConfigured, calendarYear, calendarMonth, settings, refHistory, notes]);

  // 4. 12-Month Annual Summary for Selected Year
  const yearlyOverview = useMemo(() => {
    if (!isConfigured) return { months: [], yearTotalHours: 0, yearTotalShifts: 0 };
    let yearTotalHours = 0;
    let yearTotalShifts = 0;

    const months = MONTH_NAMES_TR.map((mName, mIdx) => {
      const mNum = mIdx + 1;
      const daysInM = new Date(calendarYear, mNum, 0).getDate();
      let dC = 0;
      let nC = 0;
      let hrs = 0;

      for (let d = 1; d <= daysInM; d++) {
        const iso = `${calendarYear}-${String(mNum).padStart(2, '0')}-${String(d).padStart(
          2,
          '0'
        )}`;
        const info = querySingleDayForGroup(iso, null, settings, refHistory, notes);
        const sh = info.dayShift || info.nightShift;
        if (sh) {
          if (info.dayShift) dC++;
          else nC++;
          hrs += sh.durationHours;
        }
      }

      const roundedHrs = Math.round(hrs);
      yearTotalHours += roundedHrs;
      yearTotalShifts += dC + nC;

      return {
        monthNum: mNum,
        monthShort: mName.slice(0, 3),
        monthName: mName,
        dayCount: dC,
        nightCount: nC,
        totalShifts: dC + nC,
        hours: roundedHrs,
      };
    });

    return { months, yearTotalHours, yearTotalShifts };
  }, [isConfigured, calendarYear, settings, refHistory, notes]);

  const cardSurface = isLight
    ? 'bg-white border-slate-200/90 shadow-sm'
    : 'bg-[#131722] border-slate-800/90 shadow-lg';
  const subSurface = isLight
    ? 'bg-slate-50 border-slate-200/80'
    : 'bg-[#0F172A]/90 border-slate-800/80';

  const handlePrevMonth = () => {
    if (calendarMonth === 1) onMonthChange(calendarYear - 1, 12);
    else onMonthChange(calendarYear, calendarMonth - 1);
  };

  const handleNextMonth = () => {
    if (calendarMonth === 12) onMonthChange(calendarYear + 1, 1);
    else onMonthChange(calendarYear, calendarMonth + 1);
  };

  if (!isConfigured) {
    return (
      <div className="h-full w-full py-2 flex flex-col items-center justify-center">
        <div
          className={`w-full rounded-3xl border p-6 text-center flex flex-col items-center gap-3 ${cardSurface}`}
        >
          <div className="w-12 h-12 rounded-2xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h3 className="text-base font-black">Vardiya Analizi Hazır Değil</h3>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            Yaklaşan nöbetlerinizi, aylık mesai saatlerinizi ve grup karşılaştırma tablosunu
            görmek için önce vardiya döngünüzü tanımlayın.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer"
          >
            Vardiya Döngüsünü Tanımla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full py-1 flex flex-col justify-between gap-2 overflow-hidden select-none">
      {/* 1. TOP SUMMARY & MONTH SELECTOR CARD */}
      <div className={`w-full rounded-3xl border p-3.5 flex flex-col gap-2.5 shrink-0 ${cardSurface}`}>
        {/* Header + Month Selector */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                isLight ? 'bg-sky-50 text-sky-600' : 'bg-sky-500/15 text-sky-400'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black tracking-tight truncate">
                {activeGroupName} · Mesai Analizi
              </div>
              <div className="text-[10px] text-slate-400">
                {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear} Dönemi
              </div>
            </div>
          </div>

          {/* Month Switcher */}
          <div className={`flex items-center gap-1 p-1 rounded-xl border ${subSurface}`}>
            <button
              type="button"
              onClick={handlePrevMonth}
              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-slate-500/15 transition cursor-pointer"
              aria-label="Önceki Ay"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-extrabold px-1.5 whitespace-nowrap">
              {MONTH_NAMES_TR[calendarMonth - 1].slice(0, 3)} {calendarYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="w-6 h-6 rounded-xl flex items-center justify-center hover:bg-slate-500/15 transition cursor-pointer"
              aria-label="Sonraki Ay"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4 Key Monthly KPIs */}
        <div className="grid grid-cols-4 gap-1.5">
          <div className={`p-2 rounded-2xl border text-center ${subSurface}`}>
            <div className="text-[9px] font-bold uppercase text-slate-400">Toplam Süre</div>
            <div className="text-sm font-black text-sky-500 mt-0.5">
              {monthMetrics.totalHours} <span className="text-[10px] font-bold">sa</span>
            </div>
          </div>
          <div className={`p-2 rounded-2xl border text-center ${subSurface}`}>
            <div className="text-[9px] font-bold uppercase text-slate-400">Gündüz / Gece</div>
            <div className="text-sm font-black mt-0.5 flex items-center justify-center gap-1">
              <span className="text-amber-500">{monthMetrics.dayShifts}</span>
              <span className="text-slate-400 text-xs">/</span>
              <span className="text-indigo-400">{monthMetrics.nightShifts}</span>
            </div>
          </div>
          <div className={`p-2 rounded-2xl border text-center ${subSurface}`}>
            <div className="text-[9px] font-bold uppercase text-slate-400">Hafta Sonu</div>
            <div className="text-sm font-black text-rose-500 mt-0.5">
              {monthMetrics.weekendShifts} <span className="text-[10px] font-bold">gün</span>
            </div>
          </div>
          <div className={`p-2 rounded-2xl border text-center ${subSurface}`}>
            <div className="text-[9px] font-bold uppercase text-slate-400">İstirahat</div>
            <div className="text-sm font-black text-emerald-500 mt-0.5">
              {monthMetrics.restDays} <span className="text-[10px] font-bold">gün</span>
            </div>
          </div>
        </div>

        {/* Work vs Rest Ratio Visual Bar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] font-bold">
            <span className="text-slate-400">
              Aylık Yoğunluk: {monthMetrics.totalShifts} Nöbet / {monthMetrics.restDays} İstirahat
            </span>
            <span className="text-sky-400">
              %{Math.round((monthMetrics.totalShifts / Math.max(1, monthMetrics.daysInMonth)) * 100)}{' '}
              Görev Günü
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-800/40">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{
                width: `${(monthMetrics.dayShifts / Math.max(1, monthMetrics.daysInMonth)) * 100}%`,
              }}
              title="Gündüz Nöbeti"
            />
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{
                width: `${(monthMetrics.nightShifts / Math.max(1, monthMetrics.daysInMonth)) * 100}%`,
              }}
              title="Akşam Nöbeti"
            />
            <div
              className="h-full bg-emerald-500/35 transition-all flex-1"
              title="İstirahat Günleri"
            />
          </div>
        </div>
      </div>

      {/* 2. SEGMENTED SUB-VIEW SWITCHER */}
      <div
        className={`w-full grid grid-cols-3 gap-1 p-1 rounded-2xl border shrink-0 ${
          isLight ? 'bg-slate-200/70 border-slate-200' : 'bg-[#131722] border-slate-800'
        }`}
      >
        <button
          type="button"
          onClick={() => setViewMode('upcoming')}
          className={`py-1.5 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
            viewMode === 'upcoming'
              ? isLight
                ? 'bg-white text-slate-900 shadow-xs'
                : 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-400'
          }`}
        >
          <CalendarCheck className="w-3.5 h-3.5" />
          <span>Yaklaşan 5 Nöbet</span>
        </button>
        <button
          type="button"
          onClick={() => setViewMode('groups')}
          className={`py-1.5 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
            viewMode === 'groups'
              ? isLight
                ? 'bg-white text-slate-900 shadow-xs'
                : 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-400'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Grup Dağılımı</span>
        </button>
        <button
          type="button"
          onClick={() => setViewMode('yearly')}
          className={`py-1.5 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
            viewMode === 'yearly'
              ? isLight
                ? 'bg-white text-slate-900 shadow-xs'
                : 'bg-slate-800 text-white shadow-xs'
              : 'text-slate-400'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>{calendarYear} Yıllık</span>
        </button>
      </div>

      {/* 3. DYNAMIC CONTENT AREA (Fills remaining height cleanly) */}
      <div
        className={`w-full flex-1 min-h-0 rounded-3xl border p-3 overflow-y-auto flex flex-col justify-between ${cardSurface}`}
      >
        {/* VIEW 1: UPCOMING 5 SHIFTS */}
        {viewMode === 'upcoming' && (
          <div className="flex flex-col gap-2 h-full justify-between">
            {upcomingShifts.map((item) => {
              const isDay = item.shift.shiftType === 'GUNDUZ';
              return (
                <button
                  key={`${item.isoDate}-${item.shift.shiftType}`}
                  type="button"
                  onClick={() => onJumpToDate(item.isoDate)}
                  className={`w-full p-2.5 rounded-2xl border flex items-center justify-between gap-2.5 text-left transition cursor-pointer ${
                    item.isActiveNow
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-emerald-950/30 border-emerald-500/50'
                      : subSurface
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        settings.is24HourSystem
                          ? 'bg-rose-500/15 text-rose-500'
                          : isDay
                          ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-indigo-500/15 text-indigo-400'
                      }`}
                    >
                      {settings.is24HourSystem ? (
                        <ShieldAlert className="w-4 h-4" />
                      ) : isDay ? (
                        <Sun className="w-4 h-4" />
                      ) : (
                        <Moon className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black">
                          {trDateFormatter(item.isoDate)}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">
                          · {item.weekday}
                        </span>
                        {item.isSwapped && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-400">
                            Becayiş
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <Clock className="w-3 h-3 text-sky-400" />
                        <span>
                          {settings.is24HourSystem
                            ? `24 Saat Blok (${settings.shift24Start})`
                            : isDay
                            ? `Gündüz (${formatTimeHHMM(item.shift.startDT)} - ${formatTimeHHMM(
                                item.shift.endDT
                              )})`
                            : `Akşam (${formatTimeHHMM(item.shift.startDT)} - ${formatTimeHHMM(
                                item.shift.endDT
                              )})`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.isActiveNow ? (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-500 text-white">
                        ŞU AN NÖBETTE
                      </span>
                    ) : (
                      <span
                        className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${
                          isLight
                            ? 'bg-slate-200/80 text-slate-700'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.daysUntil > 0
                          ? `${item.daysUntil}g ${item.hoursUntil}s`
                          : `${item.hoursUntil} saat`}
                      </span>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* VIEW 2: GROUP COMPARISON TABLE */}
        {viewMode === 'groups' && (
          <div className="flex flex-col gap-1.5 h-full justify-between">
            {groupComparison.map((g) => {
              const isMine = g.groupIdx === activeGroupIdx;
              return (
                <div
                  key={g.groupIdx}
                  className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 ${
                    isMine
                      ? isLight
                        ? 'bg-sky-50/80 border-sky-300'
                        : 'bg-sky-950/25 border-sky-500/40'
                      : subSurface
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black truncate">{g.groupName}</span>
                      {isMine && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-500 text-white">
                          Grubum
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {g.members || 'Personel tanımlanmadı'}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs font-bold">
                    <div className="text-center">
                      <div className="text-[9px] text-slate-400">Gündüz</div>
                      <div className="text-amber-500 font-black">{g.dayShifts}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-slate-400">Gece</div>
                      <div className="text-indigo-400 font-black">{g.nightShifts}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-slate-400">H.Sonu</div>
                      <div className="text-rose-400 font-black">{g.weekendShifts}</div>
                    </div>
                    <div className="text-center min-w-[42px]">
                      <div className="text-[9px] text-slate-400">Toplam</div>
                      <div className="text-sky-400 font-black">{g.totalHours}s</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: 12-MONTH YEARLY OVERVIEW */}
        {viewMode === 'yearly' && (
          <div className="flex flex-col justify-between h-full gap-2">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Award className="w-4 h-4 text-amber-400" />
                <span>
                  {calendarYear} Yılı Toplamı: {yearlyOverview.yearTotalShifts} Nöbet (
                  {yearlyOverview.yearTotalHours} sa)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 flex-1">
              {yearlyOverview.months.map((m) => {
                const isSelectedM = m.monthNum === calendarMonth;
                return (
                  <button
                    key={m.monthNum}
                    type="button"
                    onClick={() => onMonthChange(calendarYear, m.monthNum)}
                    className={`p-2 rounded-2xl border flex flex-col justify-between text-left transition cursor-pointer ${
                      isSelectedM
                        ? 'bg-sky-600 border-sky-500 text-white shadow-xs'
                        : subSurface
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black">{m.monthShort}</span>
                      <span
                        className={`text-[10px] font-bold ${
                          isSelectedM ? 'text-sky-100' : 'text-sky-400'
                        }`}
                      >
                        {m.hours}s
                      </span>
                    </div>
                    <div
                      className={`text-[10px] font-semibold flex items-center justify-between mt-1 ${
                        isSelectedM ? 'text-white/90' : 'text-slate-400'
                      }`}
                    >
                      <span>G:{m.dayCount}</span>
                      <span>A:{m.nightCount}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
