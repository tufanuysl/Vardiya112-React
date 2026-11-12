import React, { useState, useMemo } from 'react';
import { AppSettings, NoteItem, RefRecord } from '../types';
import { querySingleDayForGroup, trDateFormatter, toISODate, addDays, createLocalDate } from '../shiftEngine';
import { Trash2, ArrowRight } from 'lucide-react';

interface QuickNoteModalProps {
  dateISO: string;
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
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
  onSaveNote,
  onDeleteNote,
  onGoToDetail,
  onDismiss,
}) => {
  const isLight = settings.theme === 'light';

  const [noteType, setNoteType] = useState('Nöbet Değişimi');
  const [noteDesc, setNoteDesc] = useState('');

  const dayInfo = querySingleDayForGroup(dateISO, null, settings, refHistory, notes);
  const cleanStatusText = dayInfo.statusText.replace(/^[^\wÇĞİÖŞÜçğıöşü24]+\s*/, '');

  const defaultTargetDate = toISODate(addDays(createLocalDate(dateISO), 1));
  const [swapTargetDate, setSwapTargetDate] = useState(defaultTargetDate);
  const [swapShiftType, setSwapShiftType] = useState<'GUNDUZ' | 'AKSAM'>(() =>
    dayInfo.nightShift ? 'AKSAM' : 'GUNDUZ'
  );

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
    const finalDesc =
      noteType === 'Nöbet Değişimi' && !noteDesc.trim()
        ? `${trDateFormatter(dateISO)} nöbeti -> ${trDateFormatter(swapTargetDate)} (${
            swapShiftType === 'GUNDUZ' ? 'Gündüz' : 'Akşam'
          }) ile değişti`
        : noteDesc.trim() || noteType;

    const newNote: NoteItem = {
      id: Date.now(),
      date: dateISO,
      type: noteType,
      desc: finalDesc,
      isNewRef: false,
      swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
      swapShiftType: noteType === 'Nöbet Değişimi' ? swapShiftType : 'GUNDUZ',
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
                <span>Gündüz: {dutyGroupsSummary.dayGroup}</span>
                <span aria-hidden="true">·</span>
                <span>Gece: {dutyGroupsSummary.nightGroup}</span>
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
        <div className="p-5 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
          {/* Existing Notes on this date */}
          {dayNotes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-slate-400">
                Kayıtlı Notlar ve Değişimler
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
                      <div className="text-[10px] font-bold text-sky-500">{n.type}</div>
                      <div className="text-xs truncate">{n.desc}</div>
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
            <span className="text-[11px] font-semibold text-slate-400">Tür</span>
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

          {/* Swap Target Box if Nöbet Değişimi */}
          {noteType === 'Nöbet Değişimi' && (
            <div
              className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                isLight ? 'bg-slate-50 border-slate-200/80' : 'bg-slate-900/60 border-slate-800'
              }`}
            >
              <span className="text-xs font-semibold text-slate-400">
                Yerine Tutulacak Gün ve Vardiya
              </span>
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
                  Gündüz
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
                  Gece
                </button>
              </div>
            </div>
          )}

          {/* Description Textarea */}
          <div>
            <textarea
              rows={2}
              placeholder="Not veya açıklama (isteğe bağlı)..."
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
