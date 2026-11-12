import React, { useState } from 'react';
import { runBuiltInTests } from '../shiftEngine';
import { X, Play } from 'lucide-react';
import { AppSettings } from '../types';

interface BuiltInTestModalProps {
  settings?: AppSettings;
  onDismiss: () => void;
}

export const BuiltInTestModal: React.FC<BuiltInTestModalProps> = ({ settings, onDismiss }) => {
  const [results, setResults] = useState<string[]>(() => runBuiltInTests());
  const isLight = settings?.theme === 'light';

  const handleRerun = () => {
    setResults(runBuiltInTests());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[85vh] transition-all ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#0F172A] border-slate-700 text-white'
        }`}
      >
        {/* Header */}
        <div
          className={`p-5 flex items-center justify-between border-b ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🧪</span>
            <span className="text-sm md:text-base font-black">Doğrulama Testleri</span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className={`p-1.5 rounded-full transition ${
              isLight
                ? 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                : 'hover:bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          <button
            type="button"
            onClick={handleRerun}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Testleri Yeniden Çalıştır</span>
          </button>

          <div
            className={`p-4 rounded-2xl border flex flex-col gap-2 font-mono text-xs ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#090D16] border-slate-800'
            }`}
          >
            {results.map((line, idx) => {
              const isPass = line.startsWith('✅');
              return (
                <div
                  key={idx}
                  className={`p-2 rounded-lg border ${
                    isPass
                      ? isLight
                        ? 'bg-emerald-100/70 border-emerald-300 text-emerald-900 font-semibold'
                        : 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300'
                      : isLight
                      ? 'bg-rose-100/70 border-rose-300 text-rose-900 font-semibold'
                      : 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                  }`}
                >
                  {line}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-4 border-t flex justify-end ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/50'
          }`}
        >
          <button
            type="button"
            onClick={onDismiss}
            className={`px-5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              isLight
                ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
