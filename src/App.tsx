import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings, NoteItem, RefRecord, UserProfile } from './types';
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
} from './shiftEngine';
import { HomeTab } from './components/HomeTab';
import { CalendarTab } from './components/CalendarTab';
import { SettingsTab } from './components/SettingsTab';
import { SetupReferenceModal } from './components/SetupReferenceModal';
import { QuickNoteModal } from './components/QuickNoteModal';
import { DeveloperInfoModal } from './components/DeveloperInfoModal';
import { BuiltInTestModal } from './components/BuiltInTestModal';
import { ProfileManagerModal } from './components/ProfileManagerModal';
import { ToastNotification, ToastMessage } from './components/ToastNotification';
import { getThemePreset } from './themes';
import { Settings } from 'lucide-react';

export const App: React.FC = () => {
  const [configured, setConfigured] = useState<boolean>(() => loadStoredConfigured());
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());
  const [refHistory, setRefHistory] = useState<RefRecord[]>(() => loadStoredRefHistory());
  const [notes, setNotes] = useState<NoteItem[]>(() => loadStoredNotes());

  const [profiles, setProfiles] = useState<UserProfile[]>(() =>
    loadStoredProfiles(loadStoredSettings(), loadStoredRefHistory(), loadStoredNotes())
  );
  const [activeProfileId, setActiveProfileId] = useState<string>(() =>
    loadActiveProfileId(
      loadStoredProfiles(loadStoredSettings(), loadStoredRefHistory(), loadStoredNotes())
    )
  );
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);

  // Minimal 2-Tab Navigation: 'home' | 'calendar' (initializes from user's preferred defaultStartTab)
  const [activeTab, setActiveTab] = useState<'home' | 'calendar'>(() =>
    loadStoredSettings().defaultStartTab === 'calendar' ? 'calendar' : 'home'
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

  // Calendar Navigation
  const now = new Date();
  const [calendarYear, setCalendarYear] = useState<number>(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(now.getMonth() + 1);
  const [calendarGroupIdx, setCalendarGroupIdx] = useState<number>(-1);

  // Modals
  const [showSetupModal, setShowSetupModal] = useState<boolean>(false);
  const [showDevModal, setShowDevModal] = useState<boolean>(false);
  const [showTestModal, setShowTestModal] = useState<boolean>(false);
  const [selectedCalendarDateForNote, setSelectedCalendarDateForNote] = useState<string | null>(null);

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

  // Live Clock and Shift Arrival Monitoring
  useEffect(() => {
    const timer = setInterval(() => {
      const currentDate = new Date();
      const iso = toISODate(currentDate);
      const time = `${String(currentDate.getHours()).padStart(2, '0')}:${String(
        currentDate.getMinutes()
      ).padStart(2, '0')}`;

      if (isLiveDutyMode) {
        setDutyQueryDate(iso);
        setDutyQueryTime(time);
      }

      if (refHistory.length === 0) return;

      const myDayInfo = querySingleDayForGroup(iso, null, settings, refHistory, notes);
      const gName = myDayInfo.groupName || 'Grubunuz';

      if (settings.is24HourSystem) {
        if ((myDayInfo.dayShift || myDayInfo.nightShift) && time === settings.shift24Start) {
          const key = `${iso}_${time}_24h_start`;
          if (lastNotifiedKeyRef.current !== key) {
            lastNotifiedKeyRef.current = key;
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
          if (lastNotifiedKeyRef.current !== key) {
            lastNotifiedKeyRef.current = key;
            triggerShiftToast(
              'Gündüz Nöbeti Başladı',
              `${gName} için ${settings.dayStart} - ${settings.dayEnd} gündüz nöbeti başladı.`,
              'day-start'
            );
          }
        }
        if (myDayInfo.nightShift && time === settings.nightStart) {
          const key = `${iso}_${time}_night_start`;
          if (lastNotifiedKeyRef.current !== key) {
            lastNotifiedKeyRef.current = key;
            triggerShiftToast(
              'Akşam Nöbeti Başladı',
              `${gName} için ${settings.nightStart} - ${settings.nightEnd} akşam nöbeti başladı.`,
              'night-start'
            );
          }
        }
        if (myDayInfo.morningCarryover && time === settings.nightEnd) {
          const key = `${iso}_${time}_night_end`;
          if (lastNotifiedKeyRef.current !== key) {
            lastNotifiedKeyRef.current = key;
            triggerShiftToast(
              'Nöbet Tamamlandı',
              `Sabah ${settings.nightEnd} itibarıyla nöbet tamamlandı.`,
              'shift-end'
            );
          }
        }
      }

      const leadMin = settings.reminderMinutesBefore ?? 30;
      if (leadMin > 0) {
        const futureDT = addMinutes(currentDate, leadMin);
        const futureISO = toISODate(futureDT);
        const futureTime = formatTimeHHMM(futureDT);
        const futureDayInfo = querySingleDayForGroup(futureISO, null, settings, refHistory, notes);
        const targetStart = settings.is24HourSystem
          ? settings.shift24Start
          : futureDayInfo.dayShift
          ? settings.dayStart
          : futureDayInfo.nightShift
          ? settings.nightStart
          : null;

        if (
          targetStart &&
          (futureDayInfo.dayShift || futureDayInfo.nightShift) &&
          futureTime === targetStart
        ) {
          const preKey = `${futureISO}_${targetStart}_pre_${leadMin}`;
          if (lastNotifiedKeyRef.current !== preKey) {
            lastNotifiedKeyRef.current = preKey;
            triggerShiftToast(
              `Nöbete ${leadMin} Dakika Kaldı`,
              `${gName} vardiyası saat ${targetStart} itibarıyla başlayacak.`,
              'custom'
            );
          }
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isLiveDutyMode, settings, refHistory, notes, triggerShiftToast]);

  const handleUpdateSettings = useCallback(
    (newSettings: AppSettings) => {
      setSettings((prev) => {
        if (
          newSettings.defaultStartTab &&
          newSettings.defaultStartTab !== prev.defaultStartTab
        ) {
          setActiveTab(newSettings.defaultStartTab);
        }
        return newSettings;
      });
      saveStoredSettings(newSettings);

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
    [profiles, activeProfileId, triggerShiftToast]
  );

  const handleSaveNotes = useCallback(
    (newNotes: NoteItem[], newRefs: RefRecord[]) => {
      setNotes(newNotes);
      setRefHistory(newRefs);
      saveStoredNotes(newNotes);
      saveStoredRefHistory(newRefs);
      if (newRefs.length > 0 && !configured) {
        setConfigured(true);
        saveStoredConfigured(true);
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
    [configured, activeProfileId]
  );

  const handleSelectProfile = useCallback(
    (profileId: string) => {
      const target = profiles.find((p) => p.id === profileId);
      if (!target) return;
      setActiveProfileId(target.id);
      saveActiveProfileId(target.id);
      setRefHistory(target.refHistory || []);
      setNotes(target.notes || []);
      saveStoredRefHistory(target.refHistory || []);
      saveStoredNotes(target.notes || []);
      const hasRef = Array.isArray(target.refHistory) && target.refHistory.length > 0;
      setConfigured(hasRef);
      saveStoredConfigured(hasRef);
    },
    [profiles]
  );

  const handleSaveProfile = useCallback(
    (
      savedProfile: UserProfile,
      updatedSettings?: AppSettings,
      makeActive: boolean = true
    ) => {
      if (updatedSettings) {
        setSettings(updatedSettings);
        saveStoredSettings(updatedSettings);
      }

      setProfiles((prev) => {
        const exists = prev.some((p) => p.id === savedProfile.id);
        const next = exists
          ? prev.map((p) => (p.id === savedProfile.id ? savedProfile : p))
          : [...prev, savedProfile];
        saveStoredProfiles(next);
        return next;
      });

      if (makeActive || savedProfile.id === activeProfileId) {
        setActiveProfileId(savedProfile.id);
        saveActiveProfileId(savedProfile.id);
        setRefHistory(savedProfile.refHistory || []);
        setNotes(savedProfile.notes || []);
        saveStoredRefHistory(savedProfile.refHistory || []);
        saveStoredNotes(savedProfile.notes || []);
        const hasRef =
          Array.isArray(savedProfile.refHistory) && savedProfile.refHistory.length > 0;
        setConfigured(hasRef);
        saveStoredConfigured(hasRef);
      }
    },
    [activeProfileId]
  );

  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      setProfiles((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((p) => p.id !== profileId);
        saveStoredProfiles(next);
        if (profileId === activeProfileId && next[0]) {
          const fallback = next[0];
          setActiveProfileId(fallback.id);
          saveActiveProfileId(fallback.id);
          setRefHistory(fallback.refHistory || []);
          setNotes(fallback.notes || []);
          saveStoredRefHistory(fallback.refHistory || []);
          saveStoredNotes(fallback.notes || []);
        }
        return next;
      });
    },
    [activeProfileId]
  );

  const handleDeleteRef = useCallback(
    (idx: number) => {
      if (idx >= 0) {
        const updated = refHistory.filter((_, i) => i !== idx);
        setRefHistory(updated);
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
    resetAllStorage();
    setSettings(DEFAULT_SETTINGS);
    setRefHistory(DEFAULT_REFS);
    setNotes([]);
    setConfigured(false);
    const freshProfiles = loadStoredProfiles(DEFAULT_SETTINGS, DEFAULT_REFS, []);
    setProfiles(freshProfiles);
    setActiveProfileId(freshProfiles[0].id);
  }, []);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) || profiles[0];
  const themePreset = getThemePreset(settings.theme);
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

  const finishHorizontalSwipe = () => {
    const state = swipeStartRef.current;
    if (!state || !state.active) return;
    if (state.locked === 'x') {
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
        soundId={settings.notificationSound || 'chime'}
        onClose={() => setActiveToast(null)}
      />

      {/* MAIN VIEWPORT (2-Page Swipe Carousel: Nöbet | Takvim) */}
      <main
        className="flex-1 max-w-md mx-auto w-full pb-1 overflow-hidden relative z-10 flex flex-col justify-center touch-pan-y select-none"
        onTouchStart={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('canvas, input, select, textarea, [data-no-swipe]')) return;
          const touch = e.touches[0];
          swipeStartRef.current = { x: touch.clientX, y: touch.clientY, active: true, locked: null };
        }}
        onTouchMove={(e) => {
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
          if (e.button !== 0) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('canvas, input, select, textarea, [data-no-swipe]')) return;
          swipeStartRef.current = { x: e.clientX, y: e.clientY, active: true, locked: null };
          didSwipeDragRef.current = false;
        }}
        onMouseMove={(e) => {
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
            transform: `translate3d(calc(${activeTab === 'home' ? '0%' : '-50%'} + ${swipeOffset}px), 0, 0)`,
          }}
        >
          {/* Slide 1: Nöbet */}
          <div className="w-1/2 h-full px-4 pt-3 flex flex-col justify-center overflow-visible flex-shrink-0">
            <HomeTab
              settings={settings}
              refHistory={refHistory}
              notes={notes}
              activeProfileName={activeProfile?.name}
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
            />
          </div>

          {/* Slide 2: Takvim */}
          <div className="w-1/2 h-full px-2.5 pt-3 flex flex-col justify-center overflow-hidden flex-shrink-0">
            <CalendarTab
              settings={settings}
              refHistory={refHistory}
              notes={notes}
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
            />
          </div>
        </div>
      </main>

      {/* THUMB-FRIENDLY BOTTOM NAVIGATION DOCK (Nöbet | Takvim | Ayarlar) */}
      <div className="w-full flex justify-center pb-3 pt-1 px-4 flex-shrink-0 z-30 no-share relative">
        <nav
          className={`w-full max-w-sm flex items-center justify-between gap-1.5 p-1.5 rounded-full border shadow-lg transition-all ${themePreset.dockBgClass}`}
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
                  'Uygulama açılışında ilk olarak Nöbet (3D Dünya) sayfası açılacak.',
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
            title="Nöbet Ekranı (Ana sayfa yapmak için basılı tutun)"
            className={`flex-1 py-2 px-4 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
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
            className={`flex-1 py-2 px-4 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
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

          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className={`h-9 px-3.5 rounded-full flex items-center justify-center gap-1.5 text-xs font-bold transition cursor-pointer shrink-0 ${
              isLight
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700 hover:text-white'
            }`}
            title="Ayarlar"
            aria-label="Ayarlar"
          >
            <Settings className="w-4 h-4" />
            <span>Ayarlar</span>
          </button>
        </nav>
      </div>

      {/* PROFILE MANAGER MODAL */}
      {showProfileModal && (
        <ProfileManagerModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          settings={settings}
          activeRefHistory={refHistory}
          isLight={isLight}
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
              settings={settings}
              refHistory={refHistory}
              notes={notes}
              profiles={profiles}
              activeProfileId={activeProfileId}
              defaultDate={singleQueryDate}
              onUpdateSettings={handleUpdateSettings}
              onSaveNotes={handleSaveNotes}
              onSelectProfile={handleSelectProfile}
              onSaveProfile={handleSaveProfile}
              onDeleteProfile={handleDeleteProfile}
              onDeleteRef={handleDeleteRef}
              onResetAll={handleResetAll}
              onOpenSetupModal={() => setShowSetupModal(true)}
              onOpenDevModal={() => setShowDevModal(true)}
              onOpenTestModal={() => setShowTestModal(true)}
              onTriggerTestToast={() => {
                const isSilent = settings.notificationSound === 'silent';
                triggerShiftToast(
                  isSilent ? 'Nöbet Bildirimi Testi (Sessiz)' : 'Nöbet Bildirimi Testi',
                  isSilent
                    ? 'Sessiz mod aktif: Vardiya saatinizde yalnızca görsel bildirim gösterilecektir.'
                    : 'Vardiya saatiniz geldiğinde seçtiğiniz ses tonu ile bildirim görüntülenecektir.',
                  'test'
                );
              }}
              onClose={() => setShowSettingsModal(false)}
            />
          </div>
        </div>
      )}

      {/* MODALS */}
      {showSetupModal && (
        <SetupReferenceModal
          settings={settings}
          baseRef={refHistory[0] || { validFrom: '1970-01-01', myGroupIdx: 0, refDate: toISODate(new Date()), refType: 'GUNDUZ' }}
          canClose={true}
          onSave={(newBaseRef) => {
            const updated = [...refHistory];
            if (updated.length > 0) {
              updated[0] = newBaseRef;
            } else {
              updated.push(newBaseRef);
            }
            setRefHistory(updated);
            saveStoredRefHistory(updated);
            setConfigured(true);
            saveStoredConfigured(true);
            setShowSetupModal(false);
          }}
          onDismiss={() => setShowSetupModal(false)}
          onChangeGroupCount={(num) => {
            const names = [...settings.groupNames];
            while (names.length < num) names.push(`${names.length + 1}. Grup`);
            const mems = [...settings.groupMembers];
            while (mems.length < num) mems.push('');
            handleUpdateSettings({
              ...settings,
              numGroups: num,
              groupNames: names.slice(0, num),
              groupMembers: mems.slice(0, num),
            });
          }}
        />
      )}

      {showDevModal && (
        <DeveloperInfoModal settings={settings} onDismiss={() => setShowDevModal(false)} />
      )}

      {showTestModal && (
        <BuiltInTestModal settings={settings} onDismiss={() => setShowTestModal(false)} />
      )}

      {selectedCalendarDateForNote && (
        <QuickNoteModal
          dateISO={selectedCalendarDateForNote}
          settings={settings}
          refHistory={refHistory}
          notes={notes}
          activeProfileName={activeProfile?.name}
          onSaveNote={(newNote) => {
            const updated = [...notes, newNote];
            handleSaveNotes(updated, refHistory);
          }}
          onDeleteNote={(id) => {
            const updated = notes.filter((it) => it.id !== id);
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
    </div>
  );
};
