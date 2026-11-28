import React, { useMemo, useState, useRef } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import {
  querySingleDayForGroup,
  getEffectiveGroupIdxForDate,
  getEffectiveGroupMembersForShift,
  buildICSContent,
  toISODate,
  trDateFormatter,
  isSamePersonNameTR,
} from '../shiftEngine';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Copy,
  Check,
  Table2,
  ShieldCheck,
  Megaphone,
  Settings,
} from 'lucide-react';
import { useShare } from '../hooks/useShare';
import { getThemePreset } from '../themes';
import {
  apiUrl,
  isCapacitorNative,
  openExternalSystemUrl,
  shareOrOpenNativeFile,
  toAbsoluteApiUrl,
} from '../utils/nativeBridge';
import { getAuthHeaders } from '../firebase';

interface CalendarTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  allNotes?: NoteItem[];
  isAdminBureauMode?: boolean;
  embeddedInAdminHome?: boolean;
  inspectedPersonName?: string;
  onInspectedPersonChange?: (personName: string) => void;
  pendingLeaveRequestsCount?: number;
  calendarYear: number;
  calendarMonth: number; // 1-12
  calendarGroupIdx: number; // -1 for auto / my group, -2 for all groups
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
  onOpenRosterTable: () => void;
  onOpenBureauModal?: (
    section?: 'units' | 'identity' | 'shift_ref' | 'personnel' | 'records' | 'admins'
  ) => void;
  onOpenAnnouncementModal?: () => void;
  onOpenSettings?: () => void;
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
  allNotes,
  isAdminBureauMode = false,
  embeddedInAdminHome = false,
  inspectedPersonName,
  onInspectedPersonChange,
  pendingLeaveRequestsCount = 0,
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
  onOpenRosterTable,
  onOpenBureauModal,
  onOpenAnnouncementModal,
  onOpenSettings,
}) => {
  const themePreset = getThemePreset(settings.theme);
  const isLight = themePreset.isLight;
  const nowDate = new Date();
  const todayISO = toISODate(nowDate);
  const isCurrentMonth =
    calendarYear === nowDate.getFullYear() && calendarMonth === nowDate.getMonth() + 1;
  const isTodaySelected = singleQueryDate === todayISO;
  const { shareElement } = useShare();
  const screenRef = useRef<HTMLDivElement>(null);
  const [shiftFilter, setShiftFilter] = useState<'all' | 'day' | 'night'>('all');
  const [adminEventFilter, setAdminEventFilter] = useState<
    'all' | 'leave' | 'idari_ucretsiz' | 'icap_swap'
  >('all');
  const [copiedSchedule, setCopiedSchedule] = useState(false);
  const [icsExported, setIcsExported] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [inspectedGroupPopupIdx, setInspectedGroupPopupIdx] = useState<number | null>(null);
  const [localInspectedPerson, setLocalInspectedPerson] = useState<string>('');

  const effectiveInspectedPerson = (inspectedPersonName ?? localInspectedPerson).trim();
  const handleSelectInspectedPerson = (name: string) => {
    setLocalInspectedPerson(name);
    onInspectedPersonChange?.(name);
  };

  // Horizontal swipe gesture state on the calendar card for smooth month switching
  const [monthSwipeDx, setMonthSwipeDx] = useState(0);
  const monthSwipeRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    locked: 'x' | 'y' | null;
  } | null>(null);
  const didMonthSwipeRef = useRef<boolean>(false);

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

  // -2 is the General All-Groups View; -1 is Individual Calendar (Bireysel Takvim / Grubum)
  const isGuestAllGroups = calendarGroupIdx === -2;

  const allUnitPersonnel = useMemo(() => {
    const list: Array<{ name: string; groupIdx: number; groupName: string }> = [];
    for (let g = 0; g < settings.numGroups; g++) {
      const gName = settings.groupNames[g] || `${g + 1}. Grup`;
      const rawMembers = (settings.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      rawMembers.forEach((m) => {
        list.push({ name: m, groupIdx: g, groupName: gName });
      });
    }
    return list;
  }, [settings.numGroups, settings.groupNames, settings.groupMembers]);

  // Resolve the active person whose individual calendar is displayed when not in All-Groups (-2) view
  const activeCalendarWorker = useMemo(() => {
    const ownWorker = (settings.activeWorkerName || '').trim();
    if (!isAdminBureauMode) {
      return ownWorker;
    }

    const sourceNotes = allNotes || notes;

    if (calendarGroupIdx === -1) {
      if (effectiveInspectedPerson) return effectiveInspectedPerson;
      if (ownWorker) return ownWorker;
      const latestNoteWithPerson = sourceNotes.find((it) => Boolean(it.swapMyPerson?.trim()));
      if (latestNoteWithPerson?.swapMyPerson) {
        return latestNoteWithPerson.swapMyPerson.trim();
      }
      return allUnitPersonnel[0]?.name || '';
    }

    if (calendarGroupIdx >= 0) {
      const groupMembers = allUnitPersonnel.filter((p) => p.groupIdx === calendarGroupIdx);
      if (
        effectiveInspectedPerson &&
        groupMembers.some((p) => isSamePersonNameTR(p.name, effectiveInspectedPerson))
      ) {
        return effectiveInspectedPerson;
      }
      if (ownWorker && groupMembers.some((p) => isSamePersonNameTR(p.name, ownWorker))) {
        return ownWorker;
      }
      const memberWithOverride = groupMembers.find((p) =>
        sourceNotes.some(
          (it) =>
            (it.swapMyPerson && isSamePersonNameTR(it.swapMyPerson, p.name)) ||
            (it.type === 'Nöbet Değişimi' &&
              it.swapWithPerson &&
              isSamePersonNameTR(it.swapWithPerson, p.name))
        )
      );
      if (memberWithOverride) {
        return memberWithOverride.name;
      }
      return groupMembers[0]?.name || ownWorker;
    }

    return ownWorker;
  }, [
    isAdminBureauMode,
    settings.activeWorkerName,
    effectiveInspectedPerson,
    calendarGroupIdx,
    allUnitPersonnel,
    allNotes,
    notes,
  ]);

  const effectiveSettingsForCalendar = useMemo<AppSettings>(() => {
    if (!activeCalendarWorker || settings.activeWorkerName === activeCalendarWorker) {
      return settings;
    }
    return {
      ...settings,
      activeWorkerName: activeCalendarWorker,
    };
  }, [settings, activeCalendarWorker]);

  const effectiveNotesForCalendar = useMemo<NoteItem[]>(() => {
    const sourceNotes = allNotes || notes;
    if (!activeCalendarWorker) {
      return notes;
    }
    if (
      !isAdminBureauMode &&
      settings.activeWorkerName &&
      isSamePersonNameTR(settings.activeWorkerName, activeCalendarWorker) &&
      notes.length > 0
    ) {
      return notes;
    }
    return sourceNotes.filter((it) => {
      const np = (it.swapMyPerson || '').trim();
      const sp = (it.swapWithPerson || '').trim();
      if (!np && !sp && !it.cloudNoteId) {
        return true;
      }
      return (
        (Boolean(np) && isSamePersonNameTR(activeCalendarWorker, np)) ||
        (it.type === 'Nöbet Değişimi' &&
          Boolean(sp) &&
          isSamePersonNameTR(activeCalendarWorker, sp))
      );
    });
  }, [
    isAdminBureauMode,
    activeCalendarWorker,
    settings.activeWorkerName,
    notes,
    allNotes,
  ]);

  const formatCompactGroupLabel = (gIdx: number): string => {
    const raw = (settings.groupNames[gIdx] || `${gIdx + 1}. Grup`).trim();
    const matchNum = raw.match(/^(\d+)\.\s*Grup$/i) || raw.match(/^Grup\s*(\d+)$/i);
    if (matchNum) {
      return `${matchNum[1]}.G`;
    }
    const cleaned = raw.replace(/\.?\s*Grup$/i, '').trim();
    return cleaned.length > 5 ? cleaned.slice(0, 5) : cleaned;
  };

  const {
    cells,
    dayCount,
    nightCount,
    restCount,
    totalHours,
    monthGeneralLeaveDays,
    monthGeneralIdariUcretsizDays,
    monthGeneralIcapAndSwaps,
  } = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth - 1, 1);
    const lastDay = new Date(calendarYear, calendarMonth, 0).getDate();
    const startWeekday = (firstDay.getDay() + 6) % 7;

    let dayC = 0;
    let nightC = 0;
    let restC = 0;
    let hours = 0;
    let generalLeaves = 0;
    let generalIdariUcretsiz = 0;
    let generalIcapSwaps = 0;

    const generalSourceNotes = isAdminBureauMode ? allNotes || notes : [];

    const cellList: Array<{
      dayNum: number | null;
      isoDate: string;
      shiftKind: 'none' | 'day' | 'night' | '24h' | 'leave' | 'icap' | 'note';
      shortLabel: string;
      dayGroupLabel: string;
      nightGroupLabel: string;
      dayLeaveCount: number;
      dayIdariUcretsizCount: number;
      dayIcapSwapCount: number;
      hasPersonalNote: boolean;
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
        dayLeaveCount: 0,
        dayIdariUcretsizCount: 0,
        dayIcapSwapCount: 0,
        hasPersonalNote: false,
        isToday: false,
      });
    }

    const isConfigured = refHistory && refHistory.length > 0;

    for (let d = 1; d <= lastDay; d++) {
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(
        2,
        '0'
      )}`;
      const info = querySingleDayForGroup(
        iso,
        calendarGroupIdx >= 0 ? calendarGroupIdx : null,
        effectiveSettingsForCalendar,
        refHistory,
        effectiveNotesForCalendar
      );

      // General institution summary counts (ONLY computed in Admin Bureau mode; filtered by selected group/person if active)
      let dLeaves = 0;
      let dIdariUcretsiz = 0;
      let dIcapSwaps = 0;
      if (isAdminBureauMode) {
        const generalDayNotes = generalSourceNotes.filter((it) => {
          const matchesDate =
            it.date === iso ||
            (it.type === 'Nöbet Değişimi' && it.swapTargetDate?.trim() === iso);
          if (!matchesDate) return false;

          if (calendarGroupIdx === -1 && activeCalendarWorker) {
            const p1 = (it.swapMyPerson || '').trim();
            const p2 = (it.swapWithPerson || '').trim();
            return (
              (Boolean(p1) && isSamePersonNameTR(p1, activeCalendarWorker)) ||
              (it.type === 'Nöbet Değişimi' &&
                Boolean(p2) &&
                isSamePersonNameTR(p2, activeCalendarWorker))
            );
          }

          if (calendarGroupIdx >= 0) {
            if (typeof it.targetGroupIdx === 'number') {
              return it.targetGroupIdx === calendarGroupIdx;
            }
            const p1 = (it.swapMyPerson || '').trim();
            if (p1) {
              const found = allUnitPersonnel.find((p) => isSamePersonNameTR(p.name, p1));
              if (found) return found.groupIdx === calendarGroupIdx;
            }
          }
          return true;
        });

        for (const gn of generalDayNotes) {
          const lower = `${gn.type} ${gn.desc}`.toLocaleLowerCase('tr-TR');
          if (
            gn.type === 'İzin / Rapor' ||
            lower.includes('izin') ||
            lower.includes('idari') ||
            lower.includes('ücretsiz') ||
            lower.includes('ucretsiz') ||
            lower.includes('rapor')
          ) {
            if (gn.date === iso) {
              dLeaves++;
              generalLeaves++;
              if (
                lower.includes('idari') ||
                lower.includes('ücretsiz') ||
                lower.includes('ucretsiz')
              ) {
                dIdariUcretsiz++;
                generalIdariUcretsiz++;
              }
            }
          } else if (
            gn.type === 'İcap Nöbeti' ||
            gn.type === 'Nöbet Değişimi' ||
            gn.type === 'Ek Nöbet'
          ) {
            dIcapSwaps++;
            if (gn.date === iso) {
              generalIcapSwaps++;
            }
          }
        }
      }

      // Strictly personal plain note belonging ONLY to the active calendar worker on this exact date
      const hasPersonalNote =
        (info.notes || []).some(
          (it) =>
            it.date === iso &&
            it.type !== 'Nöbet Değişimi' &&
            it.type !== 'İzin / Rapor' &&
            it.type !== 'İcap Nöbeti' &&
            it.type !== 'Ek Nöbet' &&
            it.type !== 'Nöbet Boşa Çıkarma'
        );

      let shiftKind: 'none' | 'day' | 'night' | '24h' | 'leave' | 'icap' | 'note' = 'none';
      let shortLabel = '';

      if (info.statusText.startsWith('🟪 İzinli')) {
        shiftKind = 'leave';
        const lowerStatus = info.statusText.toLocaleLowerCase('tr-TR');
        shortLabel = lowerStatus.includes('idari')
          ? 'İDARİ'
          : lowerStatus.includes('ücretsiz') || lowerStatus.includes('ucretsiz')
          ? 'ÜCR.İZ'
          : lowerStatus.includes('rapor')
          ? 'RAPOR'
          : 'İZİNLİ';
        restC++;
      } else if (info.statusText.startsWith('🟨 İcap Nöbeti')) {
        shiftKind = 'icap';
        const icapCode = info.statusText.includes('(A)')
          ? 'A'
          : info.statusText.includes('(24)')
          ? '24'
          : 'S';
        shortLabel = `İcap (${icapCode})`;
        if (info.dayShift) {
          dayC++;
          hours += info.dayShift.durationHours;
        } else if (info.nightShift) {
          nightC++;
          hours += info.nightShift.durationHours;
        } else {
          restC++;
        }
      } else if (settings.is24HourSystem) {
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

      if (shiftKind === 'none' && hasPersonalNote) {
        shiftKind = 'note';
        shortLabel = 'Not';
      }

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
        dayLeaveCount: dLeaves,
        dayIdariUcretsizCount: dIdariUcretsiz,
        dayIcapSwapCount: dIcapSwaps,
        hasPersonalNote,
        isToday: iso === todayISO,
      });
    }

    while (cellList.length % 7 !== 0) {
      cellList.push({
        dayNum: null,
        isoDate: '',
        shiftKind: 'none',
        shortLabel: '',
        dayGroupLabel: '',
        nightGroupLabel: '',
        dayLeaveCount: 0,
        dayIdariUcretsizCount: 0,
        dayIcapSwapCount: 0,
        hasPersonalNote: false,
        isToday: false,
      });
    }

    return {
      cells: cellList,
      dayCount: dayC,
      nightCount: nightC,
      restCount: restC,
      totalHours: Math.round(hours),
      monthGeneralLeaveDays: generalLeaves,
      monthGeneralIdariUcretsizDays: generalIdariUcretsiz,
      monthGeneralIcapAndSwaps: generalIcapSwaps,
    };
  }, [
    calendarYear,
    calendarMonth,
    calendarGroupIdx,
    activeCalendarWorker,
    allUnitPersonnel,
    settings,
    effectiveSettingsForCalendar,
    effectiveNotesForCalendar,
    refHistory,
    notes,
    allNotes,
    isAdminBureauMode,
    todayISO,
  ]);

  const handleExportICS = async () => {
    const targetGroup =
      calendarGroupIdx === -2 ? -2 : calendarGroupIdx >= 0 ? calendarGroupIdx : -1;
    const icsContent = buildICSContent(
      calendarYear,
      calendarMonth,
      targetGroup,
      effectiveSettingsForCalendar,
      refHistory,
      effectiveNotesForCalendar
    );
    const filename = `vardiya_${calendarYear}_${String(calendarMonth).padStart(2, '0')}.ics`;

    const flashIcsSuccess = () => {
      setIcsExported(true);
      window.setTimeout(() => setIcsExported(false), 2000);
    };

    if (isCapacitorNative()) {
      const nativeRes = await shareOrOpenNativeFile({
        fileName: filename,
        mimeType: 'text/calendar',
        textContent: icsContent,
        title: filename,
        text: 'Vardiya 112 Takvim Dosyası (.ics)',
        dialogTitle: 'Takvim Uygulaması ile Aç',
        preferFileOpener: true,
      });
      if (nativeRes.handled) {
        flashIcsSuccess();
        return;
      }
    }

    try {
      const response = await fetch(apiUrl('/api/calendar/ics'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ icsContent, filename }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          downloadUrl?: string;
          inlineUrl?: string;
        };
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const targetUrl = isIOS ? data.inlineUrl || data.downloadUrl : data.downloadUrl;
        if (targetUrl) {
          const fullUrl = toAbsoluteApiUrl(targetUrl);
          if (isCapacitorNative()) {
            const opened = await openExternalSystemUrl(fullUrl);
            if (opened) {
              flashIcsSuccess();
              return;
            }
          } else {
            const link = document.createElement('a');
            link.href = fullUrl;
            if (!isIOS) {
              link.download = filename;
            }
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            flashIcsSuccess();
            return;
          }
        }
      }
    } catch {
      // Offline / fallback below
    }

    try {
      const icsFile = new File([icsContent], filename, { type: 'text/calendar' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [icsFile] })) {
        await navigator.share({
          files: [icsFile],
          title: filename,
          text: 'Vardiya 112 Takvim Dosyası',
        });
        flashIcsSuccess();
        return;
      }
    } catch {
      // Fall through to Blob download
    }

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    flashIcsSuccess();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);
  };

  const handleCopyMonthText = async () => {
    const lastDay = new Date(calendarYear, calendarMonth, 0).getDate();

    if (isGuestAllGroups) {
      const lines: string[] = [
        `Tüm Gruplar - ${MONTH_NAMES_TR[calendarMonth - 1]} ${calendarYear} Nöbet Çizelgesi`,
      ];
      for (let d = 1; d <= lastDay; d++) {
        const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(
          2,
          '0'
        )}`;
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
      effectiveSettingsForCalendar,
      refHistory,
      effectiveNotesForCalendar
    );
    const lines: string[] = [
      `${activeCalendarWorker ? `${activeCalendarWorker} (${firstInfo.groupName})` : firstInfo.groupName} - ${MONTH_NAMES_TR[calendarMonth - 1]} ${calendarYear} Nöbet Listesi`,
    ];

    for (let d = 1; d <= lastDay; d++) {
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(
        2,
        '0'
      )}`;
      const info = querySingleDayForGroup(
        iso,
        calendarGroupIdx >= 0 ? calendarGroupIdx : null,
        effectiveSettingsForCalendar,
        refHistory,
        effectiveNotesForCalendar
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
    if (didMonthSwipeRef.current) {
      didMonthSwipeRef.current = false;
      return;
    }
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    onSingleDateChange(isoDate);
    onDutyDateChange(isoDate);
  };

  // Horizontal swipe handlers for month switching inside the calendar card
  const finishMonthSwipe = () => {
    const st = monthSwipeRef.current;
    if (!st || !st.active) return;
    if (st.locked === 'x') {
      if (monthSwipeDx <= -45) {
        handleNextMonth();
      } else if (monthSwipeDx >= 45) {
        handlePrevMonth();
      }
    }
    monthSwipeRef.current = null;
    setMonthSwipeDx(0);
  };

  const isConfigured = refHistory && refHistory.length > 0;
  const effectiveGroupIdx = useMemo(
    () =>
      getEffectiveGroupIdxForDate(
        singleQueryDate,
        effectiveSettingsForCalendar,
        refHistory,
        effectiveNotesForCalendar
      ),
    [singleQueryDate, effectiveSettingsForCalendar, refHistory, effectiveNotesForCalendar]
  );
  const selectedDayGroupStatuses = useMemo(
    () =>
      Array.from({ length: settings.numGroups }, (_, i) =>
        querySingleDayForGroup(
          singleQueryDate,
          i,
          effectiveSettingsForCalendar,
          refHistory,
          !isGuestAllGroups && i === effectiveGroupIdx ? effectiveNotesForCalendar : []
        )
      ),
    [
      singleQueryDate,
      settings.numGroups,
      effectiveSettingsForCalendar,
      refHistory,
      isGuestAllGroups,
      effectiveGroupIdx,
      effectiveNotesForCalendar,
    ]
  );

  const selectedDayAdminRecords = useMemo(() => {
    if (!isAdminBureauMode) return [];
    const sourceNotes = allNotes || notes;
    return sourceNotes.filter((it) => {
      const matchesDate =
        it.date === singleQueryDate ||
        (it.type === 'Nöbet Değişimi' && it.swapTargetDate?.trim() === singleQueryDate);
      if (!matchesDate) return false;

      if (calendarGroupIdx === -1 && activeCalendarWorker) {
        const p1 = (it.swapMyPerson || '').trim();
        const p2 = (it.swapWithPerson || '').trim();
        return (
          (Boolean(p1) && isSamePersonNameTR(p1, activeCalendarWorker)) ||
          (it.type === 'Nöbet Değişimi' &&
            Boolean(p2) &&
            isSamePersonNameTR(p2, activeCalendarWorker))
        );
      }

      if (calendarGroupIdx >= 0) {
        if (typeof it.targetGroupIdx === 'number') {
          return it.targetGroupIdx === calendarGroupIdx;
        }
        const p1 = (it.swapMyPerson || '').trim();
        if (p1) {
          const found = allUnitPersonnel.find((p) => isSamePersonNameTR(p.name, p1));
          if (found) return found.groupIdx === calendarGroupIdx;
        }
      }

      if (adminEventFilter !== 'all') {
        const lower = `${it.type} ${it.desc}`.toLocaleLowerCase('tr-TR');
        const isLeave =
          it.type === 'İzin / Rapor' ||
          lower.includes('izin') ||
          lower.includes('idari') ||
          lower.includes('ücretsiz') ||
          lower.includes('ucretsiz') ||
          lower.includes('rapor');
        const isIdariUcretsiz =
          lower.includes('idari') ||
          lower.includes('ücretsiz') ||
          lower.includes('ucretsiz');
        const isIcapSwap =
          it.type === 'İcap Nöbeti' ||
          it.type === 'Nöbet Değişimi' ||
          it.type === 'Ek Nöbet';

        if (adminEventFilter === 'leave' && !isLeave) return false;
        if (adminEventFilter === 'idari_ucretsiz' && !isIdariUcretsiz) return false;
        if (adminEventFilter === 'icap_swap' && !isIcapSwap) return false;
      }

      return true;
    });
  }, [
    isAdminBureauMode,
    allNotes,
    notes,
    singleQueryDate,
    calendarGroupIdx,
    activeCalendarWorker,
    allUnitPersonnel,
    adminEventFilter,
  ]);

  const adminSelectedPersonGroupIdx = useMemo(() => {
    if (calendarGroupIdx >= 0) return calendarGroupIdx;
    if (calendarGroupIdx === -1 && activeCalendarWorker) {
      const found = allUnitPersonnel.find((p) =>
        isSamePersonNameTR(p.name, activeCalendarWorker)
      );
      if (found) return found.groupIdx;
    }
    return -2;
  }, [calendarGroupIdx, activeCalendarWorker, allUnitPersonnel]);

  const filteredAdminPersonnelList = useMemo(() => {
    if (adminSelectedPersonGroupIdx >= 0) {
      return allUnitPersonnel.filter((p) => p.groupIdx === adminSelectedPersonGroupIdx);
    }
    return allUnitPersonnel;
  }, [allUnitPersonnel, adminSelectedPersonGroupIdx]);

  const isLiveTodayActive =
    isCurrentMonth &&
    isLiveDutyMode &&
    isTodaySelected &&
    calendarGroupIdx === -2 &&
    shiftFilter === 'all' &&
    adminEventFilter === 'all';

  const dropdownSelectValue = useMemo(() => {
    if (isGuestAllGroups) return '-2';
    if (
      isAdminBureauMode &&
      calendarGroupIdx === -1 &&
      activeCalendarWorker &&
      allUnitPersonnel.some((p) => isSamePersonNameTR(p.name, activeCalendarWorker))
    ) {
      const matched = allUnitPersonnel.find((p) =>
        isSamePersonNameTR(p.name, activeCalendarWorker)
      );
      if (matched) return `person:${matched.name}`;
    }
    return String(calendarGroupIdx);
  }, [
    isGuestAllGroups,
    isAdminBureauMode,
    calendarGroupIdx,
    activeCalendarWorker,
    allUnitPersonnel,
  ]);

  return (
    <div
      ref={screenRef}
      className={`${
        embeddedInAdminHome ? 'w-full gap-2.5' : 'h-full max-h-full w-full justify-center gap-2'
      } max-w-[400px] mx-auto flex flex-col items-center select-none`}
    >
      {/* 1. SWIPEABLE ROUNDED CALENDAR CARD (Swipe left/right on calendar to switch months!) */}
      <div
        data-no-swipe="true"
        onTouchStart={(e) => {
          const t = e.touches[0];
          monthSwipeRef.current = {
            startX: t.clientX,
            startY: t.clientY,
            active: true,
            locked: null,
          };
          didMonthSwipeRef.current = false;
        }}
        onTouchMove={(e) => {
          const st = monthSwipeRef.current;
          if (!st || !st.active) return;
          const t = e.touches[0];
          const dx = t.clientX - st.startX;
          const dy = t.clientY - st.startY;
          if (!st.locked) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            st.locked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          }
          if (st.locked === 'x') {
            clearLongPressTimer();
            didMonthSwipeRef.current = true;
            setMonthSwipeDx(Math.max(-90, Math.min(90, dx * 0.45)));
          }
        }}
        onTouchEnd={finishMonthSwipe}
        onTouchCancel={finishMonthSwipe}
        className={`w-full rounded-3xl border p-3.5 flex flex-col transition relative overflow-hidden ${
          isLight
            ? 'bg-white/95 border-slate-200 shadow-sm'
            : 'bg-[#111622]/90 border-slate-800/90 shadow-lg'
        }`}
      >
        {/* Card Top Header: Row 1 (Full-width Centered Month Switcher) & Row 2+3 (Detailed Filters) */}
        <div className="flex flex-col gap-1.5 mb-2 flex-shrink-0">
          {/* Row 1: Full-Width Centered Month Navigation */}
          <div className="w-full flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer active:scale-90 no-share shrink-0 ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
              }`}
              aria-label="Önceki Ay"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowMonthPicker((v) => !v)}
              className={`flex-1 py-1 px-3 rounded-xl text-sm sm:text-base font-black tracking-tight text-center truncate transition cursor-pointer whitespace-nowrap ${
                isLight ? 'hover:bg-slate-100 text-slate-900' : 'hover:bg-slate-800/80 text-white'
              }`}
              title="Ay ve Yıl Seçmek İçin Dokunun (veya Takvimi Sağa/Sola Kaydırın)"
            >
              {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear}
            </button>

            <button
              type="button"
              onClick={handleNextMonth}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer active:scale-90 no-share shrink-0 ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
              }`}
              aria-label="Sonraki Ay"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {isAdminBureauMode ? (
            /* ADMIN DETAILED FILTER BAR (Clean Group + Personnel Selectors & Shift/Record Filter Chips; Redundant Export/Duplicate Buttons Removed) */
            <div className="flex flex-col gap-1.5 no-share">
              {/* Filter Line 1: Group Filter + Personnel Filter + Reset/Today Button */}
              <div className="flex items-center gap-1.5 min-w-0">
                {/* 1. Group Scope Filter Dropdown */}
                <select
                  value={String(adminSelectedPersonGroupIdx)}
                  onChange={(e) => {
                    const gVal = parseInt(e.target.value, 10);
                    handleSelectInspectedPerson('');
                    onGroupChange(gVal);
                  }}
                  className={`h-7 px-2 rounded-xl text-[10.5px] font-extrabold border outline-none cursor-pointer transition min-w-0 flex-1 truncate ${
                    adminSelectedPersonGroupIdx === -2 && calendarGroupIdx === -2
                      ? isLight
                        ? 'bg-slate-100 border-slate-300 text-slate-800'
                        : 'bg-slate-900/90 border-slate-700/90 text-slate-200'
                      : isLight
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                  }`}
                  title="Gruba Göre Filtrele"
                >
                  <option value="-2" className="bg-slate-900 text-white">
                    🏢 Tüm Gruplar ({settings.numGroups})
                  </option>
                  {Array.from({ length: settings.numGroups }, (_, i) => (
                    <option key={i} value={String(i)} className="bg-slate-900 text-white">
                      {settings.groupNames[i] || `${i + 1}. Grup`}
                    </option>
                  ))}
                </select>

                {/* 2. Personnel Filter Dropdown (Filtered by selected group or all personnel) */}
                <select
                  value={
                    calendarGroupIdx === -1 && activeCalendarWorker
                      ? `person:${activeCalendarWorker}`
                      : ''
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      handleSelectInspectedPerson('');
                      onGroupChange(
                        adminSelectedPersonGroupIdx >= 0 ? adminSelectedPersonGroupIdx : -2
                      );
                      return;
                    }
                    if (val.startsWith('person:')) {
                      const pName = val.slice('person:'.length);
                      handleSelectInspectedPerson(pName);
                      onGroupChange(-1);
                    }
                  }}
                  className={`h-7 px-2 rounded-xl text-[10.5px] font-extrabold border outline-none cursor-pointer transition min-w-0 flex-[1.25] truncate ${
                    calendarGroupIdx === -1 && activeCalendarWorker
                      ? isLight
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : 'bg-rose-500/20 border-rose-500/45 text-rose-200'
                      : isLight
                      ? 'bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-slate-900/90 border-slate-700/90 text-slate-300'
                  }`}
                  title="Personele Göre Bireysel Takvim Filtrele"
                >
                  <option value="" className="bg-slate-900 text-white">
                    👥 Tüm Personeller ({filteredAdminPersonnelList.length})
                  </option>
                  {filteredAdminPersonnelList.map((p, idx) => (
                    <option
                      key={`adm-p-${p.groupIdx}-${idx}`}
                      value={`person:${p.name}`}
                      className="bg-slate-900 text-white"
                    >
                      👤 {p.name} ({formatCompactGroupLabel(p.groupIdx)})
                    </option>
                  ))}
                </select>

                {/* 3. Dedicated "Canlı" (Live Today & Reset) Button in the Calendar Header */}
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setShiftFilter('all');
                    setAdminEventFilter('all');
                    handleSelectInspectedPerson('');
                    onGroupChange(-2);
                    onMonthChange(now.getFullYear(), now.getMonth() + 1);
                    onSingleDateChange(toISODate(now));
                    onResetLive();
                  }}
                  className={`h-7 px-2.5 rounded-xl text-[10px] font-black border transition cursor-pointer shrink-0 flex items-center gap-1.5 whitespace-nowrap ${
                    isLiveTodayActive
                      ? isLight
                        ? 'bg-emerald-100 border-emerald-400 text-emerald-800 shadow-2xs'
                        : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-2xs'
                      : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white shadow-xs'
                  }`}
                  title="Canlı Nöbet Saatine ve Bugüne Dön"
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        isLiveTodayActive ? 'bg-emerald-400' : 'bg-emerald-200'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${
                        isLiveTodayActive ? 'bg-emerald-500' : 'bg-white'
                      }`}
                    />
                  </span>
                  <span>Canlı</span>
                </button>
              </div>

              {/* Filter Line 2: Detailed Shift & Record Type Filter Chips */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setShiftFilter('all');
                    setAdminEventFilter('all');
                  }}
                  className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap ${
                    shiftFilter === 'all' && adminEventFilter === 'all'
                      ? isLight
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-slate-200 border-white text-slate-950'
                      : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tümü
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setShiftFilter((prev) => (prev === 'day' ? 'all' : 'day'))
                  }
                  className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1 ${
                    shiftFilter === 'day'
                      ? 'bg-amber-500/25 border-amber-400 text-amber-300'
                      : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-amber-50'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-amber-300'
                  }`}
                >
                  <span>☀️</span>
                  <span>Gündüz</span>
                </button>

                {!settings.is24HourSystem && (
                  <button
                    type="button"
                    onClick={() =>
                      setShiftFilter((prev) => (prev === 'night' ? 'all' : 'night'))
                    }
                    className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1 ${
                      shiftFilter === 'night'
                        ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                        : isLight
                        ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-indigo-50'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-indigo-300'
                    }`}
                  >
                    <span>🌙</span>
                    <span>Gece</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setAdminEventFilter((prev) => (prev === 'leave' ? 'all' : 'leave'))
                  }
                  className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1 ${
                    adminEventFilter === 'leave'
                      ? 'bg-purple-600 border-purple-400 text-white'
                      : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-purple-50'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-purple-300'
                  }`}
                >
                  <span>🟪</span>
                  <span>İzin/Rapor</span>
                  {monthGeneralLeaveDays > 0 && (
                    <span className="px-1 rounded bg-purple-500/30 text-[9px] font-black">
                      {monthGeneralLeaveDays}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setAdminEventFilter((prev) =>
                      prev === 'idari_ucretsiz' ? 'all' : 'idari_ucretsiz'
                    )
                  }
                  className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1 ${
                    adminEventFilter === 'idari_ucretsiz'
                      ? 'bg-fuchsia-600 border-fuchsia-400 text-white'
                      : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-fuchsia-50'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-fuchsia-300'
                  }`}
                >
                  <span>🏛️</span>
                  <span>İdari/Ücretsiz</span>
                  {monthGeneralIdariUcretsizDays > 0 && (
                    <span className="px-1 rounded bg-fuchsia-500/30 text-[9px] font-black">
                      {monthGeneralIdariUcretsizDays}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setAdminEventFilter((prev) =>
                      prev === 'icap_swap' ? 'all' : 'icap_swap'
                    )
                  }
                  className={`h-6 px-2 rounded-lg text-[10px] font-extrabold border transition cursor-pointer shrink-0 whitespace-nowrap flex items-center gap-1 ${
                    adminEventFilter === 'icap_swap'
                      ? 'bg-amber-500 border-amber-300 text-slate-950'
                      : isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-amber-50'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-amber-300'
                  }`}
                >
                  <span>🔄</span>
                  <span>İcap/Değişim</span>
                  {monthGeneralIcapAndSwaps > 0 && (
                    <span className="px-1 rounded bg-amber-500/30 text-[9px] font-black">
                      {monthGeneralIcapAndSwaps}
                    </span>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* STANDARD PERSONNEL ROW 2: "Bireysel | Genel" Segmented Toggle + Live Dot + Export/Share Actions */
            <div className="flex items-center justify-between gap-2 no-share">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {/* Segmented Bireysel / Genel Switcher */}
                <div
                  className={`flex items-center p-0.5 rounded-xl border shrink-0 ${
                    isLight
                      ? 'bg-slate-100 border-slate-200/90'
                      : 'bg-slate-900/90 border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onGroupChange(-1)}
                    className={`h-6.5 px-2.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                      !isGuestAllGroups
                        ? isLight
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'bg-rose-600 text-white shadow-2xs'
                        : isLight
                        ? 'text-slate-600 hover:text-slate-900'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Bireysel Nöbet Takvimim"
                  >
                    <span>👤</span>
                    <span>Bireysel</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onGroupChange(-2)}
                    className={`h-6.5 px-2.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                      isGuestAllGroups
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : isLight
                        ? 'text-slate-600 hover:text-slate-900'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Genel (Tüm Gruplar) Nöbet Takvimi"
                  >
                    <span>👥</span>
                    <span>Genel</span>
                  </button>
                </div>

                {/* Group / Personnel Selector Dropdown when in Bireysel mode */}
                {!isGuestAllGroups && (
                  <select
                    value={dropdownSelectValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('person:')) {
                        const pName = val.slice('person:'.length);
                        handleSelectInspectedPerson(pName);
                        onGroupChange(-1);
                        return;
                      }
                      onGroupChange(parseInt(val, 10));
                    }}
                    className={`h-7 px-2 rounded-xl text-[11px] font-bold border outline-none cursor-pointer transition min-w-0 flex-1 max-w-[140px] truncate ${
                      isLight
                        ? 'bg-rose-50 border-rose-200 text-rose-600'
                        : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    <option value="-1" className="bg-slate-900 text-white">
                      {activeCalendarWorker
                        ? `${activeCalendarWorker}`
                        : 'Grubum'}
                    </option>
                    <optgroup label="Diğer Gruplar" className="bg-slate-900 text-white">
                      {Array.from({ length: settings.numGroups }, (_, i) => (
                        <option key={i} value={String(i)} className="bg-slate-900 text-white">
                          {settings.groupNames[i] || `${i + 1}. Grup`}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </div>

              {/* Live Green Dot + Export / Copy / Share Compact Icons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    onMonthChange(now.getFullYear(), now.getMonth() + 1);
                    onSingleDateChange(toISODate(now));
                    onResetLive();
                  }}
                  className={`w-7 h-7 rounded-xl flex items-center justify-center transition cursor-pointer ${
                    isCurrentMonth && isLiveDutyMode && isTodaySelected
                      ? isLight
                        ? 'bg-emerald-100 ring-1 ring-emerald-400/70'
                        : 'bg-emerald-500/20 ring-1 ring-emerald-500/50'
                      : isLight
                      ? 'hover:bg-slate-100'
                      : 'hover:bg-slate-800'
                  }`}
                  title="Canlı · Bugüne Dön"
                  aria-label="Canlı"
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {isCurrentMonth && isLiveDutyMode && isTodaySelected && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyMonthText}
                  className={`w-7 h-7 rounded-xl flex items-center justify-center transition cursor-pointer ${
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
                  className={`w-7 h-7 rounded-xl flex items-center justify-center transition cursor-pointer ${
                    icsExported
                      ? 'text-emerald-500'
                      : isLight
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Takvime Ekle (.ics)"
                  aria-label="İndir"
                >
                  {icsExported ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (screenRef.current) {
                      const ok = await shareElement(
                        screenRef.current,
                        `vardiya-${calendarYear}-${String(calendarMonth).padStart(2, '0')}.png`
                      );
                      if (ok) {
                        setShareDone(true);
                        window.setTimeout(() => setShareDone(false), 2000);
                      }
                    }
                  }}
                  className={`w-7 h-7 rounded-xl flex items-center justify-center transition cursor-pointer ${
                    shareDone
                      ? 'text-emerald-500'
                      : isLight
                      ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/60'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  title="Görsel Paylaş"
                  aria-label="Paylaş"
                >
                  {shareDone ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick 12-Month Grid Overlay Popover when Month Title is tapped (opens on top without shifting layout) */}
        {showMonthPicker && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMonthPicker(false)}
            />
            <div
              className={`absolute top-12 left-3 right-3 z-50 p-3 rounded-2xl border shadow-2xl backdrop-blur-md animate-fade-in no-share ${
                isLight
                  ? 'bg-white/98 border-slate-300 text-slate-900 shadow-slate-900/20'
                  : 'bg-[#0b0f19]/98 border-slate-700 text-white shadow-black/70'
              }`}
            >
              <div className="flex items-center justify-between mb-2 px-1">
                <button
                  type="button"
                  onClick={() => onMonthChange(calendarYear - 1, calendarMonth)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-extrabold cursor-pointer"
                >
                  ‹ {calendarYear - 1}
                </button>
                <span className="text-xs font-black">{calendarYear} Yılı</span>
                <button
                  type="button"
                  onClick={() => onMonthChange(calendarYear + 1, calendarMonth)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-extrabold cursor-pointer"
                >
                  {calendarYear + 1} ›
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {MONTH_NAMES_TR.map((mName, mIdx) => {
                  const activeM = mIdx + 1 === calendarMonth;
                  return (
                    <button
                      key={mName}
                      type="button"
                      onClick={() => {
                        onMonthChange(calendarYear, mIdx + 1);
                        setShowMonthPicker(false);
                      }}
                      className={`py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer ${
                        activeM
                          ? 'bg-rose-600 text-white shadow-xs'
                          : isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      {mName}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

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

        {/* Fixed-Height Vertically Centered Swipeable Day Grid Container */}
        <div
          style={{
            transform: monthSwipeDx ? `translate3d(${monthSwipeDx}px, 0, 0)` : undefined,
          }}
          className={`${
            embeddedInAdminHome ? 'h-[224px] sm:h-[238px]' : 'h-[306px] sm:h-[318px]'
          } w-full flex flex-col justify-center ${
            monthSwipeDx ? '' : 'transition-transform duration-200 ease-out'
          }`}
        >
          <div className="w-full grid grid-cols-7 gap-1.5">
            {cells.map((cell, idx) => {
              const cellHeightClass = embeddedInAdminHome
                ? 'h-[34px] sm:h-[36px]'
                : 'h-[46px] sm:h-[48px]';
              if (!cell.dayNum) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className={`${cellHeightClass} rounded-xl border border-transparent ${
                      isLight ? 'bg-slate-50/40' : 'bg-slate-900/20'
                    }`}
                  />
                );
              }

              const isSelectedDay = cell.isoDate === singleQueryDate;
              const matchesAdminEventFilter =
                !isAdminBureauMode ||
                adminEventFilter === 'all' ||
                (adminEventFilter === 'leave' && cell.dayLeaveCount > 0) ||
                (adminEventFilter === 'idari_ucretsiz' && cell.dayIdariUcretsizCount > 0) ||
                (adminEventFilter === 'icap_swap' && cell.dayIcapSwapCount > 0);

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
                    className={`relative ${cellHeightClass} rounded-xl border flex flex-col overflow-hidden transition cursor-pointer ${
                      isLight
                        ? 'bg-slate-100 border-slate-200/90'
                        : 'bg-[#0c101a] border-slate-800/90'
                    } ${
                      cell.isToday
                        ? 'ring-2 ring-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.25)]'
                        : isSelectedDay
                        ? 'ring-2 ring-rose-500 border-rose-500'
                        : adminEventFilter !== 'all' && matchesAdminEventFilter
                        ? 'ring-1.5 ring-purple-400 border-purple-400'
                        : ''
                    } ${
                      adminEventFilter !== 'all' && !matchesAdminEventFilter
                        ? 'opacity-20'
                        : 'opacity-100'
                    }`}
                  >
                    {/* Top Mini Day Number Header + General Leave/Event Indicator */}
                    <div
                      className={`h-[13px] w-full px-1 flex items-center justify-between shrink-0 ${
                        cell.isToday
                          ? 'bg-sky-500/20 text-sky-400'
                          : isLight
                          ? 'bg-slate-200/70 text-slate-700'
                          : 'bg-slate-900/90 text-slate-300'
                      }`}
                    >
                      <span className="text-[9px] font-black leading-none mx-auto">
                        {cell.dayNum}
                      </span>
                      {isAdminBureauMode && cell.dayLeaveCount > 0 ? (
                        <span
                          className={`px-0.5 rounded text-white text-[6.5px] font-black leading-none shrink-0 ${
                            cell.dayIdariUcretsizCount > 0 ? 'bg-fuchsia-600' : 'bg-purple-600'
                          }`}
                          title={`${cell.dayLeaveCount} personel izinli/raporlu`}
                        >
                          {cell.dayLeaveCount}İ
                        </span>
                      ) : isAdminBureauMode && cell.dayIcapSwapCount > 0 ? (
                        <span
                          className="px-0.5 rounded bg-amber-500 text-slate-950 text-[6.5px] font-black leading-none shrink-0"
                          title={`${cell.dayIcapSwapCount} icap/değişim kaydı`}
                        >
                          {cell.dayIcapSwapCount}D
                        </span>
                      ) : null}
                    </div>

                    {/* Upper Split Half: Sabah / Gündüz Group */}
                    <div
                      className={`flex-1 w-full flex items-center justify-center gap-0.5 px-0.5 transition ${
                        isLight
                          ? 'bg-amber-100/85 text-amber-900'
                          : 'bg-amber-500/20 text-amber-300'
                      } ${dimMorning ? 'opacity-20' : 'opacity-100'}`}
                    >
                      <span className="text-[6.5px] leading-none shrink-0">☀️</span>
                      <span className="text-[7.5px] font-extrabold leading-none tracking-tighter truncate">
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
                      <span className="text-[6.5px] leading-none shrink-0">🌙</span>
                      <span className="text-[7.5px] font-extrabold leading-none tracking-tighter truncate">
                        {cell.nightGroupLabel}
                      </span>
                    </div>
                  </button>
                );
              }

              // MODE B: SINGLE GROUP OR INDIVIDUAL PERSONNEL VIEW
              const isDimmed =
                (shiftFilter === 'day' && cell.shiftKind !== 'day' && cell.shiftKind !== '24h') ||
                (shiftFilter === 'night' && cell.shiftKind !== 'night') ||
                (adminEventFilter !== 'all' && !matchesAdminEventFilter);

              let cellStyle = isLight
                ? 'bg-slate-100/70 hover:bg-slate-200/70 border-slate-200/60 text-slate-600'
                : 'bg-slate-900/50 hover:bg-slate-800/70 border-slate-800/60 text-slate-400';
              let badgeColor = '';

              if (cell.shiftKind === 'leave') {
                cellStyle = 'bg-[#7e22ce] hover:bg-purple-600 border-purple-400 text-white';
                badgeColor = 'text-purple-100 font-black';
              } else if (cell.shiftKind === 'icap') {
                cellStyle = 'bg-[#fef08a] hover:bg-[#fde047] border-amber-500 text-slate-950';
                badgeColor = 'text-slate-950 font-black';
              } else if (cell.shiftKind === 'day') {
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
              } else if (cell.shiftKind === 'note') {
                cellStyle = isLight
                  ? 'bg-sky-50/90 hover:bg-sky-100/80 border-sky-300 text-sky-950'
                  : 'bg-[#0e1b2a] hover:bg-[#132539] border-sky-500/40 text-sky-100';
                badgeColor = isLight ? 'text-sky-700' : 'text-sky-300';
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
                  className={`relative ${cellHeightClass} px-0.5 rounded-xl border flex flex-col items-center justify-center gap-0.5 overflow-hidden transition cursor-pointer ${cellStyle} ${
                    cell.isToday
                      ? 'ring-2 ring-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.25)]'
                      : isSelectedDay
                      ? 'ring-2 ring-rose-500 border-rose-500'
                      : ''
                  } ${
                    cell.hasPersonalNote && cell.shiftKind !== 'note'
                      ? 'border-b-2 border-b-sky-400'
                      : ''
                  } ${isDimmed ? 'opacity-20' : 'opacity-100'}`}
                >
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

                  {/* Shift Label */}
                  {cell.shortLabel ? (
                    <span
                      className={`text-[8px] sm:text-[8.5px] font-bold tracking-tight leading-none max-w-full truncate ${badgeColor}`}
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

        {/* Selected Day Special Records Summary Strip at Bottom of Calendar Card (İzinli, İdari/Ücretsiz, Değişim, İcap Personnel) */}
        {isAdminBureauMode && (
          <div
            className={`mt-1.5 pt-1.5 border-t min-h-[26px] flex items-center gap-1.5 overflow-x-auto no-scrollbar ${
              isLight ? 'border-slate-200/80' : 'border-slate-800/80'
            }`}
          >
            <span className="text-[9.5px] font-black text-slate-400 shrink-0 tabular-nums">
              {trDateFormatter(singleQueryDate)}:
            </span>
            {selectedDayAdminRecords.length > 0 ? (
              selectedDayAdminRecords.map((rec, rIdx) => {
                const lower = `${rec.type} ${rec.desc}`.toLocaleLowerCase('tr-TR');
                const isIdariUcretsiz =
                  lower.includes('idari') ||
                  lower.includes('ücretsiz') ||
                  lower.includes('ucretsiz');
                const isLeave =
                  rec.type === 'İzin / Rapor' ||
                  lower.includes('izin') ||
                  isIdariUcretsiz ||
                  lower.includes('rapor');
                const isSwap = rec.type === 'Nöbet Değişimi';
                const label =
                  isSwap && rec.swapWithPerson
                    ? `${rec.swapMyPerson} ⇄ ${rec.swapWithPerson}`
                    : `${rec.swapMyPerson || ''} (${rec.desc || rec.type})`;
                return (
                  <span
                    key={`${rec.id}-${rIdx}`}
                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold shrink-0 whitespace-nowrap border ${
                      isIdariUcretsiz
                        ? isLight
                          ? 'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-800'
                          : 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200'
                        : isLeave
                        ? isLight
                          ? 'bg-purple-100 border-purple-300 text-purple-800'
                          : 'bg-purple-500/20 border-purple-500/40 text-purple-200'
                        : isSwap
                        ? isLight
                          ? 'bg-sky-100 border-sky-300 text-sky-800'
                          : 'bg-sky-500/20 border-sky-500/40 text-sky-200'
                        : isLight
                        ? 'bg-amber-100 border-amber-300 text-amber-800'
                        : 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                    }`}
                  >
                    {label}
                  </span>
                );
              })
            ) : (
              <span className="text-[9.5px] font-semibold text-slate-500 truncate">
                İzin, değişim veya icap kaydı bulunmuyor
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. FIVE GROUP STATUS CARDS FOR THE SELECTED DAY (Clicking opens a floating overlay of group personnel without affecting the calendar or shifting the page) */}
      <div className="w-full flex-shrink-0 relative z-40">
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(5, settings.numGroups)}, minmax(0, 1fr))`,
          }}
        >
          {selectedDayGroupStatuses.map((gInfo, i) => {
            const isPopupOpen = inspectedGroupPopupIdx === i;
            const isHighlighted =
              isPopupOpen ||
              (calendarGroupIdx >= 0
                ? i === calendarGroupIdx
                : isGuestAllGroups
                ? Boolean(gInfo.dayShift || gInfo.nightShift)
                : i === effectiveGroupIdx);

            let statusLabel = 'İstirahat';
            let iconEmoji = '🛋️';
            let cardBgClass = isLight
              ? 'bg-slate-100/95 border-slate-200/90 text-slate-600'
              : 'bg-[#101521]/95 border-slate-800/90 text-slate-400';
            let labelColorClass = isLight ? 'text-slate-500' : 'text-slate-400';

            if (isConfigured) {
              if (gInfo.statusText.startsWith('🟪 İzinli')) {
                statusLabel = 'İzinli';
                iconEmoji = '🟪';
                cardBgClass = isLight
                  ? 'bg-purple-50/95 border-purple-300'
                  : 'bg-purple-950/60 border-purple-500/45';
                labelColorClass = isLight ? 'text-purple-700' : 'text-purple-300';
              } else if (gInfo.statusText.startsWith('🟨 İcap Nöbeti')) {
                statusLabel = gInfo.nightShift ? 'İcap (A)' : 'İcap (S)';
                iconEmoji = '🟨';
                cardBgClass = isLight
                  ? 'bg-amber-50/95 border-amber-300'
                  : 'bg-amber-950/50 border-amber-500/45';
                labelColorClass = isLight ? 'text-amber-700' : 'text-amber-300';
              } else if (gInfo.nightShift) {
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
            const shortHeader =
              rawName === `${i + 1}. Grup` ? `${i + 1}` : rawName.replace('. Grup', '');

            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  setInspectedGroupPopupIdx((prev) => (prev === i ? null : i))
                }
                className={`py-1.5 px-1 rounded-2xl flex flex-col items-center justify-between ${
                  embeddedInAdminHome ? 'min-h-[50px] sm:min-h-[54px]' : 'min-h-[70px]'
                } transition cursor-pointer ${cardBgClass} ${highlightFrameClass}`}
              >
                <span
                  className={`text-xs font-extrabold leading-none truncate max-w-full ${
                    isHighlighted
                      ? themePreset.highlightTextClass
                      : isLight
                      ? 'text-slate-800'
                      : 'text-white'
                  }`}
                >
                  {shortHeader}
                </span>

                <span className="text-lg leading-none my-0.5 select-none" aria-hidden="true">
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

        {/* Floating Group Personnel Popover (Opens on top of the calendar without shifting the page or altering calendar filters) */}
        {inspectedGroupPopupIdx !== null && inspectedGroupPopupIdx < settings.numGroups && (() => {
          const selGroupInfo = querySingleDayForGroup(
            singleQueryDate,
            inspectedGroupPopupIdx,
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
            inspectedGroupPopupIdx,
            effShiftType,
            settings,
            refHistory,
            allNotes || notes,
            settings.activeWorkerName
          );

          const groupStatusBadge = selGroupInfo.nightShift
            ? '🌙 Gece Nöbeti'
            : selGroupInfo.dayShift
            ? '☀️ Gündüz Nöbeti'
            : selGroupInfo.morningCarryover
            ? '🌅 Sabah Çıkışı'
            : '🛋️ İstirahat';

          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setInspectedGroupPopupIdx(null)}
              />
              <div
                className={`absolute left-0 right-0 bottom-full mb-2 z-50 p-3 rounded-2xl border shadow-2xl backdrop-blur-md animate-fade-in flex flex-col gap-2 ${
                  isLight
                    ? 'bg-white/98 border-slate-300 text-slate-900 shadow-slate-900/20'
                    : 'bg-[#0b0f19]/98 border-slate-700 text-white shadow-black/75'
                }`}
              >
                <div className="flex items-center justify-between gap-2 border-b pb-1.5 border-slate-500/20">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs leading-none">👥</span>
                    <span className={`text-xs font-extrabold truncate ${themePreset.highlightTextClass}`}>
                      {settings.groupNames[inspectedGroupPopupIdx] || `${inspectedGroupPopupIdx + 1}. Grup`} Personelleri
                    </span>
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-500/15 text-[9.5px] font-bold shrink-0">
                      {groupStatusBadge}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onOpenBureauModal && (
                      <button
                        type="button"
                        onClick={() => {
                          setInspectedGroupPopupIdx(null);
                          onOpenBureauModal('personnel');
                        }}
                        className="text-[10.5px] font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded-lg bg-indigo-500/15 cursor-pointer"
                      >
                        Düzenle
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setInspectedGroupPopupIdx(null)}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-400 px-1.5 py-0.5 rounded-lg cursor-pointer"
                    >
                      Kapat ✕
                    </button>
                  </div>
                </div>

                {memberItems.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                    {memberItems.map((item, idx) => (
                      <span
                        key={`${item.name}-${idx}`}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold leading-snug break-words flex items-center gap-1 border ${
                          item.isSwappedIn
                            ? isLight
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-emerald-950/75 text-emerald-200 border-emerald-500/40'
                            : item.isExtraShift || item.isIcap
                            ? isLight
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-amber-950/75 text-amber-200 border-amber-500/40'
                            : isLight
                            ? 'bg-slate-100 text-slate-800 border-slate-200/80'
                            : 'bg-slate-800/90 text-slate-100 border-slate-700/70'
                        }`}
                      >
                        {item.isSwappedIn && <span className="text-[10px]">🔄</span>}
                        {item.isExtraShift && <span className="text-[10px]">➕</span>}
                        {item.isIcap && <span className="text-[10px]">🟨</span>}
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
                    Bu grup için aktif personel bulunmuyor.
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* 3. PROMINENT FULL-WIDTH MONTHLY ROSTER TABLE BUTTON + HARMONIOUS ADMIN PANEL & SETTINGS BUTTONS BELOW IT */}
      <div
        data-no-swipe="true"
        className="w-full min-w-0 flex-shrink-0 flex flex-col gap-1.5 relative z-30 no-share"
      >
        <button
          type="button"
          onClick={onOpenRosterTable}
          className={`w-full ${
            embeddedInAdminHome ? 'h-9.5' : 'h-11'
          } px-4 rounded-2xl border text-xs sm:text-sm font-black tracking-wide flex items-center justify-center gap-2 shadow-md transition cursor-pointer active:scale-[0.99] whitespace-nowrap ${
            isLight
              ? 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 shadow-indigo-500/20'
              : 'bg-gradient-to-r from-indigo-600 to-blue-600 border-indigo-400/50 text-white hover:from-indigo-500 hover:to-blue-500 shadow-indigo-950/50'
          }`}
          title="Tüm Gruplar ve Personeller Aylık Resmi Nöbet Çizelgesi Tablosu"
        >
          <Table2 className="w-4 h-4 shrink-0" />
          <span className="truncate">AYLIK NÖBET ÇİZELGESİ TABLOSUNU AÇ</span>
        </button>

        {embeddedInAdminHome &&
          isAdminBureauMode &&
          (onOpenBureauModal || onOpenAnnouncementModal || onOpenSettings) && (
            <div className="w-full flex items-center gap-1.5 min-w-0">
              {onOpenBureauModal && (
                <button
                  type="button"
                  onClick={() => onOpenBureauModal('units')}
                  className={`flex-1 min-w-0 h-9.5 px-2.5 rounded-2xl border text-[11px] sm:text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer active:scale-[0.99] whitespace-nowrap ${
                    pendingLeaveRequestsCount > 0
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 border-amber-300 text-slate-950 hover:from-amber-400 hover:to-orange-400 shadow-amber-950/40'
                      : isLight
                      ? 'bg-rose-600 border-rose-500 text-white hover:bg-rose-500 shadow-rose-500/20'
                      : 'bg-gradient-to-r from-rose-600 to-pink-600 border-rose-400/50 text-white hover:from-rose-500 hover:to-pink-500 shadow-rose-950/50'
                  }`}
                  title="Kurum, Vardiya, Grup, Personel, İzin ve Duyuru Yönetim Paneli"
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">YÖNETİCİ PANELİ</span>
                  {pendingLeaveRequestsCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-black leading-none bg-slate-950 text-amber-300 shrink-0">
                      {pendingLeaveRequestsCount}
                    </span>
                  )}
                </button>
              )}

              {onOpenAnnouncementModal && (
                <button
                  type="button"
                  onClick={onOpenAnnouncementModal}
                  className={`h-9.5 px-3 rounded-2xl border text-[11px] sm:text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer active:scale-[0.99] whitespace-nowrap shrink-0 ${
                    isLight
                      ? 'bg-amber-500 border-amber-400 text-slate-950 hover:bg-amber-400 shadow-amber-500/20'
                      : 'bg-gradient-to-r from-amber-500 to-amber-400 border-amber-300/70 text-slate-950 hover:from-amber-400 hover:to-amber-300 shadow-amber-950/40'
                  }`}
                  title="Yeni Genel Kurum Duyurusu Ekle ve Yayınlanan Duyuruları Yönet"
                >
                  <Megaphone className="w-3.5 h-3.5 shrink-0" />
                  <span>DUYURU EKLE</span>
                </button>
              )}

              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className={`h-9.5 px-3 rounded-2xl border text-[11px] sm:text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer active:scale-[0.99] whitespace-nowrap shrink-0 ${
                    isLight
                      ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700 shadow-slate-500/15'
                      : 'bg-slate-800/95 border-slate-600/70 text-slate-100 hover:bg-slate-700 hover:text-white shadow-slate-950/50'
                  }`}
                  title="Uygulama, Tema ve Hesap Ayarları"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span>AYARLAR</span>
                </button>
              )}
            </div>
          )}
      </div>

      {/* 4. BOTTOM FILTER & MONTHLY SUMMARY CARD (Hidden when embedded in Admin Home Screen) */}
      {!embeddedInAdminHome && (
        <div
          className={`w-full rounded-3xl border p-2.5 flex flex-col gap-2 flex-shrink-0 no-share ${themePreset.summaryCardClass}`}
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

          {/* Monthly Summary Row or Admin General Institution Summary */}
          <div
            className={`flex items-center justify-around flex-wrap gap-1.5 pt-1.5 border-t text-[10.5px] font-bold ${
              isLight ? 'border-rose-200/70 text-slate-700' : 'border-white/10 text-slate-200'
            }`}
          >
            {isGuestAllGroups ? (
              isAdminBureauMode ? (
                <>
                  <div className="flex items-center gap-1">
                    <span>🏢</span>
                    <span>{settings.numGroups} Grup</span>
                  </div>
                  <div className="flex items-center gap-1 text-purple-300">
                    <span>🟪</span>
                    <span>Aylık İzin: {monthGeneralLeaveDays} gün</span>
                  </div>
                  <div className="flex items-center gap-1 text-amber-300">
                    <span>🟨</span>
                    <span>İcap/Değişim: {monthGeneralIcapAndSwaps}</span>
                  </div>
                  {pendingLeaveRequestsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenBureauModal?.('records')}
                      className="flex items-center gap-1 text-amber-400 underline cursor-pointer"
                    >
                      <span>⏳ {pendingLeaveRequestsCount} Onay Bekliyor</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 text-amber-400">
                    <span>☀️</span>
                    <span>
                      Sabah: {settings.dayStart}-{settings.dayEnd}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-rose-300">
                    <span>🌙</span>
                    <span>
                      Gece: {settings.nightStart}-{settings.nightEnd}
                    </span>
                  </div>
                </>
              )
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
      )}
    </div>
  );
};
