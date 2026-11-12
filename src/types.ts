export type ShiftPresetId =
  | '112_5G'
  | '12_24_48_4G'
  | '12_36_3G'
  | '12_48_5G'
  | 'CUSTOM';

export interface ShiftPresetOption {
  id: ShiftPresetId;
  name: string;
  shortBadge: string;
  desc: string;
  is24HourSystem: boolean;
  dayStart: string;
  dayEnd: string;
  nightStart: string;
  nightEnd: string;
  shift24Start: string;
  restHours: number;
  dayRestHours: number;
  nightRestHours: number;
  numGroups: number;
  shiftTransition: 'ALTERNATE' | 'SAME';
}

export type NotificationSoundId = 'chime' | 'telsiz' | 'radar' | 'soft' | 'silent';

export interface AppSettings {
  shiftPreset?: ShiftPresetId;
  dayStart: string; // e.g. "09:00"
  dayEnd: string; // e.g. "19:00"
  nightStart: string; // e.g. "19:00"
  nightEnd: string; // e.g. "09:00"
  shift24Start: string; // e.g. "08:00"
  is24HourSystem: boolean;
  restHours: number; // e.g. 48 or 72
  dayRestHours?: number; // e.g. 24 in 12/24-12/48, defaults to restHours
  nightRestHours?: number; // e.g. 48 in 12/24-12/48, defaults to restHours
  numGroups: number; // 2..10 (default 5)
  shiftTransition: string; // "ALTERNATE" | "SAME"
  groupCycleMode?: '112_CLASSIC' | 'SEQUENTIAL';
  groupNames: string[];
  groupMembers: string[];
  theme: 'dark' | 'light';
  reminderMinutesBefore?: number; // 0, 15, 30, 60 (minutes before shift start)
  notificationSound?: NotificationSoundId;
}

export interface RefRecord {
  validFrom: string; // ISO "YYYY-MM-DD"
  myGroupIdx: number; // 0-based
  refDate: string; // ISO "YYYY-MM-DD"
  refType: 'GUNDUZ' | 'AKSAM';
}

export interface NoteItem {
  id: number;
  date: string; // ISO "YYYY-MM-DD"
  type: string; // "Nöbet Değişimi" | "Grup Değişikliği" | "İcap Nöbeti" | "Acil Durum" | "Diğer"
  desc: string;
  isNewRef: boolean;
  swapTargetDate?: string; // ISO "YYYY-MM-DD"
  swapShiftType?: 'GUNDUZ' | 'AKSAM';
}

export interface ShiftInstance {
  groupIdx: number;
  groupName: string;
  shiftType: 'GUNDUZ' | 'AKSAM';
  startDT: Date;
  endDT: Date;
  durationHours: number;
}

export interface SingleDayQueryResult {
  isoDate: string;
  groupIdx: number;
  groupName: string;
  morningCarryover: ShiftInstance | null;
  dayShift: ShiftInstance | null;
  nightShift: ShiftInstance | null;
  isRestAllDay: boolean;
  statusText: string;
  notes: NoteItem[];
}
