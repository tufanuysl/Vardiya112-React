import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, getLastGoogleIdToken, signInBureauWithGoogle } from './firebase';
import {
  AppRoleMode,
  AppSettings,
  AuthorizedAdminDoc,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  UnitAnnouncementDoc,
  UnitLeaveRequestDoc,
  UnitRosterNoteDoc,
  UserCloudProfileDoc,
  UserProfile,
} from './types';
import {
  loadStoredSettings,
  saveStoredSettings,
  loadStoredRefHistory,
  saveStoredRefHistory,
  loadStoredNotes,
  saveStoredNotes,
  loadStoredConfigured,
  saveStoredConfigured,
  loadStoredProfiles,
  saveStoredProfiles,
  loadActiveProfileId,
  saveActiveProfileId,
  findMatchingGroupByName,
  resetAllStorage,
  DEFAULT_SETTINGS,
  DEFAULT_REFS,
} from './storage';
import {
  toISODate,
  querySingleDayForGroup,
  addMinutes,
  formatTimeHHMM,
  isSamePersonNameTR,
  verifyGoogleAccountMatchesPerson,
} from './shiftEngine';
import { HomeTab } from './components/HomeTab';
import { CalendarTab } from './components/CalendarTab';
import { SettingsTab } from './components/SettingsTab';
import { QuickNoteModal } from './components/QuickNoteModal';
import { DeveloperInfoModal } from './components/DeveloperInfoModal';
import { BuiltInTestModal } from './components/BuiltInTestModal';
import { ProfileManagerModal } from './components/ProfileManagerModal';
import { ShiftRosterTableModal } from './components/ShiftRosterTableModal';
import { BureauAdminModal } from './components/BureauAdminModal';
import { FirstLaunchAuthScreen } from './components/FirstLaunchAuthScreen';
import { ToastNotification, ToastMessage } from './components/ToastNotification';
import { getThemePreset, resolveEffectiveThemeId } from './themes';
import {
  addUnitAnnouncementToCloud,
  applyUnitDocToLocalState,
  convertCloudNotesToLocalNotes,
  deleteUnitAnnouncementFromCloud,
  fetchAllUnitsFromServer,
  getInstitutionMeta,
  isUserSuperAdmin,
  saveUserCloudProfileToCloud,
  subscribeToActiveUnit,
  subscribeToAllUnits,
  subscribeToMyAdminDoc,
  subscribeToUserCloudProfile,
  syncUnitSettingsToCloud,
} from './services/institutionUnitService';
import {
  Bell,
  Building2,
  Check,
  Crown,
  Download,
  FileText,
  Megaphone,
  Paperclip,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

export const App: React.FC = () => {
  // Read localStorage once on initial boot (instead of parsing JSON redundantly across 6 hooks)
  const initialBootRef = React.useRef<{
    configured: boolean;
    settings: AppSettings;
    refHistory: RefRecord[];
    notes: NoteItem[];
    profiles: UserProfile[];
    activeProfileId: string;
  } | null>(null);
  if (!initialBootRef.current) {
    const bootSettings = loadStoredSettings();
    const bootRefs = loadStoredRefHistory();
    const bootNotes = loadStoredNotes();
    const bootProfiles = loadStoredProfiles(bootSettings, bootRefs, bootNotes);
    initialBootRef.current = {
      configured: loadStoredConfigured(),
      settings: bootSettings,
      refHistory: bootRefs,
      notes: bootNotes,
      profiles: bootProfiles,
      activeProfileId: loadActiveProfileId(bootProfiles),
    };
  }
  const boot = initialBootRef.current;

  const [configured, setConfigured] = useState<boolean>(boot.configured);
  const [settings, setSettings] = useState<AppSettings>(boot.settings);
  const [refHistory, setRefHistory] = useState<RefRecord[]>(boot.refHistory);
  const [notes, setNotes] = useState<NoteItem[]>(boot.notes);

  const [profiles, setProfiles] = useState<UserProfile[]>(boot.profiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(boot.activeProfileId);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);

  // Minimal 2-Tab Navigation: 'home' | 'calendar' (initializes from user's preferred defaultStartTab)
  const [activeTab, setActiveTab] = useState<'home' | 'calendar'>(() =>
    boot.settings.defaultStartTab === 'calendar' ? 'calendar' : 'home'
  );
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const swipeStartRef = React.useRef<{
    x: number;
    y: number;
    active: boolean;
    locked: 'x' | 'y' | null;
  } | null>(null);
  const didSwipeDragRef = React.useRef<boolean>(false);
  const dockLongPressTimerRef = React.useRef<number | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Live Duty Clock & Manual Date/Time
  const [isLiveDutyMode, setIsLiveDutyMode] = useState<boolean>(true);
  const [dutyQueryDate, setDutyQueryDate] = useState<string>(() => toISODate(new Date()));
  const [dutyQueryTime, setDutyQueryTime] = useState<string>(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [singleQueryDate, setSingleQueryDate] = useState<string>(() => toISODate(new Date()));

  // Calendar Navigation (Defaults to -2 All Groups if logged in as Admin / İdari Büro)
  const now = new Date();
  const [calendarYear, setCalendarYear] = useState<number>(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(now.getMonth() + 1);
  const [calendarGroupIdx, setCalendarGroupIdx] = useState<number>(() =>
    boot.settings.appRoleMode === 'admin' ? -2 : -1
  );

  // First-Launch Full-Screen Login & Role Selection Gate (blocks main UI until completed)
  const [showFirstLaunchAuth, setShowFirstLaunchAuth] = useState<boolean>(
    () => !boot.settings.onboardingCompleted
  );

  // Modals
  const [showDevModal, setShowDevModal] = useState<boolean>(false);
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [showRosterTable, setShowRosterTable] = useState<boolean>(false);
  const [showBureauModal, setShowBureauModal] = useState<boolean>(false);
  const [bureauInitialSection, setBureauInitialSection] = useState<
    'units' | 'identity' | 'shift_ref' | 'personnel' | 'records' | 'admins'
  >('units');
  const [showAnnouncementModal, setShowAnnouncementModal] = useState<boolean>(false);
  const [selectedCalendarDateForNote, setSelectedCalendarDateForNote] = useState<string | null>(null);
  const [sunClockNow, setSunClockNow] = useState<Date>(() => new Date());

  // Multi-Institution Cloud Server State (Firestore) & Role State (Yönetici / Admin / Çalışan)
  const [allUnits, setAllUnits] = useState<InstitutionUnitDoc[]>([]);
  const [activeUnit, setActiveUnit] = useState<InstitutionUnitDoc | null>(null);
  const [activeUnitCloudNotes, setActiveUnitCloudNotes] = useState<UnitRosterNoteDoc[]>([]);
  const [activeUnitLeaveRequests, setActiveUnitLeaveRequests] = useState<UnitLeaveRequestDoc[]>([]);
  const [activeUnitAnnouncements, setActiveUnitAnnouncements] = useState<UnitAnnouncementDoc[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  const [authResolved, setAuthResolved] = useState<boolean>(false);
  const [myAdminDoc, setMyAdminDoc] = useState<AuthorizedAdminDoc | null>(null);
  const [adminDocResolved, setAdminDocResolved] = useState<boolean>(false);
  const [cloudUserProfile, setCloudUserProfile] = useState<UserCloudProfileDoc | null>(null);

  // Refs to prevent echo loops & stale closures during real-time Firestore sync
  const settingsRef = React.useRef<AppSettings>(settings);
  const activeUnitRef = React.useRef<InstitutionUnitDoc | null>(activeUnit);
  const configuredRef = React.useRef<boolean>(configured);
  const applyingCloudUnitRef = React.useRef<boolean>(false);
  const unitSettingsSyncTimerRef = React.useRef<number | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    activeUnitRef.current = activeUnit;
  }, [activeUnit]);

  useEffect(() => {
    configuredRef.current = configured;
  }, [configured]);

  useEffect(() => {
    return () => {
      if (unitSettingsSyncTimerRef.current !== null) {
        window.clearTimeout(unitSettingsSyncTimerRef.current);
      }
    };
  }, []);

  const [isAndroidAuthBridge, setIsAndroidAuthBridge] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('android_auth') === '1';
  });
  const [androidBridgeToken, setAndroidBridgeToken] = useState<string>(
    () => getLastGoogleIdToken() || ''
  );
  const [androidBridgeCopied, setAndroidBridgeCopied] = useState<boolean>(false);
  const [androidBridgeBusy, setAndroidBridgeBusy] = useState<boolean>(false);
  const [androidBridgeError, setAndroidBridgeError] = useState<string>('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setAuthResolved(true);
      const tok = getLastGoogleIdToken();
      if (tok) setAndroidBridgeToken(tok);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setAdminDocResolved(false);
    const unsub = subscribeToMyAdminDoc(currentUser?.email, (docData) => {
      setMyAdminDoc(docData);
      setAdminDocResolved(true);
    });
    return () => unsub();
  }, [currentUser?.email]);

  useEffect(() => {
    const unsub = subscribeToUserCloudProfile(currentUser?.uid, (prof) => {
      setCloudUserProfile(prof);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  const isSuperAdmin = useMemo(
    () => isUserSuperAdmin(currentUser?.email),
    [currentUser?.email]
  );
  const isAuthorizedAdmin = Boolean(currentUser) && (isSuperAdmin || Boolean(myAdminDoc));
  const pendingLeaveRequestsCount = useMemo(
    () => activeUnitLeaveRequests.filter((r) => r.status === 'PENDING').length,
    [activeUnitLeaveRequests]
  );

  // Toast Notification State
  const [activeToast, setActiveToast] = useState<ToastMessage | null>(null);
  const lastNotifiedKeyRef = React.useRef<string>('');

  const triggerShiftToast = useCallback(
    (title: string, message: string, type: ToastMessage['type'] = 'custom') => {
      const newToast: ToastMessage = {
        id: String(Date.now()),
        title,
        message,
        type,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setActiveToast(newToast);
    },
    []
  );

  // Live Clock and Shift Arrival Monitoring (minute-gated to save mobile CPU & battery)
  const lastCheckedMinuteRef = React.useRef<string>('');

  useEffect(() => {
    const hasNotifiedShiftKey = (key: string): boolean => {
      if (lastNotifiedKeyRef.current === key) return true;
      try {
        return window.localStorage.getItem('VARDIYA_112_LAST_REMINDER_KEY') === key;
      } catch {
        return false;
      }
    };

    const markNotifiedShiftKey = (key: string) => {
      lastNotifiedKeyRef.current = key;
      try {
        window.localStorage.setItem('VARDIYA_112_LAST_REMINDER_KEY', key);
      } catch {
        // ignore storage restrictions
      }
    };

    const checkTick = () => {
      const currentDate = new Date();
      const iso = toISODate(currentDate);
      const time = `${String(currentDate.getHours()).padStart(2, '0')}:${String(
        currentDate.getMinutes()
      ).padStart(2, '0')}`;
      const minuteKey = `${iso}_${time}`;

      if (!document.hidden && isLiveDutyMode) {
        setDutyQueryDate((prev) => (prev === iso ? prev : iso));
        setDutyQueryTime((prev) => (prev === time ? prev : time));
      }

      if (refHistory.length === 0) return;
      if (settings.appRoleMode === 'admin') return;
      if (lastCheckedMinuteRef.current === minuteKey) return;
      lastCheckedMinuteRef.current = minuteKey;

      const myDayInfo = querySingleDayForGroup(iso, null, settings, refHistory, notes);
      const gName = myDayInfo.groupName || 'Grubunuz';

      if (settings.is24HourSystem) {
        if ((myDayInfo.dayShift || myDayInfo.nightShift) && time === settings.shift24Start) {
          const key = `${iso}_${time}_24h_start`;
          if (!hasNotifiedShiftKey(key)) {
            markNotifiedShiftKey(key);
            triggerShiftToast(
              '24 Saat Nöbet Başladı',
              `${gName} için 24 saatlik nöbet görevi başladı.`,
              'day-start'
            );
          }
        }
      } else {
        if (myDayInfo.dayShift && time === settings.dayStart) {
          const key = `${iso}_${time}_day_start`;
          if (!hasNotifiedShiftKey(key)) {
            markNotifiedShiftKey(key);
            triggerShiftToast(
              'Gündüz Nöbeti Başladı',
              `${gName} için ${settings.dayStart} - ${settings.dayEnd} gündüz nöbeti başladı.`,
              'day-start'
            );
          }
        }
        if (myDayInfo.nightShift && time === settings.nightStart) {
          const key = `${iso}_${time}_night_start`;
          if (!hasNotifiedShiftKey(key)) {
            markNotifiedShiftKey(key);
            triggerShiftToast(
              'Gece Nöbeti Başladı',
              `${gName} için ${settings.nightStart} - ${settings.nightEnd} gece nöbeti başladı.`,
              'night-start'
            );
          }
        }
        if (myDayInfo.morningCarryover && time === settings.nightEnd) {
          const key = `${iso}_${time}_night_end`;
          if (!hasNotifiedShiftKey(key)) {
            markNotifiedShiftKey(key);
            triggerShiftToast(
              'Nöbet Tamamlandı',
              `Sabah ${settings.nightEnd} itibarıyla nöbet tamamlandı. İyi istirahatler!`,
              'shift-end'
            );
          }
        }
      }

      // Window-aware Shift Reminder Check (fires reliably even if phone screen was off at the exact minute)
      const leadMin = settings.reminderMinutesBefore ?? 30;
      if (leadMin > 0) {
        const candidateDates = [currentDate, addMinutes(currentDate, 24 * 60)];
        for (const candDate of candidateDates) {
          const candISO = toISODate(candDate);
          const candInfo = querySingleDayForGroup(candISO, null, settings, refHistory, notes);
          if (!candInfo.dayShift && !candInfo.nightShift) continue;

          const isNight = !settings.is24HourSystem && Boolean(candInfo.nightShift && !candInfo.dayShift);
          const targetStart = settings.is24HourSystem
            ? settings.shift24Start
            : candInfo.dayShift
            ? settings.dayStart
            : candInfo.nightShift
            ? settings.nightStart
            : null;
          if (!targetStart) continue;

          const [hh, mm] = targetStart.split(':').map((n) => parseInt(n, 10));
          if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;

          const shiftStartDT = new Date(
            candDate.getFullYear(),
            candDate.getMonth(),
            candDate.getDate(),
            hh,
            mm,
            0,
            0
          );
          const diffMin = Math.round((shiftStartDT.getTime() - currentDate.getTime()) / 60000);

          if (diffMin > 0 && diffMin <= leadMin) {
            const preKey = `${candISO}_${targetStart}_pre_${leadMin}`;
            if (!hasNotifiedShiftKey(preKey)) {
              markNotifiedShiftKey(preKey);
              const shiftLabel = settings.is24HourSystem
                ? '24 Saat'
                : isNight
                ? 'Gece'
                : 'Gündüz';
              triggerShiftToast(
                `Nöbete ${diffMin} Dakika Kaldı`,
                `${gName} ${shiftLabel} nöbetiniz saat ${targetStart} itibarıyla başlayacak.`,
                isNight ? 'night-start' : 'day-start'
              );
            }
            break;
          }
        }
      }
    };

    checkTick();
    const timer = window.setInterval(checkTick, 5000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkTick();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isLiveDutyMode, settings, refHistory, notes, triggerShiftToast]);

  const persistUserCloudProfile = useCallback(
    (
      nextSettings: AppSettings,
      targetUnit: InstitutionUnitDoc | null,
      targetRefs: RefRecord[]
    ) => {
      if (!auth.currentUser?.emailVerified) return;
      void saveUserCloudProfileToCloud({
        activeUnitId: targetUnit?.id || nextSettings.activeUnitId || '',
        activeUnitCity: targetUnit?.city || nextSettings.weatherCity || '',
        appRoleMode: nextSettings.appRoleMode === 'admin' ? 'admin' : 'personnel',
        workerName: nextSettings.activeWorkerName || cloudUserProfile?.workerName || '',
        myGroupIdx: targetRefs[0]?.myGroupIdx ?? 0,
        kvkkAccepted: Boolean(nextSettings.kvkkAccepted),
        theme: nextSettings.theme || 'dark',
        defaultStartTab: nextSettings.defaultStartTab === 'calendar' ? 'calendar' : 'home',
      }).catch(() => {
        // Non-blocking background persistence
      });
    },
    []
  );

  const scheduleAdminUnitSettingsSync = useCallback(
    (nextSettings: AppSettings, refRecord?: RefRecord | null) => {
      if (applyingCloudUnitRef.current) return;
      const unit = activeUnitRef.current;
      if (
        !unit ||
        nextSettings.appRoleMode !== 'admin' ||
        !isAuthorizedAdmin ||
        !auth.currentUser
      ) {
        return;
      }

      if (unitSettingsSyncTimerRef.current !== null) {
        window.clearTimeout(unitSettingsSyncTimerRef.current);
      }

      unitSettingsSyncTimerRef.current = window.setTimeout(() => {
        const latestUnit = activeUnitRef.current;
        if (!latestUnit) return;
        void syncUnitSettingsToCloud({
          unit: latestUnit,
          settings: nextSettings,
          refRecord: refRecord ?? null,
        }).catch(() => {
          // Error already handled inside syncUnitSettingsToCloud
        });
      }, 450);
    },
    [isAuthorizedAdmin]
  );

  const handleUpdateSettings = useCallback(
    (newSettings: AppSettings) => {
      const prevSettings = settingsRef.current;
      if (
        newSettings.defaultStartTab &&
        newSettings.defaultStartTab !== prevSettings.defaultStartTab
      ) {
        setActiveTab(newSettings.defaultStartTab);
      }
      setSettings(newSettings);
      settingsRef.current = newSettings;
      saveStoredSettings(newSettings);

      // Sync unit-level shift/group/personnel edits made in SettingsTab or PDF Importer to Firestore
      const unitConfigChanged =
        newSettings.numGroups !== prevSettings.numGroups ||
        newSettings.is24HourSystem !== prevSettings.is24HourSystem ||
        newSettings.dayStart !== prevSettings.dayStart ||
        newSettings.dayEnd !== prevSettings.dayEnd ||
        newSettings.nightStart !== prevSettings.nightStart ||
        newSettings.nightEnd !== prevSettings.nightEnd ||
        newSettings.shift24Start !== prevSettings.shift24Start ||
        newSettings.restHours !== prevSettings.restHours ||
        newSettings.dayRestHours !== prevSettings.dayRestHours ||
        newSettings.nightRestHours !== prevSettings.nightRestHours ||
        newSettings.shiftTransition !== prevSettings.shiftTransition ||
        newSettings.groupCycleMode !== prevSettings.groupCycleMode ||
        JSON.stringify(newSettings.groupNames) !== JSON.stringify(prevSettings.groupNames) ||
        JSON.stringify(newSettings.groupMembers) !== JSON.stringify(prevSettings.groupMembers);

      if (unitConfigChanged) {
        scheduleAdminUnitSettingsSync(newSettings);
      }

      // Persist personal theme / defaultStartTab preference to user's cloud profile
      if (
        newSettings.theme !== prevSettings.theme ||
        newSettings.defaultStartTab !== prevSettings.defaultStartTab
      ) {
        persistUserCloudProfile(newSettings, activeUnitRef.current, refHistoryRef.current);
      }

      // Check if active profile's name now matches a group in updated groupMembers
      const activeProf = profiles.find((p) => p.id === activeProfileId);
      if (activeProf && activeProf.name && activeProf.name !== 'Ana Profilim') {
        const match = findMatchingGroupByName(
          activeProf.name,
          newSettings.groupMembers,
          newSettings.groupNames
        );
        if (match && match.groupIdx !== activeProf.groupIdx) {
          triggerShiftToast(
            'Otomatik Grup Eşleşmesi Tespit Edildi',
            `${activeProf.name} ismi ${match.groupName} personel listesinde bulundu. Profil ekranından onaylayabilirsiniz.`,
            'custom'
          );
        }
      }
    },
    [
      profiles,
      activeProfileId,
      triggerShiftToast,
      scheduleAdminUnitSettingsSync,
      persistUserCloudProfile,
    ]
  );

  const handleSaveNotes = useCallback(
    (newNotes: NoteItem[], newRefs: RefRecord[]) => {
      const prevPrimaryRef = refHistoryRef.current[0];
      const nextPrimaryRef = newRefs[0];
      setNotes(newNotes);
      setRefHistory(newRefs);
      refHistoryRef.current = newRefs;
      saveStoredNotes(newNotes);
      saveStoredRefHistory(newRefs);
      if (newRefs.length > 0 && !configuredRef.current) {
        setConfigured(true);
        configuredRef.current = true;
        saveStoredConfigured(true);
      }

      const refChanged =
        Boolean(nextPrimaryRef) &&
        (!prevPrimaryRef ||
          prevPrimaryRef.refDate !== nextPrimaryRef.refDate ||
          prevPrimaryRef.myGroupIdx !== nextPrimaryRef.myGroupIdx ||
          prevPrimaryRef.refType !== nextPrimaryRef.refType);

      if (refChanged && nextPrimaryRef) {
        scheduleAdminUnitSettingsSync(settingsRef.current, nextPrimaryRef);
      }

      // Sync active profile's refHistory, notes, and groupIdx
      setProfiles((prev) => {
        const next = prev.map((p) =>
          p.id === activeProfileId
            ? {
                ...p,
                groupIdx: newRefs[0] ? newRefs[0].myGroupIdx : p.groupIdx,
                isGroupConfirmed: newRefs.length > 0 ? true : p.isGroupConfirmed,
                refHistory: newRefs,
                notes: newNotes,
              }
            : p
        );
        saveStoredProfiles(next);
        return next;
      });
    },
    [activeProfileId, scheduleAdminUnitSettingsSync]
  );

  const refHistoryRef = React.useRef<RefRecord[]>(refHistory);
  useEffect(() => {
    refHistoryRef.current = refHistory;
  }, [refHistory]);

  const isolateNotesForWorker = useCallback(
    (sourceNotes: NoteItem[], targetWorkerName?: string): NoteItem[] => {
      const cleanWorker = (targetWorkerName || '').trim();
      if (!cleanWorker || cleanWorker === 'Ana Profilim') {
        return [];
      }
      return (sourceNotes || []).filter((it) => {
        const np = (it.swapMyPerson || '').trim();
        const sp = (it.swapWithPerson || '').trim();
        return (
          (Boolean(np) && isSamePersonNameTR(cleanWorker, np)) ||
          (it.type === 'Nöbet Değişimi' && Boolean(sp) && isSamePersonNameTR(cleanWorker, sp))
        );
      });
    },
    []
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) return;
      const targetWorker =
        target.name && target.name.trim() !== 'Ana Profilim' ? target.name.trim() : '';

      if (
        settings.appRoleMode !== 'admin' &&
        targetWorker &&
        !verifyGoogleAccountMatchesPerson(targetWorker, currentUser).matched
      ) {
        triggerShiftToast(
          'Kimlik Eşleşmedi',
          `"${targetWorker}" profili giriş yaptığınız Google hesabının ismiyle eşleşmediği için açılamaz.`,
          'custom'
        );
        return;
      }

      const isolatedNotes = targetWorker
        ? isolateNotesForWorker(target.notes || [], targetWorker)
        : target.notes || [];

      setActiveProfileId(target.id);
      saveActiveProfileId(target.id);
      setRefHistory(target.refHistory || []);
      refHistoryRef.current = target.refHistory || [];
      setNotes(isolatedNotes);
      saveStoredRefHistory(target.refHistory || []);
      saveStoredNotes(isolatedNotes);
      setSettings((prev) => {
        const next: AppSettings = {
          ...prev,
          activeWorkerName: targetWorker || undefined,
        };
        saveStoredSettings(next);
        return next;
      });
      const hasRef = Array.isArray(target.refHistory) && target.refHistory.length > 0;
      setConfigured(hasRef);
      saveStoredConfigured(hasRef);
    },
    [profiles, settings.appRoleMode, currentUser, isolateNotesForWorker, triggerShiftToast]
  );

  const handleSaveProfile = useCallback(
    (
      savedProfile: UserProfile,
      updatedSettings?: AppSettings,
      makeActive: boolean = true
    ) => {
      const cleanProfileWorker =
        savedProfile.name && savedProfile.name.trim() !== 'Ana Profilim'
          ? savedProfile.name.trim()
          : '';

      if (
        settings.appRoleMode !== 'admin' &&
        cleanProfileWorker &&
        !verifyGoogleAccountMatchesPerson(cleanProfileWorker, currentUser).matched
      ) {
        triggerShiftToast(
          'Google Hesap İsmi Eşleşmiyor',
          `Yalnızca Google hesabınızla eşleşen kendi adınızla profil kaydedebilirsiniz.`,
          'custom'
        );
        return;
      }

      const sanitizedProfile: UserProfile = {
        ...savedProfile,
        notes: cleanProfileWorker
          ? isolateNotesForWorker(savedProfile.notes || [], cleanProfileWorker)
          : savedProfile.notes || [],
      };

      if (updatedSettings) {
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);
      }

      setProfiles((prev) => {
        const exists = prev.some((p) => p.id === sanitizedProfile.id);
        const next = exists
          ? prev.map((p) => (p.id === sanitizedProfile.id ? sanitizedProfile : p))
          : [...prev, sanitizedProfile];
        saveStoredProfiles(next);
        return next;
      });

      if (makeActive || sanitizedProfile.id === activeProfileId) {
        setActiveProfileId(sanitizedProfile.id);
        saveActiveProfileId(sanitizedProfile.id);
        setRefHistory(sanitizedProfile.refHistory || []);
        refHistoryRef.current = sanitizedProfile.refHistory || [];
        setNotes(sanitizedProfile.notes || []);
        saveStoredRefHistory(sanitizedProfile.refHistory || []);
        saveStoredNotes(sanitizedProfile.notes || []);
        const hasRef =
          Array.isArray(sanitizedProfile.refHistory) && sanitizedProfile.refHistory.length > 0;
        setConfigured(hasRef);
        saveStoredConfigured(hasRef);
      }
    },
    [activeProfileId, settings.appRoleMode, currentUser, isolateNotesForWorker, triggerShiftToast]
  );

  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      setProfiles((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((p) => p.id !== profileId);
        saveStoredProfiles(next);
        if (profileId === activeProfileId && next[0]) {
          const fallback = next[0];
          const fbWorker =
            fallback.name && fallback.name.trim() !== 'Ana Profilim'
              ? fallback.name.trim()
              : '';
          const fbNotes = fbWorker
            ? isolateNotesForWorker(fallback.notes || [], fbWorker)
            : fallback.notes || [];
          setActiveProfileId(fallback.id);
          saveActiveProfileId(fallback.id);
          setRefHistory(fallback.refHistory || []);
          refHistoryRef.current = fallback.refHistory || [];
          setNotes(fbNotes);
          saveStoredRefHistory(fallback.refHistory || []);
          saveStoredNotes(fbNotes);
          setSettings((sPrev) => {
            const nextSettings = {
              ...sPrev,
              activeWorkerName: fbWorker || undefined,
            };
            saveStoredSettings(nextSettings);
            return nextSettings;
          });
        }
        return next;
      });
    },
    [activeProfileId, isolateNotesForWorker]
  );

  const handleDeleteRef = useCallback(
    (idx: number) => {
      if (idx >= 0) {
        const updated = refHistory.filter((_, i) => i !== idx);
        setRefHistory(updated);
        refHistoryRef.current = updated;
        saveStoredRefHistory(updated);
        if (updated.length === 0) {
          setConfigured(false);
          saveStoredConfigured(false);
        }
      }
    },
    [refHistory]
  );

  const handleResetAll = useCallback(() => {
    // Cancel any pending debounced unit sync so reset never pushes empty defaults to Firestore
    if (unitSettingsSyncTimerRef.current !== null) {
      window.clearTimeout(unitSettingsSyncTimerRef.current);
      unitSettingsSyncTimerRef.current = null;
    }

    // Close all open modals cleanly so Settings never stays stuck above the login screen
    setShowSettingsModal(false);
    setShowBureauModal(false);
    setShowRosterTable(false);
    setShowProfileModal(false);
    setSelectedCalendarDateForNote(null);

    // Clear ONLY local device storage (server institutions, personnel, roster notes, and table styles remain intact!)
    resetAllStorage();
    setActiveUnit(null);
    activeUnitRef.current = null;
    setActiveUnitCloudNotes([]);
    setActiveUnitLeaveRequests([]);
    setSettings(DEFAULT_SETTINGS);
    settingsRef.current = DEFAULT_SETTINGS;
    setRefHistory(DEFAULT_REFS);
    refHistoryRef.current = DEFAULT_REFS;
    setNotes([]);
    setConfigured(false);
    configuredRef.current = false;
    const freshProfiles = loadStoredProfiles(DEFAULT_SETTINGS, DEFAULT_REFS, []);
    setProfiles(freshProfiles);
    setActiveProfileId(freshProfiles[0].id);
    setShowFirstLaunchAuth(true);

    // Force-fetch fresh institution list directly from Firestore server
    void fetchAllUnitsFromServer()
      .then((freshUnits) => {
        if (freshUnits.length > 0) {
          setAllUnits(freshUnits);
        }
      })
      .catch(() => {
        // Realtime listener will keep units synced
      });

    triggerShiftToast(
      'Cihaz Önbelleği Sıfırlandı',
      'Sunucuya kayıtlı kurum, personel, nöbet ve izin verileriniz korundu. Giriş yaptığınızda sunucudan otomatik yüklenecektir.',
      'custom'
    );
  }, [triggerShiftToast]);

  const handleResyncFromServer = useCallback(async () => {
    try {
      const freshUnits = await fetchAllUnitsFromServer();
      setAllUnits(freshUnits);
      const currentUnitId = activeUnitRef.current?.id || settingsRef.current.activeUnitId;
      if (currentUnitId) {
        const refreshed = freshUnits.find((u) => u.id === currentUnitId);
        if (refreshed) {
          setActiveUnit(refreshed);
          activeUnitRef.current = refreshed;
          applyingCloudUnitRef.current = true;
          const prev = settingsRef.current;
          const latestRefs = refHistoryRef.current;
          const preferredGrp =
            prev.appRoleMode === 'admin' ? refreshed.refGroupIdx : latestRefs[0]?.myGroupIdx;
          const { nextSettings, nextRefs } = applyUnitDocToLocalState(
            refreshed,
            prev,
            latestRefs,
            preferredGrp,
            prev.activeWorkerName
          );
          setSettings(nextSettings);
          settingsRef.current = nextSettings;
          saveStoredSettings(nextSettings);
          setRefHistory(nextRefs);
          refHistoryRef.current = nextRefs;
          saveStoredRefHistory(nextRefs);
          setConfigured(true);
          configuredRef.current = true;
          saveStoredConfigured(true);
          window.setTimeout(() => {
            applyingCloudUnitRef.current = false;
          }, 0);
        }
      }
      triggerShiftToast(
        'Sunucu Verileri Yenilendi',
        `${freshUnits.length} kurum ve güncel vardiya kayıtları sunucudan tekrar yüklendi.`,
        'custom'
      );
    } catch {
      triggerShiftToast(
        'Sunucu Bağlantı Uyarısı',
        'Sunucudan veriler alınamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
        'custom'
      );
    }
  }, [triggerShiftToast]);

  useEffect(() => {
    if (!settings.autoThemeEnabled) return;
    setSunClockNow(new Date());
    const intervalId = window.setInterval(() => {
      setSunClockNow(new Date());
    }, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setSunClockNow(new Date());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [settings.autoThemeEnabled, settings.autoThemeLat, settings.autoThemeLng]);

  // 1. Subscribe to all published InstitutionUnits in Firestore
  useEffect(() => {
    const unsub = subscribeToAllUnits((units) => {
      setAllUnits(units);
    });
    return () => unsub();
  }, []);

  // 2. Subscribe to the worker's currently active InstitutionUnit & its official bureau roster notes + leave requests + announcements
  useEffect(() => {
    const unitId = settings.activeUnitId;
    if (!unitId) {
      setActiveUnit(null);
      activeUnitRef.current = null;
      setActiveUnitCloudNotes([]);
      setActiveUnitLeaveRequests([]);
      setActiveUnitAnnouncements([]);
      return;
    }

    const unsub = subscribeToActiveUnit(
      unitId,
      (unitDoc) => {
        setActiveUnit(unitDoc);
        activeUnitRef.current = unitDoc;
        if (unitDoc) {
          applyingCloudUnitRef.current = true;
          const prev = settingsRef.current;
          const latestRefs = refHistoryRef.current;
          const activeProf =
            profiles.find((p) => p.id === activeProfileId) || profiles[0];
          const fallbackProfName =
            activeProf?.name && activeProf.name.trim() !== 'Ana Profilim'
              ? activeProf.name.trim()
              : '';
          const preferredWorker =
            prev.activeWorkerName?.trim() ||
            fallbackProfName ||
            cloudUserProfile?.workerName?.trim() ||
            undefined;
          const preferredGrp =
            prev.appRoleMode === 'admin' && !preferredWorker
              ? unitDoc.refGroupIdx
              : latestRefs[0]?.myGroupIdx;
          const { nextSettings, nextRefs } = applyUnitDocToLocalState(
            unitDoc,
            prev,
            latestRefs,
            preferredGrp,
            preferredWorker
          );
          setSettings(nextSettings);
          settingsRef.current = nextSettings;
          saveStoredSettings(nextSettings);
          setRefHistory(nextRefs);
          refHistoryRef.current = nextRefs;
          saveStoredRefHistory(nextRefs);

          // Keep the worker's active profile synchronized with any admin group transfer or reference update!
          if (prev.appRoleMode !== 'admin' && nextRefs.length > 0) {
            const newGroupIdx = nextRefs[0].myGroupIdx;
            setProfiles((prevProfiles) => {
              const updated = prevProfiles.map((p) => {
                if (
                  p.id === activeProfileId ||
                  (prev.activeWorkerName && isSamePersonNameTR(p.name, prev.activeWorkerName))
                ) {
                  return {
                    ...p,
                    groupIdx: newGroupIdx,
                    refHistory: nextRefs,
                  };
                }
                return p;
              });
              saveStoredProfiles(updated);
              return updated;
            });
          }

          if (!configuredRef.current) {
            setConfigured(true);
            configuredRef.current = true;
            saveStoredConfigured(true);
          }
          window.setTimeout(() => {
            applyingCloudUnitRef.current = false;
          }, 0);
        }
      },
      (cloudNotes) => {
        setActiveUnitCloudNotes(cloudNotes);
      },
      (leaveRequests) => {
        setActiveUnitLeaveRequests(leaveRequests);
      },
      undefined,
      (announcements) => {
        setActiveUnitAnnouncements(announcements);
      }
    );

    return () => unsub();
  }, [settings.activeUnitId, activeProfileId]);

  const handleSelectActiveUnit = useCallback(
    (unit: InstitutionUnitDoc | null, preferredGroupIdx?: number, preferredWorkerName?: string) => {
      if (!unit) {
        setActiveUnit(null);
        activeUnitRef.current = null;
        setActiveUnitCloudNotes([]);
        setActiveUnitLeaveRequests([]);
        setActiveUnitAnnouncements([]);
        const prev = settingsRef.current;
        const cleared: AppSettings = {
          ...prev,
          activeUnitId: undefined,
          activeUnitName: undefined,
          activeUnitCode: undefined,
          activeUnitType: undefined,
          activeUnitAnnouncement: undefined,
          activeWorkerName: undefined,
        };
        setSettings(cleared);
        settingsRef.current = cleared;
        saveStoredSettings(cleared);
        persistUserCloudProfile(cleared, null, refHistoryRef.current);
        return;
      }

      setActiveUnit(unit);
      activeUnitRef.current = unit;
      applyingCloudUnitRef.current = true;
      const { nextSettings, nextRefs } = applyUnitDocToLocalState(
        unit,
        settingsRef.current,
        refHistoryRef.current,
        preferredGroupIdx,
        preferredWorkerName
      );
      setSettings(nextSettings);
      settingsRef.current = nextSettings;
      saveStoredSettings(nextSettings);
      setRefHistory(nextRefs);
      refHistoryRef.current = nextRefs;
      saveStoredRefHistory(nextRefs);
      if (!configuredRef.current) {
        setConfigured(true);
        configuredRef.current = true;
        saveStoredConfigured(true);
      }
      window.setTimeout(() => {
        applyingCloudUnitRef.current = false;
      }, 0);
      persistUserCloudProfile(nextSettings, unit, nextRefs);
    },
    [persistUserCloudProfile]
  );

  const isAdminBureauMode =
    settings.appRoleMode === 'admin' && Boolean(currentUser) && isAuthorizedAdmin;
  const effectiveIsAdmin = isAdminBureauMode && isAuthorizedAdmin;
  const effectiveIsSuperAdmin = isAdminBureauMode && isSuperAdmin;

  // Enforce mandatory Google verification (both Personnel & Admin), Google-name match & KVKK acceptance (Personnel)
  useEffect(() => {
    if (!authResolved) return;
    if (!currentUser) {
      setShowBureauModal(false);
      setShowFirstLaunchAuth(true);
      return;
    }
    if (settings.appRoleMode === 'admin' && adminDocResolved && !isAuthorizedAdmin) {
      setShowBureauModal(false);
      setShowFirstLaunchAuth(true);
      return;
    }
    if (settings.appRoleMode !== 'admin') {
      if (!settings.kvkkAccepted) {
        setShowBureauModal(false);
        setShowFirstLaunchAuth(true);
        return;
      }
      const activeProfForGuard = profiles.find((p) => p.id === activeProfileId) || profiles[0];
      const guardWorkerName =
        (settings.activeWorkerName || '').trim() ||
        (activeProfForGuard?.name && activeProfForGuard.name.trim() !== 'Ana Profilim'
          ? activeProfForGuard.name.trim()
          : '');
      if (guardWorkerName && !verifyGoogleAccountMatchesPerson(guardWorkerName, currentUser).matched) {
        setShowBureauModal(false);
        setShowFirstLaunchAuth(true);
      }
    }
  }, [
    authResolved,
    adminDocResolved,
    currentUser,
    isAuthorizedAdmin,
    settings.appRoleMode,
    settings.kvkkAccepted,
    settings.activeWorkerName,
    profiles,
    activeProfileId,
  ]);

  const activateOrCreateIsolatedWorkerProfile = useCallback(
    (workerName: string, groupIdx: number, targetRefs: RefRecord[], matchedSourceLabel?: string) => {
      const cleanWorker = workerName.trim();
      if (!cleanWorker) return;

      setProfiles((prev) => {
        const existingMatch = prev.find((p) => isSamePersonNameTR(p.name, cleanWorker));
        if (existingMatch) {
          const isolated = isolateNotesForWorker(existingMatch.notes || [], cleanWorker);
          const updatedList = prev.map((p) =>
            p.id === existingMatch.id
              ? {
                  ...p,
                  name: cleanWorker,
                  groupIdx,
                  isGroupConfirmed: true,
                  matchedSource: matchedSourceLabel || p.matchedSource,
                  refHistory: targetRefs,
                  notes: isolated,
                }
              : p
          );
          saveStoredProfiles(updatedList);
          setActiveProfileId(existingMatch.id);
          saveActiveProfileId(existingMatch.id);
          setNotes(isolated);
          saveStoredNotes(isolated);
          return updatedList;
        }

        const currentActive = prev.find((p) => p.id === activeProfileId) || prev[0];
        const isCurrentPlaceholder =
          !currentActive || !currentActive.name || currentActive.name === 'Ana Profilim';

        if (isCurrentPlaceholder && currentActive) {
          const isolated = isolateNotesForWorker(currentActive.notes || [], cleanWorker);
          const updatedList = prev.map((p) =>
            p.id === currentActive.id
              ? {
                  ...p,
                  name: cleanWorker,
                  groupIdx,
                  isGroupConfirmed: true,
                  matchedSource: matchedSourceLabel || p.matchedSource,
                  refHistory: targetRefs,
                  notes: isolated,
                }
              : p
          );
          saveStoredProfiles(updatedList);
          setActiveProfileId(currentActive.id);
          saveActiveProfileId(currentActive.id);
          setNotes(isolated);
          saveStoredNotes(isolated);
          return updatedList;
        }

        // Current active profile belonged to a DIFFERENT personnel -> create a clean separate profile for this personnel with empty notes
        const newProfile: UserProfile = {
          id: `profile-${Date.now()}`,
          name: cleanWorker,
          role: '112 Personeli',
          avatarColor: 'sky',
          groupIdx,
          isGroupConfirmed: true,
          matchedSource: matchedSourceLabel || 'Kurum Girişi',
          refHistory: targetRefs,
          notes: [],
          createdAt: new Date().toISOString(),
        };
        const updatedList = [...prev, newProfile];
        saveStoredProfiles(updatedList);
        setActiveProfileId(newProfile.id);
        saveActiveProfileId(newProfile.id);
        setNotes([]);
        saveStoredNotes([]);
        return updatedList;
      });
    },
    [activeProfileId, isolateNotesForWorker]
  );

  const handleCompleteFirstLaunchLogin = useCallback(
    (params: {
      roleMode: AppRoleMode;
      selectedUnit: InstitutionUnitDoc | null;
      selectedCity?: string;
      groupIdx: number;
      workerName: string;
      localRefDate?: string;
      localRefType?: 'GUNDUZ' | 'AKSAM';
      openBureauCreator?: boolean;
      kvkkAccepted?: boolean;
    }) => {
      const {
        roleMode,
        selectedUnit,
        selectedCity,
        groupIdx,
        workerName,
        localRefDate,
        localRefType,
        openBureauCreator,
        kvkkAccepted,
      } = params;

      if (!currentUser) {
        triggerShiftToast(
          'Google Girişi Zorunlu',
          'Uygulamaya giriş yapabilmek için önce Google hesabınızla oturum açmalısınız.',
          'custom'
        );
        return;
      }

      if (roleMode === 'admin' && !isAuthorizedAdmin) {
        triggerShiftToast(
          'Google Doğrulaması Zorunlu',
          'Admin (İdari Büro) girişi yalnızca yetkili Google hesabı doğrulandıktan sonra yapılabilir.',
          'custom'
        );
        return;
      }

      if (roleMode === 'personnel' && !verifyGoogleAccountMatchesPerson(workerName, currentUser).matched) {
        triggerShiftToast(
          'Google Hesap İsmi Eşleşmiyor',
          'Seçtiğiniz personel adı Google hesabınızın ismiyle eşleşmiyor. Başka bir personelin verilerine giriş yapılamaz.',
          'custom'
        );
        return;
      }

      if (roleMode === 'personnel' && !kvkkAccepted && !settings.kvkkAccepted) {
        triggerShiftToast(
          'KVKK Onayı Zorunlu',
          'Personel girişi için KVKK Aydınlatma Metni ve Kullanım Koşullarını onaylamalısınız.',
          'custom'
        );
        return;
      }

      const consentTimestamp = settings.kvkkAcceptedAt || new Date().toISOString();

      const preservedWorkerName =
        workerName.trim() ||
        settingsRef.current.activeWorkerName?.trim() ||
        (activeProfile?.name && activeProfile.name.trim() !== 'Ana Profilim'
          ? activeProfile.name.trim()
          : '') ||
        cloudUserProfile?.workerName?.trim() ||
        '';

      if (selectedUnit) {
        setActiveUnit(selectedUnit);
        activeUnitRef.current = selectedUnit;
        const { nextSettings, nextRefs } = applyUnitDocToLocalState(
          selectedUnit,
          settingsRef.current,
          refHistoryRef.current,
          roleMode === 'admin' && !preservedWorkerName ? selectedUnit.refGroupIdx : groupIdx,
          preservedWorkerName || undefined
        );
        const finalizedSettings: AppSettings = {
          ...nextSettings,
          weatherCity: selectedCity || selectedUnit.city || nextSettings.weatherCity,
          theme: cloudUserProfile?.theme || nextSettings.theme,
          defaultStartTab: cloudUserProfile?.defaultStartTab || nextSettings.defaultStartTab,
          appRoleMode: roleMode,
          onboardingCompleted: true,
          kvkkAccepted: true,
          kvkkAcceptedAt: consentTimestamp,
        };
        setSettings(finalizedSettings);
        settingsRef.current = finalizedSettings;
        saveStoredSettings(finalizedSettings);
        setRefHistory(nextRefs);
        refHistoryRef.current = nextRefs;
        saveStoredRefHistory(nextRefs);
        setConfigured(true);
        configuredRef.current = true;
        saveStoredConfigured(true);
        persistUserCloudProfile(finalizedSettings, selectedUnit, nextRefs);

        if (roleMode === 'personnel' && workerName) {
          activateOrCreateIsolatedWorkerProfile(
            workerName,
            groupIdx,
            nextRefs,
            selectedUnit.name
          );
        }
      } else {
        const fallbackRefs: RefRecord[] =
          refHistoryRef.current.length > 0
            ? refHistoryRef.current.map((r, idx) =>
                idx === 0 ? { ...r, myGroupIdx: groupIdx } : r
              )
            : [
                {
                  validFrom: '2020-01-01',
                  myGroupIdx: groupIdx,
                  refDate: localRefDate || toISODate(new Date()),
                  refType: localRefType || 'GUNDUZ',
                },
              ];

        const finalizedSettings: AppSettings = {
          ...settingsRef.current,
          weatherCity: selectedCity || settingsRef.current.weatherCity,
          theme: cloudUserProfile?.theme || settingsRef.current.theme,
          defaultStartTab:
            cloudUserProfile?.defaultStartTab || settingsRef.current.defaultStartTab,
          activeUnitId: undefined,
          activeUnitName: undefined,
          activeUnitCode: undefined,
          activeUnitType: undefined,
          activeUnitAnnouncement: undefined,
          activeWorkerName: preservedWorkerName || undefined,
          appRoleMode: roleMode,
          onboardingCompleted: true,
          kvkkAccepted: true,
          kvkkAcceptedAt: consentTimestamp,
        };
        setActiveUnit(null);
        activeUnitRef.current = null;
        setSettings(finalizedSettings);
        settingsRef.current = finalizedSettings;
        saveStoredSettings(finalizedSettings);
        setRefHistory(fallbackRefs);
        refHistoryRef.current = fallbackRefs;
        saveStoredRefHistory(fallbackRefs);
        setConfigured(true);
        configuredRef.current = true;
        saveStoredConfigured(true);
        persistUserCloudProfile(finalizedSettings, null, fallbackRefs);

        if (roleMode === 'personnel' && workerName) {
          activateOrCreateIsolatedWorkerProfile(
            workerName,
            groupIdx,
            fallbackRefs,
            'Kişisel Kurulum'
          );
        }
      }

      setCalendarGroupIdx(roleMode === 'admin' ? -2 : -1);
      setShowFirstLaunchAuth(false);
      if (roleMode === 'admin' && openBureauCreator) {
        setShowBureauModal(true);
      } else if (roleMode !== 'admin') {
        setShowBureauModal(false);
      }

      triggerShiftToast(
        roleMode === 'admin' ? 'İdari Büro Girişi Yapıldı' : 'Personel Girişi Yapıldı',
        roleMode === 'admin'
          ? 'Genel kurum takvimi ve günlük idari büro özeti aktif edildi.'
          : `${workerName || 'Personel'} olarak nöbet takviminiz hazırlandı.`,
        'custom'
      );
    },
    [
      currentUser,
      isAuthorizedAdmin,
      settings,
      cloudUserProfile,
      persistUserCloudProfile,
      activateOrCreateIsolatedWorkerProfile,
      triggerShiftToast,
    ]
  );

  // Merge personal local notes with official bureau cloud notes for the active institution (used in full Monthly Roster Table)
  const combinedNotes = useMemo<NoteItem[]>(() => {
    if (!activeUnit || activeUnitCloudNotes.length === 0) {
      return notes;
    }
    const cloudConverted = convertCloudNotesToLocalNotes(activeUnitCloudNotes);
    return [...cloudConverted, ...notes];
  }, [notes, activeUnit, activeUnitCloudNotes]);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) || profiles[0];

  // Resolve the active individual worker name (from unit worker selection, cloud profile, active profile, or verified Google account match)
  const effectiveWorkerName = useMemo(() => {
    const profileName = (activeProfile?.name || '').trim();
    const isGenericProfileName =
      !profileName ||
      profileName === 'Ana Profilim' ||
      profileName === 'Varsayılan' ||
      profileName === 'Profil 1';

    const candidates = [
      (settings.activeWorkerName || '').trim(),
      (cloudUserProfile?.workerName || '').trim(),
      isGenericProfileName ? '' : profileName,
    ].filter(Boolean);

    const allMembers: string[] = [];
    for (let g = 0; g < settings.numGroups; g++) {
      const members = (settings.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      allMembers.push(...members);
    }

    // 1. Prefer any candidate that matches an official member in settings.groupMembers
    for (const cand of candidates) {
      const canonical = allMembers.find((m) => isSamePersonNameTR(m, cand));
      if (canonical) return canonical;
    }

    // 2. Next, check if the signed-in Google account matches an official member in settings.groupMembers
    if (currentUser && allMembers.length > 0) {
      const googleMatched = allMembers.find(
        (m) => verifyGoogleAccountMatchesPerson(m, currentUser).matched
      );
      if (googleMatched) return googleMatched;
      if (currentUser.displayName) {
        const displayMatched = allMembers.find((m) =>
          isSamePersonNameTR(m, currentUser.displayName || '')
        );
        if (displayMatched) return displayMatched;
      }
    }

    // 3. Fallback to first candidate if present
    return candidates[0] || '';
  }, [
    settings.activeWorkerName,
    settings.numGroups,
    settings.groupMembers,
    activeProfile?.name,
    cloudUserProfile?.workerName,
    currentUser,
  ]);

  // Strictly personal notes for individual calendar / home / quick-note views:
  // 1) Logging in as another personnel MUST NEVER show the previous personnel's leaves/swaps/notes!
  // 2) Another member of the same group taking leave MUST NOT appear on this user's personal calendar!
  // 3) Admin shift changes (Nöbet Değişimi, Ek Nöbet, İcap, İzin, Nöbet Boşa Çıkarma) immediately reflect on the worker's calendar!
  const personalCombinedNotes = useMemo<NoteItem[]>(() => {
    const myGroupIdx =
      refHistory && refHistory.length > 0 ? refHistory[refHistory.length - 1].myGroupIdx : 0;

    if (settings.appRoleMode === 'admin') {
      // When admin selects a specific group (calendarGroupIdx >= 0) or has an activeWorkerName, filter appropriately
      return combinedNotes.filter((it) => {
        if (effectiveWorkerName) {
          const notePerson = (it.swapMyPerson || '').trim();
          const swapPartner = (it.swapWithPerson || '').trim();
          return (
            (Boolean(notePerson) && isSamePersonNameTR(effectiveWorkerName, notePerson)) ||
            (it.type === 'Nöbet Değişimi' &&
              Boolean(swapPartner) &&
              isSamePersonNameTR(effectiveWorkerName, swapPartner))
          );
        }
        return false;
      });
    }

    return combinedNotes.filter((it) => {
      const notePerson = (it.swapMyPerson || '').trim();
      const swapPartner = (it.swapWithPerson || '').trim();

      // When logged in as a specific named personnel, ONLY notes explicitly belonging to this personnel
      // (or where this personnel is the swap partner) appear on the individual calendar.
      if (effectiveWorkerName) {
        return (
          (Boolean(notePerson) && isSamePersonNameTR(effectiveWorkerName, notePerson)) ||
          (it.type === 'Nöbet Değişimi' &&
            Boolean(swapPartner) &&
            isSamePersonNameTR(effectiveWorkerName, swapPartner))
        );
      }

      // If no worker name is set (anonymous local usage), never show cloud notes
      if (it.cloudNoteId) {
        return false;
      }

      if (typeof it.targetGroupIdx === 'number' && it.targetGroupIdx !== myGroupIdx) {
        return false;
      }

      if (notePerson) {
        return false;
      }

      return true;
    });
  }, [
    combinedNotes,
    effectiveWorkerName,
    refHistory,
    settings.appRoleMode,
  ]);

  const effectiveThemeId = useMemo(
    () => resolveEffectiveThemeId(settings, sunClockNow),
    [settings, sunClockNow]
  );
  const effectiveSettings = useMemo(() => {
    const needsTheme = settings.theme !== effectiveThemeId;
    const needsWorker =
      Boolean(effectiveWorkerName) && settings.activeWorkerName !== effectiveWorkerName;
    if (!needsTheme && !needsWorker) return settings;
    return {
      ...settings,
      theme: effectiveThemeId,
      activeWorkerName: effectiveWorkerName || settings.activeWorkerName,
    };
  }, [settings, effectiveThemeId, effectiveWorkerName]);
  const themePreset = getThemePreset(effectiveThemeId);
  const isLight = themePreset.isLight;

  useEffect(() => {
    const root = document.documentElement;
    if (themePreset.isLight) {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    root.style.setProperty('--bg-primary', themePreset.bgPrimary);
    root.style.setProperty('--text-primary', themePreset.textPrimary);
  }, [themePreset]);

  useEffect(() => {
    if (isAdminBureauMode && activeTab !== 'home') {
      setActiveTab('home');
    }
  }, [isAdminBureauMode, activeTab]);

  const finishHorizontalSwipe = () => {
    const state = swipeStartRef.current;
    if (!state || !state.active) return;
    if (!isAdminBureauMode && state.locked === 'x') {
      if (activeTab === 'home' && swipeOffset < -50) {
        setActiveTab('calendar');
      } else if (activeTab === 'calendar' && swipeOffset > 50) {
        setActiveTab('home');
      }
    }
    swipeStartRef.current = null;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  // General Announcement Notification State for Personnel (Server-persisted + Dismissible once read)
  const activeUnitKeyForAnnouncement = activeUnit?.id || settings.activeUnitId || 'default';
  const currentAnnouncement = useMemo(
    () => (activeUnit?.announcement ?? settings.activeUnitAnnouncement ?? '').trim(),
    [activeUnit?.announcement, settings.activeUnitAnnouncement]
  );

  // Build unified list of announcements (from `/units/{unitId}/announcements` subcollection + fallback summary field)
  const unifiedAnnouncements = useMemo<UnitAnnouncementDoc[]>(() => {
    if (activeUnitAnnouncements.length > 0) {
      return activeUnitAnnouncements;
    }
    if (currentAnnouncement) {
      return [
        {
          id: `legacy_${currentAnnouncement.slice(0, 32)}`,
          unitId: activeUnitKeyForAnnouncement,
          title: 'Resmi Kurum Duyurusu',
          content: currentAnnouncement,
          authorName: activeUnit?.ownerName || 'Kurum Yöneticisi',
          authorUid: activeUnit?.ownerUid || '',
          attachmentName: '',
          attachmentType: '',
          attachmentDataUrl: '',
        },
      ];
    }
    return [];
  }, [
    activeUnitAnnouncements,
    currentAnnouncement,
    activeUnitKeyForAnnouncement,
    activeUnit?.ownerName,
    activeUnit?.ownerUid,
  ]);

  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(
        `VARDIYA_112_DISMISSED_ANNS_${boot.settings.activeUnitId || 'default'}`
      );
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        `VARDIYA_112_DISMISSED_ANNS_${activeUnitKeyForAnnouncement}`
      );
      setDismissedAnnouncementIds(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setDismissedAnnouncementIds([]);
    }
  }, [activeUnitKeyForAnnouncement]);

  const persistDismissedAnnouncementIds = useCallback(
    (nextIds: string[]) => {
      setDismissedAnnouncementIds(nextIds);
      try {
        window.localStorage.setItem(
          `VARDIYA_112_DISMISSED_ANNS_${activeUnitKeyForAnnouncement}`,
          JSON.stringify(nextIds)
        );
      } catch {
        // ignore storage errors
      }
    },
    [activeUnitKeyForAnnouncement]
  );

  const unreadAnnouncements = useMemo(
    () => unifiedAnnouncements.filter((a) => !dismissedAnnouncementIds.includes(a.id)),
    [unifiedAnnouncements, dismissedAnnouncementIds]
  );

  const hasActiveAnnouncement = unifiedAnnouncements.length > 0;
  const hasUnreadAnnouncement = unreadAnnouncements.length > 0;

  const handleOpenAnnouncementModal = useCallback(() => {
    if (unifiedAnnouncements.length > 0) {
      const allIds = Array.from(
        new Set([...dismissedAnnouncementIds, ...unifiedAnnouncements.map((a) => a.id)])
      );
      persistDismissedAnnouncementIds(allIds);
    }
    setShowAnnouncementModal(true);
  }, [dismissedAnnouncementIds, unifiedAnnouncements, persistDismissedAnnouncementIds]);

  const handleDismissSingleAnnouncement = useCallback(
    (annId: string) => {
      if (dismissedAnnouncementIds.includes(annId)) return;
      const next = [...dismissedAnnouncementIds, annId];
      persistDismissedAnnouncementIds(next);
    },
    [dismissedAnnouncementIds, persistDismissedAnnouncementIds]
  );

  const handleMarkAllAnnouncementsReadAndClose = useCallback(() => {
    const allIds = Array.from(
      new Set([...dismissedAnnouncementIds, ...unifiedAnnouncements.map((a) => a.id)])
    );
    persistDismissedAnnouncementIds(allIds);
    setShowAnnouncementModal(false);
  }, [dismissedAnnouncementIds, unifiedAnnouncements, persistDismissedAnnouncementIds]);

  const handleDownloadAnnouncementAttachment = useCallback((ann: UnitAnnouncementDoc) => {
    if (!ann.attachmentDataUrl) return;
    const link = document.createElement('a');
    link.href = ann.attachmentDataUrl;
    link.download = ann.attachmentName || 'resmi_yazi.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Admin Quick Announcement Publisher State
  const [adminAnnTitle, setAdminAnnTitle] = useState<string>('');
  const [adminAnnContent, setAdminAnnContent] = useState<string>('');
  const [adminAnnAttachName, setAdminAnnAttachName] = useState<string>('');
  const [adminAnnAttachType, setAdminAnnAttachType] = useState<string>('');
  const [adminAnnAttachDataUrl, setAdminAnnAttachDataUrl] = useState<string>('');
  const [publishingAdminAnn, setPublishingAdminAnn] = useState<boolean>(false);

  const handleSelectAdminAnnouncementFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 665600) {
        triggerShiftToast(
          'Dosya Boyutu Sınırı',
          'Eklenen resmi yazı veya PDF dosyası en fazla 650 KB olabilir.',
          'custom'
        );
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (result) {
          setAdminAnnAttachName(file.name);
          setAdminAnnAttachType(file.type || 'application/pdf');
          setAdminAnnAttachDataUrl(result);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [triggerShiftToast]
  );

  const handlePublishAdminAnnouncement = useCallback(async () => {
    const targetUnitId = activeUnit?.id || settings.activeUnitId;
    if (!targetUnitId) {
      triggerShiftToast(
        'Aktif Kurum Seçilmedi',
        'Duyuru yayınlamak için önce Yönetici Panelinden bir kurum seçmeli veya oluşturmalısınız.',
        'custom'
      );
      return;
    }
    const cleanContent = adminAnnContent.trim();
    if (!cleanContent) {
      triggerShiftToast('Duyuru Metni Boş', 'Lütfen yayınlanacak duyuru metnini yazın.', 'custom');
      return;
    }
    setPublishingAdminAnn(true);
    try {
      await addUnitAnnouncementToCloud({
        unitId: targetUnitId,
        title: adminAnnTitle.trim() || 'Resmi Kurum Duyurusu',
        content: cleanContent,
        attachmentName: adminAnnAttachName,
        attachmentType: adminAnnAttachType,
        attachmentDataUrl: adminAnnAttachDataUrl,
      });
      setAdminAnnTitle('');
      setAdminAnnContent('');
      setAdminAnnAttachName('');
      setAdminAnnAttachType('');
      setAdminAnnAttachDataUrl('');
      triggerShiftToast(
        'Duyuru Sunucuya Kaydedildi',
        'Yeni kurum duyurusu tüm personellere bildirim olarak yayınlandı.',
        'custom'
      );
    } catch (err) {
      triggerShiftToast(
        'Duyuru Yayınlanamadı',
        err instanceof Error ? err.message : 'Sunucu bağlantı hatası oluştu.',
        'custom'
      );
    } finally {
      setPublishingAdminAnn(false);
    }
  }, [
    activeUnit?.id,
    settings.activeUnitId,
    adminAnnTitle,
    adminAnnContent,
    adminAnnAttachName,
    adminAnnAttachType,
    adminAnnAttachDataUrl,
    triggerShiftToast,
  ]);

  const handleDeleteAdminAnnouncement = useCallback(
    async (annId: string) => {
      const targetUnitId = activeUnit?.id || settings.activeUnitId;
      if (!targetUnitId || annId.startsWith('legacy_')) return;
      try {
        await deleteUnitAnnouncementFromCloud(targetUnitId, annId);
        triggerShiftToast('Duyuru Silindi', 'Seçilen duyuru sunucudan kaldırıldı.', 'custom');
      } catch (err) {
        triggerShiftToast(
          'Silinemedi',
          err instanceof Error ? err.message : 'Duyuru silinirken hata oluştu.',
          'custom'
        );
      }
    },
    [activeUnit?.id, settings.activeUnitId, triggerShiftToast]
  );

  return (
    <div
      style={{
        backgroundColor: themePreset.bgPrimary,
        color: themePreset.textPrimary,
      }}
      className="relative w-full h-dvh max-h-screen transition-colors duration-200 overflow-hidden flex flex-col justify-between"
    >
      {/* Toast Notification */}
      <ToastNotification
        toast={activeToast}
        onClose={() => setActiveToast(null)}
      />

      {/* FIRST-LAUNCH FULL-SCREEN LOGIN & ROLE SELECTION GATE (Blocks Main UI) */}
      {showFirstLaunchAuth && !isAndroidAuthBridge ? (
        <FirstLaunchAuthScreen
          settings={effectiveSettings}
          refHistory={refHistory}
          allUnits={allUnits}
          activeUnit={activeUnit}
          currentUser={currentUser}
          myAdminDoc={myAdminDoc}
          cloudUserProfile={cloudUserProfile}
          isSuperAdmin={isSuperAdmin}
          isAuthorizedAdmin={isAuthorizedAdmin}
          isLight={isLight}
          onCompleteLogin={handleCompleteFirstLaunchLogin}
        />
      ) : (
        <>
          {/* FLOATING NOTIFICATION BUTTON STAYING DIRECTLY ON TOP OF THE THEME */}
          {!isAdminBureauMode && hasUnreadAnnouncement && (
            <div className="fixed top-3 right-3 z-40 pointer-events-none">
              <div className="pointer-events-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleOpenAnnouncementModal}
                  title="Genel Kurum Duyurusu"
                  aria-label="Genel Kurum Duyurusu"
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-extrabold shadow-xl transition cursor-pointer bg-amber-500 text-slate-950 border-amber-300 hover:bg-amber-400"
                >
                  <Bell className="w-3.5 h-3.5 shrink-0" />
                  <span className="max-w-[140px] truncate">Genel Duyuru</span>
                  <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-black leading-none bg-slate-950 text-amber-300">
                    {unreadAnnouncements.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleMarkAllAnnouncementsReadAndClose}
                  title="Duyuru Bildirimini Kapat"
                  aria-label="Duyuru Bildirimini Kapat"
                  className={`w-7 h-7 rounded-full border flex items-center justify-center shadow-lg transition cursor-pointer ${
                    isLight
                      ? 'bg-white/95 text-slate-700 border-slate-300 hover:bg-slate-100'
                      : 'bg-slate-900/95 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* MAIN VIEWPORT (2-Page Swipe Carousel in Personnel Mode | Unified Main Screen in Admin Mode) */}
          <main
            className="flex-1 max-w-md mx-auto w-full pb-1 overflow-hidden relative z-10 flex flex-col justify-center touch-pan-y select-none"
            onTouchStart={(e) => {
              if (isAdminBureauMode) return;
              const target = e.target as HTMLElement | null;
              if (target?.closest('canvas, input, select, textarea, [data-no-swipe]')) return;
              const touch = e.touches[0];
              swipeStartRef.current = { x: touch.clientX, y: touch.clientY, active: true, locked: null };
            }}
            onTouchMove={(e) => {
              if (isAdminBureauMode) return;
              const state = swipeStartRef.current;
              if (!state || !state.active) return;
              const touch = e.touches[0];
              const dx = touch.clientX - state.x;
              const dy = touch.clientY - state.y;

              if (!state.locked) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                state.locked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
              }

              if (state.locked === 'x') {
                setIsSwiping(true);
                if ((activeTab === 'home' && dx > 0) || (activeTab === 'calendar' && dx < 0)) {
                  setSwipeOffset(dx * 0.25);
                } else {
                  setSwipeOffset(dx);
                }
              }
            }}
            onTouchEnd={finishHorizontalSwipe}
            onMouseDown={(e) => {
              if (isAdminBureauMode || e.button !== 0) return;
              const target = e.target as HTMLElement | null;
              if (target?.closest('canvas, input, select, textarea, [data-no-swipe]')) return;
              swipeStartRef.current = { x: e.clientX, y: e.clientY, active: true, locked: null };
              didSwipeDragRef.current = false;
            }}
            onMouseMove={(e) => {
              if (isAdminBureauMode) return;
              const state = swipeStartRef.current;
              if (!state || !state.active) return;
              const dx = e.clientX - state.x;
              const dy = e.clientY - state.y;

              if (!state.locked) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                state.locked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
              }

              if (state.locked === 'x') {
                didSwipeDragRef.current = true;
                setIsSwiping(true);
                if ((activeTab === 'home' && dx > 0) || (activeTab === 'calendar' && dx < 0)) {
                  setSwipeOffset(dx * 0.25);
                } else {
                  setSwipeOffset(dx);
                }
              }
            }}
            onMouseUp={finishHorizontalSwipe}
            onMouseLeave={finishHorizontalSwipe}
            onClickCapture={(e) => {
              if (didSwipeDragRef.current) {
                e.stopPropagation();
                e.preventDefault();
                didSwipeDragRef.current = false;
              }
            }}
          >
            <div
              className={`flex w-[200%] h-full will-change-transform ${
                isSwiping ? '' : 'transition-transform duration-300 ease-out'
              }`}
              style={{
                transform: `translate3d(calc(${
                  isAdminBureauMode || activeTab === 'home' ? '0%' : '-50%'
                } + ${isAdminBureauMode ? 0 : swipeOffset}px), 0, 0)`,
              }}
            >
              {/* Slide 1: Nöbet (or Unified Admin Dashboard with miniature top-left 3D Earth + Embedded Calendar) */}
              <div
                className={`w-1/2 h-full ${
                  isAdminBureauMode ? 'px-1.5 pt-3.5 sm:pt-4 pb-2.5' : 'px-4 pt-3'
                } flex flex-col justify-center overflow-visible flex-shrink-0`}
              >
                <HomeTab
                  settings={effectiveSettings}
                  refHistory={refHistory}
                  notes={personalCombinedNotes}
                  allNotes={combinedNotes}
                  isAdminBureauMode={isAdminBureauMode}
                  pendingLeaveRequestsCount={isAdminBureauMode ? pendingLeaveRequestsCount : 0}
                  activeProfileName={effectiveWorkerName || activeProfile?.name}
                  dutyQueryDate={dutyQueryDate}
                  dutyQueryTime={dutyQueryTime}
                  isLiveDutyMode={isLiveDutyMode}
                  onDutyDateChange={(d) => {
                    setIsLiveDutyMode(false);
                    setDutyQueryDate(d);
                  }}
                  onDutyTimeChange={(t) => {
                    setIsLiveDutyMode(false);
                    setDutyQueryTime(t);
                  }}
                  onResetLive={() => {
                    setIsLiveDutyMode(true);
                    const now = new Date();
                    setDutyQueryDate(toISODate(now));
                    setDutyQueryTime(
                      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
                        2,
                        '0'
                      )}`
                    );
                  }}
                  singleQueryDate={singleQueryDate}
                  onSingleDateChange={setSingleQueryDate}
                  onOpenQuickNote={(d) => setSelectedCalendarDateForNote(d)}
                  onOpenSettings={() => setShowSettingsModal(true)}
                  onOpenBureauModal={
                    isAdminBureauMode
                      ? (section = 'units') => {
                          setBureauInitialSection(section);
                          setShowBureauModal(true);
                        }
                      : undefined
                  }
                  onOpenAnnouncementModal={handleOpenAnnouncementModal}
                  calendarYear={calendarYear}
                  calendarMonth={calendarMonth}
                  calendarGroupIdx={calendarGroupIdx}
                  onMonthChange={(y, m) => {
                    setCalendarYear(y);
                    setCalendarMonth(m);
                  }}
                  onGroupChange={setCalendarGroupIdx}
                  onOpenRosterTable={() => setShowRosterTable(true)}
                  isActive={
                    (isAdminBureauMode || activeTab === 'home') &&
                    !showRosterTable &&
                    !showBureauModal &&
                    !showSettingsModal &&
                    !showProfileModal
                  }
                />
              </div>

              {/* Slide 2: Takvim (Personnel Mode) */}
              <div className="w-1/2 h-full px-2.5 pt-3 flex flex-col justify-center overflow-hidden flex-shrink-0">
                <CalendarTab
                  settings={effectiveSettings}
                  refHistory={refHistory}
                  notes={personalCombinedNotes}
                  allNotes={combinedNotes}
                  isAdminBureauMode={isAdminBureauMode}
                  pendingLeaveRequestsCount={isAdminBureauMode ? pendingLeaveRequestsCount : 0}
                  calendarYear={calendarYear}
                  calendarMonth={calendarMonth}
                  calendarGroupIdx={calendarGroupIdx}
                  onMonthChange={(y, m) => {
                    setCalendarYear(y);
                    setCalendarMonth(m);
                  }}
                  onGroupChange={setCalendarGroupIdx}
                  onDayClick={(iso) => setSelectedCalendarDateForNote(iso)}
                  singleQueryDate={singleQueryDate}
                  dutyQueryTime={dutyQueryTime}
                  isLiveDutyMode={isLiveDutyMode}
                  onSingleDateChange={setSingleQueryDate}
                  onDutyDateChange={(d) => {
                    setIsLiveDutyMode(false);
                    setDutyQueryDate(d);
                  }}
                  onDutyTimeChange={(t) => {
                    setIsLiveDutyMode(false);
                    setDutyQueryTime(t);
                  }}
                  onResetLive={() => {
                    setIsLiveDutyMode(true);
                    const now = new Date();
                    setDutyQueryDate(toISODate(now));
                    setDutyQueryTime(
                      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
                        2,
                        '0'
                      )}`
                    );
                  }}
                  onOpenRosterTable={() => setShowRosterTable(true)}
                  onOpenBureauModal={
                    isAdminBureauMode
                      ? (section = 'units') => {
                          setBureauInitialSection(section);
                          setShowBureauModal(true);
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </main>

      {/* THUMB-FRIENDLY BOTTOM NAVIGATION DOCK (Personnel Mode Only — Admin Mode has no bottom dock) */}
      {!isAdminBureauMode && (
        <div className="w-full flex justify-center pb-3 pt-1 px-3 flex-shrink-0 z-30 no-share relative">
          <nav
            className={`w-full max-w-md flex items-center justify-between gap-1 p-1.5 rounded-full border shadow-lg transition-all ${themePreset.dockBgClass}`}
          >
            <button
              type="button"
              onPointerDown={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
                dockLongPressTimerRef.current = window.setTimeout(() => {
                  handleUpdateSettings({ ...settings, defaultStartTab: 'home' });
                  setActiveTab('home');
                  triggerShiftToast(
                    'Nöbet Ekranı Ana Sayfa Yapıldı',
                    'Uygulama açılışında ilk olarak Nöbet sayfası açılacak.',
                    'custom'
                  );
                }, 550);
              }}
              onPointerUp={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
              }}
              onPointerLeave={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
              }}
              onClick={() => setActiveTab('home')}
              title="Nöbet Ana Ekranı"
              className={`flex-1 py-2 px-2.5 rounded-full text-xs font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                activeTab === 'home'
                  ? themePreset.dockActiveBtnClass
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <span className="text-sm leading-none">🚨</span>
              <span>Nöbet</span>
              {(settings.defaultStartTab || 'home') === 'home' && (
                <span className="text-[9px] text-amber-400 leading-none" title="Varsayılan Ana Sayfa">
                  ★
                </span>
              )}
            </button>

            <button
              type="button"
              onPointerDown={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
                dockLongPressTimerRef.current = window.setTimeout(() => {
                  handleUpdateSettings({ ...settings, defaultStartTab: 'calendar' });
                  setActiveTab('calendar');
                  triggerShiftToast(
                    'Takvim Ana Sayfa Yapıldı',
                    'Uygulama açılışında ilk olarak Takvim sayfası açılacak.',
                    'custom'
                  );
                }, 550);
              }}
              onPointerUp={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
              }}
              onPointerLeave={() => {
                if (dockLongPressTimerRef.current) window.clearTimeout(dockLongPressTimerRef.current);
              }}
              onClick={() => setActiveTab('calendar')}
              title="Takvim Ekranı (Ana sayfa yapmak için basılı tutun)"
              className={`flex-1 py-2 px-2.5 rounded-full text-xs font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                activeTab === 'calendar'
                  ? themePreset.dockActiveBtnClass
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <span className="text-sm leading-none">📅</span>
              <span>Takvim</span>
              {settings.defaultStartTab === 'calendar' && (
                <span className="text-[9px] text-amber-400 leading-none" title="Varsayılan Ana Sayfa">
                  ★
                </span>
              )}
            </button>

            <div className={`w-px h-5 ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} />

            {/* Personnel General Announcement Notification Button */}
            <button
              type="button"
              onClick={handleOpenAnnouncementModal}
              className={`relative h-9 px-3 rounded-full flex items-center justify-center gap-1.5 text-xs font-extrabold transition cursor-pointer shrink-0 ${
                hasUnreadAnnouncement
                  ? 'bg-amber-500 text-slate-950 shadow-xs hover:bg-amber-400'
                  : isLight
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Genel Kurum Duyuruları"
              aria-label="Genel Kurum Duyuruları"
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Duyurular</span>
              {hasUnreadAnnouncement && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none bg-slate-950 text-amber-300 animate-pulse">
                  {unreadAnnouncements.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className={`h-9 px-2.5 rounded-full flex items-center justify-center gap-1 text-xs font-bold transition cursor-pointer shrink-0 ${
                isLight
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                  : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title="Ayarlar"
              aria-label="Ayarlar"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Ayarlar</span>
            </button>
          </nav>
        </div>
      )}
      </>
      )}

      {/* BUREAU / MULTI-INSTITUTION SERVER MODAL (ONLY available in Admin / İdari Büro mode) */}
      {isAdminBureauMode && showBureauModal && (
        <BureauAdminModal
          settings={effectiveSettings}
          refHistory={refHistory}
          notes={personalCombinedNotes}
          allUnits={allUnits}
          activeUnit={activeUnit}
          activeUnitCloudNotes={activeUnitCloudNotes}
          activeUnitLeaveRequests={activeUnitLeaveRequests}
          activeUnitAnnouncements={activeUnitAnnouncements}
          isLight={isLight}
          initialSection={bureauInitialSection}
          onSelectActiveUnit={handleSelectActiveUnit}
          onUpdateSettings={handleUpdateSettings}
          onSaveNotes={handleSaveNotes}
          onResyncFromServer={handleResyncFromServer}
          onOpenRosterTable={() => setShowRosterTable(true)}
          onTriggerToast={(title, msg) => triggerShiftToast(title, msg, 'custom')}
          onOpenFirstLaunchScreen={() => setShowFirstLaunchAuth(true)}
          onClose={() => setShowBureauModal(false)}
        />
      )}

      {/* PROFILE MANAGER MODAL (Personnel mode only) */}
      {!isAdminBureauMode && showProfileModal && (
        <ProfileManagerModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          settings={effectiveSettings}
          activeRefHistory={refHistory}
          isLight={isLight}
          activeUnit={activeUnit}
          currentUser={currentUser}
          isAuthorizedAdmin={effectiveIsAdmin}
          onTriggerToast={(title, msg) => triggerShiftToast(title, msg, 'custom')}
          onSelectProfile={(id) => {
            handleSelectProfile(id);
            const prof = profiles.find((p) => p.id === id);
            if (prof) {
              triggerShiftToast(
                `${prof.name} Profili Aktif`,
                `${settings.groupNames[prof.groupIdx] || `${prof.groupIdx + 1}. Grup`} nöbet düzeni yüklendi.`,
                'custom'
              );
            }
          }}
          onSaveProfile={(prof, updatedSettings, makeActive) => {
            handleSaveProfile(prof, updatedSettings, makeActive);
            triggerShiftToast(
              'Profil ve Grup Onaylandı',
              `${prof.name} profili ${
                (updatedSettings || settings).groupNames[prof.groupIdx] ||
                `${prof.groupIdx + 1}. Grup`
              } ile onaylı olarak eşleştirildi.`,
              'custom'
            );
          }}
          onDeleteProfile={handleDeleteProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div
          onClick={() => setShowSettingsModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg max-h-[82vh] rounded-3xl border overflow-y-auto shadow-2xl p-3 md:p-5 cursor-default ${themePreset.modalBgClass}`}
          >
            <SettingsTab
              settings={effectiveSettings}
              refHistory={refHistory}
              notes={personalCombinedNotes}
              profiles={profiles}
              activeProfileId={activeProfileId}
              defaultDate={singleQueryDate}
              activeUnit={activeUnit}
              currentUser={currentUser}
              isAuthorizedAdmin={effectiveIsAdmin}
              onOpenFirstLaunchScreen={() => {
                setShowSettingsModal(false);
                setShowFirstLaunchAuth(true);
              }}
              onOpenBureauModal={
                isAdminBureauMode
                  ? (section = 'units') => {
                      setShowSettingsModal(false);
                      setBureauInitialSection(section);
                      setShowBureauModal(true);
                    }
                  : undefined
              }
              onTriggerToast={(title, msg) => triggerShiftToast(title, msg, 'custom')}
              onUpdateSettings={handleUpdateSettings}
              onSaveNotes={handleSaveNotes}
              onSelectProfile={handleSelectProfile}
              onSaveProfile={handleSaveProfile}
              onDeleteProfile={handleDeleteProfile}
              onDeleteRef={handleDeleteRef}
              onResetAll={handleResetAll}
              onResyncFromServer={handleResyncFromServer}
              onOpenDevModal={() => setShowDevModal(true)}
              onOpenTestModal={() => setShowTestModal(true)}
              onTriggerTestReminder={(title, msg) => triggerShiftToast(title, msg, 'test')}
              onClose={() => setShowSettingsModal(false)}
            />
          </div>
        </div>
      )}

      {/* MODALS */}
      {showDevModal && (
        <DeveloperInfoModal settings={effectiveSettings} onDismiss={() => setShowDevModal(false)} />
      )}

      {showTestModal && (
        <BuiltInTestModal settings={effectiveSettings} onDismiss={() => setShowTestModal(false)} />
      )}

      {showRosterTable && (
        <ShiftRosterTableModal
          settings={effectiveSettings}
          refHistory={refHistory}
          notes={combinedNotes}
          localNotes={notes}
          activeUnitCloudNotes={activeUnitCloudNotes}
          activeUnitLeaveRequests={activeUnitLeaveRequests}
          onSaveLocalNotes={(newLocalNotes) => handleSaveNotes(newLocalNotes, refHistory)}
          onUpdateSettings={handleUpdateSettings}
          onTriggerToast={(title, msg) => triggerShiftToast(title, msg, 'custom')}
          activeProfileName={activeProfile?.name}
          calendarYear={calendarYear}
          calendarMonth={calendarMonth}
          onMonthChange={(y, m) => {
            setCalendarYear(y);
            setCalendarMonth(m);
          }}
          onOpenNoteForDate={(iso) => setSelectedCalendarDateForNote(iso)}
          allUnits={allUnits}
          activeUnit={activeUnit}
          isAdminBureauMode={isAdminBureauMode}
          onSelectUnit={isAdminBureauMode ? (unit) => handleSelectActiveUnit(unit) : undefined}
          onOpenBureauModal={isAdminBureauMode ? () => setShowBureauModal(true) : undefined}
          onClose={() => setShowRosterTable(false)}
        />
      )}

      {/* ANDROID APK CHROME GOOGLE AUTH BRIDGE OVERLAY (?android_auth=1) */}
      {isAndroidAuthBridge && (
        <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/40 bg-slate-900 text-white shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <img
                src="/vardiya112logo.png"
                alt="Vardiya 112"
                className="w-12 h-12 rounded-2xl border border-rose-500/50 object-cover shrink-0"
              />
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                  VARDİYA 112 · ANDROID APK GİRİŞ KÖPRÜSÜ
                </div>
                <h2 className="text-base font-black">Chrome Üzerinden APK Giriş Kodu Al</h2>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Android APK içindeki WebView Google açılır penceresini engellediğinde, burada Chrome
              ile giriş yapıp oluşturulan tek seferlik <strong>Vardiya 112 Giriş Anahtarını</strong>{' '}
              kopyalayarak uygulamadaki alana yapıştırabilirsiniz.
            </p>

            {androidBridgeError && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                {androidBridgeError}
              </div>
            )}

            <button
              type="button"
              disabled={androidBridgeBusy}
              onClick={async () => {
                setAndroidBridgeBusy(true);
                setAndroidBridgeError('');
                try {
                  await signInBureauWithGoogle();
                  const tok = getLastGoogleIdToken();
                  if (tok) {
                    setAndroidBridgeToken(tok);
                  } else {
                    setAndroidBridgeError(
                      'Giriş yapıldı ancak tarayıcı ID Token dönmedi. Lütfen tekrar deneyin.'
                    );
                  }
                } catch (err) {
                  setAndroidBridgeError(
                    err instanceof Error ? err.message : 'Google girişi yapılamadı.'
                  );
                } finally {
                  setAndroidBridgeBusy(false);
                }
              }}
              className="w-full py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-extrabold transition cursor-pointer"
            >
              {androidBridgeBusy
                ? 'Google Hesabı Doğrulanıyor...'
                : '1. Vardiya 112 — Google ile Giriş Yap'}
            </button>

            {androidBridgeToken && (
              <div className="p-3 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 space-y-2">
                <div className="text-[11px] font-extrabold text-emerald-300">
                  ✅ Giriş Kodu Hazır ({currentUser?.email || 'Doğrulandı'})
                </div>
                <textarea
                  readOnly
                  rows={3}
                  value={androidBridgeToken}
                  className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono text-emerald-200 outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(androidBridgeToken);
                      setAndroidBridgeCopied(true);
                      setTimeout(() => setAndroidBridgeCopied(false), 3000);
                    } catch {
                      // ignore
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition cursor-pointer"
                >
                  {androidBridgeCopied
                    ? '✓ Kopyalandı! Şimdi Vardiya 112 APK Uygulamasına Dönün'
                    : '2. Giriş Kodunu Kopyala (APK İçine Yapıştırın)'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setIsAndroidAuthBridge(false);
                try {
                  const cleanUrl = window.location.pathname;
                  window.history.replaceState({}, '', cleanUrl);
                } catch {
                  // ignore
                }
              }}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
            >
              Web Uygulamasına Geç
            </button>
          </div>
        </div>
      )}

      {selectedCalendarDateForNote && (
        <QuickNoteModal
          dateISO={selectedCalendarDateForNote}
          settings={effectiveSettings}
          refHistory={refHistory}
          notes={isAdminBureauMode ? combinedNotes : personalCombinedNotes}
          activeProfileName={activeProfile?.name}
          activeUnit={activeUnit}
          activeUnitLeaveRequests={activeUnitLeaveRequests}
          currentUserUid={currentUser?.uid}
          isAdminBureauMode={isAdminBureauMode}
          onRememberWorkerName={(workerName) => {
            const clean = workerName.trim();
            if (clean && !settings.activeWorkerName?.trim()) {
              handleUpdateSettings({ ...settings, activeWorkerName: clean });
            }
          }}
          onTriggerToast={(title, msg) => triggerShiftToast(title, msg, 'custom')}
          onSaveNote={(newNote) => {
            const updated = [...notes, newNote];
            handleSaveNotes(updated, refHistory);
          }}
          onSaveNotesBatch={(notesToAdd) => {
            const updated = [...notes, ...notesToAdd];
            handleSaveNotes(updated, refHistory);
          }}
          onDeleteNote={(id) => {
            const updated = notes.filter((it) => it.id !== id);
            handleSaveNotes(updated, refHistory);
          }}
          onDeleteNotesBatch={(idsToRemove) => {
            const removeSet = new Set(idsToRemove);
            const updated = notes.filter((it) => !removeSet.has(it.id));
            handleSaveNotes(updated, refHistory);
          }}
          onGoToDetail={() => {
            setSingleQueryDate(selectedCalendarDateForNote);
            setSelectedCalendarDateForNote(null);
            setActiveTab('home');
          }}
          onDismiss={() => setSelectedCalendarDateForNote(null)}
        />
      )}

      {/* GENERAL ANNOUNCEMENTS MODAL (Personnel Reader + Admin Direct Publisher & Manager) */}
      {showAnnouncementModal && (
        <div
          onClick={() => setShowAnnouncementModal(false)}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden flex flex-col ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-[#111622] border-slate-800 text-white'
            }`}
          >
            {/* Header */}
            <div
              className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
                isLight ? 'border-slate-100 bg-amber-50/60' : 'border-slate-800/80 bg-amber-950/20'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-amber-500 truncate">
                    {activeUnit?.name || settings.activeUnitName || 'Kurum Bildirimi'}
                  </div>
                  <h3 className="text-sm sm:text-base font-black truncate">
                    {isAdminBureauMode
                      ? 'Kurum Duyurusu Ekle & Yönet'
                      : 'Genel Kurum Duyuruları'}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAnnouncementModal(false)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ${
                  isLight
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* ADMIN ANNOUNCEMENT CREATOR FORM */}
              {isAdminBureauMode && (
                <div
                  className={`p-3.5 sm:p-4 rounded-2xl border space-y-3 ${
                    isLight
                      ? 'bg-amber-50/50 border-amber-200/90'
                      : 'bg-slate-900/80 border-amber-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase tracking-wide text-amber-500 flex items-center gap-1.5">
                      <Megaphone className="w-3.5 h-3.5" />
                      <span>Yeni Genel Duyuru Yayınla</span>
                    </span>
                    <span
                      className={`text-[10.5px] font-semibold ${
                        isLight ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Sunucuya Kaydedilir · PDF Eklenebilir
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label
                        className={`block text-[11px] font-extrabold mb-1 ${
                          isLight ? 'text-slate-700' : 'text-slate-300'
                        }`}
                      >
                        Duyuru Başlığı (İsteğe Bağlı)
                      </label>
                      <input
                        type="text"
                        value={adminAnnTitle}
                        onChange={(e) => setAdminAnnTitle(e.target.value)}
                        maxLength={140}
                        placeholder="Örn: Kasım Ayı Resmi Nöbet Çizelgesi ve Resmi Yazı"
                        className={`w-full h-9.5 px-3 rounded-xl border text-xs font-semibold outline-none transition ${
                          isLight
                            ? 'bg-white border-slate-300 text-slate-900 focus:border-amber-500'
                            : 'bg-slate-950 border-slate-700 text-white focus:border-amber-400'
                        }`}
                      />
                    </div>

                    <div>
                      <label
                        className={`block text-[11px] font-extrabold mb-1 ${
                          isLight ? 'text-slate-700' : 'text-slate-300'
                        }`}
                      >
                        Duyuru Metni
                      </label>
                      <textarea
                        rows={3}
                        value={adminAnnContent}
                        onChange={(e) => setAdminAnnContent(e.target.value)}
                        maxLength={1800}
                        placeholder="Tüm personellere bildirim olarak gösterilecek duyuru metnini buraya yazın..."
                        className={`w-full p-2.5 rounded-xl border text-xs font-semibold outline-none transition resize-none ${
                          isLight
                            ? 'bg-white border-slate-300 text-slate-900 focus:border-amber-500'
                            : 'bg-slate-950 border-slate-700 text-white focus:border-amber-400'
                        }`}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <label
                          className={`h-9 px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
                            isLight
                              ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                          }`}
                        >
                          <Paperclip className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span>Resmi Yazı / PDF Ekle</span>
                          <input
                            type="file"
                            accept=".pdf,application/pdf,image/*,.doc,.docx"
                            onChange={handleSelectAdminAnnouncementFile}
                            className="hidden"
                          />
                        </label>

                        {adminAnnAttachName && (
                          <div
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold ${
                              isLight
                                ? 'bg-amber-100 border-amber-300 text-amber-900'
                                : 'bg-amber-950/50 border-amber-500/40 text-amber-200'
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="max-w-[160px] truncate">{adminAnnAttachName}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setAdminAnnAttachName('');
                                setAdminAnnAttachType('');
                                setAdminAnnAttachDataUrl('');
                              }}
                              className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
                              title="Eki Kaldır"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={publishingAdminAnn || !adminAnnContent.trim()}
                        onClick={() => void handlePublishAdminAnnouncement()}
                        className="h-9 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-45 text-slate-950 text-xs font-black inline-flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-xs"
                      >
                        <Megaphone className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {publishingAdminAnn ? 'Yayınlanıyor...' : 'Duyuruyu Yayınla'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* PUBLISHED ANNOUNCEMENTS LIST */}
              <div className="space-y-2.5">
                {isAdminBureauMode && (
                  <div
                    className={`text-xs font-extrabold ${
                      isLight ? 'text-slate-700' : 'text-slate-300'
                    }`}
                  >
                    Yayınlanan Kurum Duyuruları ({unifiedAnnouncements.length})
                  </div>
                )}

                {hasActiveAnnouncement ? (
                  unifiedAnnouncements.map((ann) => {
                    const isRead = dismissedAnnouncementIds.includes(ann.id);
                    return (
                      <div
                        key={ann.id}
                        className={`p-3.5 sm:p-4 rounded-2xl border space-y-2 transition ${
                          isRead && !isAdminBureauMode
                            ? isLight
                              ? 'bg-slate-50 border-slate-200 text-slate-700'
                              : 'bg-slate-900/50 border-slate-800 text-slate-300'
                            : isLight
                            ? 'bg-amber-50/70 border-amber-300 text-slate-900'
                            : 'bg-amber-950/25 border-amber-500/40 text-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {!isAdminBureauMode && (
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shrink-0 ${
                                  isRead
                                    ? isLight
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-slate-800 text-slate-300'
                                    : 'bg-amber-500 text-slate-950'
                                }`}
                              >
                                {isRead ? '✓ Okundu' : '📢 Yeni Duyuru'}
                              </span>
                            )}
                            <span className="text-xs font-extrabold truncate">
                              {ann.title || 'Resmi Kurum Duyurusu'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isAdminBureauMode && !isRead && (
                              <button
                                type="button"
                                onClick={() => handleDismissSingleAnnouncement(ann.id)}
                                className={`px-2 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer ${
                                  isLight
                                    ? 'bg-amber-100 hover:bg-amber-200 text-amber-900'
                                    : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300'
                                }`}
                              >
                                <Check className="w-3 h-3" />
                                <span>Okundu İşaretle</span>
                              </button>
                            )}

                            {isAdminBureauMode && !ann.id.startsWith('legacy_') && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteAdminAnnouncement(ann.id)}
                                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/15 transition cursor-pointer"
                                title="Duyuruyu Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-xs sm:text-sm font-semibold leading-relaxed whitespace-pre-wrap break-words">
                          {ann.content}
                        </div>

                        {ann.attachmentDataUrl && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => handleDownloadAnnouncementAttachment(ann)}
                              className={`w-full sm:w-auto px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer ${
                                isLight
                                  ? 'bg-white hover:bg-amber-50 border-amber-300 text-amber-900 shadow-2xs'
                                  : 'bg-slate-900 hover:bg-slate-800 border-amber-500/40 text-amber-200'
                              }`}
                            >
                              <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span className="truncate max-w-[230px]">
                                {ann.attachmentName || 'Resmi Yazı / PDF Dosyası'}
                              </span>
                              <Download className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div
                    className={`p-5 rounded-2xl border text-center space-y-1.5 ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-600'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Bell className="w-6 h-6 mx-auto opacity-50" />
                    <div className="text-xs font-extrabold">
                      Aktif Genel Duyuru Bulunmuyor
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {isAdminBureauMode
                        ? 'Yukarıdaki alandan yeni bir duyuru metni veya resmi yazı PDF dosyası ekleyerek tüm personellere yayınlayabilirsiniz.'
                        : 'Kurum yöneticisi tarafından yayınlanmış güncel bir genel duyuru şu an bulunmamaktadır.'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              className={`px-5 py-3 border-t flex items-center justify-end gap-2 ${
                isLight ? 'border-slate-100 bg-slate-50/60' : 'border-slate-800/80 bg-slate-950/40'
              }`}
            >
              {!isAdminBureauMode && hasActiveAnnouncement ? (
                <button
                  type="button"
                  onClick={handleMarkAllAnnouncementsReadAndClose}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition cursor-pointer"
                >
                  Okundu, Kapat
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAnnouncementModal(false)}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition cursor-pointer"
                >
                  Kapat
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
