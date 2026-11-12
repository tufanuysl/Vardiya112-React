import React, { useState, useRef, useEffect } from 'react';
import { AppSettings, NoteItem, NotificationSoundId, RefRecord, ShiftPresetOption } from '../types';
import { trDateFormatter, toISODate, runBuiltInTests } from '../shiftEngine';
import { SHIFT_PRESETS } from '../storage';
import { playNotificationChime } from './ToastNotification';
import {
  ChevronRight,
  ChevronLeft,
  Trash2,
  X,
  Plus,
  Minus,
  Mic,
  MicOff,
  Download,
  Upload,
  Copy,
} from 'lucide-react';

interface SettingsTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  defaultDate: string;
  onUpdateSettings: (s: AppSettings) => void;
  onSaveNotes: (notes: NoteItem[], refs: RefRecord[]) => void;
  onDeleteRef: (idx: number) => void;
  onResetAll: () => void;
  onLockSystem?: () => void;
  onOpenSetupModal: () => void;
  onOpenDevModal: () => void;
  onOpenTestModal: () => void;
  onTriggerTestToast?: () => void;
  onClose?: () => void;
}

type SettingsSubPage =
  | 'main'
  | 'reference'
  | 'shift-hours'
  | 'groups'
  | 'notes'
  | 'backup'
  | 'diagnostics'
  | 'about';

const NOTE_TYPES = [
  'Nöbet Değişimi',
  'Grup Değişikliği',
  'İcap Nöbeti',
  'Acil Durum',
  'Diğer',
];

const REST_PRESETS = [24, 48, 72, 96];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  refHistory,
  notes,
  defaultDate,
  onUpdateSettings,
  onSaveNotes,
  onDeleteRef,
  onResetAll,
  onTriggerTestToast,
  onClose,
}) => {
  const isLight = settings.theme === 'light';

  const [activePage, setActivePage] = useState<SettingsSubPage>('main');
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Reference Setup State
  const primaryRef = refHistory[0] || {
    validFrom: '1970-01-01',
    myGroupIdx: 0,
    refDate: defaultDate || toISODate(new Date()),
    refType: 'GUNDUZ' as const,
  };
  const [refGroupIdx, setRefGroupIdx] = useState<number>(
    primaryRef.myGroupIdx >= 0 ? primaryRef.myGroupIdx : 0
  );
  const [refDateVal, setRefDateVal] = useState<string>(
    primaryRef.refDate || defaultDate || toISODate(new Date())
  );
  const [refShiftType, setRefShiftType] = useState<'GUNDUZ' | 'AKSAM'>(
    primaryRef.refType || 'GUNDUZ'
  );

  // Shift Hours & Rest State
  const [restHoursInput, setRestHoursInput] = useState(String(settings.restHours));

  // Groups & Personnel State
  const [expandedGroupIdx, setExpandedGroupIdx] = useState<number | null>(
    primaryRef.myGroupIdx >= 0 ? primaryRef.myGroupIdx : 0
  );
  const [listeningGroupIdx, setListeningGroupIdx] = useState<number | null>(null);
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const [quickDictationText, setQuickDictationText] = useState<string>('');
  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<number | null>(null);
  const uncommittedInterimRef = useRef<string>('');
  const pauseCommitTimerRef = useRef<number | null>(null);
  const dictationTimerRef = useRef<number | null>(null);
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
  const onUpdateSettingsRef = useRef(onUpdateSettings);

  useEffect(() => {
    settingsRef.current = settings;
    onUpdateSettingsRef.current = onUpdateSettings;
  }, [settings, onUpdateSettings]);

  const clearVoiceTimers = () => {
    if (pauseCommitTimerRef.current !== null) {
      window.clearTimeout(pauseCommitTimerRef.current);
      pauseCommitTimerRef.current = null;
    }
    if (dictationTimerRef.current !== null) {
      window.clearTimeout(dictationTimerRef.current);
      dictationTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (activePage !== 'groups') {
      shouldKeepListeningRef.current = null;
      clearVoiceTimers();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setListeningGroupIdx(null);
      setInterimSpeech('');
    }
  }, [activePage]);

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = null;
      clearVoiceTimers();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Notes & Exceptions State
  const [notesTab, setNotesTab] = useState<'list' | 'add' | 'chain'>('list');
  const [noteDate, setNoteDate] = useState(defaultDate);
  const [noteType, setNoteType] = useState('Nöbet Değişimi');
  const [noteDesc, setNoteDesc] = useState('');
  const [isNewRef, setIsNewRef] = useState(false);
  const [newRefGroup, setNewRefGroup] = useState(
    primaryRef.myGroupIdx >= 0 ? primaryRef.myGroupIdx : 0
  );
  const [newRefShiftType, setNewRefShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');
  const [swapTargetDate, setSwapTargetDate] = useState(defaultDate);
  const [swapShiftType, setSwapShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');

  // Diagnostics State
  const [testResults, setTestResults] = useState<string[]>(() => runBuiltInTests());

  // Backup State
  const [importJsonText, setImportJsonText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showTemporaryFeedback = (msg: string) => {
    setStatusFeedback(msg);
    window.setTimeout(() => {
      setStatusFeedback((prev) => (prev === msg ? null : prev));
    }, 2200);
  };

  const toTurkishTitleCase = (word: string): string => {
    if (!word) return '';
    return (
      word.charAt(0).toLocaleUpperCase('tr-TR') +
      word.slice(1).toLocaleLowerCase('tr-TR')
    );
  };

  const parseSpokenNamesToPeople = (transcript: string): string[] => {
    const cleaned = transcript
      .replace(/[.!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return [];

    // Improved splitting: split by words related to separating names, but keep names intact
    const rawSegments = cleaned
      .split(/\s*(?:,|;|\bvirgül\b|\bnoktalı virgül\b|\bve\b|\bile\b)\s*/gi)
      .map((s) => s.trim())
      .filter(Boolean);

    const people: string[] = [];

    for (const seg of rawSegments) {
      const words = seg
        .split(/\s+/)
        .map((w) => toTurkishTitleCase(w.trim()))
        .filter(Boolean);

      if (words.length === 0) continue;

      // Group words into 2-3 word segments for names
      if (words.length <= 3) {
        people.push(words.join(' '));
      } else {
        let idx = 0;
        while (idx < words.length) {
          if (words.length - idx === 3) {
            people.push(words.slice(idx, idx + 3).join(' '));
            idx += 3;
          } else if (words.length - idx >= 2) {
            people.push(words.slice(idx, idx + 2).join(' '));
            idx += 2;
          } else {
            people.push(words[idx]);
            idx += 1;
          }
        }
      }
    }

    // Ensure they are separated by commas when finally joined
    return people.map(p => p.trim());
  };

  const appendPeopleToGroup = (groupIdx: number, newPeople: string[]) => {
    if (newPeople.length === 0) return;
    const currentSettings = settingsRef.current;
    const updatedMembers = [...currentSettings.groupMembers];
    while (updatedMembers.length <= groupIdx) {
      updatedMembers.push('');
    }

    const existingList = (updatedMembers[groupIdx] || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const combined = [...existingList, ...newPeople];
    updatedMembers[groupIdx] = combined.join(', ');

    onUpdateSettingsRef.current({
      ...currentSettings,
      groupMembers: updatedMembers,
    });
  };

  const flushUncommittedInterim = (groupIdx: number) => {
    const pending = uncommittedInterimRef.current.trim();
    if (!pending) return;
    uncommittedInterimRef.current = '';
    setInterimSpeech('');
    const parsed = parseSpokenNamesToPeople(pending);
    if (parsed.length > 0) {
      appendPeopleToGroup(groupIdx, parsed);
      showTemporaryFeedback(`+ ${parsed.join(', ')}`);
    }
  };

  const startRecognitionInstance = (groupIdx: number) => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setVoiceErrorMsg(
        'Tarayıcı doğrudan ses tanımayı desteklemiyor. Aşağıdaki kutuya dokunup klavye mikrofonuyla söyleyebilirsiniz.'
      );
      setListeningGroupIdx(null);
      shouldKeepListeningRef.current = null;
      window.setTimeout(() => quickInputRef.current?.focus(), 80);
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = 'tr-TR';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListeningGroupIdx(groupIdx);
        setVoiceErrorMsg(null);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        const newlyFinalizedPeople: string[] = [];

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || '';
          if (result.isFinal) {
            const parsed = parseSpokenNamesToPeople(text);
            newlyFinalizedPeople.push(...parsed);
          } else {
            interimTranscript += text;
          }
        }

        if (newlyFinalizedPeople.length > 0) {
          if (pauseCommitTimerRef.current !== null) {
            window.clearTimeout(pauseCommitTimerRef.current);
            pauseCommitTimerRef.current = null;
          }
          uncommittedInterimRef.current = '';
          setInterimSpeech('');
          appendPeopleToGroup(groupIdx, newlyFinalizedPeople);
          showTemporaryFeedback(`+ ${newlyFinalizedPeople.join(', ')}`);
        } else {
          const cleanInterim = interimTranscript.trim();
          uncommittedInterimRef.current = cleanInterim;
          setInterimSpeech(cleanInterim);

          if (pauseCommitTimerRef.current !== null) {
            window.clearTimeout(pauseCommitTimerRef.current);
          }
          if (cleanInterim) {
            pauseCommitTimerRef.current = window.setTimeout(() => {
              flushUncommittedInterim(groupIdx);
              if (recognitionRef.current && shouldKeepListeningRef.current === groupIdx) {
                try {
                  recognitionRef.current.stop();
                } catch {
                  // ignore
                }
              }
            }, 1300);
          }
        }
      };

      recognition.onerror = (event: any) => {
        const err = event?.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          shouldKeepListeningRef.current = null;
          setListeningGroupIdx(null);
          setInterimSpeech('');
          setVoiceErrorMsg(
            'Mikrofon izni engellendi. Aşağıdaki hızlı ekleme kutusunda klavye mikrofonunu kullanabilirsiniz.'
          );
          window.setTimeout(() => quickInputRef.current?.focus(), 80);
        } else if (err === 'audio-capture') {
          shouldKeepListeningRef.current = null;
          setListeningGroupIdx(null);
          setInterimSpeech('');
          setVoiceErrorMsg('Mikrofon cihazı bulunamadı.');
        }
      };

      recognition.onend = () => {
        flushUncommittedInterim(groupIdx);
        if (shouldKeepListeningRef.current === groupIdx) {
          window.setTimeout(() => {
            if (shouldKeepListeningRef.current === groupIdx) {
              startRecognitionInstance(groupIdx);
            }
          }, 120);
        } else {
          setListeningGroupIdx((prev) => (prev === groupIdx ? null : prev));
          setInterimSpeech('');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      shouldKeepListeningRef.current = null;
      setListeningGroupIdx(null);
      setVoiceErrorMsg(
        'Sesli giriş başlatılamadı. Aşağıdaki kutuda klavye mikrofonunu kullanabilirsiniz.'
      );
      window.setTimeout(() => quickInputRef.current?.focus(), 80);
    }
  };

  const handleToggleVoiceInput = async (groupIdx: number) => {
    setVoiceErrorMsg(null);

    if (listeningGroupIdx === groupIdx || shouldKeepListeningRef.current === groupIdx) {
      shouldKeepListeningRef.current = null;
      clearVoiceTimers();
      flushUncommittedInterim(groupIdx);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setListeningGroupIdx(null);
      setInterimSpeech('');
      showTemporaryFeedback('Sesle ekleme tamamlandı');
      return;
    }

    shouldKeepListeningRef.current = null;
    clearVoiceTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        setVoiceErrorMsg(
          'Mikrofon izni verilmedi. Aşağıdaki kutuda klavye mikrofonunu kullanabilirsiniz.'
        );
        window.setTimeout(() => quickInputRef.current?.focus(), 80);
        return;
      }
    }

    shouldKeepListeningRef.current = groupIdx;
    setListeningGroupIdx(groupIdx);
    setInterimSpeech('');
    showTemporaryFeedback('Dinleniyor...');
    startRecognitionInstance(groupIdx);
  };

  const handleCommitQuickDictation = (groupIdx: number, rawValue?: string) => {
    if (dictationTimerRef.current !== null) {
      window.clearTimeout(dictationTimerRef.current);
      dictationTimerRef.current = null;
    }
    const textToParse = (rawValue !== undefined ? rawValue : quickDictationText).trim();
    if (!textToParse) return;
    const parsed = parseSpokenNamesToPeople(textToParse);
    if (parsed.length > 0) {
      appendPeopleToGroup(groupIdx, parsed);
      showTemporaryFeedback(`+ ${parsed.join(', ')}`);
    }
    setQuickDictationText('');
  };

  const handleUpdateGroupCount = (newCount: number) => {
    const clamped = Math.max(2, Math.min(10, newCount));
    const names = [...settings.groupNames];
    while (names.length < clamped) names.push(`${names.length + 1}. Grup`);
    const mems = [...settings.groupMembers];
    while (mems.length < clamped) mems.push('');
    onUpdateSettings({
      ...settings,
      numGroups: clamped,
      groupNames: names.slice(0, clamped),
      groupMembers: mems.slice(0, clamped),
    });
    if (refGroupIdx >= clamped) {
      setRefGroupIdx(clamped - 1);
    }
    showTemporaryFeedback(`${clamped} grup`);
  };

  const handleSavePrimaryRef = () => {
    const updatedRefs = [...refHistory];
    const newPrimary: RefRecord = {
      validFrom: '1970-01-01',
      myGroupIdx: refGroupIdx,
      refDate: refDateVal,
      refType: refShiftType,
    };
    if (updatedRefs.length > 0) {
      updatedRefs[0] = newPrimary;
    } else {
      updatedRefs.push(newPrimary);
    }
    onSaveNotes(notes, updatedRefs);
    showTemporaryFeedback('Referans kaydedildi');
    setActivePage('main');
  };

  const handleSaveNote = () => {
    const finalDesc =
      noteType === 'Nöbet Değişimi' && !noteDesc.trim()
        ? `${trDateFormatter(noteDate)} nöbeti → ${trDateFormatter(swapTargetDate)} (${
            swapShiftType === 'GUNDUZ' ? 'Gündüz' : 'Akşam'
          }) ile değiştirildi.`
        : noteDesc.trim() || noteType;

    const newNote: NoteItem = {
      id: Date.now(),
      date: noteDate,
      type: noteType,
      desc: finalDesc,
      isNewRef,
      swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
      swapShiftType: noteType === 'Nöbet Değişimi' ? swapShiftType : 'GUNDUZ',
    };

    const updatedNotes = [...notes, newNote];
    const updatedRefs = [...refHistory];

    if (isNewRef) {
      const existingIdx = updatedRefs.findIndex((r) => r.validFrom === noteDate);
      const newRec: RefRecord = {
        validFrom: noteDate,
        myGroupIdx: newRefGroup,
        refDate: noteDate,
        refType: newRefShiftType,
      };
      if (existingIdx > -1) {
        updatedRefs[existingIdx] = newRec;
      } else {
        updatedRefs.push(newRec);
      }
      updatedRefs.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    }

    onSaveNotes(updatedNotes, updatedRefs);
    setNoteDesc('');
    setIsNewRef(false);
    setNotesTab('list');
    showTemporaryFeedback('Kayıt eklendi');
  };

  const activeGroupIdx = refHistory.length > 0 ? refHistory[refHistory.length - 1].myGroupIdx : 0;
  const activeGroupName =
    refHistory.length > 0
      ? settings.groupNames[activeGroupIdx] || `${activeGroupIdx + 1}. Grup`
      : 'Tanımlanmadı';

  const buildBackupPayload = () => {
    return JSON.stringify(
      {
        version: '2.1',
        exportedAt: new Date().toISOString(),
        settings,
        refHistory,
        notes,
      },
      null,
      2
    );
  };

  const handleDownloadBackup = () => {
    const dataStr = buildBackupPayload();
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vardiya112_yedek_${toISODate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showTemporaryFeedback('Yedek indirildi');
  };

  const handleCopyBackup = async () => {
    try {
      await navigator.clipboard.writeText(buildBackupPayload());
      showTemporaryFeedback('Panoya kopyalandı');
    } catch {
      showTemporaryFeedback('Kopyalanamadı');
    }
  };

  const applyBackupPayload = (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) {
        showTemporaryFeedback('Geçersiz format');
        return;
      }
      const nextSettings: AppSettings = {
        ...settings,
        ...parsed.settings,
        groupNames: Array.isArray(parsed.settings.groupNames)
          ? parsed.settings.groupNames
          : settings.groupNames,
        groupMembers: Array.isArray(parsed.settings.groupMembers)
          ? parsed.settings.groupMembers
          : settings.groupMembers,
      };
      const nextRefs: RefRecord[] = Array.isArray(parsed.refHistory)
        ? parsed.refHistory
        : refHistory;
      const nextNotes: NoteItem[] = Array.isArray(parsed.notes) ? parsed.notes : notes;

      onUpdateSettings(nextSettings);
      onSaveNotes(nextNotes, nextRefs);
      setImportJsonText('');
      showTemporaryFeedback('Yedek yüklendi');
      setActivePage('main');
    } catch {
      showTemporaryFeedback('Yedek okunamadı');
    }
  };

  const pageTitles: Record<SettingsSubPage, string> = {
    main: 'Ayarlar',
    reference: 'Nöbet Referansı',
    'shift-hours': 'Vardiya Çeşitleri ve Saatler',
    groups: 'Gruplar ve Personel',
    notes: 'Becayiş ve Notlar',
    backup: 'Yedekleme',
    diagnostics: 'Sistem Doğrulama',
    about: 'Hakkında',
  };

  const handleApplyPreset = (preset: ShiftPresetOption) => {
    const clamped = preset.numGroups;
    const names = [...settings.groupNames];
    while (names.length < clamped) names.push(`${names.length + 1}. Grup`);
    const mems = [...settings.groupMembers];
    while (mems.length < clamped) mems.push('');

    setRestHoursInput(String(preset.restHours));
    onUpdateSettings({
      ...settings,
      shiftPreset: preset.id,
      is24HourSystem: preset.is24HourSystem,
      dayStart: preset.dayStart,
      dayEnd: preset.dayEnd,
      nightStart: preset.nightStart,
      nightEnd: preset.nightEnd,
      shift24Start: preset.shift24Start,
      restHours: preset.restHours,
      dayRestHours: preset.dayRestHours,
      nightRestHours: preset.nightRestHours,
      numGroups: clamped,
      shiftTransition: preset.shiftTransition,
      groupNames: names.slice(0, clamped),
      groupMembers: mems.slice(0, clamped),
    });
    showTemporaryFeedback(preset.shortBadge);
  };

  const groupCardClass = 'bg-transparent';
  const dividerClass = 'divide-y divide-slate-500/10';
  const rowHoverClass = isLight
    ? 'hover:bg-slate-100/60 active:bg-slate-200/50'
    : 'hover:bg-slate-800/40 active:bg-slate-800/60';
  const subSurfaceClass = isLight
    ? 'bg-slate-100 text-slate-800'
    : 'bg-slate-900/50 text-slate-100';
  const inputClass = isLight
    ? 'bg-slate-100 border-transparent text-slate-900 focus:border-slate-300'
    : 'bg-slate-900/70 border-transparent text-white focus:border-slate-600';

  const primaryBtnClass = isLight
    ? 'bg-slate-900 hover:bg-slate-800 text-white'
    : 'bg-white hover:bg-slate-200 text-slate-900';

  const secondaryBtnClass = isLight
    ? 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
    : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300';

  const sectionLabelClass = 'text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 mt-4';
  const listDivideClass = isLight ? 'divide-y divide-slate-200/50' : 'divide-y divide-slate-800/50';

  return (
    <div className="flex flex-col w-full max-w-lg mx-auto select-none">
      {/* MINIMAL HEADER */}
      <div
        className={`sticky top-0 z-20 flex items-center justify-between py-2.5 mb-3 border-b ${
          isLight
            ? 'bg-[#F8FAFC]/95 border-slate-200/70 text-slate-900'
            : 'bg-[#0F172A]/95 border-slate-800/80 text-white'
        }`}
      >
        <div className="flex items-center gap-1 min-w-0">
          {activePage !== 'main' && (
            <button
              type="button"
              onClick={() => setActivePage('main')}
              className="flex items-center gap-0.5 pr-2 py-1 -ml-1 rounded-lg text-xs font-semibold text-sky-500 hover:opacity-80 transition cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Geri</span>
            </button>
          )}
          <h2 className="text-base font-bold tracking-tight truncate">
            {pageTitles[activePage]}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {statusFeedback && (
            <span className="text-xs font-medium text-emerald-500 animate-fade-in">
              {statusFeedback}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/60'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          MAIN SETTINGS LIST (Minimalist Unboxed Rows)
         ===================================================================== */}
      {activePage === 'main' && (
        <div className="flex flex-col gap-6 pb-4">
          {/* 1. VARDİYA DÜZENİ */}
          <section>
            <div className={sectionLabelClass}>Vardiya Düzeni</div>
            <div className={listDivideClass}>
              <button
                type="button"
                onClick={() => setActivePage('reference')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Nöbet Referansı</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-sky-500 transition">
                  <span>
                    {activeGroupName}
                    {refHistory.length > 0 ? ` · ${trDateFormatter(primaryRef.refDate)}` : ''}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActivePage('shift-hours')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Vardiya Çeşitleri ve Saatler</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-sky-500 transition">
                  <span>
                    {SHIFT_PRESETS.find((p) => p.id === settings.shiftPreset)?.shortBadge ||
                      `${settings.dayStart}/${settings.nightStart}`}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActivePage('groups')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Gruplar ve Personel</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-sky-500 transition">
                  <span>{settings.numGroups} Grup</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActivePage('notes')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Becayiş ve Notlar</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-sky-500 transition">
                  <span>{notes.length > 0 ? `${notes.length} Kayıt` : 'Ekle'}</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            </div>
          </section>

          {/* 2. TERCİHLER */}
          <section>
            <div className={sectionLabelClass}>Tercihler</div>
            <div className={listDivideClass}>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-xs font-medium">Görünüm</span>
                <div
                  className={`flex items-center p-0.5 rounded-lg border ${
                    isLight
                      ? 'bg-slate-100 border-slate-200/80'
                      : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: 'dark' })}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      settings.theme === 'dark'
                        ? 'bg-slate-800 text-white shadow-2xs'
                        : 'text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    Koyu
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: 'light' })}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      settings.theme === 'light'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Açık
                  </button>
                </div>
              </div>

              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-xs font-medium">Nöbet Hatırlatıcı</span>
                <div className="flex items-center gap-1">
                  {[
                    { label: 'Kapalı', val: 0 },
                    { label: '15dk', val: 15 },
                    { label: '30dk', val: 30 },
                    { label: '60dk', val: 60 },
                  ].map((opt) => {
                    const currentLead = settings.reminderMinutesBefore ?? 30;
                    const isSelected = currentLead === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            reminderMinutesBefore: opt.val,
                          });
                          showTemporaryFeedback(
                            opt.val === 0 ? 'Kapatıldı' : `${opt.val} dk önce`
                          );
                        }}
                        className={`px-2 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? isLight
                              ? 'bg-slate-900 text-white'
                              : 'bg-white text-slate-900'
                            : isLight
                            ? 'text-slate-500 hover:bg-slate-100'
                            : 'text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="py-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">Nöbet Başlangıç Bildirim Sesi</span>
                  {onTriggerTestToast && (
                    <button
                      type="button"
                      onClick={() => {
                        onTriggerTestToast();
                        showTemporaryFeedback('Test bildirimi gönderildi');
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${secondaryBtnClass}`}
                    >
                      Bildirimi Test Et
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {(
                    [
                      { id: 'silent', label: 'Sessiz', icon: '🔇' },
                      { id: 'chime', label: 'Klasik', icon: '🔔' },
                      { id: 'telsiz', label: 'Telsiz', icon: '📻' },
                      { id: 'radar', label: 'Uyarı', icon: '🚨' },
                      { id: 'soft', label: 'Melodi', icon: '🎵' },
                    ] as { id: NotificationSoundId; label: string; icon: string }[]
                  ).map((opt) => {
                    const currentSound = settings.notificationSound || 'chime';
                    const isSelected = currentSound === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            notificationSound: opt.id,
                          });
                          if (opt.id !== 'silent') {
                            playNotificationChime(opt.id);
                            showTemporaryFeedback(`${opt.label} sesi seçildi`);
                          } else {
                            showTemporaryFeedback('Sessiz mod aktif');
                          }
                        }}
                        className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition cursor-pointer ${
                          isSelected
                            ? opt.id === 'silent'
                              ? 'bg-rose-600 text-white shadow-xs'
                              : primaryBtnClass
                            : secondaryBtnClass
                        }`}
                      >
                        <span className="text-sm leading-none">{opt.icon}</span>
                        <span className="leading-none truncate max-w-full">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* 3. VERİ VE SİSTEM */}
          <section>
            <div className={sectionLabelClass}>Veri ve Sistem</div>
            <div className={listDivideClass}>
              <button
                type="button"
                onClick={() => setActivePage('backup')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Yedekleme ve Paylaşım</span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setTestResults(runBuiltInTests());
                  setActivePage('diagnostics');
                }}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Sistem Doğrulama</span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition" />
              </button>

              <button
                type="button"
                onClick={() => setActivePage('about')}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
              >
                <span className="text-xs font-medium">Hakkında</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-sky-500 transition">
                  <span>v2.5</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer"
              >
                <span className="text-xs font-medium text-rose-500">
                  Tüm Verileri Sıfırla
                </span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 1: NÖBET REFERANSI
         ===================================================================== */}
      {activePage === 'reference' && (
        <div className="flex flex-col gap-5 pb-4 animate-fade-in">
          {/* Group Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400">Grubunuz</span>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  disabled={settings.numGroups <= 2}
                  onClick={() => handleUpdateGroupCount(settings.numGroups - 1)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center disabled:opacity-30 cursor-pointer ${secondaryBtnClass}`}
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-xs font-semibold px-1">{settings.numGroups} Grup</span>
                <button
                  type="button"
                  disabled={settings.numGroups >= 10}
                  onClick={() => handleUpdateGroupCount(settings.numGroups + 1)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center disabled:opacity-30 cursor-pointer ${secondaryBtnClass}`}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: settings.numGroups }, (_, i) => {
                const isSelected = refGroupIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setRefGroupIdx(i)}
                    className={`py-2.5 px-1 rounded-xl text-xs font-semibold transition cursor-pointer truncate ${
                      isSelected ? primaryBtnClass : secondaryBtnClass
                    }`}
                  >
                    {settings.groupNames[i] || `${i + 1}. Grup`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference Date */}
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1.5">
              Bilinen Nöbet Tarihi
            </label>
            <input
              type="date"
              value={refDateVal}
              onChange={(e) => setRefDateVal(e.target.value)}
              className={`w-full p-2.5 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
            />
          </div>

          {/* Shift Type */}
          <div>
            <label className="text-xs font-semibold text-slate-400 block mb-1.5">
              O Günkü Vardiya
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRefShiftType('GUNDUZ')}
                className={`py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  refShiftType === 'GUNDUZ' ? 'bg-amber-500 text-white' : secondaryBtnClass
                }`}
              >
                Gündüz
              </button>
              <button
                type="button"
                onClick={() => setRefShiftType('AKSAM')}
                className={`py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  refShiftType === 'AKSAM' ? 'bg-indigo-600 text-white' : secondaryBtnClass
                }`}
              >
                Gece
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSavePrimaryRef}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition cursor-pointer mt-1 ${primaryBtnClass}`}
          >
            Kaydet
          </button>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 2: VARDİYA ÇEŞİTLERİ VE SAATLER
         ===================================================================== */}
      {activePage === 'shift-hours' && (
        <div className="flex flex-col gap-5 pb-4 animate-fade-in">
          {/* Ready Shift Presets */}
          <div>
            <span className="text-xs font-semibold text-slate-400 block mb-2">
              Hazır Vardiya Çeşitleri
            </span>
            <div className={listDivideClass}>
              {SHIFT_PRESETS.map((preset) => {
                const isSelected = (settings.shiftPreset || '112_5G') === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="w-full py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold ${
                            isSelected ? 'text-sky-500' : ''
                          }`}
                        >
                          {preset.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {preset.desc}
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold shrink-0 transition ${
                        isSelected ? primaryBtnClass : secondaryBtnClass
                      }`}
                    >
                      {isSelected ? 'Seçili' : 'Uygula'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vardiya Geçiş Düzeni */}
          <div>
            <span className="text-xs font-semibold text-slate-400 block mb-1.5">
              Vardiya Geçiş Düzeni
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    shiftPreset: 'CUSTOM',
                    shiftTransition: 'ALTERNATE',
                  })
                }
                className={`py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  settings.shiftTransition === 'ALTERNATE' ? primaryBtnClass : secondaryBtnClass
                }`}
              >
                Dönüşümlü (Gündüz ↔ Gece)
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    shiftPreset: 'CUSTOM',
                    shiftTransition: 'SAME',
                  })
                }
                className={`py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  settings.shiftTransition === 'SAME' ? primaryBtnClass : secondaryBtnClass
                }`}
              >
                Sabit (Hep Aynı Vardiya)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-amber-500">Gündüz Vardiyası</span>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Başlangıç</label>
                <input
                  type="time"
                  value={settings.dayStart}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      shiftPreset: 'CUSTOM',
                      dayStart: e.target.value,
                    })
                  }
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Bitiş</label>
                <input
                  type="time"
                  value={settings.dayEnd}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      shiftPreset: 'CUSTOM',
                      dayEnd: e.target.value,
                    })
                  }
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">
                  Gündüz Sonrası İzin (Saat)
                </label>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={settings.dayRestHours ?? settings.restHours}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 12 && val <= 120) {
                      onUpdateSettings({
                        ...settings,
                        shiftPreset: 'CUSTOM',
                        dayRestHours: val,
                      });
                    }
                  }}
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-indigo-400">Gece Vardiyası</span>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Başlangıç</label>
                <input
                  type="time"
                  value={settings.nightStart}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      shiftPreset: 'CUSTOM',
                      nightStart: e.target.value,
                    })
                  }
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Bitiş</label>
                <input
                  type="time"
                  value={settings.nightEnd}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      shiftPreset: 'CUSTOM',
                      nightEnd: e.target.value,
                    })
                  }
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">
                  Gece Sonrası İzin (Saat)
                </label>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={settings.nightRestHours ?? settings.restHours}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 12 && val <= 120) {
                      onUpdateSettings({
                        ...settings,
                        shiftPreset: 'CUSTOM',
                        nightRestHours: val,
                        restHours: val,
                      });
                    }
                  }}
                  className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
                />
              </div>
            </div>
          </div>

          {/* Quick Rest Hours Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-400">
                Standart Dinlenme Süresi
              </span>
              <span className="text-xs font-bold">
                {!settings.is24HourSystem &&
                (settings.dayRestHours ?? settings.restHours) !==
                  (settings.nightRestHours ?? settings.restHours)
                  ? `${settings.dayRestHours}s / ${settings.nightRestHours}s`
                  : `${settings.restHours} Saat`}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {REST_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setRestHoursInput(String(preset));
                    onUpdateSettings({
                      ...settings,
                      shiftPreset: 'CUSTOM',
                      restHours: preset,
                      dayRestHours: preset,
                      nightRestHours: preset,
                    });
                  }}
                  className={`py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    settings.restHours === preset &&
                    (settings.dayRestHours ?? preset) === preset &&
                    (settings.nightRestHours ?? preset) === preset
                      ? primaryBtnClass
                      : secondaryBtnClass
                  }`}
                >
                  {preset}s
                </button>
              ))}
            </div>

            <input
              type="number"
              min={12}
              max={120}
              value={restHoursInput}
              onChange={(e) => {
                setRestHoursInput(e.target.value);
                const h = parseInt(e.target.value, 10);
                if (h >= 12 && h <= 120) {
                  onUpdateSettings({
                    ...settings,
                    shiftPreset: 'CUSTOM',
                    restHours: h,
                    dayRestHours: h,
                    nightRestHours: h,
                  });
                }
              }}
              placeholder="Özel saat (12-120)"
              className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${inputClass}`}
            />
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 3: GRUPLAR VE PERSONEL
         ===================================================================== */}
      {activePage === 'groups' && (
        <div className="flex flex-col gap-4 pb-4 animate-fade-in">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs font-semibold text-slate-400">Toplam Grup Sayısı</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={settings.numGroups <= 2}
                onClick={() => handleUpdateGroupCount(settings.numGroups - 1)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 cursor-pointer ${secondaryBtnClass}`}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold w-5 text-center">{settings.numGroups}</span>
              <button
                type="button"
                disabled={settings.numGroups >= 10}
                onClick={() => handleUpdateGroupCount(settings.numGroups + 1)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 cursor-pointer ${secondaryBtnClass}`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className={listDivideClass}>
            {Array.from({ length: settings.numGroups }, (_, i) => {
              const isExpanded = expandedGroupIdx === i;
              const isMyGroup = refHistory.length > 0 && i === activeGroupIdx;
              const groupTitle = settings.groupNames[i] || `${i + 1}. Grup`;
              const membersText = settings.groupMembers[i] || '';

              return (
                <div key={i} className="py-2.5 flex flex-col">
                  <button
                    type="button"
                    onClick={() => setExpandedGroupIdx(isExpanded ? null : i)}
                    className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold">{groupTitle}</span>
                        {isMyGroup && (
                          <span className="text-[10px] font-semibold text-sky-500">· Grubum</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {membersText || 'Personel eklenmedi'}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-slate-400 shrink-0">
                      {isExpanded ? 'Kapat' : 'Düzenle'}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-500/10 flex flex-col gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 mb-1 block">Grup Adı</label>
                        <input
                          type="text"
                          value={settings.groupNames[i] || ''}
                          placeholder={`${i + 1}. Grup`}
                          onChange={(e) => {
                            const updated = [...settings.groupNames];
                            updated[i] = e.target.value;
                            onUpdateSettings({ ...settings, groupNames: updated });
                          }}
                          className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] text-slate-400">
                            Personeller (Otomatik virgülle ayrılır)
                          </label>
                          <button
                            type="button"
                            onClick={() => handleToggleVoiceInput(i)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                              listeningGroupIdx === i
                                ? 'bg-rose-600 text-white'
                                : primaryBtnClass
                            }`}
                          >
                            {listeningGroupIdx === i ? (
                              <>
                                <MicOff className="w-3 h-3" />
                                <span>Durdur</span>
                              </>
                            ) : (
                              <>
                                <Mic className="w-3 h-3" />
                                <span>Sesle Ekle</span>
                              </>
                            )}
                          </button>
                        </div>

                        {listeningGroupIdx === i && (
                          <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400 text-xs flex items-center justify-between">
                            <span>
                              {interimSpeech
                                ? `Algılanan: "${interimSpeech}"`
                                : 'İsimleri söyleyin (Örn: Ahmet Yılmaz)...'}
                            </span>
                          </div>
                        )}

                        {voiceErrorMsg && (
                          <div className="text-[11px] text-amber-500 flex items-center justify-between gap-2">
                            <span>{voiceErrorMsg}</span>
                            <button
                              type="button"
                              onClick={() => setVoiceErrorMsg(null)}
                              className="cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Quick Dictation / Auto-Comma Input */}
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={quickInputRef}
                            type="text"
                            value={quickDictationText}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val.includes(',') || val.includes(';')) {
                                handleCommitQuickDictation(i, val);
                                return;
                              }
                              setQuickDictationText(val);
                              if (dictationTimerRef.current !== null) {
                                window.clearTimeout(dictationTimerRef.current);
                              }
                              if (val.trim().length >= 2) {
                                dictationTimerRef.current = window.setTimeout(() => {
                                  handleCommitQuickDictation(i, val);
                                }, 1400);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleCommitQuickDictation(i);
                              }
                            }}
                            onBlur={() => {
                              if (quickDictationText.trim()) {
                                handleCommitQuickDictation(i);
                              }
                            }}
                            placeholder="İsim söyleyin veya yazıp Enter'a basın..."
                            className={`flex-1 p-2 rounded-lg text-xs border outline-none ${inputClass}`}
                          />
                          <button
                            type="button"
                            onClick={() => handleCommitQuickDictation(i)}
                            disabled={!quickDictationText.trim()}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-30 cursor-pointer ${secondaryBtnClass}`}
                          >
                            Ekle
                          </button>
                        </div>

                        {/* Person Chips */}
                        {(() => {
                          const parsedPeople = (settings.groupMembers[i] || '')
                            .split(',')
                            .map((p) => p.trim())
                            .filter(Boolean);

                          if (parsedPeople.length === 0) return null;

                          return (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {parsedPeople.map((person, pIdx) => (
                                <span
                                  key={`${person}-${pIdx}`}
                                  className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg text-xs font-medium ${secondaryBtnClass}`}
                                >
                                  <span>{person}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextPeople = parsedPeople.filter(
                                        (_, idx) => idx !== pIdx
                                      );
                                      const updated = [...settings.groupMembers];
                                      updated[i] = nextPeople.join(', ');
                                      onUpdateSettings({ ...settings, groupMembers: updated });
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          );
                        })()}

                        <textarea
                          rows={2}
                          value={settings.groupMembers[i] || ''}
                          placeholder="Toplu liste (virgülle ayrılmış)"
                          onChange={(e) => {
                            const updated = [...settings.groupMembers];
                            updated[i] = e.target.value;
                            onUpdateSettings({ ...settings, groupMembers: updated });
                          }}
                          className={`w-full p-2 rounded-lg text-xs border outline-none ${inputClass}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 4: BECAYİŞ VE NOTLAR
         ===================================================================== */}
      {activePage === 'notes' && (
        <div className="flex flex-col gap-4 pb-4 animate-fade-in">
          <div className="flex items-center gap-1">
            {[
              { id: 'list' as const, label: `Kayıtlar (${notes.length})` },
              { id: 'add' as const, label: 'Yeni Ekle' },
              { id: 'chain' as const, label: `Referanslar (${refHistory.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setNotesTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  notesTab === t.id ? primaryBtnClass : secondaryBtnClass
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {notesTab === 'list' && (
            <div className={listDivideClass}>
              {notes.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Henüz kayıtlı becayiş veya not bulunmuyor.
                </div>
              ) : (
                notes
                  .slice()
                  .reverse()
                  .map((n) => (
                    <div key={n.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold">
                          {trDateFormatter(n.date)} ·{' '}
                          <span className="text-sky-500">{n.type}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">{n.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = notes.filter((it) => it.id !== n.id);
                          onSaveNotes(updated, refHistory);
                          showTemporaryFeedback('Silindi');
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
              )}
            </div>
          )}

          {notesTab === 'add' && (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">Tarih</label>
                  <input
                    type="date"
                    value={noteDate}
                    onChange={(e) => setNoteDate(e.target.value)}
                    className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">Tür</label>
                  <select
                    value={noteType}
                    onChange={(e) => setNoteType(e.target.value)}
                    className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                  >
                    {NOTE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {noteType === 'Nöbet Değişimi' && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="text-[11px] text-slate-400 mb-1 block">
                      Karşılık Tarihi
                    </label>
                    <input
                      type="date"
                      value={swapTargetDate}
                      onChange={(e) => setSwapTargetDate(e.target.value)}
                      className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 mb-1 block">Vardiya</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSwapShiftType('GUNDUZ')}
                        className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                          swapShiftType === 'GUNDUZ'
                            ? 'bg-amber-500 text-white'
                            : secondaryBtnClass
                        }`}
                      >
                        Gündüz
                      </button>
                      <button
                        type="button"
                        onClick={() => setSwapShiftType('AKSAM')}
                        className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                          swapShiftType === 'AKSAM'
                            ? 'bg-indigo-600 text-white'
                            : secondaryBtnClass
                        }`}
                      >
                        Gece
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] text-slate-400 mb-1 block">Açıklama</label>
                <input
                  type="text"
                  placeholder="İsteğe bağlı not..."
                  value={noteDesc}
                  onChange={(e) => setNoteDesc(e.target.value)}
                  className={`w-full p-2 rounded-lg text-xs border outline-none ${inputClass}`}
                />
              </div>

              <div className="py-2 flex items-center justify-between border-t border-slate-500/10">
                <span className="text-xs font-medium">Yeni Referans Başlangıcı</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isNewRef}
                  onClick={() => setIsNewRef(!isNewRef)}
                  className={`w-10 h-5.5 rounded-full transition-colors p-0.5 cursor-pointer flex items-center ${
                    isNewRef
                      ? 'bg-sky-500 justify-end'
                      : isLight
                      ? 'bg-slate-300 justify-start'
                      : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                </button>
              </div>

              {isNewRef && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newRefGroup}
                    onChange={(e) => setNewRefGroup(parseInt(e.target.value, 10))}
                    className={`p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                  >
                    {Array.from({ length: settings.numGroups }, (_, i) => (
                      <option key={i} value={i}>
                        {settings.groupNames[i] || `${i + 1}. Grup`}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewRefShiftType('GUNDUZ')}
                      className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                        newRefShiftType === 'GUNDUZ'
                          ? 'bg-amber-500 text-white'
                          : secondaryBtnClass
                      }`}
                    >
                      Gündüz
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewRefShiftType('AKSAM')}
                      className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                        newRefShiftType === 'AKSAM'
                          ? 'bg-indigo-600 text-white'
                          : secondaryBtnClass
                      }`}
                    >
                      Gece
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleSaveNote}
                className={`w-full py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${primaryBtnClass}`}
              >
                Kaydet
              </button>
            </div>
          )}

          {notesTab === 'chain' && (
            <div className={listDivideClass}>
              {refHistory.map((r, idx) => (
                <div key={idx} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold">
                      {settings.groupNames[r.myGroupIdx] || `${r.myGroupIdx + 1}. Grup`} ·{' '}
                      {r.refType === 'GUNDUZ' ? 'Gündüz' : 'Gece'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {trDateFormatter(r.refDate)}
                    </div>
                  </div>
                  {idx > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteRef(idx);
                        showTemporaryFeedback('Kaldırıldı');
                      }}
                      className="text-xs font-semibold text-rose-500 cursor-pointer"
                    >
                      Sil
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400">Ana Referans</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 5: YEDEKLEME VE PAYLAŞIM
         ===================================================================== */}
      {activePage === 'backup' && (
        <div className="flex flex-col gap-5 pb-4 animate-fade-in">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-slate-400">Dışa Aktar</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleDownloadBackup}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${primaryBtnClass}`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Dosya İndir</span>
              </button>
              <button
                type="button"
                onClick={handleCopyBackup}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${secondaryBtnClass}`}
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Kodu Kopyala</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-3 border-t border-slate-500/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Geri Yükle</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const content = String(ev.target?.result || '');
                    if (content) applyBackupPayload(content);
                  };
                  reader.readAsText(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-sky-500 flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Dosya Seç</span>
              </button>
            </div>

            <textarea
              rows={4}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Yedek JSON kodunu buraya yapıştırın..."
              className={`w-full p-2.5 rounded-xl text-xs font-mono border outline-none ${inputClass}`}
            />

            <button
              type="button"
              disabled={!importJsonText.trim()}
              onClick={() => applyBackupPayload(importJsonText)}
              className={`w-full py-2.5 rounded-xl text-xs font-bold disabled:opacity-30 cursor-pointer ${primaryBtnClass}`}
            >
              Yedeği Uygula
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 6: SİSTEM DOĞRULAMA
         ===================================================================== */}
      {activePage === 'diagnostics' && (
        <div className="flex flex-col gap-3 pb-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {testResults.filter((r) => r.startsWith('✅')).length} / {testResults.length} test
              başarılı
            </span>
            <button
              type="button"
              onClick={() => {
                setTestResults(runBuiltInTests());
                showTemporaryFeedback('Yenilendi');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${secondaryBtnClass}`}
            >
              Yeniden Çalıştır
            </button>
          </div>

          <div className={`font-mono text-xs ${listDivideClass}`}>
            {testResults.map((line, idx) => (
              <div key={idx} className="py-2.5">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 7: HAKKINDA
         ===================================================================== */}
      {activePage === 'about' && (
        <div className="flex flex-col gap-4 pb-4 animate-fade-in text-xs">
          {/* Developer Profile Header */}
          <div
            className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
              isLight
                ? 'bg-slate-100/80 border-slate-200/80 text-slate-900'
                : 'bg-slate-900/60 border-slate-800 text-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-rose-500 bg-slate-800 shrink-0 flex items-center justify-center font-black text-white">
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
                <div className="font-extrabold text-sm">Tufan UYSAL</div>
                <div className="text-slate-400 text-[11px]">
                  Uygulama Geliştiricisi · Kütahya 112 AÇM
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-400 border border-rose-500/30 shrink-0">
              v2.5 Güncel
            </span>
          </div>

          <p
            className={`p-3 rounded-xl border text-center italic font-medium ${
              isLight
                ? 'bg-indigo-50/70 border-indigo-200/80 text-indigo-900'
                : 'bg-indigo-950/30 border-indigo-500/25 text-indigo-200'
            }`}
          >
            "Mesai arkadaşlarıma vardiya ve nöbet takibinde kolaylık sağlaması amacıyla
            geliştirilmiştir."
          </p>

          {/* Categorized Feature List */}
          <div className="flex flex-col gap-3">
            <div
              className={`p-3.5 rounded-2xl border flex flex-col gap-1.5 ${
                isLight
                  ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                  : 'bg-slate-900/50 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-sky-400 flex items-center gap-1.5">
                <span>🌍</span>
                <span>Canlı 3D Dünya & Tek Elle Ergonomik Kullanım</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[11px] leading-relaxed opacity-90">
                <li>
                  Gerçek zamanlı 3D Dünya küresi, gece/gündüz atmosferi ve aktif nöbet ilerleme yayı
                  (% tamamlanma ve kalan süre).
                </li>
                <li>
                  Nöbet ve Takvim sayfaları arasında sağa/sola kaydırarak (swipe) geçiş.
                </li>
                <li>
                  Tek elle başparmak erişimine uygun alt navigasyon barı (Nöbet, Takvim, Tema,
                  Ayarlar) ve boşluğa dokunarak ayarları kapatma.
                </li>
              </ul>
            </div>

            <div
              className={`p-3.5 rounded-2xl border flex flex-col gap-1.5 ${
                isLight
                  ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                  : 'bg-slate-900/50 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-indigo-400 flex items-center gap-1.5">
                <span>📅</span>
                <span>Gelişmiş Takvim & Misafir (Tüm Gruplar) Görünümü</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[11px] leading-relaxed opacity-90">
                <li>
                  <strong>👥 Misafir Görünümü:</strong> Gün kutucuklarını ikiye bölerek üstte{' '}
                  <strong>☀️ Sabah</strong>, altta <strong>🌙 Gece</strong> çalışan grubu aylık
                  tabloda tek bakışta gösterme.
                </li>
                <li>
                  <strong>5&apos;li Grup Durum Kutucukları:</strong> Takvimde herhangi bir güne
                  tıklayınca o günkü tüm grupların durumunu (☀️ Gündüz, 🌙 Gece, 🌅 Sabah çıkış,
                  🛋️ İstirahat) özel renkleriyle anında görme.
                </li>
                <li>
                  <strong>Basılı Tutarak Not/İstisna Ekleme:</strong> Takvimde bir güne basılı
                  tutarak nöbet değişimi, icap veya not ekleme.
                </li>
                <li>
                  Ay geçişlerinde boyutu değişmeyen sabit takvim alanı, tek elle ulaşılabilir ay
                  değiştirme ve <strong>Canlı</strong> sıfırlama butonu.
                </li>
              </ul>
            </div>

            <div
              className={`p-3.5 rounded-2xl border flex flex-col gap-1.5 ${
                isLight
                  ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                  : 'bg-slate-900/50 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-rose-400 flex items-center gap-1.5">
                <span>🔄</span>
                <span>Akıllı Nöbet Değişimi (Becayiş) Takibi</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[11px] leading-relaxed opacity-90">
                <li>
                  Nöbet değişimi yapılan eski günün kişisel takvimde otomatik olarak dinlenmeye
                  çekilmesi; mavi nokta işaretinin yalnızca nöbete gelinecek yeni güne konulması.
                </li>
                <li>
                  Değişim yapılan günlerde (ve gece nöbetiyse ertesi sabah çıkışında) değişim
                  yapılan grubun personeli gibi sayılarak 5&apos;li grup kutucuklarındaki{' '}
                  <strong>kırmızı vurgu çerçevesinin</strong> otomatik olarak o gruba taşınması.
                </li>
                <li>
                  Bireysel nöbet değişimlerinde dahi grubun genel nöbet çizelgesinin korunması.
                </li>
              </ul>
            </div>

            <div
              className={`p-3.5 rounded-2xl border flex flex-col gap-1.5 ${
                isLight
                  ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                  : 'bg-slate-900/50 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-amber-400 flex items-center gap-1.5">
                <span>⚡</span>
                <span>Vardiya Şablonları, Sesli Ekleme & Dışa Aktarım</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[11px] leading-relaxed opacity-90">
                <li>
                  112 Klasik 5 Grup (10/14 - 48 sa izin), 12/24-12/48 (4 Grup), 24/48 (3 Grup),
                  24/72 (4 Grup) hazır sistemleri ve özelleştirilebilir saatler.
                </li>
                <li>
                  Gruplara mikrofon ile Türkçe <strong>sesli personel ismi ekleme</strong>.
                </li>
                <li>
                  Nöbet öncesi sesli bildirim hatırlatıcısı, <strong>.ics</strong> takvim dosyası
                  indirme, aylık çizelge metni kopyalama, görsel paylaşma ve JSON yedekleme.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* RESET CONFIRMATION DIALOG */}
      {showResetConfirm && (
        <div
          onClick={() => setShowResetConfirm(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-xs rounded-2xl p-5 border shadow-2xl animate-fade-in ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-[#111622] border-slate-800 text-white'
            }`}
          >
            <div className="text-sm font-bold mb-1.5">Veriler Sıfırlansın mı?</div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Kayıtlı nöbet referansınız, personel listesi ve notlarınız silinecektir.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${secondaryBtnClass}`}
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  onResetAll();
                  setActivePage('main');
                  showTemporaryFeedback('Sıfırlandı');
                }}
                className="py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
              >
                Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
