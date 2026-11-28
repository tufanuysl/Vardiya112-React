import React, { useState, useMemo, useEffect } from 'react';
import {
  AppSettings,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  UnitLeaveRequestDoc,
  UnitProfileLockDoc,
} from '../types';
import {
  querySingleDayForGroup,
  getActiveReferenceForDate,
  trDateFormatter,
  toISODate,
  addDays,
  createLocalDate,
  isSamePersonNameTR,
  countInclusiveDays,
  groupConsecutiveRecords,
} from '../shiftEngine';
import { formatTitleCaseTR } from '../storage';
import { isLightTheme } from '../themes';
import {
  addUnitRosterNoteRangeToCloud,
  submitUnitLeaveRequestToCloud,
} from '../services/institutionUnitService';
import { Trash2, ArrowRight, Users, Send, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';

interface QuickNoteModalProps {
  dateISO: string;
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  activeUnit?: InstitutionUnitDoc | null;
  activeUnitLeaveRequests?: UnitLeaveRequestDoc[];
  activeUnitProfileLocks?: UnitProfileLockDoc[];
  currentUserUid?: string | null;
  isAdminBureauMode?: boolean;
  activeProfileName?: string;
  onSaveNote: (note: NoteItem) => void;
  onSaveNotesBatch?: (notesToAdd: NoteItem[]) => void;
  onDeleteNote: (id: number) => void;
  onDeleteNotesBatch?: (idsToRemove: number[]) => void;
  onRememberWorkerName?: (workerName: string) => void;
  onTriggerToast?: (title: string, message: string) => void;
  onGoToDetail: () => void;
  onDismiss: () => void;
}

const LEAVE_SUB_TYPES = [
  'Yıllık İzin',
  'İdari İzin',
  'Ücretsiz İzin',
  'Raporlu',
  'Mazeret İzni',
] as const;
type LeaveSubType = (typeof LEAVE_SUB_TYPES)[number];

export const QuickNoteModal: React.FC<QuickNoteModalProps> = ({
  dateISO,
  settings,
  refHistory,
  notes,
  activeUnit = null,
  activeUnitLeaveRequests = [],
  activeUnitProfileLocks = [],
  currentUserUid = null,
  isAdminBureauMode = false,
  activeProfileName,
  onSaveNote,
  onSaveNotesBatch,
  onDeleteNote,
  onDeleteNotesBatch,
  onRememberWorkerName,
  onTriggerToast,
  onGoToDetail,
  onDismiss,
}) => {
  const isLight = isLightTheme(settings.theme);

  const [noteType, setNoteType] = useState<
    'İzin / Rapor' | 'İcap Nöbeti' | 'Nöbet Değişimi' | 'Not'
  >('İzin / Rapor');
  const [leaveSubType, setLeaveSubType] = useState<LeaveSubType>('Yıllık İzin');
  const [noteDesc, setNoteDesc] = useState('');
  const [endDateISO, setEndDateISO] = useState<string>('');
  const [sendForAdminApproval, setSendForAdminApproval] = useState<boolean>(() =>
    Boolean(activeUnit)
  );
  const [submittingApproval, setSubmittingApproval] = useState<boolean>(false);

  const ref = getActiveReferenceForDate(dateISO, refHistory);
  const baseGroupIdx = ref ? ref.myGroupIdx : 0;
  const [adminTargetGroupIdx, setAdminTargetGroupIdx] = useState<number>(baseGroupIdx);
  const myGroupIdx = isAdminBureauMode ? adminTargetGroupIdx : baseGroupIdx;

  const baseDayInfo = useMemo(
    () => querySingleDayForGroup(dateISO, myGroupIdx, settings, refHistory, []),
    [dateISO, myGroupIdx, settings, refHistory]
  );
  const dayInfo = querySingleDayForGroup(dateISO, isAdminBureauMode ? myGroupIdx : null, settings, refHistory, notes);
  const cleanStatusText = dayInfo.statusText.replace(/^[^\wÇĞİÖŞÜçğıöşü24]+\s*/, '');

  const hasOwnShiftOnClickedDate = Boolean(baseDayInfo.dayShift || baseDayInfo.nightShift);

  const nearestOwnShiftDate = useMemo(() => {
    if (hasOwnShiftOnClickedDate) return dateISO;
    const baseD = createLocalDate(dateISO);
    for (let offset = 1; offset <= 10; offset++) {
      const nextISO = toISODate(addDays(baseD, offset));
      const nextInfo = querySingleDayForGroup(nextISO, myGroupIdx, settings, refHistory, []);
      if (nextInfo.dayShift || nextInfo.nightShift) return nextISO;

      const prevISO = toISODate(addDays(baseD, -offset));
      const prevInfo = querySingleDayForGroup(prevISO, myGroupIdx, settings, refHistory, []);
      if (prevInfo.dayShift || prevInfo.nightShift) return prevISO;
    }
    return dateISO;
  }, [dateISO, hasOwnShiftOnClickedDate, myGroupIdx, settings, refHistory]);

  const [swapSourceDate, setSwapSourceDate] = useState<string>(() =>
    hasOwnShiftOnClickedDate ? dateISO : nearestOwnShiftDate
  );
  const [swapTargetDate, setSwapTargetDate] = useState<string>(() =>
    hasOwnShiftOnClickedDate ? toISODate(addDays(createLocalDate(dateISO), 1)) : dateISO
  );
  const [swapShiftType, setSwapShiftType] = useState<'GUNDUZ' | 'AKSAM'>(() => {
    if (hasOwnShiftOnClickedDate) {
      return baseDayInfo.nightShift ? 'AKSAM' : 'GUNDUZ';
    }
    const nowH = new Date().getHours();
    return nowH >= 19 || nowH < 8 ? 'AKSAM' : 'GUNDUZ';
  });

  // Seçili gruptaki personeller
  const myGroupMembers = useMemo(() => {
    const raw = settings.groupMembers[myGroupIdx] || '';
    return raw
      .split(/[,;\n]+/)
      .map((p) => formatTitleCaseTR(p))
      .filter(Boolean);
  }, [settings.groupMembers, myGroupIdx]);

  // Varsayılan personel
  const defaultMyPerson = useMemo(() => {
    if (!isAdminBureauMode && settings.activeWorkerName?.trim()) {
      return formatTitleCaseTR(settings.activeWorkerName);
    }
    if (!isAdminBureauMode) {
      const cleanProf =
        activeProfileName && activeProfileName.trim() !== 'Ana Profilim'
          ? formatTitleCaseTR(activeProfileName)
          : '';
      if (cleanProf) return cleanProf;
    }
    return myGroupMembers[0] || '';
  }, [isAdminBureauMode, settings.activeWorkerName, activeProfileName, myGroupMembers]);

  const [swapMyPerson, setSwapMyPerson] = useState<string>(defaultMyPerson);
  const [swapWithPerson, setSwapWithPerson] = useState<string>('');

  useEffect(() => {
    if (isAdminBureauMode && myGroupMembers.length > 0) {
      const exists = myGroupMembers.some((m) => isSamePersonNameTR(m, swapMyPerson));
      if (!exists) {
        setSwapMyPerson(myGroupMembers[0]);
      }
    }
  }, [isAdminBureauMode, myGroupMembers, swapMyPerson]);

  // Karşılık gününde ve vardiyasında nöbetçi olan hedef grup ve personelleri
  const targetDutyGroupInfo = useMemo(() => {
    if (!refHistory || refHistory.length === 0 || !swapTargetDate) return null;
    for (let g = 0; g < settings.numGroups; g++) {
      const gInfo = querySingleDayForGroup(swapTargetDate, g, settings, refHistory, []);
      const isMatch = settings.is24HourSystem
        ? Boolean(gInfo.dayShift || gInfo.nightShift)
        : swapShiftType === 'GUNDUZ'
        ? Boolean(gInfo.dayShift)
        : Boolean(gInfo.nightShift);
      if (isMatch) {
        const gName = settings.groupNames[g] || `${g + 1}. Grup`;
        const people = (settings.groupMembers[g] || '')
          .split(/[,;\n]+/)
          .map((p) => formatTitleCaseTR(p))
          .filter(Boolean);
        return { groupIdx: g, groupName: gName, people };
      }
    }
    return null;
  }, [swapTargetDate, swapShiftType, settings, refHistory]);

  useEffect(() => {
    if (
      targetDutyGroupInfo &&
      targetDutyGroupInfo.people.length === 1 &&
      !swapWithPerson.trim()
    ) {
      setSwapWithPerson(targetDutyGroupInfo.people[0]);
    }
  }, [targetDutyGroupInfo]);

  // Group consecutive multi-day records into a single range entry with total day count
  const dayNotes = dayInfo.notes || [];
  const groupedDayNotes = useMemo(() => {
    if (dayNotes.length === 0) return [];
    const dayNoteIdSet = new Set(dayNotes.map((n) => n.id));
    const allGrouped = groupConsecutiveRecords(notes);
    return allGrouped.filter((grp) => grp.items.some((it) => dayNoteIdSet.has(it.id)));
  }, [dayNotes, notes]);

  const activeWorkerIdentity = (settings.activeWorkerName || '').trim();
  const dayPendingRequests = useMemo(() => {
    if (!activeWorkerIdentity) return [];
    return activeUnitLeaveRequests.filter(
      (req) =>
        req.status === 'PENDING' &&
        isSamePersonNameTR(req.personName, activeWorkerIdentity) &&
        ((req.startDate <= dateISO && req.endDate >= dateISO) || req.swapTargetDate === dateISO)
    );
  }, [
    activeUnitLeaveRequests,
    activeWorkerIdentity,
    dateISO,
  ]);

  const dutyGroupsSummary = useMemo(() => {
    if (!refHistory || refHistory.length === 0) return null;
    let dayGroup = '-';
    let nightGroup = '-';
    for (let g = 0; g < settings.numGroups; g++) {
      const gInfo = querySingleDayForGroup(dateISO, g, settings, refHistory, []);
      const gName = settings.groupNames[g] || `${g + 1}. Grup`;
      if (gInfo.dayShift) dayGroup = gName;
      if (gInfo.nightShift) nightGroup = gName;
    }
    return { dayGroup, nightGroup };
  }, [dateISO, settings, refHistory]);

  const buildLocalNoteRange = (
    startISO: string,
    endISO: string | undefined,
    cleanMy: string,
    cleanWith: string,
    finalDesc: string
  ): NoteItem[] => {
    const isMultiDayAllowed = noteType === 'İzin / Rapor' || noteType === 'İcap Nöbeti';
    const effectiveEnd =
      isMultiDayAllowed && endISO && endISO.trim() >= startISO ? endISO.trim() : startISO;
    const totalDays = Math.min(60, countInclusiveDays(startISO, effectiveEnd));
    const startD = createLocalDate(startISO);
    const baseId = Date.now();
    const list: NoteItem[] = [];
    for (let i = 0; i < totalDays; i++) {
      const curISO = toISODate(addDays(startD, i));
      list.push({
        id: baseId + i,
        date: curISO,
        type: noteType,
        desc: finalDesc,
        isNewRef: false,
        swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
        swapShiftType,
        swapWithPerson: noteType === 'Nöbet Değişimi' ? cleanWith : undefined,
        swapMyPerson: cleanMy,
        targetGroupIdx: myGroupIdx,
      });
    }
    return list;
  };

  const handleSave = async () => {
    const cleanWith = formatTitleCaseTR(swapWithPerson);
    const cleanMy = formatTitleCaseTR(swapMyPerson || defaultMyPerson || 'Personel');
    const effectiveSourceDate =
      noteType === 'Nöbet Değişimi' ? swapSourceDate || dateISO : dateISO;

    const partnerPart = cleanWith ? ` (${cleanWith} ile)` : '';
    const rawDesc = noteDesc.trim();
    const resolvedLeaveDesc =
      noteType === 'İzin / Rapor'
        ? !rawDesc
          ? leaveSubType
          : rawDesc.toLocaleLowerCase('tr-TR').includes(leaveSubType.toLocaleLowerCase('tr-TR'))
          ? rawDesc
          : `${leaveSubType} · ${rawDesc}`
        : rawDesc;

    const finalDesc =
      noteType === 'Nöbet Değişimi' && !rawDesc
        ? `${trDateFormatter(effectiveSourceDate)} nöbeti -> ${trDateFormatter(swapTargetDate)} (${
            swapShiftType === 'GUNDUZ' ? 'Sabah - S' : 'Akşam - A'
          })${partnerPart} değişti`
        : resolvedLeaveDesc ||
          (noteType === 'İzin / Rapor'
            ? leaveSubType
            : noteType === 'İcap Nöbeti'
            ? `İcap Nöbeti (${swapShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
            : noteType);

    if (!isAdminBureauMode && cleanMy && cleanMy !== 'Personel') {
      onRememberWorkerName?.(cleanMy);
    }

    const effectiveEndForRange =
      (noteType === 'İzin / Rapor' || noteType === 'İcap Nöbeti') && endDateISO.trim()
        ? endDateISO.trim()
        : effectiveSourceDate;
    const requestedDayCount = countInclusiveDays(effectiveSourceDate, effectiveEndForRange);

    // 0. Admin Bureau Mode + Active Unit -> Write directly to official Firestore `/units/{unitId}/rosterNotes`
    if (isAdminBureauMode && activeUnit) {
      setSubmittingApproval(true);
      try {
        const addedDays = await addUnitRosterNoteRangeToCloud({
          unitId: activeUnit.id,
          startDate: effectiveSourceDate,
          endDate:
            (noteType === 'İzin / Rapor' || noteType === 'İcap Nöbeti') && endDateISO.trim()
              ? endDateISO.trim()
              : undefined,
          type: noteType,
          personName: cleanMy,
          groupIdx: myGroupIdx,
          swapWithPerson: noteType === 'Nöbet Değişimi' ? cleanWith : '',
          swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
          swapShiftType,
          desc: finalDesc,
        });
        onTriggerToast?.(
          'Kurum Sunucusuna Kaydedildi',
          addedDays > 1
            ? `${cleanMy} için ${trDateFormatter(effectiveSourceDate)} – ${trDateFormatter(
                effectiveEndForRange
              )} (${addedDays} Gün) ${noteType} kaydı tek aralık olarak işlendi.`
            : `${cleanMy} için ${noteType} kaydı resmi kurum sunucusuna işlendi.`
        );
        onDismiss();
      } catch {
        onTriggerToast?.(
          'Sunucuya Kaydedilemedi',
          'Kayıt sunucuya işlenirken bir sorun oluştu. Bağlantınızı kontrol edip tekrar deneyin.'
        );
      } finally {
        setSubmittingApproval(false);
      }
      return;
    }

    // 1. If connected to an institution unit and "Yönetici Onayına Gönder" is active:
    if (activeUnit && sendForAdminApproval) {
      setSubmittingApproval(true);
      try {
        await submitUnitLeaveRequestToCloud({
          unitId: activeUnit.id,
          startDate: effectiveSourceDate,
          endDate: effectiveEndForRange,
          type: noteType,
          personName: cleanMy,
          groupIdx: myGroupIdx,
          swapWithPerson: noteType === 'Nöbet Değişimi' ? cleanWith : '',
          swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
          swapShiftType,
          desc: finalDesc,
        });
        onTriggerToast?.(
          'Yönetici Onayına Gönderildi',
          requestedDayCount > 1
            ? `${cleanMy} için ${trDateFormatter(effectiveSourceDate)} – ${trDateFormatter(
                effectiveEndForRange
              )} (${requestedDayCount} Gün) ${noteType} talebi yönetici onayına iletildi.`
            : `${cleanMy} için ${noteType} talebi yönetici onayına iletildi. Yönetici onayladığında ana takvime ve tabloya otomatik geçecektir.`
        );
        onDismiss();
      } catch {
        // Fallback to local save if offline
        const batchNotes = buildLocalNoteRange(
          effectiveSourceDate,
          endDateISO,
          cleanMy,
          cleanWith,
          finalDesc
        );
        if (onSaveNotesBatch && batchNotes.length > 1) {
          onSaveNotesBatch(batchNotes);
        } else {
          onSaveNote(batchNotes[0]);
        }
        onDismiss();
      } finally {
        setSubmittingApproval(false);
      }
      return;
    }

    // 2. Local Personal Calendar Save
    const batchNotes = buildLocalNoteRange(
      effectiveSourceDate,
      endDateISO,
      cleanMy,
      cleanWith,
      finalDesc
    );
    if (onSaveNotesBatch && batchNotes.length > 1) {
      onSaveNotesBatch(batchNotes);
      onTriggerToast?.(
        'Çok Günlü Kayıt Eklendi',
        `${cleanMy} için ${trDateFormatter(effectiveSourceDate)} – ${trDateFormatter(
          effectiveEndForRange
        )} (${batchNotes.length} Gün) ${noteType} tek kayıt aralığı olarak kaydedildi.`
      );
    } else {
      onSaveNote(batchNotes[0]);
    }
    onDismiss();
  };

  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border overflow-hidden shadow-2xl animate-fade-in transition-all ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#111622] border-slate-800 text-white'
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-start justify-between gap-2 ${
            isLight ? 'border-slate-100' : 'border-slate-800/80'
          }`}
        >
          <div>
            <div className="text-base font-bold">{trDateFormatter(dateISO)}</div>
            <div className="text-xs font-medium text-sky-500 mt-0.5">{cleanStatusText}</div>
            {dutyGroupsSummary && (
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                <span>☀️ Gündüz: {dutyGroupsSummary.dayGroup}</span>
                <span aria-hidden="true">·</span>
                <span>🌙 Gece: {dutyGroupsSummary.nightGroup}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onGoToDetail}
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80'
                : 'text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800'
            }`}
          >
            <span>Güne Git</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3.5 max-h-[75vh] overflow-y-auto">
          {/* Pending Approval Requests on this date */}
          {dayPendingRequests.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Bu Gün İçin Yönetici Onayı Bekleyen Talepler</span>
              </span>
              {dayPendingRequests.map((req) => {
                const reqDays = countInclusiveDays(req.startDate, req.endDate || req.startDate);
                return (
                  <div
                    key={req.id}
                    className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-xs flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-extrabold text-amber-300 truncate flex items-center gap-1.5 flex-wrap">
                        <span>
                          ⏳ {req.personName} · {req.type}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-200 text-[10px] font-black">
                          {reqDays} Gün
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-200/85 truncate mt-0.5">
                        {trDateFormatter(req.startDate)}
                        {req.endDate && req.endDate !== req.startDate
                          ? ` – ${trDateFormatter(req.endDate)}`
                          : ''}{' '}
                        · {req.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Existing Notes on this date (Consecutive days merged into a single date-range entry) */}
          {groupedDayNotes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-slate-400">
                Bu Güne Ait Onaylı Kayıtlar ve Notlar
              </span>
              <div className="flex flex-col gap-1.5">
                {groupedDayNotes.map((grp) => {
                  const firstItem = grp.items[0];
                  const isCloudBacked = grp.items.some((it) => Boolean(it.cloudNoteId));
                  return (
                    <div
                      key={grp.key}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                        isLight
                          ? 'bg-slate-50 border-slate-200/80 text-slate-800'
                          : 'bg-slate-900/70 border-slate-800 text-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-sky-500">{grp.type}</span>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300">
                            {grp.dayCount} Gün
                          </span>
                          {isCloudBacked && (
                            <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center gap-0.5">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Onaylı Ana Takvim</span>
                            </span>
                          )}
                          {grp.swapWithPerson && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                              🔄 {grp.personName ? `${grp.personName} ⇄ ` : ''}
                              {grp.swapWithPerson}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-400 mt-0.5">
                          {trDateFormatter(grp.startDate)}
                          {grp.endDate !== grp.startDate
                            ? ` – ${trDateFormatter(grp.endDate)} (${grp.dayCount} Gün)`
                            : ''}
                        </div>
                        <div className="text-xs truncate mt-0.5">{grp.desc}</div>
                      </div>
                      {!isCloudBacked && firstItem && (
                        <button
                          type="button"
                          onClick={() => {
                            const ids = grp.items.map((it) => it.id);
                            if (onDeleteNotesBatch && ids.length > 1) {
                              onDeleteNotesBatch(ids);
                            } else {
                              onDeleteNote(firstItem.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                          title={
                            grp.dayCount > 1
                              ? `${grp.dayCount} günlük kayıt aralığını sil`
                              : 'Kaydı sil'
                          }
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category Selector (Includes direct İdari İzin and Ücretsiz İzin choices) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400">Kayıt Türü</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setNoteType('İzin / Rapor');
                  if (leaveSubType === 'İdari İzin' || leaveSubType === 'Ücretsiz İzin') {
                    setLeaveSubType('Yıllık İzin');
                  }
                }}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'İzin / Rapor' &&
                  leaveSubType !== 'İdari İzin' &&
                  leaveSubType !== 'Ücretsiz İzin'
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                🟪 İzin / Rapor
              </button>

              <button
                type="button"
                onClick={() => {
                  setNoteType('İzin / Rapor');
                  setLeaveSubType('İdari İzin');
                }}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'İzin / Rapor' && leaveSubType === 'İdari İzin'
                    ? 'bg-fuchsia-600 border-fuchsia-400 text-white'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                🏛️ İdari İzin
              </button>

              <button
                type="button"
                onClick={() => {
                  setNoteType('İzin / Rapor');
                  setLeaveSubType('Ücretsiz İzin');
                }}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'İzin / Rapor' && leaveSubType === 'Ücretsiz İzin'
                    ? 'bg-violet-600 border-violet-400 text-white'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                ⏸️ Ücretsiz İzin
              </button>

              <button
                type="button"
                onClick={() => setNoteType('İcap Nöbeti')}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'İcap Nöbeti'
                    ? 'bg-[#fef08a] border-amber-500 text-slate-950'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                🟨 İcap (S/A)
              </button>

              <button
                type="button"
                onClick={() => setNoteType('Nöbet Değişimi')}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'Nöbet Değişimi'
                    ? isLight
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-white text-slate-900'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                🔄 Değişim
              </button>

              <button
                type="button"
                onClick={() => setNoteType('Not')}
                className={`px-2.5 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  noteType === 'Not'
                    ? isLight
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-white text-slate-900'
                    : isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200/80'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                📝 Not
              </button>
            </div>

            {/* Leave Sub-Type Selector Strip when İzin / Rapor is active */}
            {noteType === 'İzin / Rapor' && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                {LEAVE_SUB_TYPES.map((sub) => {
                  const active = leaveSubType === sub;
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setLeaveSubType(sub)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                        active
                          ? 'bg-purple-600/20 border-purple-400 text-purple-300'
                          : isLight
                          ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sub}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin Group Picker when recording directly to official server */}
          {isAdminBureauMode && (
            <div>
              <label className="text-[10.5px] font-bold text-slate-400 block mb-1">
                İlgili Nöbet Grubu
              </label>
              <select
                value={adminTargetGroupIdx}
                onChange={(e) => setAdminTargetGroupIdx(parseInt(e.target.value, 10))}
                className={`w-full p-2 rounded-xl text-xs font-bold border outline-none ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-900'
                    : 'bg-slate-900 border-slate-700 text-white'
                }`}
              >
                {Array.from({ length: settings.numGroups }, (_, gIdx) => (
                  <option key={`adm-grp-${gIdx}`} value={gIdx}>
                    {settings.groupNames[gIdx] || `${gIdx + 1}. Grup`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Person Name & Multi-Day End Date for Leave / On-Call */}
          {noteType !== 'Nöbet Değişimi' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10.5px] font-bold text-slate-400 block mb-1">
                  {isAdminBureauMode ? 'İlgili Personel' : 'Personel Adınız'}
                </label>
                {!isAdminBureauMode && settings.appRoleMode !== 'admin' && activeWorkerIdentity ? (
                  <div
                    className={`w-full p-2 rounded-xl text-xs font-extrabold border flex items-center justify-between gap-2 ${
                      isLight
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200'
                    }`}
                  >
                    <span className="truncate">{formatTitleCaseTR(activeWorkerIdentity)}</span>
                    <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                      ✓ Doğrulandı
                    </span>
                  </div>
                ) : myGroupMembers.length > 0 ? (
                  <select
                    value={swapMyPerson}
                    onChange={(e) => setSwapMyPerson(e.target.value)}
                    className={`w-full p-2 rounded-xl text-xs font-bold border outline-none ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-900'
                        : 'bg-slate-900 border-slate-700 text-white'
                    }`}
                  >
                    {myGroupMembers.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={swapMyPerson}
                    onChange={(e) => setSwapMyPerson(e.target.value)}
                    placeholder="Adınız Soyadınız..."
                    className={`w-full p-2 rounded-xl text-xs font-bold border outline-none ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-900'
                        : 'bg-slate-900 border-slate-700 text-white'
                    }`}
                  />
                )}
              </div>

              {(noteType === 'İzin / Rapor' || noteType === 'İcap Nöbeti') && (
                <div>
                  <label className="text-[10.5px] font-bold text-slate-400 flex items-center justify-between gap-1 mb-1">
                    <span>Bitiş Tarihi (Çok Günlü İse)</span>
                    {endDateISO && endDateISO >= dateISO && (
                      <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-extrabold">
                        {countInclusiveDays(dateISO, endDateISO)} Gün
                      </span>
                    )}
                  </label>
                  <input
                    type="date"
                    value={endDateISO}
                    min={dateISO}
                    onChange={(e) => setEndDateISO(e.target.value)}
                    className={`w-full p-2 rounded-xl text-xs font-bold border outline-none ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-900'
                        : 'bg-slate-900 border-slate-700 text-white'
                    }`}
                  />
                </div>
              )}
            </div>
          )}

          {/* Swap Box if Nöbet Değişimi */}
          {noteType === 'Nöbet Değişimi' && (
            <div
              className={`p-3.5 rounded-xl border flex flex-col gap-3 ${
                isLight ? 'bg-slate-50 border-slate-200/80' : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-emerald-500 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span>Nöbet Değişimi Yapılan Kişi</span>
                  </label>
                  {targetDutyGroupInfo && (
                    <span className="text-[10px] font-bold text-slate-400">
                      Hedef: {targetDutyGroupInfo.groupName}
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  value={swapWithPerson}
                  onChange={(e) => setSwapWithPerson(e.target.value)}
                  placeholder="Değişim yapılan personelin adı (Örn: Ahmet Yılmaz)..."
                  className={`w-full p-2.5 rounded-lg text-xs font-semibold border outline-none ${
                    isLight
                      ? 'bg-white border-emerald-300 text-slate-900 focus:border-emerald-500'
                      : 'bg-[#111622] border-emerald-500/40 text-white focus:border-emerald-400'
                  }`}
                />

                {targetDutyGroupInfo && targetDutyGroupInfo.people.length > 0 && (
                  <div className="flex flex-col gap-1 pt-0.5">
                    <span className="text-[10px] text-slate-400">
                      {targetDutyGroupInfo.groupName} personellerinden seçin:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {targetDutyGroupInfo.people.map((person) => {
                        const isSel =
                          swapWithPerson.trim().toLocaleLowerCase('tr-TR') ===
                          person.toLocaleLowerCase('tr-TR');
                        return (
                          <button
                            key={person}
                            type="button"
                            onClick={() => setSwapWithPerson(person)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                              isSel
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : isLight
                                ? 'bg-white border border-slate-200 text-slate-700 hover:bg-emerald-50'
                                : 'bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700'
                            }`}
                          >
                            {person}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-500/15">
                <label className="text-[11px] font-semibold text-slate-400">
                  Kendi Grubunuzdan Değişen Personel (Sizin İsminiz)
                </label>
                {settings.appRoleMode !== 'admin' && activeWorkerIdentity ? (
                  <div
                    className={`w-full p-2 rounded-lg text-xs font-extrabold border flex items-center justify-between gap-2 ${
                      isLight
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200'
                    }`}
                  >
                    <span className="truncate">{formatTitleCaseTR(activeWorkerIdentity)}</span>
                    <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                      ✓ Google ile Doğrulandı
                    </span>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={swapMyPerson}
                      onChange={(e) => setSwapMyPerson(e.target.value)}
                      placeholder="Kendi isminiz (Örn: Tufan Uysal)..."
                      className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${
                        isLight
                          ? 'bg-white border-slate-200 text-slate-800'
                          : 'bg-[#111622] border-slate-800 text-white'
                      }`}
                    />
                    {myGroupMembers.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {myGroupMembers.map((person) => {
                          const isSel =
                            swapMyPerson.trim().toLocaleLowerCase('tr-TR') ===
                            person.toLocaleLowerCase('tr-TR');
                          return (
                            <button
                              key={person}
                              type="button"
                              onClick={() => setSwapMyPerson(person)}
                              className={`px-2 py-0.5 rounded-lg text-[10.5px] font-semibold transition cursor-pointer ${
                                isSel
                                  ? 'bg-sky-600 text-white'
                                  : isLight
                                  ? 'bg-white border border-slate-200 text-slate-600'
                                  : 'bg-slate-800 border border-slate-700 text-slate-300'
                              }`}
                            >
                              {person}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-500/15">
                <div>
                  <label className="text-[10.5px] font-semibold text-slate-400 block mb-1">
                    Devredilen Nöbet Günü
                  </label>
                  <input
                    type="date"
                    value={swapSourceDate}
                    onChange={(e) => setSwapSourceDate(e.target.value)}
                    className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${
                      isLight
                        ? 'bg-white border-slate-200 text-slate-800'
                        : 'bg-[#111622] border-slate-800 text-white'
                    }`}
                  />
                </div>

                <div>
                  <label className="text-[10.5px] font-semibold text-slate-400 block mb-1">
                    Yerine Tutulacak Gün
                  </label>
                  <input
                    type="date"
                    value={swapTargetDate}
                    onChange={(e) => setSwapTargetDate(e.target.value)}
                    className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${
                      isLight
                        ? 'bg-white border-slate-200 text-slate-800'
                        : 'bg-[#111622] border-slate-800 text-white'
                    }`}
                  />
                </div>
              </div>

              <div>
                <span className="text-[10.5px] font-semibold text-slate-400 block mb-1">
                  Nöbet Vardiyası (Sabah / Akşam)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapShiftType('GUNDUZ')}
                    className={`py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                      swapShiftType === 'GUNDUZ'
                        ? 'bg-amber-500 text-slate-950 shadow-xs'
                        : isLight
                        ? 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    ☀️ Sabah / Gündüz (S)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapShiftType('AKSAM')}
                    className={`py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                      swapShiftType === 'AKSAM'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : isLight
                        ? 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    🌙 Akşam / Gece (A)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* İcap Nöbeti Shift Type Selector (Sabah S / Akşam A -> Yellow cell in table) */}
          {noteType === 'İcap Nöbeti' && (
            <div
              className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                isLight ? 'bg-amber-50/70 border-amber-200' : 'bg-amber-500/10 border-amber-500/30'
              }`}
            >
              <span className="text-xs font-extrabold text-amber-500">
                İcaba Gelinecek Nöbet (Tabloda Sarı Kutucuk İçinde S veya A Yazar)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSwapShiftType('GUNDUZ')}
                  className={`py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    swapShiftType === 'GUNDUZ'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : isLight
                      ? 'bg-white border border-amber-200 text-slate-700'
                      : 'bg-slate-900 border border-slate-700 text-slate-300'
                  }`}
                >
                  ☀️ Sabah / Gündüz (S)
                </button>
                <button
                  type="button"
                  onClick={() => setSwapShiftType('AKSAM')}
                  className={`py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                    swapShiftType === 'AKSAM'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : isLight
                      ? 'bg-white border border-amber-200 text-slate-700'
                      : 'bg-slate-900 border border-slate-700 text-slate-300'
                  }`}
                >
                  🌙 Akşam / Gece (A)
                </button>
              </div>
            </div>
          )}

          {/* Description Textarea */}
          <div>
            <textarea
              rows={2}
              placeholder="Açıklama (Örn: Yıllık İzin, Raporlu, İcap Nöbeti, Görevlendirme)..."
              value={noteDesc}
              onChange={(e) => setNoteDesc(e.target.value)}
              className={`w-full p-3 rounded-xl text-xs border outline-none resize-none ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
                  : 'bg-slate-900/60 border-slate-800 text-white placeholder:text-slate-500'
              }`}
            />
          </div>

          {/* Admin Direct Server Notice OR Personnel Approval Switcher */}
          {activeUnit && isAdminBureauMode ? (
            <div
              className={`p-3 rounded-2xl border flex items-start gap-2.5 ${
                isLight
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-snug font-medium">
                Yönetici oturumundasınız. Bu kayıt doğrudan{' '}
                <strong>{activeUnit.name}</strong> resmi sunucusuna işlenir ve uygulama
                sıfırlansa dahi sunucuda kalıcı olarak saklanır.
              </p>
            </div>
          ) : activeUnit ? (
            <div
              className={`p-3 rounded-2xl border space-y-2 ${
                sendForAdminApproval
                  ? isLight
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-950'
                    : 'bg-indigo-950/40 border-indigo-500/40 text-indigo-100'
                  : isLight
                  ? 'bg-slate-100 border-slate-200 text-slate-700'
                  : 'bg-slate-900/80 border-slate-800 text-slate-300'
              }`}
            >
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setSendForAdminApproval(true)}
                  className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                    sendForAdminApproval
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-xs'
                      : 'bg-slate-900/80 border-slate-700 text-slate-300'
                  }`}
                >
                  🛡️ Yönetici Onayına Gönder
                </button>
                <button
                  type="button"
                  onClick={() => setSendForAdminApproval(false)}
                  className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                    !sendForAdminApproval
                      ? 'bg-sky-600 border-sky-400 text-white shadow-xs'
                      : 'bg-slate-900/80 border-slate-700 text-slate-300'
                  }`}
                >
                  👤 Sadece Kişisel Takvimim
                </button>
              </div>
              <p className="text-[10.5px] opacity-90 leading-snug">
                {sendForAdminApproval
                  ? `Talebiniz ${activeUnit.name} yöneticisine iletilir. Yönetici onayladığında veri otomatik olarak ana kurum takvimine ve tabloya geçiş yapar.`
                  : 'Veri yönetici onayına gitmeden yalnızca kendi telefonunuzdaki kişisel takviminize kaydedilir.'}
              </p>
            </div>
          ) : null}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onDismiss}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                isLight ? 'text-slate-500 hover:text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={submittingApproval}
              onClick={() => void handleSave()}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer ${
                activeUnit && isAdminBureauMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                  : activeUnit && sendForAdminApproval
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                  : isLight
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-white hover:bg-slate-200 text-slate-900'
              }`}
            >
              {activeUnit && isAdminBureauMode ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{submittingApproval ? 'Kaydediliyor...' : 'Resmi Sunucuya Kaydet'}</span>
                </>
              ) : activeUnit && sendForAdminApproval ? (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {submittingApproval ? 'Gönderiliyor...' : 'Yönetici Onayına Gönder'}
                  </span>
                </>
              ) : (
                <span>Kaydet</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
