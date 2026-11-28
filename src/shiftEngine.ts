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

export const findWorkerGroupIdxInSettings = (
  workerName: string | undefined | null,
  settings: AppSettings
): number | null => {
  const clean = (workerName || '').trim();
  if (!clean) return null;
  for (let g = 0; g < settings.numGroups; g++) {
    const members = (settings.groupMembers[g] || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (members.some((m) => isSamePersonNameTR(m, clean))) {
      return g;
    }
  }
  return null;
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

  const activeWorker = (settings.activeWorkerName || '').trim();
  const matchedWorkerGroupIdx = findWorkerGroupIdxInSettings(activeWorker, settings);
  const personalGroupIdx =
    matchedWorkerGroupIdx !== null ? matchedWorkerGroupIdx : ref.myGroupIdx;

  const actualGroupIdx =
    groupIdx === null || groupIdx === undefined || groupIdx === -1 ? personalGroupIdx : groupIdx;
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

  const groupMemberList = (settings.groupMembers[actualGroupIdx] || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const isMyGroup =
    groupIdx === null ||
    groupIdx === undefined ||
    groupIdx === -1 ||
    groupIdx === personalGroupIdx ||
    groupIdx === ref.myGroupIdx;

  const isNoteForThisView = (it: NoteItem): boolean => {
    const notePerson = (it.swapMyPerson || '').trim();
    const swapPartner = (it.swapWithPerson || '').trim();
    const matchesActiveWorker =
      Boolean(activeWorker) &&
      ((Boolean(notePerson) && isSamePersonNameTR(activeWorker, notePerson)) ||
        (it.type === 'Nöbet Değişimi' &&
          Boolean(swapPartner) &&
          isSamePersonNameTR(activeWorker, swapPartner)));

    // Individual / personal calendar views must never leak another group's individual leaves
    if (!isMyGroup) {
      return false;
    }

    // 1. Official bureau cloud note -> strictly visible ONLY to the specific person it belongs to
    if (it.cloudNoteId) {
      if (!activeWorker) {
        return false;
      }
      return matchesActiveWorker;
    }

    // 2. Local note explicitly matching activeWorker (or untagged local note on this user's own profile)
    if (activeWorker) {
      if (!notePerson && !swapPartner) {
        return typeof it.targetGroupIdx !== 'number' || it.targetGroupIdx === actualGroupIdx;
      }
      return matchesActiveWorker;
    }

    if (typeof it.targetGroupIdx === 'number' && it.targetGroupIdx !== actualGroupIdx) {
      return false;
    }

    if (notePerson) {
      // If activeWorker is not yet set, allow personal untargeted swaps (legacy/tests) or 1-person groups,
      // but never leak a named colleague's leave onto other members of a multi-person group.
      if (it.type === 'Nöbet Değişimi' && typeof it.targetGroupIdx !== 'number') {
        return true;
      }
      return groupMemberList.length <= 1;
    }

    return true;
  };

  const applicableNotes = (notes || []).filter(isNoteForThisView);
  const dayNotes = applicableNotes.filter(
    (it) => it.date === isoDateStr || it.swapTargetDate?.trim() === isoDateStr
  );

  const isSwapPartnerForNote = (it: NoteItem): boolean => {
    if (it.type !== 'Nöbet Değişimi') return false;
    const notePerson = (it.swapMyPerson || '').trim();
    const swapPartner = (it.swapWithPerson || '').trim();
    if (!activeWorker || !swapPartner) return false;
    return (
      isSamePersonNameTR(activeWorker, swapPartner) &&
      (!notePerson || !isSamePersonNameTR(activeWorker, notePerson))
    );
  };

  if (isMyGroup || applicableNotes.length > 0) {
    const prevDateISO = toISODate(addDays(d, -1));

    // 0. Check for Nöbet Boşa Çıkarma FIRST (clears base shift before any takenOver / Ek Nöbet applies)
    const isCancelNote = (it: NoteItem, targetISO: string): boolean => {
      if (it.date !== targetISO || it.type === 'Nöbet Değişimi') return false;
      const lower = `${it.type} ${it.desc}`.toLocaleLowerCase('tr-TR');
      return (
        it.type === 'Nöbet Boşa Çıkarma' ||
        lower.includes('boşa çıkar') ||
        lower.includes('nöbet iptal')
      );
    };

    const cancelShiftNote = applicableNotes.find((it) => isCancelNote(it, isoDateStr));
    if (cancelShiftNote) {
      dayShift = null;
      nightShift = null;
      finalStatusText = `⬜ Boş (Nöbet Boşa Çıkarıldı${
        cancelShiftNote.desc ? ` · ${cancelShiftNote.desc}` : ''
      })`;
    }

    const prevCancelNote = applicableNotes.find((it) => isCancelNote(it, prevDateISO));
    if (prevCancelNote && morningCarryover) {
      morningCarryover = null;
      if (!dayShift && !nightShift && !cancelShiftNote) {
        finalStatusText = 'Dinlenme (Tam Gün İzinli)';
      }
    }

    // Helper to classify Nöbet Değişimi notes:
    // - Direct single-date shift change: !isPartner && !swapTargetDate && !swapWithPerson -> assigns swapShiftType on it.date
    // - Same-day shift move: !isPartner && swapTargetDate === it.date -> assigns swapShiftType on it.date
    // - Standard multi-day move or partner swap: givenAway on source date, takenOver on target date
    const isGivenAwayOnDate = (it: NoteItem, targetISO: string): boolean => {
      if (it.type !== 'Nöbet Değişimi') return false;
      const isPartner = isSwapPartnerForNote(it);
      const cleanTarget = (it.swapTargetDate || '').trim();
      const cleanPartner = (it.swapWithPerson || '').trim();
      if (!isPartner) {
        if (!cleanTarget && !cleanPartner) return false; // Direct single-date shift change to swapShiftType
        if (cleanTarget === it.date) return false; // Same-day morning<->evening move handled in takenOver
        return it.date === targetISO;
      }
      return Boolean(cleanTarget && cleanTarget !== it.date && cleanTarget === targetISO);
    };

    const isTakenOverOnDate = (it: NoteItem, targetISO: string): boolean => {
      if (it.type !== 'Nöbet Değişimi') return false;
      const isPartner = isSwapPartnerForNote(it);
      const cleanTarget = (it.swapTargetDate || '').trim();
      const cleanPartner = (it.swapWithPerson || '').trim();
      if (!isPartner) {
        if (cleanTarget) return cleanTarget === targetISO;
        if (!cleanPartner) return it.date === targetISO; // Direct single-date shift change
        return false;
      }
      return it.date === targetISO;
    };

    // 1. Day given away (off duty due to swap)
    const givenAway = applicableNotes.find((it) => isGivenAwayOnDate(it, isoDateStr));
    if (givenAway) {
      const isPartner = isSwapPartnerForNote(givenAway);
      dayShift = null;
      nightShift = null;
      if (!isPartner) {
        const targetPart =
          givenAway.swapTargetDate && givenAway.swapTargetDate.trim() !== ''
            ? trDateFormatter(givenAway.swapTargetDate)
            : 'Nöbet Değişimi';
        const partnerSuffix = givenAway.swapWithPerson
          ? ` · ${givenAway.swapWithPerson} ile`
          : '';
        finalStatusText = `İzinli (${targetPart}${partnerSuffix} değişti)`;
      } else {
        const initiatorLabel = givenAway.swapMyPerson
          ? ` · ${givenAway.swapMyPerson} ile`
          : '';
        finalStatusText = `İzinli (${trDateFormatter(givenAway.date)}${initiatorLabel} değişti)`;
      }
    }

    const prevGivenAway = applicableNotes.find((it) => isGivenAwayOnDate(it, prevDateISO));
    if (prevGivenAway && morningCarryover) {
      morningCarryover = null;
      if (!dayShift && !nightShift && !givenAway && !cancelShiftNote) {
        finalStatusText = 'Dinlenme (Tam Gün İzinli)';
      }
    }

    // 2. Day taken over / shifted to this date (on duty due to swap or shift move)
    const takenOver = applicableNotes.find((it) => isTakenOverOnDate(it, isoDateStr));
    if (takenOver) {
      const isPartner = isSwapPartnerForNote(takenOver);
      const partnerLabel = isPartner
        ? takenOver.swapMyPerson
          ? `${takenOver.swapMyPerson} yerine`
          : `${trDateFormatter(takenOver.date)} nöbeti`
        : takenOver.swapWithPerson
        ? `${takenOver.swapWithPerson} yerine`
        : takenOver.date !== isoDateStr
        ? `${trDateFormatter(takenOver.date)} yerine`
        : takenOver.desc || 'Nöbet Değişimi';

      if (settings.is24HourSystem) {
        const [s24H, s24M] = parseHM(settings.shift24Start || settings.dayStart);
        const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s24H, s24M, 0, 0);
        const eDT = addMinutes(sDT, 24 * 60);
        dayShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'GUNDUZ',
          startDT: sDT,
          endDT: eDT,
          durationHours: 24,
        };
        nightShift = null;
        finalStatusText = `🔄☀️ 24 Saat Nöbeti (${partnerLabel})`;
      } else if (takenOver.swapShiftType === 'GUNDUZ') {
        const [sh, sm] = parseHM(settings.dayStart);
        const [eh, em] = parseHM(settings.dayEnd);
        const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm, 0, 0);
        const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em, 0, 0);
        let dur = (eDT.getTime() - sDT.getTime()) / 3600000;
        if (dur <= 0) dur += 24;
        dayShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'GUNDUZ',
          startDT: sDT,
          endDT: eDT,
          durationHours: dur,
        };
        nightShift = null; // Clear any opposite night shift on the same day
        finalStatusText = `🔄☀️ Gündüz Nöbeti (${partnerLabel})`;
      } else {
        const [sh, sm] = parseHM(settings.nightStart);
        const [eh, em] = parseHM(settings.nightEnd);
        const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm, 0, 0);
        const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, eh, em, 0, 0);
        let dur = (eDT.getTime() - sDT.getTime()) / 3600000;
        if (dur <= 0) dur += 24;
        nightShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'AKSAM',
          startDT: sDT,
          endDT: eDT,
          durationHours: dur,
        };
        dayShift = null; // Clear any opposite morning/day shift on the same day
        finalStatusText = `🔄🌙 Akşam Nöbeti (${partnerLabel})`;
      }
    }

    const prevTakenNight = applicableNotes.find(
      (it) => it.swapShiftType === 'AKSAM' && isTakenOverOnDate(it, prevDateISO)
    );
    if (prevTakenNight && !settings.is24HourSystem) {
      const [sh, sm] = parseHM(settings.nightStart);
      const [eh, em] = parseHM(settings.nightEnd);
      const sDT = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, sh, sm, 0, 0);
      const eDT = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em, 0, 0);
      let dur = (eDT.getTime() - sDT.getTime()) / 3600000;
      if (dur <= 0) dur += 24;
      morningCarryover = {
        groupIdx: actualGroupIdx,
        groupName: gName,
        shiftType: 'AKSAM',
        startDT: sDT,
        endDT: eDT,
        durationHours: dur,
      };
      if (!dayShift && !nightShift) {
        finalStatusText = '🌅 Nöbet Çıkışı (Değişimden)';
      }
    }

    // 3. Check for Ek Nöbet (Admin-assigned manual shift S/A from Monthly Roster Table or Admin Panel)
    const extraShiftNote = applicableNotes.find(
      (it) => it.date === isoDateStr && it.type === 'Ek Nöbet'
    );
    if (extraShiftNote) {
      const targetType: 'GUNDUZ' | 'AKSAM' =
        extraShiftNote.swapShiftType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ';
      const [yNum, mNum, dNum] = isoDateStr.split('-').map(Number);
      const [dayDurH, nightDurH] = getShiftDurations(settings);
      if (settings.is24HourSystem) {
        const [s24H, s24M] = parseHM(settings.shift24Start || settings.dayStart);
        const sDT = new Date(yNum, mNum - 1, dNum, s24H, s24M);
        const eDT = addMinutes(sDT, 24 * 60);
        dayShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'GUNDUZ',
          startDT: sDT,
          endDT: eDT,
          durationHours: 24,
        };
        nightShift = null;
        finalStatusText = `☀️ Ek Nöbet (24 Sa)${
          extraShiftNote.desc ? ` · ${extraShiftNote.desc}` : ''
        }`;
      } else if (targetType === 'AKSAM') {
        const [nSH, nSM] = parseHM(settings.nightStart);
        const sDT = new Date(yNum, mNum - 1, dNum, nSH, nSM);
        const eDT = addMinutes(sDT, nightDurH * 60);
        nightShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'AKSAM',
          startDT: sDT,
          endDT: eDT,
          durationHours: nightDurH,
        };
        dayShift = null; // Clear any base morning shift so moving to 28 Akşam shows purely Akşam!
        finalStatusText = `🌙 Ek Nöbet (Akşam - A)${
          extraShiftNote.desc ? ` · ${extraShiftNote.desc}` : ''
        }`;
      } else {
        const [dSH, dSM] = parseHM(settings.dayStart);
        const sDT = new Date(yNum, mNum - 1, dNum, dSH, dSM);
        const eDT = addMinutes(sDT, dayDurH * 60);
        dayShift = {
          groupIdx: actualGroupIdx,
          groupName: gName,
          shiftType: 'GUNDUZ',
          startDT: sDT,
          endDT: eDT,
          durationHours: dayDurH,
        };
        nightShift = null; // Clear any base evening shift so moving to Sabah shows purely Sabah!
        finalStatusText = `☀️ Ek Nöbet (Sabah - S)${
          extraShiftNote.desc ? ` · ${extraShiftNote.desc}` : ''
        }`;
      }
    }

    const prevExtraNight = applicableNotes.find(
      (it) => it.date === prevDateISO && it.type === 'Ek Nöbet' && it.swapShiftType === 'AKSAM'
    );
    if (prevExtraNight && !settings.is24HourSystem) {
      const [, nightDurH] = getShiftDurations(settings);
      const [nSH, nSM] = parseHM(settings.nightStart);
      const prevD = addDays(d, -1);
      const sDT = new Date(prevD.getFullYear(), prevD.getMonth(), prevD.getDate(), nSH, nSM, 0, 0);
      const eDT = addMinutes(sDT, nightDurH * 60);
      morningCarryover = {
        groupIdx: actualGroupIdx,
        groupName: gName,
        shiftType: 'AKSAM',
        startDT: sDT,
        endDT: eDT,
        durationHours: nightDurH,
      };
      if (!dayShift && !nightShift) {
        finalStatusText = '🌅 Nöbet Çıkışı (Ek Nöbet)';
      }
    }

    // 4. Check for İcap Nöbeti (On-Call Shift: Yellow cell with S or A)
    const icapNote = applicableNotes.find((it) => {
      if (it.date !== isoDateStr || it.type === 'Nöbet Değişimi') return false;
      const lower = `${it.type} ${it.desc}`.toLocaleLowerCase('tr-TR');
      return it.type === 'İcap Nöbeti' || lower.includes('icap') || lower.includes('i̇cap');
    });
    if (icapNote) {
      const icapCode = settings.is24HourSystem
        ? '24'
        : icapNote.swapShiftType === 'AKSAM'
        ? 'A'
        : 'S';
      finalStatusText = `🟨 İcap Nöbeti (${icapCode})${
        icapNote.swapMyPerson ? ` · ${icapNote.swapMyPerson}` : ''
      }`;
    }

    // 5. Check for İzin / Rapor (Official or Individual Leave)
    const isLeaveNote = (it: NoteItem, targetISO: string): boolean => {
      if (it.date !== targetISO || it.type === 'Nöbet Değişimi') return false;
      const lower = `${it.type} ${it.desc}`.toLocaleLowerCase('tr-TR');
      return (
        it.type === 'İzin / Rapor' ||
        lower.includes('izin') ||
        lower.includes('rapor') ||
        lower.includes('yıllık') ||
        lower.includes('ücretsiz')
      );
    };

    const leaveNote = applicableNotes.find((it) => isLeaveNote(it, isoDateStr));
    if (leaveNote) {
      dayShift = null;
      nightShift = null;
      finalStatusText = `🟪 İzinli (${
        leaveNote.swapMyPerson ? `${leaveNote.swapMyPerson} · ` : ''
      }${leaveNote.desc || 'İzin / Rapor'})`;
    }

    const prevLeaveNote = applicableNotes.find((it) => isLeaveNote(it, prevDateISO));
    if (prevLeaveNote && morningCarryover) {
      morningCarryover = null;
      if (!dayShift && !nightShift && !leaveNote && !cancelShiftNote && !givenAway) {
        finalStatusText = 'Dinlenme (Tam Gün İzinli)';
      }
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

export const findSwappedPartnerGroupIdx = (
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

const formatTitleCaseTRLocal = (raw: string): string => {
  if (!raw) return '';
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1).toLocaleLowerCase('tr-TR'))
    .join(' ');
};

const normalizePersonTR = (raw: string): string => {
  return (raw || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ');
};

export const isSamePersonNameTR = (nameA: string, nameB: string): boolean => {
  const a = normalizePersonTR(nameA);
  const b = normalizePersonTR(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  const fa = foldTurkishToAsciiLower(a).replace(/\s+/g, ' ').trim();
  const fb = foldTurkishToAsciiLower(b).replace(/\s+/g, ' ').trim();
  if (fa && fb && fa === fb) return true;
  const partsA = a.split(' ');
  const partsB = b.split(' ');
  if (
    (partsA[0] === partsB[0] || (fa && fb && fa.split(' ')[0] === fb.split(' ')[0])) &&
    partsA[0].length >= 3 &&
    (partsA.length === 1 || partsB.length === 1)
  ) {
    return true;
  }
  return false;
};

const foldTurkishToAsciiLower = (raw: string): string => {
  return (raw || '')
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ş/g, 's')
    .replace(/ş/g, 's')
    .replace(/Ğ/g, 'g')
    .replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/Ö/g, 'o')
    .replace(/ö/g, 'o')
    .replace(/Ç/g, 'c')
    .replace(/ç/g, 'c')
    .toLowerCase();
};

const tokenizeFoldedName = (raw: string): string[] => {
  return foldTurkishToAsciiLower(raw)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/\d+/g, ''))
    .filter((t) => t.length >= 2);
};

const doTokenListsStrictlyMatch = (personTokens: string[], accountTokens: string[]): boolean => {
  if (personTokens.length === 0 || accountTokens.length === 0) return false;

  if (personTokens.length === 1) {
    return accountTokens.length === 1 && accountTokens[0] === personTokens[0];
  }

  // Multi-word personnel name requires at least 2 full matching tokens on the Google account
  if (accountTokens.length < 2) return false;

  const pSet = new Set(personTokens);
  const aSet = new Set(accountTokens);

  let matchCount = 0;
  for (const tok of pSet) {
    if (aSet.has(tok)) matchCount += 1;
  }

  const minLen = Math.min(pSet.size, aSet.size);
  if (matchCount < 2 || matchCount !== minLen) {
    return false;
  }

  // All tokens identical in any order (e.g. "Yılmaz Ahmet" <-> "Ahmet Yılmaz")
  if (pSet.size === aSet.size && matchCount === pSet.size) {
    return true;
  }

  // When one side includes a middle name/title, the surname (last token) must match on both sides
  const pLast = personTokens[personTokens.length - 1];
  const aLast = accountTokens[accountTokens.length - 1];
  return pLast === aLast;
};

export interface GoogleIdentityMatchResult {
  matched: boolean;
  matchedBy?: 'displayName' | 'email';
  accountLabel: string;
}

/**
 * Verifies that the signed-in Google account's real name (displayName) — or strict exact full-name
 * email prefix fallback — matches the selected personnel name so no user can impersonate another person.
 */
export const verifyGoogleAccountMatchesPerson = (
  personName: string,
  user: { displayName?: string | null; email?: string | null } | null | undefined
): GoogleIdentityMatchResult => {
  const cleanPerson = (personName || '').trim();
  const displayName = (user?.displayName || '').trim();
  const email = (user?.email || '').trim();
  const accountLabel = displayName || email || 'Google Hesabı';

  if (!cleanPerson || !user) {
    return { matched: false, accountLabel };
  }

  const personTokens = tokenizeFoldedName(cleanPerson);
  if (personTokens.length === 0) {
    return { matched: false, accountLabel };
  }

  // 1. Primary check: Google Account displayName
  if (displayName) {
    const accountTokens = tokenizeFoldedName(displayName);
    if (doTokenListsStrictlyMatch(personTokens, accountTokens)) {
      return { matched: true, matchedBy: 'displayName', accountLabel };
    }
  }

  // 2. Secondary check: Strict exact full-name email local-part match (for accounts without a full displayName)
  if (email && email.includes('@')) {
    const localPart = foldTurkishToAsciiLower(email.split('@')[0] || '');
    const emailTokens = localPart
      .replace(/[^a-z]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    if (doTokenListsStrictlyMatch(personTokens, emailTokens)) {
      return { matched: true, matchedBy: 'email', accountLabel };
    }

    const compactEmail = localPart.replace(/[^a-z]/g, '');
    if (personTokens.length >= 2 && compactEmail.length >= 5) {
      const fullConcat = personTokens.join('');
      const firstLastConcat = `${personTokens[0]}${personTokens[personTokens.length - 1]}`;
      const lastFirstConcat = `${personTokens[personTokens.length - 1]}${personTokens[0]}`;
      if (
        compactEmail === fullConcat ||
        compactEmail === firstLastConcat ||
        compactEmail === lastFirstConcat
      ) {
        return { matched: true, matchedBy: 'email', accountLabel };
      }
    }
  }

  return { matched: false, accountLabel };
};

export interface EffectiveGroupMemberItem {
  name: string;
  isSwappedIn?: boolean;
  replacedName?: string;
  isExtraShift?: boolean;
  isIcap?: boolean;
}

export interface EffectiveGroupMembersResult {
  membersText: string;
  memberItems: EffectiveGroupMemberItem[];
}

/**
 * Verilen tarih ve vardiyada ilgili grubun (veya o vardiyanın) gerçekte nöbette olan personel listesini döner:
 * - Nöbet Değişimi (Becayiş) yapılan personeli yerine geçen kişiyle değiştirir.
 * - O gün İzin / Rapor veya Nöbet Boşa Çıkarma kaydı olan personeli nöbetçi listesinden çıkarır (izinli olduğunda yazmaz).
 * - O gün ilgili vardiyaya Ek Nöbet veya İcap Nöbeti yazılan personeli nöbetçi listesine ekler.
 */
export const getEffectiveGroupMembersForShift = (
  isoDateStr: string,
  groupIdx: number,
  shiftType: 'GUNDUZ' | 'AKSAM' | null,
  settings: AppSettings,
  refHistory: RefRecord[],
  notes: NoteItem[] = [],
  activeProfileName?: string
): EffectiveGroupMembersResult => {
  const rawStr = settings.groupMembers[groupIdx] || '';
  const baseNames = rawStr
    .split(/[,;\n]+/)
    .map((p) => formatTitleCaseTRLocal(p))
    .filter(Boolean);

  let memberItems: EffectiveGroupMemberItem[] = baseNames.map((name) => ({ name }));

  if (!notes || notes.length === 0 || !isoDateStr) {
    return {
      membersText: memberItems.map((m) => m.name).join(', '),
      memberItems,
    };
  }

  const ref = getActiveReferenceForDate(isoDateStr, refHistory);
  const myGroupIdx = ref ? ref.myGroupIdx : 0;
  const myGroupRaw = settings.groupMembers[myGroupIdx] || '';
  const myGroupPeople = myGroupRaw
    .split(/[,;\n]+/)
    .map((p) => formatTitleCaseTRLocal(p))
    .filter(Boolean);

  const cleanProfileName =
    activeProfileName && activeProfileName.trim() !== 'Ana Profilim'
      ? formatTitleCaseTRLocal(activeProfileName)
      : '';

  const defaultMyPerson = cleanProfileName || myGroupPeople[0] || '';

  const applyReplacement = (outgoingName: string, incomingName: string) => {
    const cleanIncoming = formatTitleCaseTRLocal(incomingName);
    const cleanOutgoing = formatTitleCaseTRLocal(outgoingName);
    if (!cleanIncoming) return;

    if (cleanOutgoing) {
      const matchIdx = memberItems.findIndex((m) =>
        isSamePersonNameTR(m.name, cleanOutgoing)
      );
      if (matchIdx > -1) {
        const oldName = memberItems[matchIdx].name;
        memberItems[matchIdx] = {
          name: cleanIncoming,
          isSwappedIn: true,
          replacedName: oldName,
        };
        return;
      }
    }

    if (memberItems.length >= 1) {
      const oldName = memberItems[0].name;
      if (!isSamePersonNameTR(oldName, cleanIncoming)) {
        memberItems[0] = {
          name: cleanIncoming,
          isSwappedIn: true,
          replacedName: cleanOutgoing || oldName,
        };
      }
    } else {
      memberItems.push({
        name: cleanIncoming,
        isSwappedIn: true,
        replacedName: cleanOutgoing || undefined,
      });
    }
  };

  // 1. Apply Nöbet Değişimi (Swaps / Becayiş)
  for (const note of notes) {
    if (note.type !== 'Nöbet Değişimi') continue;

    const noteWithPerson = formatTitleCaseTRLocal(note.swapWithPerson || '');
    const noteMyPerson = formatTitleCaseTRLocal(note.swapMyPerson || defaultMyPerson);
    const notePersonGroupIdx = findWorkerGroupIdxInSettings(noteMyPerson, settings);
    const effectiveNoteOriginGroupIdx =
      notePersonGroupIdx !== null
        ? notePersonGroupIdx
        : typeof note.targetGroupIdx === 'number'
        ? note.targetGroupIdx
        : myGroupIdx;

    // DURUM 1: Devredilen nöbet günü (note.date === isoDateStr)
    if (note.date === isoDateStr) {
      const originNormalDay = querySingleDayForGroup(
        isoDateStr,
        effectiveNoteOriginGroupIdx,
        settings,
        refHistory,
        []
      );
      const originNormalShift: 'GUNDUZ' | 'AKSAM' | null = originNormalDay.nightShift
        ? 'AKSAM'
        : originNormalDay.dayShift
        ? 'GUNDUZ'
        : null;

      const isOriginGroupOnThisShift =
        groupIdx === effectiveNoteOriginGroupIdx &&
        (shiftType === null || originNormalShift === null || shiftType === originNormalShift);

      const hasMyPersonInThisGroup =
        Boolean(noteMyPerson) &&
        memberItems.some((m) => isSamePersonNameTR(m.name, noteMyPerson));

      if (isOriginGroupOnThisShift || hasMyPersonInThisGroup) {
        if (noteWithPerson) {
          applyReplacement(noteMyPerson, noteWithPerson);
        } else if (noteMyPerson) {
          // Devredilen gün karşılık kişi yazılmamışsa kendi personeli listeden çıkar
          memberItems = memberItems.filter((m) => !isSamePersonNameTR(m.name, noteMyPerson));
        }
      }
    }

    // DURUM 2: Karşılık tutulan hedef nöbet günü (note.swapTargetDate === isoDateStr)
    if (note.swapTargetDate && note.swapTargetDate.trim() === isoDateStr) {
      const partnerGroupIdx = findSwappedPartnerGroupIdx(note, settings, refHistory);
      const shiftMatches =
        shiftType === null ||
        !note.swapShiftType ||
        shiftType === note.swapShiftType ||
        settings.is24HourSystem;

      if (shiftMatches && (partnerGroupIdx === groupIdx || partnerGroupIdx === null)) {
        const hasWithInTarget =
          Boolean(noteWithPerson) &&
          memberItems.some((m) => isSamePersonNameTR(m.name, noteWithPerson));
        const hasMyInTarget =
          Boolean(noteMyPerson) &&
          memberItems.some((m) => isSamePersonNameTR(m.name, noteMyPerson));

        if (hasWithInTarget && noteMyPerson) {
          applyReplacement(noteWithPerson, noteMyPerson);
        } else if (hasMyInTarget && noteWithPerson) {
          applyReplacement(noteMyPerson, noteWithPerson);
        } else if (partnerGroupIdx === groupIdx) {
          if (noteWithPerson && noteMyPerson) {
            applyReplacement(noteWithPerson, noteMyPerson);
          } else if (noteMyPerson && !memberItems.some((m) => isSamePersonNameTR(m.name, noteMyPerson))) {
            memberItems.push({
              name: noteMyPerson,
              isSwappedIn: true,
            });
          } else if (noteWithPerson) {
            applyReplacement('', noteWithPerson);
          }
        }
      }
    }
  }

  // Determine if this group is the active group on duty for `shiftType` on `isoDateStr`
  const thisGroupBaseDay = querySingleDayForGroup(isoDateStr, groupIdx, settings, refHistory, []);
  const isThisGroupOnRequestedShift =
    shiftType === 'GUNDUZ'
      ? Boolean(thisGroupBaseDay.dayShift)
      : shiftType === 'AKSAM'
      ? Boolean(thisGroupBaseDay.nightShift)
      : Boolean(thisGroupBaseDay.dayShift || thisGroupBaseDay.nightShift);

  // 2. Apply Ek Nöbet & İcap Nöbeti (add person if assigned to this shift on isoDateStr, or remove from their morning shift if moved to evening on same day)
  for (const note of notes) {
    if (note.date !== isoDateStr) continue;
    const person = formatTitleCaseTRLocal(note.swapMyPerson || '');
    if (!person) continue;

    const lower = `${note.type} ${note.desc}`.toLocaleLowerCase('tr-TR');
    const isExtra = note.type === 'Ek Nöbet';
    const isIcap =
      note.type === 'İcap Nöbeti' || lower.includes('icap') || lower.includes('i̇cap');

    if (!isExtra && !isIcap) continue;

    const noteShiftType: 'GUNDUZ' | 'AKSAM' =
      note.swapShiftType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ';

    // If a member of THIS group was moved to the OTHER shift on the same day (e.g., from Morning to Evening), remove them from the Morning shift list
    if (
      shiftType !== null &&
      !settings.is24HourSystem &&
      noteShiftType !== shiftType &&
      isExtra
    ) {
      memberItems = memberItems.filter((m) => !isSamePersonNameTR(m.name, person));
      continue;
    }

    const matchesShift =
      shiftType === null || settings.is24HourSystem || noteShiftType === shiftType;

    const matchesTargetGroup =
      isThisGroupOnRequestedShift ||
      (typeof note.targetGroupIdx === 'number' && note.targetGroupIdx === groupIdx);

    if (matchesShift && matchesTargetGroup) {
      const alreadyExists = memberItems.some((m) => isSamePersonNameTR(m.name, person));
      if (!alreadyExists) {
        memberItems.push({
          name: person,
          isExtraShift: isExtra,
          isIcap,
        });
      }
    }
  }

  // 3. Apply İzin / Rapor & Nöbet Boşa Çıkarma (Exclude anyone who is on leave or removed from duty on isoDateStr!)
  for (const note of notes) {
    if (note.date !== isoDateStr || note.type === 'Nöbet Değişimi') continue;
    const lower = `${note.type} ${note.desc}`.toLocaleLowerCase('tr-TR');
    const isLeave =
      note.type === 'İzin / Rapor' ||
      lower.includes('izin') ||
      lower.includes('rapor') ||
      lower.includes('yıllık') ||
      lower.includes('ücretsiz');
    const isCancelled = note.type === 'Nöbet Boşa Çıkarma';

    if (!isLeave && !isCancelled) continue;

    const person = formatTitleCaseTRLocal(note.swapMyPerson || defaultMyPerson);
    if (person) {
      memberItems = memberItems.filter((m) => !isSamePersonNameTR(m.name, person));
    }
  }

  return {
    membersText: memberItems.map((m) => m.name).join(', '),
    memberItems,
  };
};

export const getEffectiveGroupIdxForDate = (
  isoDateStr: string,
  settings: AppSettings,
  refHistory: RefRecord[],
  notes: NoteItem[] = []
): number => {
  const ref = getActiveReferenceForDate(isoDateStr, refHistory);
  if (!ref) return 0;
  const matchedWorkerGroupIdx = findWorkerGroupIdxInSettings(settings.activeWorkerName, settings);
  const myGroupIdx = matchedWorkerGroupIdx !== null ? matchedWorkerGroupIdx : ref.myGroupIdx;
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
  const fmtHM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const escapeICS = (str: string) =>
    str
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');

  const nowStamp = fmtUTC(new Date());
  const daysInMonth = new Date(year, month, 0).getDate();

  const targetGroups: number[] =
    groupIdx === -2
      ? Array.from({ length: settings.numGroups }, (_, idx) => idx)
      : [groupIdx >= 0 ? groupIdx : -1];

  const calTitle =
    groupIdx === -2
      ? `112 Tüm Gruplar Nöbet Takvimi (${pad(month)}/${year})`
      : `112 Vardiya Nöbet Takvimi (${pad(month)}/${year})`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//112 Vardiya Sistemi//NONSGML v1.0//TR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeICS(calTitle)}`,
  ];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;

    for (const gIdx of targetGroups) {
      const info = querySingleDayForGroup(dateStr, gIdx, settings, refs, notes);
      const dayShifts = [info.dayShift, info.nightShift].filter(
        (s): s is ShiftInstance => s !== null
      );

      for (const shift of dayShifts) {
        const isDay = shift.shiftType === 'GUNDUZ';
        const title = settings.is24HourSystem
          ? '🚑 24 Saat Nöbeti'
          : isDay
          ? '☀️ Gündüz Nöbeti'
          : '🌙 Akşam Nöbeti';

        const memberInfo = getEffectiveGroupMembersForShift(
          dateStr,
          shift.groupIdx,
          shift.shiftType,
          settings,
          refs,
          notes
        );
        const descParts = [
          `Grup: ${info.groupName}`,
          `Saat: ${fmtHM(shift.startDT)} - ${fmtHM(shift.endDT)} (${shift.durationHours} Saat)`,
        ];
        if (memberInfo.membersText) {
          descParts.push(`Personel: ${memberInfo.membersText}`);
        }

        lines.push(
          'BEGIN:VEVENT',
          `UID:vardiya112-${dateStr}-g${shift.groupIdx}-${isDay ? 'D' : 'N'}@vardiya112.app`,
          `DTSTAMP:${nowStamp}`,
          `DTSTART:${fmtUTC(shift.startDT)}`,
          `DTEND:${fmtUTC(shift.endDT)}`,
          `SUMMARY:${escapeICS(`${title} (${info.groupName})`)}`,
          `DESCRIPTION:${escapeICS(descParts.join('\n'))}`,
          'STATUS:CONFIRMED',
          'SEQUENCE:0',
          'TRANSP:OPAQUE',
          'BEGIN:VALARM',
          'TRIGGER:-PT60M',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeICS(`${title} (${info.groupName}) 1 saat sonra başlıyor`)}`,
          'END:VALARM',
          'END:VEVENT'
        );
      }
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
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

  // Test: Shift Swap (Becayiş) ve Personel Değişimi
  const swapTestSettings: AppSettings = {
    ...testSettings,
    groupMembers: ['Tufan Uysal, Ali Kaya', 'Mehmet Demir', 'Ahmet Yılmaz, Hasan Çelik', 'Veli Öz', 'Burak Can'],
  };
  const swapNotes: NoteItem[] = [
    {
      id: 1,
      date: '2026-03-01',
      type: 'Nöbet Değişimi',
      desc: 'Becayiş testi',
      isNewRef: false,
      swapTargetDate: '2026-03-02',
      swapShiftType: 'AKSAM',
      swapMyPerson: 'Tufan Uysal',
      swapWithPerson: 'Ahmet Yılmaz',
    },
  ];
  const swappedOutDay = querySingleDayForGroup(
    '2026-03-01',
    0,
    swapTestSettings,
    [testRefs[0]],
    swapNotes
  );
  const swappedInDay = querySingleDayForGroup(
    '2026-03-02',
    0,
    swapTestSettings,
    [testRefs[0]],
    swapNotes
  );
  assertCond(
    swappedOutDay.dayShift === null && swappedInDay.nightShift !== null,
    'Nöbet değişimi (becayiş) yapılan gün izinli görünmeli, hedef günde yeni vardiya oluşmalı.'
  );

  const day1Members = getEffectiveGroupMembersForShift(
    '2026-03-01',
    0,
    'GUNDUZ',
    swapTestSettings,
    [testRefs[0]],
    swapNotes,
    'Tufan Uysal'
  );
  assertCond(
    day1Members.membersText.includes('Ahmet Yılmaz') &&
      !day1Members.membersText.includes('Tufan Uysal'),
    'Becayiş yapılan günde eski personelin yerine nöbet değişimi yapılan kişi görünmeli.'
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

export const countInclusiveDays = (startISO: string, endISO?: string): number => {
  if (!startISO) return 1;
  const targetEnd = endISO && endISO.trim() ? endISO.trim() : startISO;
  const [sy, sm, sd] = startISO.split('-').map((n) => parseInt(n, 10));
  const [ey, em, ed] = targetEnd.split('-').map((n) => parseInt(n, 10));
  if (!sy || !sm || !sd || !ey || !em || !ed) return 1;
  const s = new Date(sy, sm - 1, sd, 12, 0, 0, 0);
  const e = new Date(ey, em - 1, ed, 12, 0, 0, 0);
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000);
  return diff >= 0 ? diff + 1 : 1;
};

export interface GroupedNoteRecord<T> {
  key: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  type: string;
  personName: string;
  groupIdx?: number;
  swapWithPerson?: string;
  swapTargetDate?: string;
  swapShiftType?: 'GUNDUZ' | 'AKSAM';
  desc: string;
  items: T[];
}

/**
 * Birden fazla gün ardarda izin, rapor, icap, nöbet boşa çıkarma veya aynı türden kayıt alan
 * bir personel için her günün kaydını tek tek listelemek yerine ardışık günleri birleştirerek
 * "Başlangıç Tarihi – Bitiş Tarihi (X Gün)" şeklinde tek bir aralık kaydı olarak gruplar.
 */
export function groupConsecutiveRecords<
  T extends {
    date: string;
    type: string;
    desc?: string;
    personName?: string;
    swapMyPerson?: string;
    groupIdx?: number;
    targetGroupIdx?: number;
    swapWithPerson?: string;
    swapTargetDate?: string;
    swapShiftType?: 'GUNDUZ' | 'AKSAM';
  }
>(records: T[]): GroupedNoteRecord<T>[] {
  if (!records || records.length === 0) return [];

  // Sort ascending by person, type, and date so consecutive days sit adjacent
  const sorted = [...records].sort((a, b) => {
    const pA = (a.personName || a.swapMyPerson || '').trim().toLocaleLowerCase('tr-TR');
    const pB = (b.personName || b.swapMyPerson || '').trim().toLocaleLowerCase('tr-TR');
    if (pA !== pB) return pA.localeCompare(pB, 'tr-TR');
    if (a.type !== b.type) return a.type.localeCompare(b.type, 'tr-TR');
    return a.date.localeCompare(b.date);
  });

  const groups: GroupedNoteRecord<T>[] = [];

  for (const item of sorted) {
    const person = (item.personName || item.swapMyPerson || '').trim();
    const desc = (item.desc || '').trim();
    const gIdx =
      typeof item.groupIdx === 'number'
        ? item.groupIdx
        : typeof item.targetGroupIdx === 'number'
        ? item.targetGroupIdx
        : undefined;
    const isSwappable = item.type === 'Nöbet Değişimi';

    const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
    let canMerge = false;

    if (
      lastGroup &&
      !isSwappable &&
      lastGroup.type === item.type &&
      isSamePersonNameTR(lastGroup.personName || 'Kişisel', person || 'Kişisel') &&
      (lastGroup.desc || '').toLocaleLowerCase('tr-TR') === desc.toLocaleLowerCase('tr-TR') &&
      (lastGroup.swapShiftType || 'GUNDUZ') === (item.swapShiftType || 'GUNDUZ')
    ) {
      if (item.date === lastGroup.endDate) {
        canMerge = true;
      } else {
        const nextDayAfterLast = toISODate(addDays(createLocalDate(lastGroup.endDate), 1));
        if (item.date === nextDayAfterLast) {
          canMerge = true;
        }
      }
    }

    if (canMerge && lastGroup) {
      if (item.date > lastGroup.endDate) {
        lastGroup.endDate = item.date;
        lastGroup.dayCount = countInclusiveDays(lastGroup.startDate, lastGroup.endDate);
      }
      lastGroup.items.push(item);
    } else {
      groups.push({
        key: `${person || 'local'}_${item.type}_${item.date}_${groups.length}`,
        startDate: item.date,
        endDate: item.date,
        dayCount: 1,
        type: item.type,
        personName: person,
        groupIdx: gIdx,
        swapWithPerson: item.swapWithPerson,
        swapTargetDate: item.swapTargetDate,
        swapShiftType: item.swapShiftType,
        desc,
        items: [item],
      });
    }
  }

  return groups.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

