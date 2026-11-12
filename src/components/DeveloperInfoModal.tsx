import React from 'react';
import { X } from 'lucide-react';
import { AppSettings } from '../types';

interface DeveloperInfoModalProps {
  settings?: AppSettings;
  onDismiss: () => void;
}

export const DeveloperInfoModal: React.FC<DeveloperInfoModalProps> = ({ settings, onDismiss }) => {
  const isLight = settings?.theme === 'light';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div
        className={`w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden animate-fade-in transition-all ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#0F172A] border-slate-700 text-white'
        }`}
      >
        {/* Header with Developer Profile */}
        <div
          className={`p-5 flex items-center justify-between border-b ${
            isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-purple-500 shadow-md bg-gradient-to-tr from-purple-600 to-blue-500 flex items-center justify-center shrink-0">
              <img
                src="/tufan_profil.jpeg"
                alt="Tufan UYSAL"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <div className="text-sm font-black tracking-wide">Tufan UYSAL</div>
              <div className="text-xs text-slate-400">
                Uygulama Geliştiricisi • Kütahya 112 AÇM
              </div>
            </div>
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

        {/* Changelog & Versions */}
        <div className="p-5 flex flex-col gap-3.5 max-h-[75vh] overflow-y-auto">
          <div className="text-sm font-black flex items-center gap-2">
            <span>🚀</span>
            <span>Uygulama Özellikleri & Sürüm Notları</span>
          </div>

          <div
            className={`flex flex-col gap-1.5 p-3.5 rounded-2xl border ${
              isLight
                ? 'bg-purple-50/70 border-purple-200 text-slate-700'
                : 'bg-[#1E293B]/70 border-slate-700/60 text-slate-300'
            }`}
          >
            <span className={`text-xs font-bold ${isLight ? 'text-purple-700' : 'text-purple-400'}`}>
              v2.5 Güncel Sürüm (Kasım 2026)
            </span>
            <ul className="text-xs space-y-1 list-disc list-inside leading-relaxed opacity-90">
              <li>
                <strong>Misafir (Tüm Gruplar) Görünümü:</strong> Aylık takvimde gün kutucuklarını
                ikiye bölerek Sabah (☀️) ve Gece (🌙) nöbetçisi grupları bir arada gösterme.
              </li>
              <li>
                <strong>Takvimde 5&apos;li Grup Kutucukları:</strong> Güne tıklayınca tüm grupların
                o günkü durumunu görme; güne <strong>basılı tutunca</strong> istisna/not/becayiş
                ekleme.
              </li>
              <li>
                <strong>Akıllı Becayiş Vurgusu:</strong> Nöbet değişilen günlerde değişim yapılan
                grubun personeli gibi sayılarak kırmızı grup çerçevesinin otomatik taşınması ve
                yalnızca gelinecek güne mavi nokta konulması.
              </li>
              <li>
                <strong>Ergonomik Tek El Tasarımı:</strong> Alt navigasyon barında Nöbet, Takvim,
                Tema ve Ayarlar erişimi; sabit boyutlu ferah takvim ve büyütülmüş 3D Dünya küresi.
              </li>
            </ul>
          </div>

          <div
            className={`flex flex-col gap-1 p-3.5 rounded-2xl border ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-600'
                : 'bg-[#1E293B]/40 border-slate-800 text-slate-400'
            }`}
          >
            <span className={`text-xs font-bold ${isLight ? 'text-sky-700' : 'text-sky-400'}`}>
              v2.0 Çekirdek Vardiya Motoru
            </span>
            <p className="text-xs leading-relaxed">
              112 5 grup özel döngüsü, çoklu vardiya şablonları (12/24-48, 24/48, 24/72), Türkçe
              sesli personel ekleme, .ics takvim dışa aktarımı, görsel paylaşım ve JSON yedekleme.
            </p>
          </div>

          {/* Developer Dedication Quote */}
          <div
            className={`p-3.5 rounded-2xl border text-center ${
              isLight
                ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                : 'bg-[#1E1B4B]/80 border-indigo-500/30 text-indigo-300'
            }`}
          >
            <p className="text-xs font-medium italic">
              "Mesai arkadaşlarıma vardiya takibinde kolaylık sağlaması dileğiyle..."
            </p>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-lg transition mt-2 cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
