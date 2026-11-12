import { AppSettings, NoteItem, RefRecord, ShiftInstance, SingleDayQueryResult } from './types';

export const trDateFormatter = (isoDate: string): string => {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
  }
  return isoDate;
};

export const formatTRDateFromDate = (d: Date): string => {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
};

export const formatTimeHHMM = (d: Date): string => {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

export const parseHM = (hmStr: string): [number, number] => {
  const parts = (hmStr || '09:00').split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return [h, m];
};

export const toISODate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const addDays = (d: Date, days: number): Date => {
  const res = new Date(d);
  res.setDate(res.getDate() + days);
  return res;
};

export const addMinutes = (d: Date, minutes: number): Date => {
  return new Date(d.getTime() + minutes * 60000);
};

export const createLocalDate = (isoStr: string, timeStr = '00:00'): Date => {
  const [y, mo, day] = isoStr.split('-').map((v) => parseInt(v, 10));
  const [h, mi] = parseHM(timeStr);
  return new Date(y, mo - 1, day, h, mi, 0, 0);
};

export const getShiftDurations = (settings: AppSettings): [number, number] => {
  if (settings.is24HourSystem) {
    return [24.0, 24.0];
  }
  const [dsH, dsM] = parseHM(settings.dayStart);
  const [deH, deM] = parseHM(settings.dayEnd);
  let dayH = deH + deM / 60.0 - (dsH + dsM / 60.0);
  if (dayH <= 0) dayH += 24.0;

  const [nsH, nsM] = parseHM(settings.nightStart);
  const [neH, neM] = parseHM(settings.nightEnd);
  let nightH = neH + neM / 60.0 - (nsH + nsM / 60.0);
  if (nightH <= 0) nightH += 24.0;

  return [dayH, nightH];
};

export const getRestHoursAfterShift = (
  shiftType: 'GUNDUZ' | 'AKSAM',
  settings: AppSettings
): number => {
  if (settings.is24HourSystem) {
    return settings.restHours;
  }
  if (shiftType === 'GUNDUZ') {
    return typeof settings.dayRestHours === 'number' ? settings.dayRestHours : settings.restHours;
  }
  return typeof settings.nightRestHours === 'number' ? settings.nightRestHours : settings.restHours;
};

export const getActiveReferenceForDate = (
  isoDateStr: string,
  refHistory: RefRecord[]
): RefRecord | null => {
  if (!refHistory || refHistory.length === 0) {
    return null;
  }
  let active = refHistory[0];
  for (const r of refHistory) {
    if (isoDateStr >= r.validFrom) {
      active = r;
    }
  }
  return active;
};

export const getGroupAnchorDateTime = (
  groupIdx: number,
  refRecord: RefRecord,
  settings: AppSettings
): [Date, 'GUNDUZ' | 'AKSAM'] => {
  const myIdx = refRecord.myGroupIdx;
  const numG = settings.numGroups;

  const useClassic112Order =
    numG === 5 && (settings.groupCycleMode ?? '112_CLASSIC') === '112_CLASSIC';
  const cycleOrder = useClassic112Order
    ? [0, 4, 2, 3, 1]
    : Array.from({ length: numG }, (_, i) => i);

  const myPos = Math.max(0, cycleOrder.indexOf(myIdx));
  const groupPos = Math.max(0, cycleOrder.indexOf(groupIdx));
  const dayOffset = (((groupPos - myPos) % numG) + numG) % numG;

  const baseDate = createLocalDate(refRecord.refDate);
  const groupRefDate = addDays(baseDate, dayOffset);

  const timeStr = settings.is24HourSystem
    ? settings.shift24Start || settings.dayStart
    : refRecord.refType === 'GUNDUZ'
    ? settings.dayStart
    : settings.nightStart;
  const [h, m] = parseHM(timeStr);
  const anchorDT = new Date(
    groupRefDate.getFullYear(),
    groupRefDate.getMonth(),
    groupRefDate.getDate(),
    h,
    m,
    0,
    0
  );

  return [anchorDT, refRecord.refType];
};

export const generateGroupShiftsInWindow = (
  groupIdx: number,
  winStartDT: Date,
  winEndDT: Date,
  refRecord: RefRecord,
  settings: AppSettings
): ShiftInstance[] => {
  const [dayHours, nightHours] = getShiftDurations(settings);
  const [anchorDT, anchorType] = getGroupAnchorDateTime(groupIdx, refRecord, settings);
  const groupName = settings.groupNames[groupIdx] || `Grup ${groupIdx + 1}`;

  const shifts: ShiftInstance[] = [];

  // Forward generation
  let currStart = new Date(anchorDT.getTime());
  let currType: 'GUNDUZ' | 'AKSAM' = anchorType;

  while (currStart.getTime() <= winEndDT.getTime()) {
    const durHours = currType === 'GUNDUZ' ? dayHours : nightHours;
    const durMinutes = Math.round(durHours * 60);
    const currEnd = addMinutes(currStart, durMinutes);

    if (currEnd.getTime() >= winStartDT.getTime()) {
      shifts.push({
        groupIdx,
        groupName,
        shiftType: currType,
        startDT: new Date(currStart),
        endDT: new Date(currEnd),
        durationHours: durHours,
      });
    }

    const postRestMinutes = Math.round(getRestHoursAfterShift(currType, settings) * 60);
    currStart = addMinutes(currEnd, postRestMinutes);
    if (settings.shiftTransition === 'ALTERNATE') {
      currType = currType === 'GUNDUZ' ? 'AKSAM' : 'GUNDUZ';
    }
  }

  // Backward generation
  currStart = new Date(anchorDT.getTime());
  currType = anchorType;

  while (true) {
    const prevType: 'GUNDUZ' | 'AKSAM' =
      settings.shiftTransition === 'ALTERNATE'
        ? currType === 'GUNDUZ'
          ? 'AKSAM'
          : 'GUNDUZ'
        : currType;
    const prevDurHours = prevType === 'GUNDUZ' ? dayHours : nightHours;
    const prevDurMinutes = Math.round(prevDurHours * 60);
    const prevPostRestMinutes = Math.round(getRestHoursAfterShift(prevType, settings) * 60);
    const prevEnd = addMinutes(currStart, -prevPostRestMinutes);
    const prevStart = addMinutes(prevEnd, -prevDurMinutes);

    if (prevEnd.getTime() < winStartDT.getTime()) break;
    if (prevStart.getTime() <= winEndDT.getTime()) {
      shifts.push({
        groupIdx,
        groupName,
        shiftType: prevType,
        startDT: new Date(prevStart),
        endDT: new Date(prevEnd),
        durationHours: prevDurHours,
      });
    }
    currStart = prevStart;
    currType = prevType;
  }

  return shifts.sort((a, b) => a.startDT.getTime() - b.startDT.getTime());
};

export const querySingleDayForGroup = (
  isoDateStr: string,
  groupIdx: number | null | undefined,
  settings: AppSettings,
  refHistory: RefRecord[],
  notes: NoteItem[] = []
): SingleDayQueryResult => {
  const ref = getActiveReferenceForDate(isoDateStr, refHistory);
  const fallbackIdx = groupIdx === null || groupIdx === undefined || groupIdx === -1 ? 0 : groupIdx;
  const fallbackName = settings.groupNames[fallbackIdx] || `${fallbackIdx + 1}. Grup`;

  if (!ref) {
    return {
      isoDate: isoDateStr,
      groupIdx: fallbackIdx,
      groupName: fallbackName,
      morningCarryover: null,
      dayShift: null,
      nightShift: null,
      isRestAllDay: false,
      statusText: 'Tanımlanmadı',
      notes: [],
    };
  }

  const actualGroupIdx =
    groupIdx === null || groupIdx === undefined || groupIdx === -1 ? ref.myGroupIdx : groupIdx;
  const gName = settings.groupNames[actualGroupIdx] || `${actualGroupIdx + 1}. Grup`;
  const d = createLocalDate(isoDateStr);
  const winStart = addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0), -1);
  const winEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const shifts = generateGroupShiftsInWindow(actualGroupIdx, winStart, winEnd, ref, settings);

  let morningCarryover: ShiftInstance | null = null;
  let dayShift: ShiftInstance | null = null;
  let nightShift: ShiftInstance | null = null;
  const dayStartZero = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

  for (const sh of shifts) {
    const shStartISO = toISODate(sh.startDT);
    if (shStartISO < isoDateStr && sh.endDT.getTime() > dayStartZero.getTime()) {
      morningCarryover = sh;
    } else if (shStartISO === isoDateStr) {
      if (sh.shiftType === 'GUNDUZ') dayShift = sh;
      else nightShift = sh;
    }
  }

  const parts: string[] = [];
  if (settings.is24HourSystem) {
    if (dayShift || nightShift || morningCarryover) {
      parts.push('24 Saat Kesintisiz Nöbet');
    }
  } else {
    if (morningCarryover) {
      parts.push('Önceki nöbetin devamı');
    }
    if (dayShift) {
      parts.push('Gündüz Nöbeti');
    }
    if (nightShift) {
      parts.push('Akşam Nöbeti');
    }
  }
  if (parts.length === 0) {
    parts.push('Dinlenme (Tam Gün İzinli)');
  }

  let finalStatusText = parts.join(' + ');
  const dayNotes = (notes || []).filter(
    (it) => it.date === isoDateStr || it.swapTargetDate === isoDateStr
  );

  const isMyGroup =
    groupIdx === null || groupIdx === undefined || groupIdx === -1 || groupIdx === ref.myGroupIdx;

  if (isMyGroup) {
    const givenAway = (notes || []).find(
      (it) =>
        it.type === 'Nöbet Değişimi' &&
        it.date === isoDateStr &&
        it.swapTargetDate &&
        it.swapTargetDate.trim() !== ''
    );
    if (givenAway && givenAway.swapTargetDate) {
      dayShift = null;
      nightShift = null;
      finalStatusText = `İzinli (${trDateFormatter(givenAway.swapTargetDate)} ile değişti)`;
    }

    const prevGivenAwayDateISO = toISODate(addDays(d, -1));
    const prevGivenAway = (notes || []).find(
      (it) =>
        it.type === 'Nöbet Değişimi' &&
        it.date === prevGivenAwayDateISO &&
        it.swapTargetDate &&
        it.swapTargetDate.trim() !== ''
    );
    if (prevGivenAway && morningCarryover) {
      morningCarryover = null;
      if (!dayShift && !nightShift) {
        finalStatusText = 'Dinlenme (Tam Gün İzinli)';
      }
    }

    const takenOver = (notes || []).find(
      (it) => it.type === 'Nöbet Değişimi' && it.swapTargetDate === isoDateStr
    );
    if (takenOver) {
      if (takenOver.swapShiftType === 'GUNDUZ') {
        const [sh, sm] = parseHM(settings.dayStart);
        const [eh, em] = parseHM(settings.dayEnd);
        const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm, 0, 0);
        const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em, 0, 0);
        const dur = (eDT.getTime() - sDT.getTime()) / 3600000;
        dayShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'GUNDUZ',
          startDT: sDT,
          endDT: eDT,
          durationHours: dur,
        };
        finalStatusText = `🔄☀️ Gündüz Nöbeti (${trDateFormatter(takenOver.date)} yerine)`;
      } else {
        const [sh, sm] = parseHM(settings.nightStart);
        const [eh, em] = parseHM(settings.nightEnd);
        const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm, 0, 0);
        const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, eh, em, 0, 0);
        const dur = (eDT.getTime() - sDT.getTime()) / 3600000;
        nightShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'AKSAM',
          startDT: sDT,
          endDT: eDT,
          durationHours: dur,
        };
        finalStatusText = `🔄🌙 Akşam Nöbeti (${trDateFormatter(takenOver.date)} yerine)`;
      }
    }

    const prevDateISO = toISODate(addDays(d, -1));
    const prevTakenNight = (notes || []).find(
      (it) =>
        it.type === 'Nöbet Değişimi' &&
        it.swapTargetDate === prevDateISO &&
        it.swapShiftType === 'AKSAM'
    );
    if (prevTakenNight && !dayShift && !nightShift) {
      const [sh, sm] = parseHM(settings.nightStart);
      const [eh, em] = parseHM(settings.nightEnd);
      const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, sh, sm, 0, 0);
      const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em, 0, 0);
      const dur = (eDT.getTime() - sDT.getTime()) / 3600000;
      morningCarryover = {
        groupIdx: actualGroupIdx,
        groupName: gName,
        shiftType: 'AKSAM',
        startDT: sDT,
        endDT: eDT,
        durationHours: dur,
      };
      finalStatusText = '🌅 Nöbet Çıkışı (Değişimden)';
    }
  }

  return {
    isoDate: isoDateStr,
    groupIdx: actualGroupIdx,
    groupName: gName,
    morningCarryover,
    dayShift,
    nightShift,
    isRestAllDay: !morningCarryover && !dayShift && !nightShift,
    statusText: finalStatusText,
    notes: dayNotes,
  };
};

export const whoIsOnDutyAt = (
  targetDT: Date,
  settings: AppSettings,
  refHistory: RefRecord[]
): ShiftInstance[] => {
  const isoD = toISODate(targetDT);
  const ref = getActiveReferenceForDate(isoD, refHistory);
  if (!ref) {
    return [];
  }
  const winStart = addDays(targetDT, -1);
  const winEnd = addDays(targetDT, 1);

  const active: ShiftInstance[] = [];
  for (let i = 0; i < settings.numGroups; i++) {
    const shifts = generateGroupShiftsInWindow(i, winStart, winEnd, ref, settings);
    for (const sh of shifts) {
      if (targetDT.getTime() >= sh.startDT.getTime() && targetDT.getTime() < sh.endDT.getTime()) {
        active.push(sh);
      }
    }
  }
  return active;
};

const findSwappedPartnerGroupIdx = (
  note: NoteItem,
  settings: AppSettings,
  refHistory: RefRecord[]
): number | null => {
  if (
    note.type !== 'Nöbet Değişimi' ||
    !note.swapTargetDate ||
    note.swapTargetDate.trim() === ''
  ) {
    return null;
  }
  const targetISO = note.swapTargetDate.trim();
  for (let g = 0; g < settings.numGroups; g++) {
    const gInfo = querySingleDayForGroup(targetISO, g, settings, refHistory, []);
    if (settings.is24HourSystem) {
      if (gInfo.dayShift || gInfo.nightShift) return g;
    } else if (note.swapShiftType === 'GUNDUZ' && gInfo.dayShift) {
      return g;
    } else if (note.swapShiftType === 'AKSAM' && gInfo.nightShift) {
      return g;
    }
  }
  return null;
};

export const getEffectiveGroupIdxForDate = (
  isoDateStr: string,
  settings: AppSettings,
  refHistory: RefRecord[],
  notes: NoteItem[] = []
): number => {
  const ref = getActiveReferenceForDate(isoDateStr, refHistory);
  if (!ref) return 0;
  const myGroupIdx = ref.myGroupIdx;
  const d = createLocalDate(isoDateStr);
  const prevDateISO = toISODate(addDays(d, -1));

  // 1. Nöbet değişimi ile geleceğim hedef gün (swapTargetDate === isoDateStr)
  const takenOver = (notes || []).find(
    (it) =>
      it.type === 'Nöbet Değişimi' &&
      it.swapTargetDate &&
      it.swapTargetDate.trim() === isoDateStr
  );
  if (takenOver) {
    const partnerIdx = findSwappedPartnerGroupIdx(takenOver, settings, refHistory);
    if (partnerIdx !== null) return partnerIdx;
  }

  // 2. Değiştiğim gece nöbetinin ertesi günü (sabah çıkışı)
  const prevTakenNight = (notes || []).find(
    (it) =>
      it.type === 'Nöbet Değişimi' &&
      it.swapTargetDate &&
      it.swapTargetDate.trim() === prevDateISO &&
      it.swapShiftType === 'AKSAM'
  );
  if (prevTakenNight) {
    const partnerIdx = findSwappedPartnerGroupIdx(prevTakenNight, settings, refHistory);
    if (partnerIdx !== null) return partnerIdx;
  }

  // 3. Normalde kendi nöbetim olup devrettiğim gün (date === isoDateStr)
  const givenAway = (notes || []).find(
    (it) =>
      it.type === 'Nöbet Değişimi' &&
      it.date === isoDateStr &&
      it.swapTargetDate &&
      it.swapTargetDate.trim() !== ''
  );
  if (givenAway) {
    const partnerIdx = findSwappedPartnerGroupIdx(givenAway, settings, refHistory);
    if (partnerIdx !== null) return partnerIdx;
  }

  // 4. Normalde kendi gece nöbetim olup devrettiğim günün ertesi sabahı
  const prevGivenAway = (notes || []).find(
    (it) =>
      it.type === 'Nöbet Değişimi' &&
      it.date === prevDateISO &&
      it.swapTargetDate &&
      it.swapTargetDate.trim() !== ''
  );
  if (prevGivenAway) {
    const myPrevNormal = querySingleDayForGroup(prevDateISO, myGroupIdx, settings, refHistory, []);
    if (myPrevNormal.nightShift) {
      const partnerIdx = findSwappedPartnerGroupIdx(prevGivenAway, settings, refHistory);
      if (partnerIdx !== null) return partnerIdx;
    }
  }

  return myGroupIdx;
};

export interface NextShiftSummary {
  isoDate: string;
  shift: ShiftInstance;
  startsInHours: number;
  isCurrentlyActive: boolean;
}

export const findNextShiftForGroup = (
  fromDT: Date,
  groupIdx: number | null | undefined,
  settings: AppSettings,
  refHistory: RefRecord[],
  notes: NoteItem[] = []
): NextShiftSummary | null => {
  if (!refHistory || refHistory.length === 0) return null;

  for (let offset = -1; offset <= 14; offset++) {
    const checkDate = addDays(fromDT, offset);
    const iso = toISODate(checkDate);
    const dayResult = querySingleDayForGroup(iso, groupIdx, settings, refHistory, notes);
    const candidates = [dayResult.dayShift, dayResult.nightShift].filter(
      (s): s is ShiftInstance => s !== null
    );

    for (const sh of candidates) {
      if (fromDT.getTime() >= sh.startDT.getTime() && fromDT.getTime() < sh.endDT.getTime()) {
        return {
          isoDate: iso,
          shift: sh,
          startsInHours: 0,
          isCurrentlyActive: true,
        };
      }
      if (sh.startDT.getTime() > fromDT.getTime()) {
        const diffHours = Math.max(
          0,
          Math.round((sh.startDT.getTime() - fromDT.getTime()) / 3600000)
        );
        return {
          isoDate: iso,
          shift: sh,
          startsInHours: diffHours,
          isCurrentlyActive: false,
        };
      }
    }
  }

  return null;
};

export const buildICSContent = (
  year: number,
  month: number,
  groupIdx: number,
  settings: AppSettings,
  refs: RefRecord[],
  notes: NoteItem[]
): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtUTC = (d: Date) => {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
      d.getUTCHours()
    )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const nowStamp = fmtUTC(new Date());

  const daysInMonth = new Date(year, month, 0).getDate();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//112 Vardiya Sistemi//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const info = querySingleDayForGroup(dateStr, groupIdx, settings, refs, notes);
    const shift = info.dayShift || info.nightShift;
    if (!shift) continue;

    const title = settings.is24HourSystem
      ? '🚑 24 Saat Nöbeti'
      : info.dayShift
      ? '☀️ Gündüz Nöbeti'
      : '🌙 Akşam Nöbeti';
    lines.push(
      'BEGIN:VEVENT',
      `UID:vardiya112-${dateStr}-g${info.groupIdx}-${info.dayShift ? 'D' : 'N'}@vardiya112`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART:${fmtUTC(shift.startDT)}`,
      `DTEND:${fmtUTC(shift.endDT)}`,
      `SUMMARY:${title} (${info.groupName})`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR\r\n');
  return lines.join('\r\n');
};

export const runBuiltInTests = (): string[] => {
  const logs: string[] = [];
  const assertCond = (cond: boolean, msg: string) => {
    logs.push(cond ? `✅ GEÇTİ: ${msg}` : `❌ HATA: ${msg}`);
  };

  const testSettings: AppSettings = {
    shiftPreset: '112_5G',
    dayStart: '09:00',
    dayEnd: '19:00',
    nightStart: '19:00',
    nightEnd: '09:00',
    shift24Start: '08:00',
    is24HourSystem: false,
    restHours: 48,
    dayRestHours: 48,
    nightRestHours: 48,
    numGroups: 5,
    shiftTransition: 'ALTERNATE',
    groupCycleMode: '112_CLASSIC',
    groupNames: ['1. Grup', '2. Grup', '3. Grup', '4. Grup', '5. Grup'],
    groupMembers: ['', '', '', '', ''],
    theme: 'dark',
  };

  const testRefs: RefRecord[] = [
    { validFrom: '1970-01-01', myGroupIdx: 0, refDate: '2026-03-01', refType: 'GUNDUZ' },
  ];

  const d1 = querySingleDayForGroup('2026-03-01', 0, testSettings, testRefs, []);
  const d2 = querySingleDayForGroup('2026-03-02', 0, testSettings, testRefs, []);
  const d3 = querySingleDayForGroup('2026-03-03', 0, testSettings, testRefs, []);
  const d4 = querySingleDayForGroup('2026-03-04', 0, testSettings, testRefs, []);
  const d5 = querySingleDayForGroup('2026-03-05', 0, testSettings, testRefs, []);
  const d6 = querySingleDayForGroup('2026-03-06', 0, testSettings, testRefs, []);
  const d8 = querySingleDayForGroup('2026-03-08', 0, testSettings, testRefs, []);

  assertCond(
    d1.dayShift !== null &&
      d3.nightShift !== null &&
      d6.dayShift !== null &&
      d8.nightShift !== null,
    'Referans 1. gün gündüz ise 3. gün akşam, 6. gün gündüz, 8. gün akşam çıkmalı.'
  );
  assertCond(d2.isRestAllDay && d5.isRestAllDay, '2. ve 5. gün tam dinlenme çıkmalı.');
  assertCond(
    d4.morningCarryover !== null && d4.dayShift === null && d4.nightShift === null,
    "4. gün sadece 09:00'a kadar nöbet çıkmalı."
  );

  let allDaysValid = true;
  for (let i = 1; i <= 10; i++) {
    const iso = `2026-03-${String(i).padStart(2, '0')}`;
    let dG = 0;
    let nG = 0;
    for (let g = 0; g < 5; g++) {
      const info = querySingleDayForGroup(iso, g, testSettings, testRefs, []);
      if (info.dayShift) dG++;
      if (info.nightShift) nG++;
    }
    if (dG !== 1 || nG !== 1) allDaysValid = false;
  }
  assertCond(allDaysValid, 'Her gün tam olarak 1 gündüz grubu ve 1 akşam grubu bulunmalı.');

  let coverageValid = true;
  const baseT = new Date(2026, 2, 5, 0, 0, 0, 0);
  for (let m = 0; m < 24 * 60; m += 30) {
    const checkDT = addMinutes(baseT, m);
    const onDuty = whoIsOnDutyAt(checkDT, testSettings, testRefs);
    if (onDuty.length !== 1) coverageValid = false;
  }
  assertCond(coverageValid, '24 saatin her anında kesintisiz tam 1 grup nöbette olmalı.');

  assertCond(
    d1.dayShift?.durationHours === 10.0 && d3.nightShift?.durationHours === 14.0,
    'Gündüz nöbeti 10 saat, akşam nöbeti 14 saat sürmeli.'
  );

  // Test: 12/24 - 12/48 (4 Grup) Vardiya Çeşidi Doğrulaması
  const settings1224: AppSettings = {
    ...testSettings,
    shiftPreset: '12_24_48_4G',
    dayStart: '08:00',
    dayEnd: '20:00',
    nightStart: '20:00',
    nightEnd: '08:00',
    restHours: 48,
    dayRestHours: 24,
    nightRestHours: 48,
    numGroups: 4,
    groupNames: ['1. Grup', '2. Grup', '3. Grup', '4. Grup'],
  };
  const k1 = querySingleDayForGroup('2026-03-01', 0, settings1224, [testRefs[0]], []);
  const k2 = querySingleDayForGroup('2026-03-02', 0, settings1224, [testRefs[0]], []);
  const k5 = querySingleDayForGroup('2026-03-05', 0, settings1224, [testRefs[0]], []);
  assertCond(
    k1.dayShift !== null && k2.nightShift !== null && k5.dayShift !== null,
    '12/24 - 12/48 (4 Grup) sisteminde 1. gün gündüz, 2. gün gece, 5. gün tekrar gündüz olmalı.'
  );

  // Test: Shift Swap (Becayiş)
  const swapNotes: NoteItem[] = [
    {
      id: 1,
      date: '2026-03-01',
      type: 'Nöbet Değişimi',
      desc: 'Becayiş testi',
      isNewRef: false,
      swapTargetDate: '2026-03-02',
      swapShiftType: 'AKSAM',
    },
  ];
  const swappedOutDay = querySingleDayForGroup(
    '2026-03-01',
    0,
    testSettings,
    [testRefs[0]],
    swapNotes
  );
  const swappedInDay = querySingleDayForGroup(
    '2026-03-02',
    0,
    testSettings,
    [testRefs[0]],
    swapNotes
  );
  assertCond(
    swappedOutDay.dayShift === null && swappedInDay.nightShift !== null,
    'Nöbet değişimi (becayiş) yapılan gün izinli görünmeli, hedef günde yeni vardiya oluşmalı.'
  );

  // Test: 24-Hour Block Shift Mode (24/72)
  const settings24: AppSettings = {
    ...testSettings,
    is24HourSystem: true,
    restHours: 72,
    shift24Start: '08:00',
    numGroups: 4,
  };
  const d24_1 = querySingleDayForGroup('2026-03-01', 0, settings24, [testRefs[0]], []);
  const d24_2 = querySingleDayForGroup('2026-03-02', 0, settings24, [testRefs[0]], []);
  const d24_5 = querySingleDayForGroup('2026-03-05', 0, settings24, [testRefs[0]], []);
  assertCond(
    (d24_1.dayShift !== null || d24_1.nightShift !== null) &&
      d24_2.dayShift === null &&
      (d24_5.dayShift !== null || d24_5.nightShift !== null),
    '24 saatlik blok sistemde (24/72) 1. gün nöbetten sonra 5. gün tekrar nöbet gelmeli.'
  );

  return logs;
};
