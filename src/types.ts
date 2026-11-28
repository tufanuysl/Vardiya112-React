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

export type AppThemeId =
  | 'dark'
  | 'light'
  | 'emerald'
  | 'ocean'
  | 'sunset'
  | 'amethyst'
  | 'amoled'
  | 'sand';

export type AppRoleMode = 'personnel' | 'admin';

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
  theme: AppThemeId;
  autoThemeEnabled?: boolean;
  autoThemeDay?: AppThemeId;
  autoThemeNight?: AppThemeId;
  autoThemeLat?: number;
  autoThemeLng?: number;
  defaultStartTab?: 'home' | 'calendar';
  weatherCity?: string;
  reminderMinutesBefore?: number; // 0, 15, 30, 60 (minutes before shift start)
  notificationSound?: NotificationSoundId;
  activeUnitId?: string;
  activeUnitName?: string;
  activeUnitCode?: string;
  activeUnitType?: InstitutionType;
  activeUnitAnnouncement?: string;
  activeWorkerName?: string;
  appRoleMode?: AppRoleMode;
  onboardingCompleted?: boolean;
  kvkkAccepted?: boolean;
  kvkkAcceptedAt?: string;
}

export type InstitutionType =
  | 'CAGRI_ALICI'
  | 'POLIS'
  | 'JANDARMA'
  | 'ITFAIYE'
  | 'SAGLIK_112'
  | 'AFAD'
  | 'ORMAN'
  | 'DIGER';

export interface InstitutionUnitDoc {
  id: string;
  name: string;
  institutionType: InstitutionType;
  city: string;
  unitCode: string;
  ownerUid: string;
  ownerName: string;
  adminUids: string[];
  numGroups: number;
  is24HourSystem: boolean;
  dayStart: string;
  dayEnd: string;
  nightStart: string;
  nightEnd: string;
  shift24Start: string;
  restHours: number;
  dayRestHours: number;
  nightRestHours: number;
  shiftTransition: 'ALTERNATE' | 'SAME';
  groupCycleMode: '112_CLASSIC' | 'SEQUENTIAL';
  groupNames: string[];
  groupMembers: string[];
  refDate: string;
  refGroupIdx: number;
  refType: 'GUNDUZ' | 'AKSAM';
  announcement: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuthorizedAdminDoc {
  email: string;
  name: string;
  institutionType: 'ALL' | InstitutionType;
  unitCode: string;
  addedByEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type RosterRecordType =
  | 'Nöbet Değişimi'
  | 'İzin / Rapor'
  | 'İcap Nöbeti'
  | 'Nöbet Boşa Çıkarma'
  | 'Ek Nöbet'
  | 'Görevlendirme'
  | 'Not'
  | 'Diğer';

export interface UnitRosterNoteDoc {
  id: string;
  unitId: string;
  date: string;
  type: RosterRecordType;
  personName: string;
  groupIdx: number;
  swapWithPerson: string;
  swapTargetDate: string;
  swapShiftType: 'GUNDUZ' | 'AKSAM';
  desc: string;
  authorUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UnitLeaveRequestDoc {
  id: string;
  unitId: string;
  startDate: string;
  endDate: string;
  type: RosterRecordType;
  personName: string;
  groupIdx: number;
  swapWithPerson: string;
  swapTargetDate: string;
  swapShiftType: 'GUNDUZ' | 'AKSAM';
  desc: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UnitAnnouncementDoc {
  id: string;
  unitId: string;
  title: string;
  content: string;
  authorName: string;
  authorUid: string;
  attachmentName: string;
  attachmentType: string;
  attachmentDataUrl: string;
  createdAt?: unknown;
  updatedAt?: unknown;
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
  swapWithPerson?: string; // Nöbet değişimi yapılan karşı personel
  swapMyPerson?: string; // Kendi grubumdan nöbeti değişen (eski) personel
  targetGroupIdx?: number; // İlgili personelin grup indeksi (0-based)
  cloudNoteId?: string;
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

export type ProfileAvatarColor = 'emerald' | 'sky' | 'amber' | 'rose' | 'indigo';

export interface UserProfile {
  id: string;
  name: string;
  role?: string;
  avatarColor: ProfileAvatarColor;
  groupIdx: number;
  isGroupConfirmed: boolean;
  matchedSource?: string; // e.g. "Personel Listesi", "Nöbet Tarihi", "PDF/Fotoğraf Çizelgesi"
  refHistory: RefRecord[];
  notes: NoteItem[];
  createdAt: string;
}

export interface ProfileGroupMatchResult {
  groupIdx: number;
  groupName: string;
  matchedMemberName: string;
  confidence: 'exact' | 'partial';
}

export interface UnitProfileLockDoc {
  id: string;
  unitId: string;
  personKey: string;
  personName: string;
  groupIdx: number;
  ownerUid: string;
  ownerDisplayLabel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UnitTableMetaDoc {
  unitId: string;
  tableTheme: 'classic' | 'modern' | 'dark' | 'contrast';
  fontSize: 'sm' | 'md' | 'lg';
  rowDensity: 'compact' | 'normal' | 'comfortable';
  highlightWeekends: boolean;
  zebraGroups: boolean;
  colorizeShiftCodes: boolean;
  showTotalsColumn: boolean;
  highlightToday: boolean;
  boldGroupDividers: boolean;
  showLegend: boolean;
  customTitle: string;
  cellHighlights: Record<string, string>;
  updatedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserCloudProfileDoc {
  ownerUid: string;
  activeUnitId: string;
  activeUnitCity: string;
  appRoleMode: AppRoleMode;
  workerName: string;
  myGroupIdx: number;
  kvkkAccepted: boolean;
  theme: AppThemeId;
  defaultStartTab: 'home' | 'calendar';
  createdAt?: unknown;
  updatedAt?: unknown;
}



