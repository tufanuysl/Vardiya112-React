import React, { useState } from 'react';
import { AppSettings, RefRecord } from '../types';
import { trDateFormatter, toISODate, createLocalDate, addDays } from '../shiftEngine';
import { Plus, Minus, X, Check } from 'lucide-react';

interface SetupReferenceModalProps {
  settings: AppSettings;
  baseRef: RefRecord;
  canClose: boolean;
  onSave: (ref: RefRecord) => void;
  onDismiss: () => void;
  onChangeGroupCount: (n: number) => void;
}

export const SetupReferenceModal: React.FC<SetupReferenceModalProps> = ({
  settings,
  baseRef,
  canClose,
  onSave,
  onDismiss,
  onChangeGroupCount,
}) => {
  const [gIdx, setGIdx] = useState(baseRef.myGroupIdx >= 0 ? baseRef.myGroupIdx : 0);
  const [rDate, setRDate] = useState(baseRef.refDate || toISODate(new Date()));
  const [rType, setRType] = useState<'GUNDUZ' | 'AKSAM'>(baseRef.refType || 'GUNDUZ');

  const isLight = settings.theme === 'light';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        className={`w-full max-w-md rounded-3xl border overflow-hidden shadow-2xl animate-fade-in transition-all ${
          isLight ? 'bg-white border-slate-200 text-slate-800' : 'bg-[#0F172A] border-slate-700 text-white'
        }`}
      >
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-red-600 to-rose-900 p-5 flex items-center justify-between text-white shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center font-black text-sm">
              112
            </div>
            <div>
              <h3 className="text-base font-black">Vardiya Kurulumu</h3>
              <p className="text-xs text-white/80">Döngün buradan hesaplanır</p>
            </div>
          </div>
          {canClose && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1.5 rounded-full hover:bg-white/20 text-white/80 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col gap-5">
          {/* 1. Group Count and My Group Selection */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                👥 GRUBUM
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={settings.numGroups <= 2}
                  onClick={() => {
                    const n = settings.numGroups - 1;
                    if (gIdx >= n) setGIdx(n - 1);
                    onChangeGroupCount(n);
                  }}
                  className={`w-7 h-7 rounded-full disabled:opacity-40 flex items-center justify-center font-bold transition cursor-pointer ${
                    isLight
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className={`text-xs font-bold ${isLight ? 'text-sky-700' : 'text-sky-400'}`}>
                  {settings.numGroups} grup
                </span>
                <button
                  type="button"
                  disabled={settings.numGroups >= 10}
                  onClick={() => onChangeGroupCount(settings.numGroups + 1)}
                  className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center font-bold transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Group Grid Selector */}
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: settings.numGroups }, (_, i) => {
                const isSelected = i === gIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setGIdx(i)}
                    className={`py-3 rounded-2xl text-base font-black transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white ring-2 ring-blue-400 shadow-lg scale-105'
                        : isLight
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                        : 'bg-[#1E293B] text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className={`text-xs font-bold ${isLight ? 'text-sky-700' : 'text-sky-400'}`}>
              {settings.groupNames[gIdx] || `${gIdx + 1}. Grup`}
            </div>
          </div>

          {/* 2. Known Duty Date */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                📅 BİLİNEN BİR NÖBET GÜNÜM
              </span>
              <span className={`text-[11px] font-semibold ${isLight ? 'text-sky-700' : 'text-sky-400'}`}>
                {trDateFormatter(rDate)}
              </span>
            </div>

            {/* Date Input with native picker and direct access */}
            <div
              className={`p-3 rounded-2xl border flex flex-col gap-2.5 transition-all ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#1E293B] border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={rDate}
                  onChange={(e) => {
                    if (e.target.value) setRDate(e.target.value);
                  }}
                  className={`flex-1 p-2.5 rounded-xl text-sm font-bold border outline-none cursor-pointer transition ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-blue-500'
                      : 'bg-[#0F172A] border-slate-700 text-white focus:ring-2 focus:ring-blue-500'
                  }`}
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const d = createLocalDate(rDate);
                      setRDate(toISODate(addDays(d, -1)));
                    } catch {
                      setRDate(toISODate(new Date()));
                    }
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold border transition cursor-pointer text-center ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  ◀ -1 Gün
                </button>
                <button
                  type="button"
                  onClick={() => setRDate(toISODate(new Date()))}
                  className="flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer text-center shadow-sm"
                >
                  Bugün
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const d = createLocalDate(rDate);
                      setRDate(toISODate(addDays(d, 1)));
                    } catch {
                      setRDate(toISODate(new Date()));
                    }
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold border transition cursor-pointer text-center ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  +1 Gün ▶
                </button>
              </div>
            </div>
          </div>

          {/* 3. Shift Type On That Day */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              🕐 O GÜNKÜ NÖBET TİPİM
            </span>
            <div
              className={`grid grid-cols-2 gap-2 p-1.5 rounded-2xl border ${
                isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#1E293B] border-slate-700'
              }`}
            >
              <button
                type="button"
                onClick={() => setRType('GUNDUZ')}
                className={`py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  rType === 'GUNDUZ'
                    ? 'bg-amber-500 text-white shadow'
                    : isLight
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>☀️</span>
                <span>Gündüz</span>
              </button>
              <button
                type="button"
                onClick={() => setRType('AKSAM')}
                className={`py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  rType === 'AKSAM'
                    ? 'bg-indigo-600 text-white shadow'
                    : isLight
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>🌙</span>
                <span>Akşam</span>
              </button>
            </div>
          </div>

          {/* 4. Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            {canClose && (
              <button
                type="button"
                onClick={onDismiss}
                className={`flex-1 py-3 rounded-2xl border font-bold text-xs transition cursor-pointer ${
                  isLight
                    ? 'border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                Vazgeç
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onSave({
                  validFrom: '1970-01-01',
                  myGroupIdx: gIdx,
                  refDate: rDate,
                  refType: rType,
                });
              }}
              className="flex-1 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-lg transition cursor-pointer"
            >
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
