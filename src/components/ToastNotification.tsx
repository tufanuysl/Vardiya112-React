import React, { useEffect, useRef, useState } from 'react';
import { Bell, X, CheckCircle2, Sun, Moon, Sunrise } from 'lucide-react';

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'day-start' | 'night-start' | 'shift-end' | 'custom' | 'test';
  timestamp: string;
}

interface ToastNotificationProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export const requestSystemNotificationPermission = async (): Promise<
  'granted' | 'denied' | 'unsupported'
> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
};

export const triggerSystemNotification = async (title: string, message: string) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const options: NotificationOptions = {
    body: message,
    icon: '/vardiya112logo.png',
    badge: '/vardiya112logo.png',
    silent: true,
    tag: 'vardiya112-shift-reminder',
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {
    // Fallback to standard Notification constructor below
  }

  try {
    new Notification(title, options);
  } catch {
    // Ignored if background notification blocked
  }
};

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  toast,
  onClose,
}) => {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(100);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // Shorter, non-intrusive duration for routine changes (2.8s), slightly longer for shift alerts (4.5s)
  const durationMs = toast?.type === 'custom' ? 2800 : 4500;

  useEffect(() => {
    if (!toast) return;

    setDragOffset({ x: 0, y: 0 });
    setIsDragging(false);
    setProgress(100);

    // Trigger system OS notification only for shift reminders / shift events / tests
    if (toast.type !== 'custom') {
      void triggerSystemNotification(toast.title, toast.message);
    }

    const rafId = window.requestAnimationFrame(() => {
      setProgress(0);
    });

    const timer = window.setTimeout(() => {
      onClose();
    }, durationMs);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toast, durationMs, onClose]);

  if (!toast) return null;

  const getVisualConfig = () => {
    switch (toast.type) {
      case 'day-start':
        return {
          icon: <Sun className="w-4 h-4 text-amber-400" />,
          borderClass: 'border-amber-500/45',
          badgeBgClass: 'bg-amber-500/15 border-amber-500/30',
          barClass: 'bg-amber-400',
        };
      case 'night-start':
        return {
          icon: <Moon className="w-4 h-4 text-indigo-400" />,
          borderClass: 'border-indigo-500/45',
          badgeBgClass: 'bg-indigo-500/15 border-indigo-500/30',
          barClass: 'bg-indigo-400',
        };
      case 'shift-end':
        return {
          icon: <Sunrise className="w-4 h-4 text-sky-400" />,
          borderClass: 'border-sky-500/45',
          badgeBgClass: 'bg-sky-500/15 border-sky-500/30',
          barClass: 'bg-sky-400',
        };
      case 'test':
        return {
          icon: <Bell className="w-4 h-4 text-emerald-400" />,
          borderClass: 'border-emerald-500/45',
          badgeBgClass: 'bg-emerald-500/15 border-emerald-500/30',
          barClass: 'bg-emerald-400',
        };
      default:
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
          borderClass: 'border-emerald-500/35',
          badgeBgClass: 'bg-emerald-500/15 border-emerald-500/25',
          barClass: 'bg-emerald-400',
        };
    }
  };

  const visual = getVisualConfig();

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = Math.min(20, e.clientY - dragStartRef.current.y);
    setDragOffset({ x: dx, y: dy });

    // Dismiss immediately if swiped up or sideways
    if (dy < -28 || Math.abs(dx) > 75) {
      dragStartRef.current = null;
      setIsDragging(false);
      onClose();
    }
  };

  const handlePointerUp = () => {
    if (!dragStartRef.current) return;
    const { x, y } = dragOffset;
    dragStartRef.current = null;
    setIsDragging(false);

    // If barely moved, treat tapping anywhere on the banner as an instant dismiss
    if (Math.abs(x) < 8 && Math.abs(y) < 8) {
      onClose();
      return;
    }
    setDragOffset({ x: 0, y: 0 });
  };

  return (
    <div className="fixed top-2.5 inset-x-0 z-[120] flex justify-center px-3 pointer-events-none select-none">
      <div
        role="status"
        aria-live="polite"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragStartRef.current = null;
          setIsDragging(false);
          setDragOffset({ x: 0, y: 0 });
        }}
        style={{
          transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
          opacity: Math.max(0.25, 1 - Math.abs(dragOffset.x) / 160 - Math.max(0, -dragOffset.y) / 70),
        }}
        title="Kapatmak için dokunun veya kaydırın"
        className={`pointer-events-auto w-full max-w-sm rounded-2xl bg-[#0F172A]/95 border ${visual.borderClass} shadow-xl backdrop-blur-xl px-3 py-2.5 text-white flex items-center gap-2.5 cursor-pointer relative overflow-hidden ${
          isDragging ? '' : 'transition-all duration-200 ease-out animate-fade-in'
        }`}
      >
        <div
          className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${visual.badgeBgClass}`}
        >
          {visual.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-extrabold tracking-tight text-white truncate">
              {toast.title}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0">· {toast.timestamp}</span>
          </div>
          <p className="text-[11px] text-slate-300 mt-0.5 leading-snug line-clamp-2">
            {toast.message}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="h-7 px-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 border border-slate-700/80 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1 shrink-0 transition cursor-pointer"
          aria-label="Bildirimi Kapat"
        >
          <span>Kapat</span>
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Auto-dismiss countdown progress bar */}
        <div className="absolute bottom-0 inset-x-0 h-0.5 bg-slate-800/80">
          <div
            style={{
              width: `${progress}%`,
              transitionDuration: `${durationMs}ms`,
            }}
            className={`h-full ${visual.barClass} transition-[width] ease-linear`}
          />
        </div>
      </div>
    </div>
  );
};
