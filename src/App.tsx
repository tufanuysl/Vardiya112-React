import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings, NoteItem, RefRecord } from './types';
import {
  loadStoredSettings,
  saveStoredSettings,
  loadStoredRefHistory,
  saveStoredRefHistory,
  loadStoredNotes,
  saveStoredNotes,
  loadStoredConfigured,
  saveStoredConfigured,
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
import { ToastNotification, ToastMessage } from './components/ToastNotification';
import { Settings, Sun, Moon } from 'lucide-react';

export const App: React.FC = () => {
  const [configured, setConfigured] = useState<boolean>(() => loadStoredConfigured());
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());
  const [refHistory, setRefHistory] = useState<RefRecord[]>(() => loadStoredRefHistory());
  const [notes, setNotes] = useState<NoteItem[]>(() => loadStoredNotes());

  // Minimal 2-Tab Navigation: 'home' | 'calendar'
  const [activeTab, setActiveTab] = useState<'home' | 'calendar'>('home');
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const swipeStartRef = React.useRef<{
    x: number;
    y: number;
    active: boolean;
    locked: 'x' | 'y' | null;
  } | null>(null);
  const didSwipeDragRef = React.useRef<boolean>(false);
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

  const handleUpdateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    saveStoredSettings(newSettings);
  }, []);

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
    },
    [configured]
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
  }, []);

  const isLight = settings.theme === 'light';

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  }, [settings.theme]);

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
      className={`relative w-full h-dvh max-h-screen transition-colors duration-200 overflow-hidden flex flex-col justify-between ${
        isLight ? 'bg-[#F8FAFC] text-[#0F172A]' : 'bg-[#090D16] text-[#F1F5F9]'
      }`}
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

      {/* THUMB-FRIENDLY BOTTOM NAVIGATION DOCK (Nöbet | Takvim | Tema | Ayarlar) */}
      <div className="w-full flex justify-center pb-3 pt-1 px-4 flex-shrink-0 z-20 no-share">
        <nav
          className={`w-full max-w-sm flex items-center justify-between gap-1.5 p-1.5 rounded-full border shadow-lg transition-all ${
            isLight
              ? 'bg-white/95 border-slate-200/90 shadow-slate-200/50'
              : 'bg-[#111622]/95 border-slate-800/90 shadow-black/50'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`flex-1 py-2 px-4 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'home'
                ? isLight
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-950 shadow-xs'
                : isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <span className="text-sm leading-none">🚨</span>
            <span>Nöbet</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`flex-1 py-2 px-4 rounded-full text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'calendar'
                ? isLight
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-950 shadow-xs'
                : isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <span className="text-sm leading-none">📅</span>
            <span>Takvim</span>
          </button>

          <div className={`w-px h-5 ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} />

          <button
            type="button"
            onClick={() => handleUpdateSettings({ ...settings, theme: isLight ? 'dark' : 'light' })}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition cursor-pointer shrink-0 ${
              isLight
                ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Temayı Değiştir"
            aria-label="Temayı Değiştir"
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

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

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div
          onClick={() => setShowSettingsModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg max-h-[82vh] rounded-3xl border overflow-y-auto shadow-2xl p-3 md:p-5 cursor-default ${
              isLight ? 'bg-[#F8FAFC] border-slate-200' : 'bg-[#0F172A] border-slate-800'
            }`}
          >
            <SettingsTab
              settings={settings}
              refHistory={refHistory}
              notes={notes}
              defaultDate={singleQueryDate}
              onUpdateSettings={handleUpdateSettings}
              onSaveNotes={handleSaveNotes}
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
