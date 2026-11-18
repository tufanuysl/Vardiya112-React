import React, { useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Users,
  Clock,
  Sparkles,
  X,
  Check,
} from 'lucide-react';
import { AppSettings, NoteItem, RefRecord, ShiftPresetId } from '../types';
import { trDateFormatter } from '../shiftEngine';
import { findMatchingGroupByName, formatTitleCaseTR } from '../storage';

export interface AnalyzedShiftData {
  documentSummary: string;
  confidenceNote: string;
  detectedSystem: {
    numGroups: number;
    is24HourSystem: boolean;
    dayStart: string;
    dayEnd: string;
    nightStart: string;
    nightEnd: string;
    restHours: number;
    shiftTransition: 'ALTERNATE' | 'SAME' | string;
    shiftPreset: string;
  };
  detectedGroups: Array<{
    groupIndex: number;
    groupName: string;
    members: string[];
  }>;
  referenceCandidates: Array<{
    date: string;
    groupIndex: number;
    groupName: string;
    shiftType: 'GUNDUZ' | 'AKSAM' | string;
    label: string;
  }>;
  suggestedReference: {
    groupIndex: number;
    refDate: string;
    refType: 'GUNDUZ' | 'AKSAM' | string;
    explanation: string;
  };
}

interface ShiftScheduleImporterProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  activeProfileName?: string;
  isLight: boolean;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onSaveNotes: (newNotes: NoteItem[], newRefs: RefRecord[]) => void;
  onSyncLocalRefState: (groupIdx: number, refDate: string, refType: 'GUNDUZ' | 'AKSAM') => void;
  onFeedback: (msg: string) => void;
}

async function prepareFileBase64(file: File): Promise<{ mimeType: string; base64Data: string }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const commaIdx = res.indexOf(',');
        resolve({
          mimeType: 'application/pdf',
          base64Data: commaIdx >= 0 ? res.slice(commaIdx + 1) : res,
        });
      };
      reader.onerror = () => reject(new Error('PDF dosyası okunamadı.'));
      reader.readAsDataURL(file);
    });
  }

  // Image optimization (downscale large camera photos to max 1800px so upload is fast and reliable)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const maxDim = 1800;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const commaIdx = dataUrl.indexOf(',');
          resolve({
            mimeType: file.type || 'image/jpeg',
            base64Data: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
          });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedUrl = canvas.toDataURL('image/jpeg', 0.86);
        const commaIdx = compressedUrl.indexOf(',');
        resolve({
          mimeType: 'image/jpeg',
          base64Data: commaIdx >= 0 ? compressedUrl.slice(commaIdx + 1) : compressedUrl,
        });
      };
      img.onerror = () => {
        const commaIdx = dataUrl.indexOf(',');
        resolve({
          mimeType: file.type || 'image/jpeg',
          base64Data: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
        });
      };
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Görsel dosyası okunamadı.'));
    reader.readAsDataURL(file);
  });
}

export const ShiftScheduleImporter: React.FC<ShiftScheduleImporterProps> = ({
  settings,
  refHistory,
  notes,
  activeProfileName = '',
  isLight,
  onUpdateSettings,
  onSaveNotes,
  onSyncLocalRefState,
  onFeedback,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzedShiftData | null>(null);

  // Editable confirmation state before integrating
  const [personNameFilter, setPersonNameFilter] = useState<string>(
    activeProfileName && activeProfileName !== 'Ana Profilim' ? activeProfileName : ''
  );
  const [approvedGroupIdx, setApprovedGroupIdx] = useState<number>(0);
  const [approvedRefDate, setApprovedRefDate] = useState<string>('');
  const [approvedShiftType, setApprovedShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');

  // Toggle options for what to integrate on approval
  const [applyReference, setApplyReference] = useState<boolean>(true);
  const [applySystemHours, setApplySystemHours] = useState<boolean>(false);
  const [applyGroupMembers, setApplyGroupMembers] = useState<boolean>(false);
  const [integrationCompleteMsg, setIntegrationCompleteMsg] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processSelectedFile(file);
  };

  const processSelectedFile = async (file: File) => {
    setErrorMsg(null);
    setIntegrationCompleteMsg(null);
    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    setIsAnalyzing(true);
    try {
      const { mimeType, base64Data } = await prepareFileBase64(file);
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const response = await fetch('/api/shift-schedule/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mimeType,
          base64Data,
          currentGroupNames: settings.groupNames,
          currentNumGroups: settings.numGroups,
          currentYearMonth,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Vardiya listesi okunamadı.');
      }

      const result = data as AnalyzedShiftData;
      setAnalysisResult(result);

      // Initialize approval fields from suggestedReference or matched profile name
      const maxG = Math.max(2, Math.min(10, result.detectedSystem?.numGroups || settings.numGroups));
      let sugIdx = Math.max(0, Math.min(maxG - 1, result.suggestedReference?.groupIndex ?? 0));
      let sugDate =
        result.suggestedReference?.refDate && /^\d{4}-\d{2}-\d{2}$/.test(result.suggestedReference.refDate)
          ? result.suggestedReference.refDate
          : new Date().toISOString().slice(0, 10);
      let sugType: 'GUNDUZ' | 'AKSAM' =
        result.suggestedReference?.refType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ';

      // Check if activeProfileName / personNameFilter matches any detected group in the PDF/photo
      const combinedMembers: string[] = Array.from({ length: maxG }, (_, i) => {
        const dg = result.detectedGroups?.find((g) => g.groupIndex === i);
        return dg && Array.isArray(dg.members) && dg.members.length > 0
          ? dg.members.join(', ')
          : settings.groupMembers[i] || '';
      });
      const combinedNames: string[] = Array.from({ length: maxG }, (_, i) => {
        const dg = result.detectedGroups?.find((g) => g.groupIndex === i);
        return dg?.groupName || settings.groupNames[i] || `${i + 1}. Grup`;
      });

      const nameToMatch = (personNameFilter || activeProfileName || '').trim();
      if (nameToMatch && nameToMatch !== 'Ana Profilim') {
        const matched = findMatchingGroupByName(nameToMatch, combinedMembers, combinedNames);
        if (matched) {
          sugIdx = matched.groupIdx;
          const cand = result.referenceCandidates?.find((c) => c.groupIndex === matched.groupIdx);
          if (cand && /^\d{4}-\d{2}-\d{2}$/.test(cand.date)) {
            sugDate = cand.date;
            sugType = cand.shiftType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ';
          }
        }
      }

      setApprovedGroupIdx(sugIdx);
      setApprovedRefDate(sugDate);
      setApprovedShiftType(sugType);
      setApplyReference(true);

      // Auto-check group members if members were detected
      const hasMembers =
        Array.isArray(result.detectedGroups) &&
        result.detectedGroups.some((g) => Array.isArray(g.members) && g.members.length > 0);
      setApplyGroupMembers(hasMembers);

      // Auto-check system hours if group count differs from current
      const sysDiffers =
        result.detectedSystem &&
        (result.detectedSystem.numGroups !== settings.numGroups ||
          result.detectedSystem.is24HourSystem !== settings.is24HourSystem);
      setApplySystemHours(Boolean(sysDiffers));
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Belge analiz edilirken bir sorun oluştu. Lütfen daha net bir fotoğraf veya PDF deneyin.'
      );
      setAnalysisResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectGroupInPreview = (gIdx: number) => {
    setApprovedGroupIdx(gIdx);
    if (!analysisResult?.referenceCandidates) return;
    // Automatically find a shift for this group in the extracted candidates so reference matches immediately
    const candidate = analysisResult.referenceCandidates.find((c) => c.groupIndex === gIdx);
    if (candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
      setApprovedRefDate(candidate.date);
      setApprovedShiftType(candidate.shiftType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ');
    }
  };

  const handleApproveIntegration = () => {
    if (!analysisResult) return;

    let nextSettings: AppSettings = { ...settings };

    if (applySystemHours && analysisResult.detectedSystem) {
      const sys = analysisResult.detectedSystem;
      const clampedGroups = Math.max(2, Math.min(10, sys.numGroups || settings.numGroups));
      const names = [...nextSettings.groupNames];
      while (names.length < clampedGroups) names.push(`${names.length + 1}. Grup`);
      const mems = [...nextSettings.groupMembers];
      while (mems.length < clampedGroups) mems.push('');

      const validPresetIds: ShiftPresetId[] = [
        '112_5G',
        '12_24_48_4G',
        '12_36_3G',
        '12_48_5G',
        'CUSTOM',
      ];
      const presetId: ShiftPresetId = validPresetIds.includes(sys.shiftPreset as ShiftPresetId)
        ? (sys.shiftPreset as ShiftPresetId)
        : 'CUSTOM';

      nextSettings = {
        ...nextSettings,
        numGroups: clampedGroups,
        is24HourSystem: Boolean(sys.is24HourSystem),
        dayStart: sys.dayStart || nextSettings.dayStart,
        dayEnd: sys.dayEnd || nextSettings.dayEnd,
        nightStart: sys.nightStart || nextSettings.nightStart,
        nightEnd: sys.nightEnd || nextSettings.nightEnd,
        restHours: sys.restHours >= 12 && sys.restHours <= 120 ? sys.restHours : nextSettings.restHours,
        dayRestHours: sys.restHours >= 12 && sys.restHours <= 120 ? sys.restHours : nextSettings.dayRestHours,
        nightRestHours:
          sys.restHours >= 12 && sys.restHours <= 120 ? sys.restHours : nextSettings.nightRestHours,
        shiftTransition: sys.shiftTransition === 'SAME' ? 'SAME' : 'ALTERNATE',
        shiftPreset: presetId,
        groupNames: names.slice(0, clampedGroups),
        groupMembers: mems.slice(0, clampedGroups),
      };
    }

    if (applyGroupMembers && Array.isArray(analysisResult.detectedGroups)) {
      const names = [...nextSettings.groupNames];
      const mems = [...nextSettings.groupMembers];
      analysisResult.detectedGroups.forEach((dg) => {
        if (dg.groupIndex >= 0 && dg.groupIndex < nextSettings.numGroups) {
          if (dg.groupName && dg.groupName.trim()) {
            names[dg.groupIndex] = dg.groupName.trim();
          }
          if (Array.isArray(dg.members) && dg.members.length > 0) {
            mems[dg.groupIndex] = dg.members
              .map((m) => formatTitleCaseTR(m))
              .filter(Boolean)
              .join(', ');
          }
        }
      });
      nextSettings = {
        ...nextSettings,
        groupNames: names,
        groupMembers: mems,
      };
    }

    if (applySystemHours || applyGroupMembers) {
      onUpdateSettings(nextSettings);
    }

    if (applyReference) {
      const safeGroupIdx = Math.max(0, Math.min(nextSettings.numGroups - 1, approvedGroupIdx));
      const newPrimary: RefRecord = {
        validFrom: '1970-01-01',
        myGroupIdx: safeGroupIdx,
        refDate: approvedRefDate,
        refType: approvedShiftType,
      };
      const updatedRefs = [...refHistory];
      if (updatedRefs.length > 0) {
        updatedRefs[0] = newPrimary;
      } else {
        updatedRefs.push(newPrimary);
      }
      onSaveNotes(notes, updatedRefs);
      onSyncLocalRefState(safeGroupIdx, approvedRefDate, approvedShiftType);
    }

    const groupLabel =
      nextSettings.groupNames[approvedGroupIdx] || `${approvedGroupIdx + 1}. Grup`;
    setIntegrationCompleteMsg(
      `${groupLabel} · ${trDateFormatter(approvedRefDate)} (${
        approvedShiftType === 'GUNDUZ' ? 'Gündüz' : 'Gece'
      }) nöbet referansı onaylanarak sisteme entegre edildi.`
    );
    onFeedback('Liste onaylandı ve entegre edildi ✓');
    setAnalysisResult(null);
  };

  const handleReset = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setErrorMsg(null);
  };

  const totalDetectedGroupCount = Math.max(
    settings.numGroups,
    analysisResult?.detectedSystem?.numGroups || settings.numGroups
  );

  const hasDetectedMembers =
    Array.isArray(analysisResult?.detectedGroups) &&
    analysisResult.detectedGroups.some((g) => Array.isArray(g.members) && g.members.length > 0);

  return (
    <section
      className={`p-3.5 rounded-2xl border flex flex-col gap-3 transition ${
        isLight
          ? 'bg-gradient-to-br from-emerald-50/70 via-white to-sky-50/60 border-emerald-200/80 shadow-xs'
          : 'bg-gradient-to-br from-emerald-950/25 via-slate-900/60 to-sky-950/20 border-emerald-500/25'
      }`}
    >
      {/* Başlık */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isLight
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold tracking-tight">
                PDF veya Fotoğraftan Vardiya Listesi Entegre Et
              </h3>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                  isLight
                    ? 'bg-emerald-500/15 text-emerald-700'
                    : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                Onaylı Sistem
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Nöbet çizelgesi PDF&apos;ini veya fotoğrafını yükleyin; sistem okuyup onayınıza sunsun
            </p>
          </div>
        </div>

        {(selectedFile || analysisResult) && !isAnalyzing && (
          <button
            type="button"
            onClick={handleReset}
            className={`p-1 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer`}
            title="Temizle"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Gizli Dosya Seçici */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,.pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Yükleme Butonu (Analiz Yokken) */}
      {!analysisResult && !isAnalyzing && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`w-full py-3 px-3.5 rounded-xl border border-dashed flex items-center justify-center gap-2.5 text-xs font-bold transition cursor-pointer ${
              isLight
                ? 'border-emerald-300 bg-white/80 hover:bg-emerald-50/70 text-emerald-700'
                : 'border-emerald-500/35 bg-slate-900/50 hover:bg-emerald-950/30 text-emerald-300'
            }`}
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>Nöbet Listesi Seç (PDF veya Fotoğraf)</span>
          </button>

          <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3 text-sky-400" /> PDF Çizelgesi
            </span>
            <span className="flex items-center gap-1">
              <ImageIcon className="w-3 h-3 text-amber-400" /> Ekran Görüntüsü / Kamera Fotoğrafı
            </span>
          </div>
        </div>
      )}

      {/* Başarılı Entegrasyon Bildirimi */}
      {integrationCompleteMsg && !analysisResult && (
        <div
          className={`p-3 rounded-xl border flex items-start gap-2.5 ${
            isLight
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="text-[11px] font-medium leading-snug">{integrationCompleteMsg}</div>
        </div>
      )}

      {/* Analiz Ediliyor Durumu */}
      {isAnalyzing && (
        <div
          className={`p-4 rounded-xl border flex flex-col items-center justify-center gap-2.5 text-center ${
            isLight
              ? 'bg-white/90 border-slate-200/80 text-slate-700'
              : 'bg-slate-900/70 border-slate-800 text-slate-200'
          }`}
        >
          <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
          <div>
            <div className="text-xs font-bold">
              Vardiya Listesi Okunuyor ve Analiz Ediliyor...
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {selectedFile?.name} içindeki gruplar, tarihler ve nöbet düzeni çıkarılıyor
            </div>
          </div>
        </div>
      )}

      {/* Hata Mesajı */}
      {errorMsg && (
        <div
          className={`p-3 rounded-xl border flex items-start gap-2 ${
            isLight
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
          <div className="flex-1 text-[11px] font-medium">{errorMsg}</div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] font-bold underline shrink-0 cursor-pointer"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {/* ONAYLI ÖNİZLEME VE ENTEGRASYON PANELİ */}
      {analysisResult && !isAnalyzing && (
        <div className="flex flex-col gap-3 pt-1 animate-fade-in">
          {/* Yüklenen Dosya ve Tespit Özeti */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-3 ${
              isLight
                ? 'bg-white border-slate-200/80'
                : 'bg-slate-900/80 border-slate-800'
            }`}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Yüklenen Çizelge"
                className="w-12 h-12 rounded-lg object-cover border border-slate-500/20 shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                  Belge Analizi Tamamlandı
                </span>
              </div>
              <p className="text-xs font-bold leading-snug mt-0.5">
                {analysisResult.documentSummary}
              </p>
              {analysisResult.confidenceNote && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {analysisResult.confidenceNote}
                </p>
              )}
            </div>
          </div>

          {/* ADIM 1: KENDİ GRUBUNUZU VEYA LİSTEDEN BİR NÖBET SATIRINI SEÇİN */}
          <div
            className={`p-3 rounded-xl border flex flex-col gap-2.5 ${
              isLight
                ? 'bg-white border-slate-200/80'
                : 'bg-slate-900/70 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                1. Referans Alınacak Grubunuz ve Nöbetiniz
              </span>
              <span className="text-[10px] text-slate-400">Onaylı Eşleştirme</span>
            </div>

            {/* İsme Göre Otomatik Grup Eşleştirme Kutusu */}
            <div>
              <label className="text-[10px] font-semibold text-slate-400 block mb-1">
                İsminizle Otomatik Grup Eşleştir (Örn: Tufan yazın, grubunuz otomatik bulunsun):
              </label>
              <input
                type="text"
                value={personNameFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setPersonNameFilter(val);
                  const combinedMembers: string[] = Array.from(
                    { length: totalDetectedGroupCount },
                    (_, i) => {
                      const dg = analysisResult.detectedGroups?.find((g) => g.groupIndex === i);
                      return dg && Array.isArray(dg.members) && dg.members.length > 0
                        ? dg.members.join(', ')
                        : settings.groupMembers[i] || '';
                    }
                  );
                  const combinedNames: string[] = Array.from(
                    { length: totalDetectedGroupCount },
                    (_, i) => {
                      const dg = analysisResult.detectedGroups?.find((g) => g.groupIndex === i);
                      return dg?.groupName || settings.groupNames[i] || `${i + 1}. Grup`;
                    }
                  );
                  const m = findMatchingGroupByName(val, combinedMembers, combinedNames);
                  if (m) {
                    handleSelectGroupInPreview(m.groupIdx);
                  }
                }}
                placeholder="İsminizi yazın (Örn: Tufan)..."
                className={`w-full p-2 rounded-xl text-xs font-bold border outline-none ${
                  isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-900'
                    : 'bg-slate-800 border-slate-700 text-white'
                }`}
              />
            </div>

            {/* Grup Seçimi (Grup seçildiğinde o grubun belgedeki nöbet tarihi otomatik gelir) */}
            <div>
              <span className="text-[10px] font-semibold text-slate-400 block mb-1">
                Grubunuzu Seçin (Seçtiğiniz grubun listedeki nöbeti otomatik eşleşir):
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: totalDetectedGroupCount }, (_, i) => {
                  const detectedGrp = analysisResult.detectedGroups?.find(
                    (g) => g.groupIndex === i
                  );
                  const grpName =
                    detectedGrp?.groupName || settings.groupNames[i] || `${i + 1}. Grup`;
                  const isSel = approvedGroupIdx === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectGroupInPreview(i)}
                      className={`py-2 px-1 rounded-xl text-[11px] font-bold transition cursor-pointer truncate ${
                        isSel
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {grpName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Belgeden Okunan Nöbet Satırları (Hızlı Seçim) */}
            {Array.isArray(analysisResult.referenceCandidates) &&
              analysisResult.referenceCandidates.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 block mb-1">
                    Belgeden Okunan Nöbet Kayıtları (Referans almak istediğiniz satıra dokunun):
                  </span>
                  <div className="max-h-36 overflow-y-auto flex flex-col gap-1 pr-0.5">
                    {analysisResult.referenceCandidates.map((cand, idx) => {
                      const candShift: 'GUNDUZ' | 'AKSAM' =
                        cand.shiftType === 'AKSAM' ? 'AKSAM' : 'GUNDUZ';
                      const isRowSelected =
                        approvedGroupIdx === cand.groupIndex &&
                        approvedRefDate === cand.date &&
                        approvedShiftType === candShift;
                      return (
                        <button
                          key={`${cand.date}-${cand.groupIndex}-${idx}`}
                          type="button"
                          onClick={() => {
                            setApprovedGroupIdx(
                              Math.max(0, Math.min(totalDetectedGroupCount - 1, cand.groupIndex))
                            );
                            if (/^\d{4}-\d{2}-\d{2}$/.test(cand.date)) {
                              setApprovedRefDate(cand.date);
                            }
                            setApprovedShiftType(candShift);
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between gap-2 text-[11px] transition cursor-pointer border ${
                            isRowSelected
                              ? isLight
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-900 font-bold'
                                : 'bg-emerald-950/50 border-emerald-500/60 text-emerald-200 font-bold'
                              : isLight
                              ? 'bg-slate-50 hover:bg-slate-100 border-slate-200/60 text-slate-700'
                              : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/50 text-slate-300'
                          }`}
                        >
                          <div className="truncate flex items-center gap-1.5">
                            <span className="font-bold">
                              {cand.groupName || `${cand.groupIndex + 1}. Grup`}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span>{trDateFormatter(cand.date)}</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                              candShift === 'GUNDUZ'
                                ? 'bg-amber-500/20 text-amber-500'
                                : 'bg-indigo-500/20 text-indigo-400'
                            }`}
                          >
                            {candShift === 'GUNDUZ' ? '☀️ Gündüz' : '🌙 Gece'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Seçilen Referans Tarihi ve Vardiya Manuel Kontrolü */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-[10px] font-semibold text-slate-400 block mb-1">
                  Onaylanacak Referans Tarihi
                </label>
                <input
                  type="date"
                  value={approvedRefDate}
                  onChange={(e) => setApprovedRefDate(e.target.value)}
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${
                    isLight
                      ? 'bg-slate-100 border-slate-200 text-slate-900'
                      : 'bg-slate-800 border-slate-700 text-white'
                  }`}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-400 block mb-1">
                  Onaylanacak Vardiya
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setApprovedShiftType('GUNDUZ')}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      approvedShiftType === 'GUNDUZ'
                        ? 'bg-amber-500 text-white'
                        : isLight
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    ☀️ Gündüz
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovedShiftType('AKSAM')}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      approvedShiftType === 'AKSAM'
                        ? 'bg-indigo-600 text-white'
                        : isLight
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    🌙 Gece
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ADIM 2: ENTEGRE EDİLECEK AYARLARI ONAYLAYIN */}
          <div
            className={`p-3 rounded-xl border flex flex-col gap-2 ${
              isLight
                ? 'bg-white border-slate-200/80'
                : 'bg-slate-900/70 border-slate-800'
            }`}
          >
            <span className="text-[11px] font-bold block">
              2. Sisteme Entegre Edilecek Bilgileri Onaylayın
            </span>

            {/* Onay Kutusu 1: Nöbet Referansı */}
            <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-slate-500/5 transition">
              <input
                type="checkbox"
                checked={applyReference}
                onChange={(e) => setApplyReference(e.target.checked)}
                className="mt-0.5 accent-emerald-500 w-4 h-4 rounded cursor-pointer"
              />
              <div className="text-xs leading-snug">
                <div className="font-bold">Nöbet Referansını Sisteme İşle</div>
                <div className="text-[10px] text-slate-400">
                  {settings.groupNames[approvedGroupIdx] || `${approvedGroupIdx + 1}. Grup`} için{' '}
                  {trDateFormatter(approvedRefDate)} ({approvedShiftType === 'GUNDUZ' ? 'Gündüz' : 'Gece'})
                  nöbeti ana referans olarak kaydedilir.
                </div>
              </div>
            </label>

            {/* Onay Kutusu 2: Vardiya Saatleri ve Grup Sayısı */}
            {analysisResult.detectedSystem && (
              <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-slate-500/5 transition">
                <input
                  type="checkbox"
                  checked={applySystemHours}
                  onChange={(e) => setApplySystemHours(e.target.checked)}
                  className="mt-0.5 accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                />
                <div className="text-xs leading-snug">
                  <div className="font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    Vardiya Saatlerini ve Grup Sayısını Güncelle
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {analysisResult.detectedSystem.numGroups} Grup · Gündüz{' '}
                    {analysisResult.detectedSystem.dayStart}-{analysisResult.detectedSystem.dayEnd} /
                    Gece {analysisResult.detectedSystem.nightStart}-
                    {analysisResult.detectedSystem.nightEnd} ·{' '}
                    {analysisResult.detectedSystem.restHours}s İzin
                  </div>
                </div>
              </label>
            )}

            {/* Onay Kutusu 3: Grup Üyeleri ve İsimleri */}
            {hasDetectedMembers && (
              <label className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-slate-500/5 transition">
                <input
                  type="checkbox"
                  checked={applyGroupMembers}
                  onChange={(e) => setApplyGroupMembers(e.target.checked)}
                  className="mt-0.5 accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                />
                <div className="text-xs leading-snug">
                  <div className="font-bold flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-purple-400" />
                    Tespit Edilen Grup İsimlerini ve Personelleri Aktar
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {analysisResult.detectedGroups
                      .filter((g) => g.members && g.members.length > 0)
                      .map((g) => `${g.groupName}: ${g.members.slice(0, 3).join(', ')}`)
                      .join(' | ')}
                  </div>
                </div>
              </label>
            )}
          </div>

          {/* ONAY VE İPTAL BUTONLARI */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleReset}
              className={`py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                isLight
                  ? 'bg-slate-200/80 hover:bg-slate-300/80 text-slate-700'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={!applyReference && !applySystemHours && !applyGroupMembers}
              onClick={handleApproveIntegration}
              className="col-span-2 py-2.5 px-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Onayla ve Sisteme Entegre Et</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
