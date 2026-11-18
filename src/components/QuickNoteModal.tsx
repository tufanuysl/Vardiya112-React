import React, { useState, useMemo, useEffect } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import {
  querySingleDayForGroup,
  getActiveReferenceForDate,
  trDateFormatter,
  toISODate,
  addDays,
  createLocalDate,
} from '../shiftEngine';
import { formatTitleCaseTR } from '../storage';
import { isLightTheme } from '../themes';
import { Trash2, ArrowRight, Users } from 'lucide-react';

interface QuickNoteModalProps {
  dateISO: string;
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  activeProfileName?: string;
  onSaveNote: (note: NoteItem) => void;
  onDeleteNote: (id: number) => void;
  onGoToDetail: () => void;
  onDismiss: () => void;
}

const CATEGORIES = ['Nöbet Değişimi', 'İcap Nöbeti', 'Grup Değişikliği', 'Not'];

export const QuickNoteModal: React.FC<QuickNoteModalProps> = ({
  dateISO,
  settings,
  refHistory,
  notes,
  activeProfileName,
  onSaveNote,
  onDeleteNote,
  onGoToDetail,
  onDismiss,
}) => {
  const isLight = isLightTheme(settings.theme);

  const [noteType, setNoteType] = useState('Nöbet Değişimi');
  const [noteDesc, setNoteDesc] = useState('');

  const ref = getActiveReferenceForDate(dateISO, refHistory);
  const myGroupIdx = ref ? ref.myGroupIdx : 0;

  const baseDayInfo = useMemo(
    () => querySingleDayForGroup(dateISO, myGroupIdx, settings, refHistory, []),
    [dateISO, myGroupIdx, settings, refHistory]
  );
  const dayInfo = querySingleDayForGroup(dateISO, null, settings, refHistory, notes);
  const cleanStatusText = dayInfo.statusText.replace(/^[^\wÇĞİÖŞÜçğıöşü24]+\s*/, '');

  const hasOwnShiftOnClickedDate = Boolean(baseDayInfo.dayShift || baseDayInfo.nightShift);

  // Eğer tıklanan günde kullanıcının kendi nöbeti yoksa (İstirahat günüyse),
  // kullanıcının en yakın kendi nöbet gününü bulalım ki tıklanan gün doğrudan "Yerine Tutulacak Gün" olsun.
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
    hasOwnShiftOnClickedDate
      ? toISODate(addDays(createLocalDate(dateISO), 1))
      : dateISO
  );
  const [swapShiftType, setSwapShiftType] = useState<'GUNDUZ' | 'AKSAM'>(() => {
    if (hasOwnShiftOnClickedDate) {
      return baseDayInfo.nightShift ? 'AKSAM' : 'GUNDUZ';
    }
    const nowH = new Date().getHours();
    return nowH >= 19 || nowH < 8 ? 'AKSAM' : 'GUNDUZ';
  });

  // Kendi grubumdaki personeller
  const myGroupMembers = useMemo(() => {
    const raw = settings.groupMembers[myGroupIdx] || '';
    return raw
      .split(/[,;\n]+/)
      .map((p) => formatTitleCaseTR(p))
      .filter(Boolean);
  }, [settings.groupMembers, myGroupIdx]);

  // Varsayılan kendi personelim (aktif profil adı veya gruptaki ilk kişi)
  const defaultMyPerson = useMemo(() => {
    const cleanProf =
      activeProfileName && activeProfileName.trim() !== 'Ana Profilim'
        ? formatTitleCaseTR(activeProfileName)
        : '';
    if (cleanProf) return cleanProf;
    return myGroupMembers[0] || '';
  }, [activeProfileName, myGroupMembers]);

  const [swapMyPerson, setSwapMyPerson] = useState<string>(defaultMyPerson);
  const [swapWithPerson, setSwapWithPerson] = useState<string>('');

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

  // Hedef grup değiştiğinde eğer o grupta tek personel varsa ve henüz isim girilmediyse otomatik öner
  useEffect(() => {
    if (
      targetDutyGroupInfo &&
      targetDutyGroupInfo.people.length === 1 &&
      !swapWithPerson.trim()
    ) {
      setSwapWithPerson(targetDutyGroupInfo.people[0]);
    }
  }, [targetDutyGroupInfo]);

  const dayNotes = (notes || []).filter(
    (it) => it.date === dateISO || it.swapTargetDate === dateISO
  );

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

  const handleSave = () => {
    const cleanWith = formatTitleCaseTR(swapWithPerson);
    const cleanMy = formatTitleCaseTR(swapMyPerson || defaultMyPerson);
    const effectiveSourceDate =
      noteType === 'Nöbet Değişimi' ? swapSourceDate || dateISO : dateISO;

    const partnerPart = cleanWith ? ` (${cleanWith} ile)` : '';
    const finalDesc =
      noteType === 'Nöbet Değişimi' && !noteDesc.trim()
        ? `${trDateFormatter(effectiveSourceDate)} nöbeti -> ${trDateFormatter(swapTargetDate)} (${
            swapShiftType === 'GUNDUZ' ? 'Gündüz' : 'Gece'
          })${partnerPart} değişti`
        : noteDesc.trim() || noteType;

    const newNote: NoteItem = {
      id: Date.now(),
      date: effectiveSourceDate,
      type: noteType,
      desc: finalDesc,
      isNewRef: false,
      swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
      swapShiftType: noteType === 'Nöbet Değişimi' ? swapShiftType : 'GUNDUZ',
      swapWithPerson: noteType === 'Nöbet Değişimi' ? cleanWith : undefined,
      swapMyPerson: noteType === 'Nöbet Değişimi' ? cleanMy : undefined,
    };

    onSaveNote(newNote);
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
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#111622] border-slate-800 text-white'
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
          {/* Existing Notes on this date */}
          {dayNotes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-slate-400">
                Bu Güne Ait Kayıtlar ve Becayişler
              </span>
              <div className="flex flex-col gap-1.5">
                {dayNotes.map((n) => (
                  <div
                    key={n.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                      isLight
                        ? 'bg-slate-50 border-slate-200/80 text-slate-800'
                        : 'bg-slate-900/70 border-slate-800 text-white'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-sky-500">{n.type}</span>
                        {n.swapWithPerson && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                            🔄 {n.swapMyPerson ? `${n.swapMyPerson} ⇄ ` : ''}
                            {n.swapWithPerson}
                          </span>
                        )}
                      </div>
                      <div className="text-xs truncate mt-0.5">{n.desc}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(n.id)}
                      className="p-1 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category Selector */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400">Kayıt Türü</span>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              {CATEGORIES.map((cat) => {
                const isSelected = noteType === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setNoteType(cat)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      isSelected
                        ? isLight
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-900'
                        : isLight
                        ? 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                        : 'bg-slate-800/70 text-slate-400 hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Swap Box if Nöbet Değişimi */}
          {noteType === 'Nöbet Değişimi' && (
            <div
              className={`p-3.5 rounded-xl border flex flex-col gap-3 ${
                isLight ? 'bg-slate-50 border-slate-200/80' : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              {/* 1. NÖBET DEĞİŞİMİ YAPILAN KİŞİ (KARŞI PERSONEL) */}
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

                {/* Karşı Gruptaki Personel Çipleri (Tek Dokunuşla Seçim) */}
                {targetDutyGroupInfo && targetDutyGroupInfo.people.length > 0 && (
                  <div className="flex flex-col gap-1 pt-0.5">
                    <span className="text-[10px] text-slate-400">
                      {targetDutyGroupInfo.groupName} personellerinden seçin (o gece listeden çıkacak kişi):
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

              {/* 2. KENDİ GRUBUMDAN DEĞİŞEN (ESKİ) PERSONEL */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-500/15">
                <label className="text-[11px] font-semibold text-slate-400">
                  Kendi Grubunuzdan Değişen Personel (Sizin İsminiz)
                </label>
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
              </div>

              {/* 3. DEVREDİLEN GÜN VE YERİNE TUTULACAK GÜN / VARDİYA */}
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
                  Yerine Tutulacak Vardiya
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapShiftType('GUNDUZ')}
                    className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      swapShiftType === 'GUNDUZ'
                        ? 'bg-amber-500 text-white'
                        : isLight
                        ? 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    ☀️ Gündüz
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapShiftType('AKSAM')}
                    className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      swapShiftType === 'AKSAM'
                        ? 'bg-indigo-600 text-white'
                        : isLight
                        ? 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    🌙 Gece
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Description Textarea */}
          <div>
            <textarea
              rows={2}
              placeholder="Ek not veya açıklama (isteğe bağlı)..."
              value={noteDesc}
              onChange={(e) => setNoteDesc(e.target.value)}
              className={`w-full p-3 rounded-xl text-xs border outline-none resize-none ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
                  : 'bg-slate-900/60 border-slate-800 text-white placeholder:text-slate-500'
              }`}
            />
          </div>

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
              onClick={handleSave}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                isLight
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-white hover:bg-slate-200 text-slate-900'
              }`}
            >
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
