import React, { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  AppSettings,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  ShiftPresetOption,
  UnitProfileLockDoc,
  UserProfile,
} from '../types';
import {
  trDateFormatter,
  toISODate,
  runBuiltInTests,
  querySingleDayForGroup,
  groupConsecutiveRecords,
} from '../shiftEngine';
import {
  SHIFT_PRESETS,
  formatMemberListTitleCaseTR,
  formatTitleCaseTR,
} from '../storage';
import { requestSystemNotificationPermission } from './ToastNotification';
import { ShiftScheduleImporter } from './ShiftScheduleImporter';
import { ProfileManagerModal } from './ProfileManagerModal';
import { THEME_PRESETS, calculateSunTimes, getThemePreset, isLightTheme } from '../themes';
import {
  apiUrl,
  blobToBase64,
  getNativeSpeechRecognitionPlugin,
  isCapacitorNative,
  requestCurrentLocation,
  shareOrOpenNativeFile,
} from '../utils/nativeBridge';
import { getAuthHeaders } from '../firebase';
import {
  DEFAULT_WEATHER_CITY,
  findNearestProvinceByCoords,
  TURKISH_PROVINCES,
} from '../utils/weather';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Trash2,
  X,
  Plus,
  Minus,
  Mic,
  MicOff,
  Loader2,
  Download,
  Upload,
  Copy,
  Users,
  ShieldCheck,
  Calendar,
  Clock,
  Bell,
  Database,
  CheckCircle2,
  FileText,
  Info,
  Activity,
  Palette,
  Sun,
  Moon,
  MapPin,
  LogOut,
  RefreshCw,
  Building2,
} from 'lucide-react';

interface SettingsTabProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  profiles: UserProfile[];
  activeProfileId: string;
  defaultDate: string;
  onUpdateSettings: (s: AppSettings) => void;
  onSaveNotes: (notes: NoteItem[], refs: RefRecord[]) => void;
  onSelectProfile: (profileId: string) => void;
  onSaveProfile: (
    profile: UserProfile,
    updatedSettings?: AppSettings,
    makeActive?: boolean
  ) => void;
  onDeleteProfile: (profileId: string) => void;
  onDeleteRef: (idx: number) => void;
  onResetAll: () => void;
  onResyncFromServer?: () => Promise<void>;
  onLockSystem?: () => void;
  onOpenDevModal: () => void;
  onOpenTestModal: () => void;
  activeUnit?: InstitutionUnitDoc | null;
  activeUnitProfileLocks?: UnitProfileLockDoc[];
  currentUser?: User | null;
  isAuthorizedAdmin?: boolean;
  onOpenFirstLaunchScreen?: () => void;
  onOpenBureauModal?: (
    section?: 'units' | 'identity' | 'shift_ref' | 'personnel' | 'records' | 'admins'
  ) => void;
  onTriggerToast?: (title: string, message: string) => void;
  onTriggerTestReminder?: (title: string, message: string) => void;
  onClose?: () => void;
}

type SettingsSubPage =
  | 'main'
  | 'profiles'
  | 'reference'
  | 'shift-hours'
  | 'groups'
  | 'notes'
  | 'themes'
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
  profiles,
  activeProfileId,
  defaultDate,
  onUpdateSettings,
  onSaveNotes,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
  onDeleteRef,
  onResetAll,
  onResyncFromServer,
  activeUnit = null,
  activeUnitProfileLocks = [],
  currentUser = null,
  isAuthorizedAdmin = false,
  onOpenFirstLaunchScreen,
  onOpenBureauModal,
  onTriggerToast,
  onTriggerTestReminder,
  onClose,
}) => {
  const isAdminMode = settings.appRoleMode === 'admin';
  const isLight = isLightTheme(settings.theme);
  const currentThemePreset = getThemePreset(settings.theme);
  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const [activePage, setActivePage] = useState<SettingsSubPage>('main');
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdvancedResetZone, setShowAdvancedResetZone] = useState(false);
  const [resetConfirmChecked, setResetConfirmChecked] = useState(false);
  const [isResyncingServer, setIsResyncingServer] = useState(false);
  const [locatingSun, setLocatingSun] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const sunTimes = calculateSunTimes(new Date(), settings.autoThemeLat, settings.autoThemeLng);
  const lightThemes = THEME_PRESETS.filter((t) => t.isLight);
  const darkThemes = THEME_PRESETS.filter((t) => !t.isLight);

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

  useEffect(() => {
    const r = refHistory[0];
    if (r) {
      setRefGroupIdx(r.myGroupIdx >= 0 ? r.myGroupIdx : 0);
      setRefDateVal(r.refDate || defaultDate || toISODate(new Date()));
      setRefShiftType(r.refType || 'GUNDUZ');
    }
  }, [activeProfileId, refHistory, defaultDate]);

  // Shift Hours & Rest State
  const [restHoursInput, setRestHoursInput] = useState(String(settings.restHours));
  const [refSetupMode, setRefSetupMode] = useState<'manual' | 'ai'>('manual');
  const [showAdvancedHours, setShowAdvancedHours] = useState<boolean>(false);

  // Groups & Personnel State
  const [expandedGroupIdx, setExpandedGroupIdx] = useState<number | null>(
    primaryRef.myGroupIdx >= 0 ? primaryRef.myGroupIdx : 0
  );
  const [listeningGroupIdx, setListeningGroupIdx] = useState<number | null>(null);
  const [voiceModeLabel, setVoiceModeLabel] = useState<'none' | 'native' | 'web-speech' | 'recorder'>('none');
  const [isTranscribingVoice, setIsTranscribingVoice] = useState<boolean>(false);
  const [interimSpeech, setInterimSpeech] = useState<string>('');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const [quickDictationText, setQuickDictationText] = useState<string>('');
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordAutoStopTimerRef = useRef<number | null>(null);
  const activeVoiceModeRef = useRef<'none' | 'native' | 'web-speech' | 'recorder'>('none');
  const nativePartialListenerRef = useRef<any>(null);
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
    if (recordAutoStopTimerRef.current !== null) {
      window.clearTimeout(recordAutoStopTimerRef.current);
      recordAutoStopTimerRef.current = null;
    }
  };

  const cleanupMediaStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      mediaStreamRef.current = null;
    }
  };

  const cleanupNativeSpeech = async () => {
    if (nativePartialListenerRef.current) {
      try {
        await nativePartialListenerRef.current.remove?.();
      } catch {
        // ignore
      }
      nativePartialListenerRef.current = null;
    }
    const nativePlugin = getNativeSpeechRecognitionPlugin();
    if (nativePlugin && activeVoiceModeRef.current === 'native') {
      try {
        await nativePlugin.stop?.();
      } catch {
        // ignore
      }
    }
  };

  const abortAllVoiceSessions = () => {
    shouldKeepListeningRef.current = null;
    clearVoiceTimers();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    cleanupMediaStream();
    void cleanupNativeSpeech();
    activeVoiceModeRef.current = 'none';
    setVoiceModeLabel('none');
    setListeningGroupIdx(null);
    setInterimSpeech('');
  };

  useEffect(() => {
    if (activePage !== 'groups') {
      abortAllVoiceSessions();
    }
  }, [activePage]);

  useEffect(() => {
    return () => {
      abortAllVoiceSessions();
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
  const [swapWithPerson, setSwapWithPerson] = useState('');
  const [swapMyPerson, setSwapMyPerson] = useState(() => {
    const cleanProf =
      activeProfile?.name && activeProfile.name.trim() !== 'Ana Profilim'
        ? formatTitleCaseTR(activeProfile.name)
        : '';
    if (cleanProf) return cleanProf;
    const myIdx = primaryRef.myGroupIdx >= 0 ? primaryRef.myGroupIdx : 0;
    const firstMem = (settings.groupMembers[myIdx] || '')
      .split(/[,;\n]+/)
      .map((s) => formatTitleCaseTR(s))
      .filter(Boolean)[0];
    return firstMem || '';
  });

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

  const transcribeRecordedAudio = async (groupIdx: number, audioBlob: Blob) => {
    if (!audioBlob || audioBlob.size < 400) {
      setVoiceErrorMsg('Ses kaydı çok kısa. İsimleri söyleyip Durdur butonuna basın.');
      return;
    }

    setIsTranscribingVoice(true);
    setVoiceErrorMsg(null);
    try {
      const base64Data = await blobToBase64(audioBlob);
      const mimeType = audioBlob.type || 'audio/webm';
      const response = await fetch(apiUrl('/api/voice/transcribe'), {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ base64Data, mimeType }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Ses çözümleme sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.');
      }

      const data = (await response.json()) as { transcript?: string; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Ses metne çevrilemedi.');
      }

      const transcript = String(data.transcript || '').trim();
      const parsed = parseSpokenNamesToPeople(transcript);
      if (parsed.length > 0) {
        appendPeopleToGroup(groupIdx, parsed);
        showTemporaryFeedback(`+ ${parsed.join(', ')}`);
      } else {
        setVoiceErrorMsg('Konuşmada isim algılanamadı. Mikrofona yakın konuşup tekrar deneyin.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setVoiceErrorMsg(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? 'İnternet bağlantısı yok. Ses çözümleme için bağlantı gerekir veya aşağıdaki kutuyu kullanabilirsiniz.'
          : msg || 'Ses metne çevrilemedi. Tekrar deneyin.'
      );
    } finally {
      setIsTranscribingVoice(false);
    }
  };

  const startAudioRecorderFallback = async (groupIdx: number): Promise<boolean> => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenType = candidateTypes.find(
        (t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)
      );

      const recorder = chosenType
        ? new MediaRecorder(stream, { mimeType: chosenType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        const finalType = recorder.mimeType || chosenType || 'audio/webm';
        cleanupMediaStream();
        mediaRecorderRef.current = null;
        activeVoiceModeRef.current = 'none';
        setVoiceModeLabel('none');
        setListeningGroupIdx(null);
        setInterimSpeech('');
        if (chunks.length > 0) {
          const audioBlob = new Blob(chunks, { type: finalType });
          void transcribeRecordedAudio(groupIdx, audioBlob);
        }
      };

      mediaRecorderRef.current = recorder;
      activeVoiceModeRef.current = 'recorder';
      setVoiceModeLabel('recorder');
      shouldKeepListeningRef.current = groupIdx;
      setListeningGroupIdx(groupIdx);
      setInterimSpeech('');
      setVoiceErrorMsg(null);
      recorder.start(250);
      showTemporaryFeedback('Ses kaydediliyor...');

      // Auto-stop after 20 seconds so recording never hangs
      recordAutoStopTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.stop();
          } catch {
            // ignore
          }
        }
      }, 20000);

      return true;
    } catch (err: unknown) {
      cleanupMediaStream();
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setVoiceErrorMsg(
          isCapacitorNative()
            ? 'Mikrofon izni verilmedi. Telefon Ayarları > Uygulamalar > Vardiya 112 > İzinler bölümünden Mikrofon iznini açın.'
            : 'Mikrofon izni verilmedi. Tarayıcı adres çubuğundan mikrofon iznini açın.'
        );
      } else {
        setVoiceErrorMsg('Mikrofon başlatılamadı. Cihaz mikrofon iznini kontrol edin.');
      }
      return false;
    }
  };

  const startNativeCapacitorSpeech = async (groupIdx: number): Promise<boolean> => {
    const nativePlugin = getNativeSpeechRecognitionPlugin();
    if (!nativePlugin || typeof nativePlugin.start !== 'function') {
      return false;
    }

    try {
      if (typeof nativePlugin.available === 'function') {
        const avail = await nativePlugin.available();
        if (avail && avail.available === false) return false;
      }

      if (typeof nativePlugin.requestPermissions === 'function') {
        const perm = await nativePlugin.requestPermissions();
        if (perm && perm.speechRecognition === 'denied') {
          setVoiceErrorMsg(
            'Mikrofon izni reddedildi. Uygulama ayarlarından Mikrofon iznini açın.'
          );
          return true;
        }
      }

      activeVoiceModeRef.current = 'native';
      setVoiceModeLabel('native');
      shouldKeepListeningRef.current = groupIdx;
      setListeningGroupIdx(groupIdx);
      setInterimSpeech('');
      setVoiceErrorMsg(null);
      showTemporaryFeedback('Dinleniyor...');

      let lastPartial = '';
      if (typeof nativePlugin.addListener === 'function') {
        nativePartialListenerRef.current = await nativePlugin.addListener(
          'partialResults',
          (data: { matches?: string[] }) => {
            const first = data?.matches?.[0] || '';
            if (first) {
              lastPartial = first;
              uncommittedInterimRef.current = first;
              setInterimSpeech(first);
            }
          }
        );
      }

      const result = await nativePlugin.start({
        language: 'tr-TR',
        maxResults: 1,
        prompt: 'Personel isimlerini söyleyin',
        partialResults: true,
        popup: false,
      });

      const spokenText = (result?.matches?.[0] || lastPartial || '').trim();
      await cleanupNativeSpeech();
      activeVoiceModeRef.current = 'none';
      setVoiceModeLabel('none');
      shouldKeepListeningRef.current = null;
      setListeningGroupIdx(null);
      uncommittedInterimRef.current = '';
      setInterimSpeech('');

      if (spokenText) {
        const parsed = parseSpokenNamesToPeople(spokenText);
        if (parsed.length > 0) {
          appendPeopleToGroup(groupIdx, parsed);
          showTemporaryFeedback(`+ ${parsed.join(', ')}`);
        }
      }
      return true;
    } catch {
      await cleanupNativeSpeech();
      activeVoiceModeRef.current = 'none';
      setVoiceModeLabel('none');
      setListeningGroupIdx(null);
      return false;
    }
  };

  const startRecognitionInstance = (groupIdx: number) => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      // Automatically switch to MediaRecorder + AI transcription (works in Capacitor Android WebView)
      void startAudioRecorderFallback(groupIdx);
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = 'tr-TR';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        activeVoiceModeRef.current = 'web-speech';
        setVoiceModeLabel('web-speech');
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
          activeVoiceModeRef.current = 'none';
          setVoiceModeLabel('none');
          setListeningGroupIdx(null);
          setInterimSpeech('');
          setVoiceErrorMsg(
            isCapacitorNative()
              ? 'Mikrofon izni engellendi. Uygulama izinlerinden Mikrofonu açın.'
              : 'Mikrofon izni engellendi. Aşağıdaki hızlı ekleme kutusunu kullanabilirsiniz.'
          );
          window.setTimeout(() => quickInputRef.current?.focus(), 80);
        } else if (err === 'audio-capture') {
          shouldKeepListeningRef.current = null;
          activeVoiceModeRef.current = 'none';
          setVoiceModeLabel('none');
          setListeningGroupIdx(null);
          setInterimSpeech('');
          setVoiceErrorMsg('Mikrofon cihazı bulunamadı.');
        } else if (err === 'network' || err === 'language-not-supported') {
          // Fall back to universal MediaRecorder if Web Speech engine fails
          shouldKeepListeningRef.current = null;
          activeVoiceModeRef.current = 'none';
          setVoiceModeLabel('none');
          setListeningGroupIdx(null);
          void startAudioRecorderFallback(groupIdx);
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
          activeVoiceModeRef.current = 'none';
          setVoiceModeLabel('none');
          setListeningGroupIdx((prev) => (prev === groupIdx ? null : prev));
          setInterimSpeech('');
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      // Fallback to MediaRecorder + AI transcription
      void startAudioRecorderFallback(groupIdx);
    }
  };

  const handleToggleVoiceInput = async (groupIdx: number) => {
    setVoiceErrorMsg(null);
    if (isTranscribingVoice) return;

    // STOP currently active session
    if (listeningGroupIdx === groupIdx || shouldKeepListeningRef.current === groupIdx) {
      shouldKeepListeningRef.current = null;
      clearVoiceTimers();

      if (activeVoiceModeRef.current === 'recorder' && mediaRecorderRef.current) {
        if (mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.stop();
          } catch {
            abortAllVoiceSessions();
          }
          return;
        }
      }

      if (activeVoiceModeRef.current === 'native') {
        flushUncommittedInterim(groupIdx);
        await cleanupNativeSpeech();
        activeVoiceModeRef.current = 'none';
        setVoiceModeLabel('none');
        setListeningGroupIdx(null);
        setInterimSpeech('');
        showTemporaryFeedback('Sesle ekleme tamamlandı');
        return;
      }

      flushUncommittedInterim(groupIdx);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      activeVoiceModeRef.current = 'none';
      setVoiceModeLabel('none');
      setListeningGroupIdx(null);
      setInterimSpeech('');
      showTemporaryFeedback('Sesle ekleme tamamlandı');
      return;
    }

    // Abort any other group's active voice session
    abortAllVoiceSessions();

    // Layer 1: Native Capacitor SpeechRecognition plugin (if installed in APK)
    if (getNativeSpeechRecognitionPlugin()) {
      const handledNative = await startNativeCapacitorSpeech(groupIdx);
      if (handledNative) return;
    }

    // Layer 2: Browser Web Speech API (Chrome/Safari/Edge)
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionAPI) {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch {
          setVoiceErrorMsg(
            isCapacitorNative()
              ? 'Mikrofon izni verilmedi. Telefon Ayarları > Uygulamalar > Vardiya 112 > İzinler bölümünden Mikrofon iznini açın.'
              : 'Mikrofon izni verilmedi. Aşağıdaki kutuda klavye mikrofonunu kullanabilirsiniz.'
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
      return;
    }

    // Layer 3: Universal MediaRecorder + Cloud AI Transcription (works inside Capacitor Android WebView!)
    const startedRecorder = await startAudioRecorderFallback(groupIdx);
    if (!startedRecorder) {
      setVoiceErrorMsg(
        'Mikrofon başlatılamadı. Uygulama mikrofon iznini kontrol edin veya aşağıdaki kutuyu kullanın.'
      );
      window.setTimeout(() => quickInputRef.current?.focus(), 80);
    }
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
    const cleanWith = formatTitleCaseTR(swapWithPerson);
    const cleanMy = formatTitleCaseTR(swapMyPerson);
    const partnerPart = cleanWith ? ` (${cleanWith} ile)` : '';

    const finalDesc =
      noteType === 'Nöbet Değişimi' && !noteDesc.trim()
        ? `${trDateFormatter(noteDate)} nöbeti → ${trDateFormatter(swapTargetDate)} (${
            swapShiftType === 'GUNDUZ' ? 'Gündüz' : 'Gece'
          })${partnerPart} ile değiştirildi.`
        : noteDesc.trim() || noteType;

    const resolvedOwner =
      cleanMy ||
      (settings.activeWorkerName || '').trim() ||
      (activeProfile?.name && activeProfile.name !== 'Ana Profilim'
        ? activeProfile.name.trim()
        : '');

    const curGroupIdx =
      refHistory.length > 0 ? refHistory[refHistory.length - 1].myGroupIdx : 0;

    const newNote: NoteItem = {
      id: Date.now(),
      date: noteDate,
      type: noteType,
      desc: finalDesc,
      isNewRef,
      swapTargetDate: noteType === 'Nöbet Değişimi' ? swapTargetDate : '',
      swapShiftType: noteType === 'Nöbet Değişimi' ? swapShiftType : 'GUNDUZ',
      swapWithPerson: noteType === 'Nöbet Değişimi' ? cleanWith : undefined,
      swapMyPerson: resolvedOwner || undefined,
      targetGroupIdx: curGroupIdx,
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
    setSwapWithPerson('');
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

  const handleDownloadBackup = async () => {
    const dataStr = buildBackupPayload();
    const fileName = `vardiya112_yedek_${toISODate(new Date())}.json`;

    if (isCapacitorNative()) {
      const nativeRes = await shareOrOpenNativeFile({
        fileName,
        mimeType: 'application/json',
        textContent: dataStr,
        title: 'Vardiya 112 Yedek',
        text: 'Vardiya 112 JSON Yedek Dosyası',
        dialogTitle: 'Yedek Dosyasını Kaydet / Paylaş',
      });
      if (nativeRes.handled) {
        showTemporaryFeedback('Yedek paylaşıldı');
        return;
      }
    }

    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30000);
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
    profiles: 'Kullanıcı Profilleri ve Otomatik Eşleştirme',
    reference: 'Nöbet Referansı ve Vardiya Saatleri',
    'shift-hours': 'Nöbet Referansı ve Vardiya Saatleri',
    groups: 'Gruplar ve Personel',
    notes: 'Becayiş ve Notlar',
    themes: 'Görünüm ve Temalar',
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
    const nextGroupIdx = refGroupIdx >= clamped ? clamped - 1 : refGroupIdx;
    if (refGroupIdx >= clamped) {
      setRefGroupIdx(nextGroupIdx);
    }

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
          MAIN SETTINGS DASHBOARD (STANDARD GROUPED SETTINGS UI)
         ===================================================================== */}
      {activePage === 'main' && (() => {
        const totalPersonnelCount = settings.groupMembers
          .slice(0, settings.numGroups)
          .reduce((acc, raw) => {
            const count = (raw || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean).length;
            return acc + count;
          }, 0);

        const cardBoxClass = isLight
          ? 'bg-white border-slate-200/85 shadow-2xs'
          : 'bg-slate-900/55 border-slate-800/85';

        const iconBoxClass = (color: 'sky' | 'emerald' | 'indigo' | 'amber' | 'rose' | 'purple' | 'slate') => {
          const map = {
            sky: isLight ? 'bg-sky-500/12 text-sky-600' : 'bg-sky-500/15 text-sky-400',
            emerald: isLight ? 'bg-emerald-500/12 text-emerald-600' : 'bg-emerald-500/15 text-emerald-400',
            indigo: isLight ? 'bg-indigo-500/12 text-indigo-600' : 'bg-indigo-500/15 text-indigo-400',
            amber: isLight ? 'bg-amber-500/12 text-amber-600' : 'bg-amber-500/15 text-amber-400',
            rose: isLight ? 'bg-rose-500/12 text-rose-600' : 'bg-rose-500/15 text-rose-400',
            purple: isLight ? 'bg-purple-500/12 text-purple-600' : 'bg-purple-500/15 text-purple-400',
            slate: isLight ? 'bg-slate-200/70 text-slate-700' : 'bg-slate-800 text-slate-300',
          };
          return `w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${map[color]}`;
        };

        return (
          <div className="flex flex-col gap-4 pb-5 animate-fade-in">
            {/* =================================================================
                1. HESAP & KURUM KARTI (PERSONEL vs YÖNETİCİ)
               ================================================================= */}
            <section>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  {isAdminMode ? 'Yönetici & Kurum Bilgisi' : 'Profilim & Kurum'}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isAdminMode
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                      : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  }`}
                >
                  {isAdminMode ? 'Yönetici Modu' : 'Personel Modu'}
                </span>
              </div>

              <div className={`rounded-2xl border px-3.5 ${cardBoxClass} ${listDivideClass}`}>
                {!isAdminMode ? (
                  <>
                    {/* Personel Profil Satırı */}
                    <button
                      type="button"
                      onClick={() => setActivePage('profiles')}
                      className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={iconBoxClass('emerald')}>
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold truncate">
                            {settings.activeWorkerName || activeProfile?.name || 'Profil Seçilmedi'}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {activeUnit?.name || settings.activeUnitName || 'Kurum Kaydı'} ·{' '}
                            <strong className="text-emerald-500">{activeGroupName}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400 group-hover:text-sky-500 transition shrink-0">
                        <span className="text-[11px] font-semibold">Profilim</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>

                    {/* Vardiya Özeti (Kompakt Tek Satır) */}
                    <div className="py-2.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-400 font-medium">Vardiya Düzeni</span>
                      <span className="font-bold truncate">
                        {settings.is24HourSystem
                          ? `24 Saat (${settings.shift24Start})`
                          : `${settings.dayStart}–${settings.dayEnd} / ${settings.nightStart}–${settings.nightEnd}`}{' '}
                        · {settings.numGroups} Grup
                      </span>
                    </div>

                    {/* Birden Fazla Profil Varsa Hızlı Geçiş */}
                    {profiles.length > 1 && (
                      <div className="py-2.5 flex items-center gap-1.5 overflow-x-auto">
                        <span className="text-[10px] font-semibold text-slate-400 shrink-0 mr-1">
                          Profiller:
                        </span>
                        {profiles.map((p) => {
                          const isAct = p.id === activeProfileId;
                          const pGroup =
                            settings.groupNames[p.groupIdx] || `${p.groupIdx + 1}. Grup`;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                onSelectProfile(p.id);
                                showTemporaryFeedback(`${p.name} seçildi`);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold shrink-0 transition cursor-pointer ${
                                isAct
                                  ? 'bg-emerald-600 text-white shadow-2xs'
                                  : secondaryBtnClass
                              }`}
                            >
                              {p.name} ({pGroup})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Kişisel Notlar ve Nöbet Değişimlerim */}
                    <button
                      type="button"
                      onClick={() => setActivePage('notes')}
                      className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={iconBoxClass('amber')}>
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold">Nöbet Değişimi ve Notlarım</div>
                          <div className="text-[10.5px] text-slate-400 truncate">
                            Becayiş, izin ve kişisel takvim kayıtlarınız
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400 group-hover:text-sky-500 transition shrink-0">
                        {notes.length > 0 && (
                          <span className="text-[11px] font-semibold">{notes.length}</span>
                        )}
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Yönetici Hesabı ve Yetki Bilgisi */}
                    <div className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={iconBoxClass('rose')}>
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold truncate">
                            {currentUser?.displayName || currentUser?.email || 'Kurum Yöneticisi'}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {currentUser?.email
                              ? `${currentUser.email} · Yetkili Yönetici`
                              : 'Yetkili yönetici oturumu aktif'}
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/15 text-emerald-500 shrink-0">
                        Aktif
                      </span>
                    </div>

                    {/* Aktif Kurum Özeti & Yönetici Paneli */}
                    <div className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={iconBoxClass('indigo')}>
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold truncate">
                            {activeUnit?.name || settings.activeUnitName || '112 Acil Çağrı Merkezi'}
                          </div>
                          <div className="text-[10.5px] text-slate-400 truncate mt-0.5">
                            {settings.weatherCity || activeUnit?.city || 'İl Seçilmedi'} ·{' '}
                            {settings.numGroups} Grup · {totalPersonnelCount} Personel ·{' '}
                            {settings.is24HourSystem
                              ? `24s (${settings.shift24Start})`
                              : `${settings.dayStart}–${settings.dayEnd} / ${settings.nightStart}–${settings.nightEnd}`}
                          </div>
                        </div>
                      </div>

                      {onOpenBureauModal && (
                        <button
                          type="button"
                          onClick={() => {
                            if (onClose) onClose();
                            onOpenBureauModal('units');
                          }}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-rose-600 hover:bg-rose-500 text-white shrink-0 transition cursor-pointer shadow-2xs"
                        >
                          Yönetici Paneli
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* =================================================================
                2. GÖRÜNÜM VE KONUM AYARLARI
               ================================================================= */}
            <section>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Görünüm ve Konum
                </span>
              </div>

              <div className={`rounded-2xl border px-3.5 ${cardBoxClass} ${listDivideClass}`}>
                {/* Tema Seçimi */}
                <button
                  type="button"
                  onClick={() => setActivePage('themes')}
                  className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={iconBoxClass('purple')}>
                      <Palette className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>Uygulama Teması</span>
                        {settings.autoThemeEnabled && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-500">
                            Otomatik
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-slate-400 truncate">
                        {currentThemePreset.name}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center -space-x-1">
                      {currentThemePreset.previewSwatches.map((hex, idx) => (
                        <span
                          key={idx}
                          className="w-3.5 h-3.5 rounded-full border border-white/30"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition" />
                  </div>
                </button>

                {/* Bulunulan İl Seçimi */}
                <div className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={iconBoxClass('sky')}>
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Bulunulan İl</div>
                      <div className="text-[10.5px] text-slate-400 truncate">
                        {isAdminMode ? 'Kurum ili ve başlık etiketi' : 'Hava durumu ve konum ili'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={locatingSun}
                      onClick={async () => {
                        setLocatingSun(true);
                        try {
                          const coords = await requestCurrentLocation(10000);
                          const nearest = findNearestProvinceByCoords(coords.lat, coords.lng);
                          onUpdateSettings({
                            ...settings,
                            weatherCity: nearest.name,
                            autoThemeLat: coords.lat,
                            autoThemeLng: coords.lng,
                          });
                          showTemporaryFeedback(`${nearest.name} seçildi`);
                        } catch {
                          showTemporaryFeedback('Konum izni alınamadı');
                        } finally {
                          setLocatingSun(false);
                        }
                      }}
                      className={`px-2 py-1.5 rounded-xl text-[11px] font-bold border flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                        isLight
                          ? 'bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-700'
                          : 'bg-sky-950/60 hover:bg-sky-900/70 border-sky-500/40 text-sky-300'
                      }`}
                      title="GPS ile Bul"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>{locatingSun ? '...' : 'GPS'}</span>
                    </button>

                    <select
                      value={settings.weatherCity || DEFAULT_WEATHER_CITY}
                      onChange={(e) => {
                        const nextCity = e.target.value;
                        onUpdateSettings({ ...settings, weatherCity: nextCity });
                        showTemporaryFeedback(`${nextCity} seçildi`);
                      }}
                      aria-label="Bulunulan İl Seçimi"
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border outline-none cursor-pointer shrink-0 max-w-[120px] ${
                        isLight
                          ? 'bg-slate-100 border-slate-200 text-slate-900'
                          : 'bg-slate-800/90 border-slate-700 text-white'
                      }`}
                    >
                      {TURKISH_PROVINCES.map((prov) => (
                        <option
                          key={prov.plate}
                          value={prov.name}
                          className="bg-slate-900 text-white"
                        >
                          {prov.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sadece Personel Modunda: Açılış Sekmesi Tercihi */}
                {!isAdminMode && (
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={iconBoxClass('indigo')}>
                        <Sun className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold">Açılış Sayfası</div>
                        <div className="text-[10.5px] text-slate-400 truncate">
                          Uygulama açıldığında ilk gösterilecek ekran
                        </div>
                      </div>
                    </div>
                    <div
                      className={`flex items-center p-0.5 rounded-xl border shrink-0 ${
                        isLight
                          ? 'bg-slate-100 border-slate-200/80'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ ...settings, defaultStartTab: 'home' });
                          showTemporaryFeedback('Nöbet ekranı seçildi');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                          (settings.defaultStartTab || 'home') === 'home'
                            ? isLight
                              ? 'bg-slate-900 text-white shadow-2xs'
                              : 'bg-emerald-500 text-slate-950 shadow-2xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Nöbet
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ ...settings, defaultStartTab: 'calendar' });
                          showTemporaryFeedback('Takvim seçildi');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                          settings.defaultStartTab === 'calendar'
                            ? isLight
                              ? 'bg-slate-900 text-white shadow-2xs'
                              : 'bg-emerald-500 text-slate-950 shadow-2xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Takvim
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* =================================================================
                3. BİLDİRİMLER & NÖBET HATIRLATICISI
               ================================================================= */}
            <section>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Bildirimler
                </span>
              </div>

              <div className={`rounded-2xl border p-3.5 flex flex-col gap-2.5 ${cardBoxClass}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={iconBoxClass('emerald')}>
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Nöbet Hatırlatıcı</div>
                      <div className="text-[10.5px] text-slate-400 truncate">
                        Vardiya başlamadan önce bildirim gönderir
                      </div>
                    </div>
                  </div>

                  {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await requestSystemNotificationPermission();
                        setNotifPermission(res);
                        showTemporaryFeedback(
                          res === 'granted' ? 'Bildirim izni açıldı' : 'Tarayıcıdan izin verin'
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10.5px] font-bold bg-sky-600 hover:bg-sky-500 text-white transition cursor-pointer shrink-0"
                    >
                      İzni Aç
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: 'Kapalı', val: 0 },
                    { label: '15 dk', val: 15 },
                    { label: '30 dk', val: 30 },
                    { label: '1 saat', val: 60 },
                    { label: '2 saat', val: 120 },
                  ].map((opt) => {
                    const currentLead = settings.reminderMinutesBefore ?? 30;
                    const isSelected = currentLead === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={async () => {
                          if (opt.val > 0 && notifPermission === 'default') {
                            const res = await requestSystemNotificationPermission();
                            setNotifPermission(res);
                          }
                          onUpdateSettings({
                            ...settings,
                            reminderMinutesBefore: opt.val,
                          });
                          showTemporaryFeedback(
                            opt.val === 0
                              ? 'Hatırlatıcı kapatıldı'
                              : opt.val >= 60
                              ? `${opt.val / 60} saat önce`
                              : `${opt.val} dk önce`
                          );
                        }}
                        className={`py-1.5 px-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                          isSelected
                            ? opt.val === 0
                              ? 'bg-rose-600 text-white shadow-2xs'
                              : primaryBtnClass
                            : secondaryBtnClass
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* =================================================================
                4. VERİ, SENKRONİZASYON VE HESAP İŞLEMLERİ
               ================================================================= */}
            <section>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Veri ve Hesap
                </span>
              </div>

              <div className={`rounded-2xl border px-3.5 ${cardBoxClass} ${listDivideClass}`}>
                {onResyncFromServer && (
                  <button
                    type="button"
                    disabled={isResyncingServer}
                    onClick={async () => {
                      setIsResyncingServer(true);
                      try {
                        await onResyncFromServer();
                      } finally {
                        setIsResyncingServer(false);
                      }
                    }}
                    className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={iconBoxClass('emerald')}>
                        <RefreshCw
                          className={`w-4 h-4 ${isResyncingServer ? 'animate-spin' : ''}`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold">
                          {isResyncingServer ? 'Veriler Yenileniyor...' : 'Verileri Senkronize Et'}
                        </div>
                        <div className="text-[10.5px] text-slate-400 truncate">
                          Güncel kurum ve nöbet listesini yenile
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition shrink-0" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActivePage('backup')}
                  className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={iconBoxClass('sky')}>
                      <Database className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Yedekleme ve Geri Yükleme</div>
                      <div className="text-[10.5px] text-slate-400 truncate">
                        Verilerinizi yedek dosyası olarak indirin veya yükleyin
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setActivePage('about')}
                  className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={iconBoxClass('indigo')}>
                      <Info className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold">Uygulama Hakkında</div>
                      <div className="text-[10.5px] text-slate-400 truncate">
                        Sürüm ve geliştirici bilgileri
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-sky-500 transition shrink-0">
                    <span className="text-[11px] font-semibold">v3.0</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>

                {onOpenFirstLaunchScreen && (
                  <button
                    type="button"
                    onClick={onOpenFirstLaunchScreen}
                    className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={iconBoxClass('amber')}>
                        <LogOut className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold">Giriş Ekranına Dön / Hesap Değiştir</div>
                        <div className="text-[10.5px] text-slate-400 truncate">
                          Personel veya yönetici giriş ekranına geç
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-amber-500 transition shrink-0" />
                  </button>
                )}
              </div>
            </section>
          </div>
        );
      })()}

      {/* =====================================================================
          SUB-PAGE 0: KULLANICI PROFİLLERİ VE OTOMATİK GRUP EŞLEŞTİRME
         ===================================================================== */}
      {activePage === 'profiles' && (
        <div className="pb-6 animate-fade-in">
          <ProfileManagerModal
            profiles={profiles}
            activeProfileId={activeProfileId}
            settings={settings}
            activeRefHistory={refHistory}
            isLight={isLight}
            activeUnit={activeUnit}
            activeUnitProfileLocks={activeUnitProfileLocks}
            currentUser={currentUser}
            isAuthorizedAdmin={isAuthorizedAdmin}
            onTriggerToast={onTriggerToast}
            onSelectProfile={(id) => {
              onSelectProfile(id);
              showTemporaryFeedback('Aktif profil değiştirildi ✓');
            }}
            onSaveProfile={(prof, updatedSettings, makeActive) => {
              onSaveProfile(prof, updatedSettings, makeActive);
              showTemporaryFeedback(`${prof.name} profili onaylandı ✓`);
            }}
            onDeleteProfile={(id) => {
              onDeleteProfile(id);
              showTemporaryFeedback('Profil silindi');
            }}
            inlineMode={true}
          />
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 4: BECAYİŞ VE NOTLAR
         ===================================================================== */}
      {activePage === 'notes' && (() => {
        const groupedNotes = groupConsecutiveRecords(notes);
        return (
        <div className="flex flex-col gap-4 pb-4 animate-fade-in">
          <div className="flex items-center gap-1">
            {[
              { id: 'list' as const, label: `Kayıtlar (${groupedNotes.length})` },
              { id: 'add' as const, label: 'Yeni Ekle' },
              ...(isAdminMode
                ? [{ id: 'chain' as const, label: `Referanslar (${refHistory.length})` }]
                : []),
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
              {groupedNotes.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Henüz kayıtlı becayiş veya not bulunmuyor.
                </div>
              ) : (
                groupedNotes.map((grp) => {
                  const hasCloudNote = grp.items.some((it) => Boolean(it.cloudNoteId));
                  return (
                    <div key={grp.key} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold font-mono tabular-nums">
                            {grp.startDate === grp.endDate
                              ? trDateFormatter(grp.startDate)
                              : `${trDateFormatter(grp.startDate)} – ${trDateFormatter(grp.endDate)}`}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-xs font-bold text-emerald-500">
                            {grp.dayCount} Gün
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-xs font-bold text-sky-500">{grp.type}</span>
                          {grp.swapWithPerson && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400">
                              🔄 {grp.personName ? `${grp.personName} ⇄ ` : ''}
                              {grp.swapWithPerson}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">{grp.desc}</div>
                      </div>
                      {!hasCloudNote && (
                        <button
                          type="button"
                          onClick={() => {
                            const removeIds = new Set(grp.items.map((it) => it.id));
                            const updated = notes.filter((it) => !removeIds.has(it.id));
                            onSaveNotes(updated, refHistory);
                            showTemporaryFeedback('Silindi');
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                          title={grp.dayCount > 1 ? `${grp.dayCount} Günlük Kaydı Sil` : 'Kaydı Sil'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {notesTab === 'add' && (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">
                    {noteType === 'Nöbet Değişimi' ? 'Devredilen Nöbet Tarihi' : 'Tarih'}
                  </label>
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

              {noteType === 'Nöbet Değişimi' && (() => {
                // Karşılık gününde nöbetçi olan grubu ve personellerini bul
                let targetGroupTitle = '';
                let targetGroupPeople: string[] = [];
                if (refHistory.length > 0 && swapTargetDate) {
                  for (let g = 0; g < settings.numGroups; g++) {
                    const gInfo = querySingleDayForGroup(swapTargetDate, g, settings, refHistory, []);
                    const matched = settings.is24HourSystem
                      ? Boolean(gInfo.dayShift || gInfo.nightShift)
                      : swapShiftType === 'GUNDUZ'
                      ? Boolean(gInfo.dayShift)
                      : Boolean(gInfo.nightShift);
                    if (matched) {
                      targetGroupTitle = settings.groupNames[g] || `${g + 1}. Grup`;
                      targetGroupPeople = (settings.groupMembers[g] || '')
                        .split(/[,;\n]+/)
                        .map((p) => formatTitleCaseTR(p))
                        .filter(Boolean);
                      break;
                    }
                  }
                }

                const myGroupPeople = (settings.groupMembers[activeGroupIdx] || '')
                  .split(/[,;\n]+/)
                  .map((p) => formatTitleCaseTR(p))
                  .filter(Boolean);

                return (
                  <div
                    className={`p-3 rounded-xl border flex flex-col gap-3 ${
                      isLight
                        ? 'bg-slate-50 border-slate-200/80'
                        : 'bg-slate-900/50 border-slate-800'
                    }`}
                  >
                    <div className="grid grid-cols-2 gap-2.5">
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
                            ☀️ Gündüz
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
                            🌙 Gece
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Nöbet Değişimi Yapılan Kişi */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-500/10">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-emerald-500">
                          Nöbet Değişimi Yapılan Kişi
                        </label>
                        {targetGroupTitle && (
                          <span className="text-[10px] font-semibold text-slate-400">
                            Hedef Grup: {targetGroupTitle}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={swapWithPerson}
                        onChange={(e) => setSwapWithPerson(e.target.value)}
                        placeholder="Değişim yapılan kişinin adı (Örn: Ahmet Yılmaz)..."
                        className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                      />
                      {targetGroupPeople.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {targetGroupPeople.map((person) => {
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
                                    ? 'bg-emerald-600 text-white'
                                    : secondaryBtnClass
                                }`}
                              >
                                {person}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Kendi Grubumdan Değişen Personel */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-500/10">
                      <label className="text-[11px] font-semibold text-slate-400">
                        Kendi Grubunuzdan Değişen Personel (Sizin İsminiz)
                      </label>
                      <input
                        type="text"
                        value={swapMyPerson}
                        onChange={(e) => setSwapMyPerson(e.target.value)}
                        placeholder="Kendi isminiz (Örn: Tufan Uysal)..."
                        className={`w-full p-2 rounded-lg text-xs font-semibold border outline-none ${inputClass}`}
                      />
                      {myGroupPeople.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {myGroupPeople.map((person) => {
                            const isSel =
                              swapMyPerson.trim().toLocaleLowerCase('tr-TR') ===
                              person.toLocaleLowerCase('tr-TR');
                            return (
                              <button
                                key={person}
                                type="button"
                                onClick={() => setSwapMyPerson(person)}
                                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-semibold transition cursor-pointer ${
                                  isSel ? 'bg-sky-600 text-white' : secondaryBtnClass
                                }`}
                              >
                                {person}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

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

              {isAdminMode && (
                <>
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
                </>
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

          {isAdminMode && notesTab === 'chain' && (
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
        );
      })()}

      {/* =====================================================================
          SUB-PAGE 5: YEDEKLEME VE GERİ YÜKLEME (SADE STANDART TASARIM)
         ===================================================================== */}
      {activePage === 'backup' && (
        <div className="flex flex-col gap-4 pb-4 animate-fade-in">
          <div
            className={`p-4 rounded-2xl border flex flex-col gap-3 ${
              isLight
                ? 'bg-white border-slate-200/85 shadow-2xs'
                : 'bg-slate-900/55 border-slate-800/85'
            }`}
          >
            <div>
              <div className="text-xs font-extrabold">Yedek Dosyası İndir</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Nöbet ayarlarınızı, profilinizi ve takvim notlarınızı cihazınıza yedek dosyası olarak kaydedin.
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadBackup}
              className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition ${primaryBtnClass}`}
            >
              <Download className="w-4 h-4" />
              <span>Yedek Dosyasını Cihaza İndir</span>
            </button>
          </div>

          <div
            className={`p-4 rounded-2xl border flex flex-col gap-3 ${
              isLight
                ? 'bg-white border-slate-200/85 shadow-2xs'
                : 'bg-slate-900/55 border-slate-800/85'
            }`}
          >
            <div>
              <div className="text-xs font-extrabold">Yedek Dosyasından Geri Yükle</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Daha önce indirdiğiniz yedek dosyasını seçerek ayarlarınızı ve kayıtlarınızı geri yükleyin.
              </div>
            </div>

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
              className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition ${secondaryBtnClass}`}
            >
              <Upload className="w-4 h-4 text-sky-500" />
              <span>Yedek Dosyası Seç ve Yükle</span>
            </button>
          </div>

          {/* Gelişmiş Veri Yönetimi (Yanlışlıkla Tıklamayı Önlemek İçin Gizli Alan) */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvancedResetZone((v) => !v)}
              className="w-full py-2 px-3 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-slate-300 flex items-center justify-between transition cursor-pointer"
            >
              <span>Gelişmiş Cihaz Veri Yönetimi</span>
              <span>{showAdvancedResetZone ? 'Gizle ▲' : 'Göster ▼'}</span>
            </button>

            {showAdvancedResetZone && (
              <div
                className={`mt-2 p-3.5 rounded-2xl border flex flex-col gap-2.5 animate-fade-in ${
                  isLight
                    ? 'bg-rose-50/70 border-rose-200/80'
                    : 'bg-rose-950/20 border-rose-500/25'
                }`}
              >
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Bu işlem yalnızca bu cihazdaki yerel önbelleği ve oturum tercihlerini sıfırlar.
                  Sunucudaki kurum ve nöbet verileriniz silinmez.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResetConfirmChecked(false);
                    setShowResetConfirm(true);
                  }}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Cihaz Verilerini Sıfırla...</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE 7: UYGULAMA HAKKINDA (SADE STANDART TASARIM)
         ===================================================================== */}
      {activePage === 'about' && (
        <div className="flex flex-col gap-3.5 pb-4 animate-fade-in text-xs">
          {/* App & Version Card */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
              isLight
                ? 'bg-white border-slate-200/85 text-slate-900 shadow-2xs'
                : 'bg-slate-900/55 border-slate-800/85 text-white'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/vardiya112logo.png"
                alt="Vardiya 112"
                className="w-11 h-11 rounded-2xl border border-rose-500/40 object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="font-extrabold text-sm truncate">Vardiya 112</div>
                <div className="text-slate-400 text-[11px] truncate">
                  Kurumsal Nöbet ve Vardiya Takip Sistemi
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 shrink-0">
              v3.0
            </span>
          </div>

          {/* Developer Card */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${
              isLight
                ? 'bg-white border-slate-200/85 text-slate-900 shadow-2xs'
                : 'bg-slate-900/55 border-slate-800/85 text-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-rose-500 bg-slate-800 shrink-0 flex items-center justify-center font-black text-white">
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
                <div className="font-extrabold text-xs">Tufan UYSAL</div>
                <div className="text-slate-400 text-[11px]">
                  Uygulama Geliştiricisi · Kütahya 112 AÇM
                </div>
              </div>
            </div>
          </div>

          <p
            className={`p-3.5 rounded-2xl border text-center text-[11px] leading-relaxed ${
              isLight
                ? 'bg-slate-50 border-slate-200/80 text-slate-600'
                : 'bg-slate-900/40 border-slate-800/80 text-slate-300'
            }`}
          >
            112 Acil Çağrı Merkezi, Emniyet, Jandarma, Sağlık, İtfaiye ve tüm nöbet usulü çalışan
            personelin vardiya, izin ve aylık nöbet çizelgesi takibini kolaylaştırmak amacıyla
            geliştirilmiştir.
          </p>
        </div>
      )}

      {/* =====================================================================
          SUB-PAGE: THEMES & AUTO SUNRISE/SUNSET APPEARANCE
         ===================================================================== */}
      {activePage === 'themes' && (
        <div className="flex flex-col gap-4 pb-8 animate-fade-in">
          {/* Mod Seçici (Manuel vs Gün Doğumu / Batımı) */}
          <div
            className={`grid grid-cols-2 p-1 rounded-2xl border ${
              isLight
                ? 'bg-slate-100 border-slate-200/90'
                : 'bg-slate-900/80 border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                if (settings.autoThemeEnabled) {
                  onUpdateSettings({ ...settings, autoThemeEnabled: false });
                  showTemporaryFeedback('Manuel tema modu');
                }
              }}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                !settings.autoThemeEnabled
                  ? isLight
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Manuel Tema</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!settings.autoThemeEnabled) {
                  const currentIsLight = isLightTheme(settings.theme);
                  onUpdateSettings({
                    ...settings,
                    autoThemeEnabled: true,
                    autoThemeDay:
                      settings.autoThemeDay || (currentIsLight ? settings.theme : 'light'),
                    autoThemeNight:
                      settings.autoThemeNight || (!currentIsLight ? settings.theme : 'dark'),
                  });
                  showTemporaryFeedback('Otomatik gün geçişi açıldı');
                }
              }}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                settings.autoThemeEnabled
                  ? isLight
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sunTimes.isDaytime ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-sky-400" />
              )}
              <span>Gün Doğumu / Batımı</span>
            </button>
          </div>

          {!settings.autoThemeEnabled ? (
            /* ---------------- MANUEL TEMA SEÇİMİ ---------------- */
            <div className="flex flex-col gap-4">
              {/* Karanlık Temalar */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5" />
                    Karanlık Temalar
                  </span>
                  <span className="text-[10px] text-slate-400">{darkThemes.length} tema</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {darkThemes.map((tp) => {
                    const isSelected = (settings.theme || 'dark') === tp.id;
                    return (
                      <button
                        key={tp.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            theme: tp.id,
                            autoThemeEnabled: false,
                          });
                          showTemporaryFeedback(`${tp.name} uygulandı`);
                        }}
                        className={`p-3 rounded-2xl border text-left flex flex-col gap-2.5 transition cursor-pointer ${
                          isSelected
                            ? isLight
                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                              : 'bg-slate-800/95 text-white border-sky-400 shadow-sm'
                            : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800'
                            : 'bg-slate-900/60 hover:bg-slate-800/70 border-slate-800/90 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {tp.previewSwatches.map((hex, idx) => (
                              <span
                                key={idx}
                                className="w-4 h-4 rounded-full border border-white/25"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-tight">{tp.name}</div>
                          <div
                            className={`text-[10px] mt-0.5 line-clamp-1 ${
                              isSelected ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {tp.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Aydınlık Temalar */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Sun className="w-3.5 h-3.5" />
                    Aydınlık Temalar
                  </span>
                  <span className="text-[10px] text-slate-400">{lightThemes.length} tema</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {lightThemes.map((tp) => {
                    const isSelected = (settings.theme || 'dark') === tp.id;
                    return (
                      <button
                        key={tp.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            theme: tp.id,
                            autoThemeEnabled: false,
                          });
                          showTemporaryFeedback(`${tp.name} uygulandı`);
                        }}
                        className={`p-3 rounded-2xl border text-left flex flex-col gap-2.5 transition cursor-pointer ${
                          isSelected
                            ? isLight
                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                              : 'bg-slate-800/95 text-white border-sky-400 shadow-sm'
                            : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800'
                            : 'bg-slate-900/60 hover:bg-slate-800/70 border-slate-800/90 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {tp.previewSwatches.map((hex, idx) => (
                              <span
                                key={idx}
                                className="w-4 h-4 rounded-full border border-slate-400/30"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold leading-tight">{tp.name}</div>
                          <div
                            className={`text-[10px] mt-0.5 line-clamp-1 ${
                              isSelected ? 'text-slate-300' : 'text-slate-400'
                            }`}
                          >
                            {tp.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ---------------- GÜN DOĞUMU / BATIMI OTOMATİK MOD ---------------- */
            <div className="flex flex-col gap-4">
              {/* Güneş Saatleri ve Konum Kartı */}
              <div
                className={`p-3.5 rounded-2xl border flex flex-col gap-3 ${
                  isLight
                    ? 'bg-white border-slate-200/90 shadow-xs'
                    : 'bg-slate-900/65 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold">
                      {sunTimes.isDaytime ? 'Şu an Gündüz Modu Aktif' : 'Şu an Gece Modu Aktif'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {sunTimes.isDaytime
                        ? `Saat ${sunTimes.sunsetText} olunca gece temasına geçer`
                        : `Saat ${sunTimes.sunriseText} olunca gündüz temasına geçer`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={locatingSun}
                      onClick={async () => {
                        setLocatingSun(true);
                        try {
                          const coords = await requestCurrentLocation(10000);
                          const nearest = findNearestProvinceByCoords(coords.lat, coords.lng);
                          onUpdateSettings({
                            ...settings,
                            autoThemeLat: coords.lat,
                            autoThemeLng: coords.lng,
                            weatherCity: nearest.name,
                          });
                          showTemporaryFeedback(`Konum güncellendi (${nearest.name})`);
                        } catch (err) {
                          showTemporaryFeedback(
                            err instanceof Error ? err.message : 'Konum izni alınamadı'
                          );
                        } finally {
                          setLocatingSun(false);
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                        isLight
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 text-amber-500" />
                      <span>
                        {locatingSun
                          ? 'Alınıyor...'
                          : sunTimes.usingCustomLocation
                          ? 'Konum Güncel'
                          : 'Konum Kullan'}
                      </span>
                    </button>

                    {sunTimes.usingCustomLocation && (
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            autoThemeLat: undefined,
                            autoThemeLng: undefined,
                          });
                          showTemporaryFeedback('Varsayılan konuma dönüldü');
                        }}
                        className="px-2 py-1.5 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-rose-400 transition cursor-pointer"
                      >
                        Sıfırla
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`p-2.5 rounded-xl flex items-center gap-2.5 ${
                      isLight ? 'bg-amber-50/80' : 'bg-slate-800/60'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                    <div>
                      <div className="text-[10px] text-slate-400 font-medium">Gün Doğumu</div>
                      <div className="text-sm font-black tabular-nums">{sunTimes.sunriseText}</div>
                    </div>
                  </div>
                  <div
                    className={`p-2.5 rounded-xl flex items-center gap-2.5 ${
                      isLight ? 'bg-indigo-50/80' : 'bg-slate-800/60'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <div className="text-[10px] text-slate-400 font-medium">Gün Batımı</div>
                      <div className="text-sm font-black tabular-nums">{sunTimes.sunsetText}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Gündüz Teması Seçimi */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-0.5 flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  Gündüz Kullanılacak Tema
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  {lightThemes.map((tp) => {
                    const activeDay = (settings.autoThemeDay || 'light') === tp.id;
                    return (
                      <button
                        key={tp.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ ...settings, autoThemeDay: tp.id });
                          showTemporaryFeedback(`Gündüz teması: ${tp.name}`);
                        }}
                        className={`p-3 rounded-2xl border text-left flex flex-col gap-2 transition cursor-pointer ${
                          activeDay
                            ? isLight
                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                              : 'bg-slate-800/95 text-white border-amber-400 shadow-sm'
                            : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800'
                            : 'bg-slate-900/60 hover:bg-slate-800/70 border-slate-800/90 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {tp.previewSwatches.map((hex, idx) => (
                              <span
                                key={idx}
                                className="w-3.5 h-3.5 rounded-full border border-slate-400/30"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                          {activeDay && (
                            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs font-bold leading-tight">{tp.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gece Teması Seçimi */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-0.5 flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-sky-400" />
                  Gece Kullanılacak Tema
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  {darkThemes.map((tp) => {
                    const activeNight = (settings.autoThemeNight || 'dark') === tp.id;
                    return (
                      <button
                        key={tp.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ ...settings, autoThemeNight: tp.id });
                          showTemporaryFeedback(`Gece teması: ${tp.name}`);
                        }}
                        className={`p-3 rounded-2xl border text-left flex flex-col gap-2 transition cursor-pointer ${
                          activeNight
                            ? isLight
                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                              : 'bg-slate-800/95 text-white border-sky-400 shadow-sm'
                            : isLight
                            ? 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-800'
                            : 'bg-slate-900/60 hover:bg-slate-800/70 border-slate-800/90 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {tp.previewSwatches.map((hex, idx) => (
                              <span
                                key={idx}
                                className="w-3.5 h-3.5 rounded-full border border-white/25"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                          {activeNight && (
                            <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs font-bold leading-tight">{tp.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RESET CONFIRMATION DIALOG */}
      {showResetConfirm && (
        <div
          onClick={() => {
            setShowResetConfirm(false);
            setResetConfirmChecked(false);
          }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-xs rounded-2xl p-5 border shadow-2xl animate-fade-in ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-[#111622] border-slate-800 text-white'
            }`}
          >
            <div className="flex items-center gap-2 text-rose-500 mb-1.5">
              <Trash2 className="w-4 h-4 shrink-0" />
              <div className="text-sm font-extrabold">Veri Sıfırlama Onayı</div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Bu cihazdaki yerel önbellek ve oturum bilgileriniz temizlenecektir. Sunucuya kayıtlı
              kurum, personel, nöbet ve izin verileriniz silinmez.
            </p>

            <label
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-[11px] font-semibold mb-4 cursor-pointer select-none ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-slate-900/70 border-slate-800 text-slate-200'
              }`}
            >
              <input
                type="checkbox"
                checked={resetConfirmChecked}
                onChange={(e) => setResetConfirmChecked(e.target.checked)}
                className="mt-0.5 rounded accent-rose-600 cursor-pointer"
              />
              <span>Cihazdaki yerel uygulama verilerini sıfırlamayı onaylıyorum.</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetConfirmChecked(false);
                }}
                className={`py-2 rounded-xl text-xs font-semibold cursor-pointer ${secondaryBtnClass}`}
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!resetConfirmChecked}
                onClick={() => {
                  if (!resetConfirmChecked) return;
                  setShowResetConfirm(false);
                  setResetConfirmChecked(false);
                  setShowAdvancedResetZone(false);
                  onResetAll();
                  setActivePage('main');
                }}
                className="py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-35 disabled:cursor-not-allowed text-white cursor-pointer transition"
              >
                Onayla ve Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
