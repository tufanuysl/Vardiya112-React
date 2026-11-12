import React, { useEffect } from 'react';
import { Bell, X, ShieldAlert, Sun, Moon, Sunrise } from 'lucide-react';
import { NotificationSoundId } from '../types';

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'day-start' | 'night-start' | 'shift-end' | 'custom' | 'test';
  timestamp: string;
}

interface ToastNotificationProps {
  toast: ToastMessage | null;
  soundId?: NotificationSoundId;
  onClose: () => void;
}

export const playNotificationChime = (soundId: NotificationSoundId = 'chime') => {
  if (soundId === 'silent') return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (soundId === 'telsiz') {
      // 112 Telsiz: crisp double-beep radio chirp
      const freqs = [1350, 1650];
      freqs.forEach((f, idx) => {
        const start = now + idx * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.085);
      });
      return;
    }

    if (soundId === 'radar') {
      // Acil Uyarı: rising triple crystal pulse (E5 -> G#5 -> B5)
      const notes = [659.25, 830.61, 987.77];
      notes.forEach((f, idx) => {
        const start = now + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.15);
      });
      return;
    }

    if (soundId === 'soft') {
      // Yumuşak Melodi: gentle warm chord arpeggio (F4 -> A4 -> C5)
      const notes = [349.23, 440.0, 523.25];
      notes.forEach((f, idx) => {
        const start = now + idx * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, start);
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.008, start + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
      return;
    }

    // Default 'chime': Two-tone pleasant chime (C5 -> G5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);
  } catch {
    // Ignore audio autoplay restrictions
  }
};

export const triggerSystemNotification = (title: string, message: string, silent = false) => {
  // If native Notification API is supported and permitted
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: message,
        icon: '/vardiya112logo.png',
        badge: '/vardiya112logo.png',
        silent,
      });
    } catch {
      // Ignored if background notification blocked
    }
  }
};

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  toast,
  soundId = 'chime',
  onClose,
}) => {
  useEffect(() => {
    if (!toast) return;

    // Play selected notification sound (or silent)
    playNotificationChime(soundId);

    // Fire browser push if available
    triggerSystemNotification(toast.title, toast.message, soundId === 'silent');

    // Auto-dismiss after 7 seconds
    const timer = setTimeout(() => {
      onClose();
    }, 7000);

    return () => clearTimeout(timer);
  }, [toast, soundId, onClose]);

  if (!toast) return null;

  const getIcon = () => {
    switch (toast.type) {
      case 'day-start':
        return <Sun className="w-5 h-5 text-amber-400" />;
      case 'night-start':
        return <Moon className="w-5 h-5 text-indigo-400" />;
      case 'shift-end':
        return <Sunrise className="w-5 h-5 text-sky-400" />;
      case 'test':
        return <Bell className="w-5 h-5 text-emerald-400" />;
      default:
        return <ShieldAlert className="w-5 h-5 text-rose-500" />;
    }
  };

  return (
    <div className="fixed top-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none animate-bounce-short">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#0F172A]/95 border border-red-500/50 shadow-2xl backdrop-blur-xl p-3.5 text-white flex items-start gap-3 transition-all transform duration-300">
        <div className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
          {getIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-black tracking-wide text-white truncate">
              {toast.title}
            </span>
            <span className="text-[10px] text-slate-400">{toast.timestamp}</span>
          </div>
          <p className="text-xs text-slate-200 mt-0.5 leading-snug">{toast.message}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
