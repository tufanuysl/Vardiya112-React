import {
  AppSettings,
  NoteItem,
  ProfileAvatarColor,
  ProfileGroupMatchResult,
  RefRecord,
  ShiftPresetOption,
  UserProfile,
} from './types';

export const SHIFT_PRESETS: ShiftPresetOption[] = [
  {
    id: '112_5G',
    name: '112 Klasik (10/14 · 5 Grup)',
    shortBadge: '10/14 · 5G',
    desc: '09:00-19:00 Gündüz, 48s izin, 19:00-09:00 Gece, 48s izin',
    is24HourSystem: false,
    dayStart: '09:00',
    dayEnd: '19:00',
    nightStart: '19:00',
    nightEnd: '09:00',
    shift24Start: '08:00',
    restHours: 48,
    dayRestHours: 48,
    nightRestHours: 48,
    numGroups: 5,
    shiftTransition: 'ALTERNATE',
  },
  {
    id: '12_24_48_4G',
    name: '12/24 - 12/48 (4 Grup)',
    shortBadge: '12/24-48 · 4G',
    desc: '08:00-20:00 Gündüz (24s izin) → 20:00-08:00 Gece (48s izin)',
    is24HourSystem: false,
    dayStart: '08:00',
    dayEnd: '20:00',
    nightStart: '20:00',
    nightEnd: '08:00',
    shift24Start: '08:00',
    restHours: 48,
    dayRestHours: 24,
    nightRestHours: 48,
    numGroups: 4,
    shiftTransition: 'ALTERNATE',
  },
  {
    id: '12_36_3G',
    name: '12 / 36 Dönüşümlü (3 Grup)',
    shortBadge: '12/36 · 3G',
    desc: '08:00-20:00 Gündüz (24s izin) → 20:00-08:00 Gece (24s izin)',
    is24HourSystem: false,
    dayStart: '08:00',
    dayEnd: '20:00',
    nightStart: '20:00',
    nightEnd: '08:00',
    shift24Start: '08:00',
    restHours: 24,
    dayRestHours: 24,
    nightRestHours: 24,
    numGroups: 3,
    shiftTransition: 'ALTERNATE',
  },
  {
    id: '12_48_5G',
    name: '12 / 48 Eşit Süreli (5 Grup)',
    shortBadge: '12/48 · 5G',
    desc: '08:00-20:00 Gündüz (48s izin) → 20:00-08:00 Gece (48s izin)',
    is24HourSystem: false,
    dayStart: '08:00',
    dayEnd: '20:00',
    nightStart: '20:00',
    nightEnd: '08:00',
    shift24Start: '08:00',
    restHours: 48,
    dayRestHours: 48,
    nightRestHours: 48,
    numGroups: 5,
    shiftTransition: 'ALTERNATE',
  },
  {
    id: 'CUSTOM',
    name: 'Özel Vardiya Düzeni',
    shortBadge: 'Özel',
    desc: 'Saatleri, grup sayısını ve dinlenme sürelerini kendiniz belirleyin',
    is24HourSystem: false,
    dayStart: '09:00',
    dayEnd: '19:00',
    nightStart: '19:00',
    nightEnd: '09:00',
    shift24Start: '08:00',
    restHours: 48,
    dayRestHours: 48,
    nightRestHours: 48,
    numGroups: 5,
    shiftTransition: 'ALTERNATE',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  shiftPreset: '112_5G',
  dayStart: '09:00',
  dayEnd: '19:00',
  nightStart: '19:00',
  nightEnd: '09:00',
  shift24Start: '08:00',
  is24HourSystem: false,
  restHours: 48,
  dayRestHours: 48,
  nightRestHours: 48,
  numGroups: 5,
  shiftTransition: 'ALTERNATE',
  groupCycleMode: '112_CLASSIC',
  groupNames: ['1. Grup', '2. Grup', '3. Grup', '4. Grup', '5. Grup'],
  groupMembers: ['', '', '', '', ''],
  theme: 'dark',
  autoThemeEnabled: false,
  autoThemeDay: 'light',
  autoThemeNight: 'dark',
  defaultStartTab: 'home',
  weatherCity: 'İstanbul',
  reminderMinutesBefore: 30,
  notificationSound: 'silent',
};

export const DEFAULT_REFS: RefRecord[] = [];

const PREF_KEY_SETTINGS = 'VARDIYA_112_SETTINGS';
const PREF_KEY_REFS = 'VARDIYA_112_REFS';
const PREF_KEY_NOTES = 'VARDIYA_112_NOTES';
const PREF_KEY_CONFIGURED = 'VARDIYA_112_CONFIGURED';

export const formatTitleCaseTR = (str: string): string => {
  if (!str) return '';
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toLocaleUpperCase('tr-TR') +
        word.slice(1).toLocaleLowerCase('tr-TR')
    )
    .join(' ');
};

export const formatMemberListTitleCaseTR = (rawMembers: string): string => {
  if (!rawMembers) return '';
  return rawMembers
    .split(/[,;\n]+/)
    .map((entry) => formatTitleCaseTR(entry))
    .filter(Boolean)
    .join(', ');
};

export const loadStoredSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(PREF_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const restH = typeof parsed.restHours === 'number' ? parsed.restHours : DEFAULT_SETTINGS.restHours;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      is24HourSystem: false,
      dayStart: parsed.dayStart || DEFAULT_SETTINGS.dayStart,
      dayEnd: parsed.dayEnd || DEFAULT_SETTINGS.dayEnd,
      nightStart: parsed.nightStart || DEFAULT_SETTINGS.nightStart,
      nightEnd: parsed.nightEnd || DEFAULT_SETTINGS.nightEnd,
      shift24Start: parsed.shift24Start || DEFAULT_SETTINGS.shift24Start,
      restHours: restH,
      dayRestHours: typeof parsed.dayRestHours === 'number' ? parsed.dayRestHours : restH,
      nightRestHours: typeof parsed.nightRestHours === 'number' ? parsed.nightRestHours : restH,
      notificationSound: 'silent',
      groupNames:
        Array.isArray(parsed.groupNames) && parsed.groupNames.length > 0
          ? parsed.groupNames
          : DEFAULT_SETTINGS.groupNames,
      groupMembers:
        Array.isArray(parsed.groupMembers) && parsed.groupMembers.length > 0
          ? parsed.groupMembers.map((m: string) => formatMemberListTitleCaseTR(m || ''))
          : DEFAULT_SETTINGS.groupMembers,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const saveStoredSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(PREF_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings', e);
  }
};

export const loadStoredRefHistory = (): RefRecord[] => {
  try {
    const raw = localStorage.getItem(PREF_KEY_REFS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: any) => ({
      validFrom: r.validFrom || '1970-01-01',
      myGroupIdx: typeof r.myGroupIdx === 'number' ? r.myGroupIdx : 0,
      refDate: r.refDate || '2026-01-01',
      refType: r.refType === 'AKSAM' || r.refShiftTypeId === 'AKSAM' ? 'AKSAM' : 'GUNDUZ',
    }));
  } catch {
    return [];
  }
};

export const saveStoredRefHistory = (refs: RefRecord[]): void => {
  try {
    localStorage.setItem(PREF_KEY_REFS, JSON.stringify(refs));
  } catch (e) {
    console.error('Failed to save ref history', e);
  }
};

export const loadStoredNotes = (): NoteItem[] => {
  try {
    const raw = localStorage.getItem(PREF_KEY_NOTES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveStoredNotes = (notes: NoteItem[]): void => {
  try {
    localStorage.setItem(PREF_KEY_NOTES, JSON.stringify(notes));
  } catch (e) {
    console.error('Failed to save notes', e);
  }
};

export const loadStoredAuth = (): boolean => true;
export const saveStoredAuth = (_val: boolean): void => {};

export const loadStoredConfigured = (): boolean => {
  try {
    return localStorage.getItem(PREF_KEY_CONFIGURED) === 'true';
  } catch {
    return false;
  }
};

export const saveStoredConfigured = (val: boolean): void => {
  try {
    localStorage.setItem(PREF_KEY_CONFIGURED, val ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save configured', e);
  }
};

export const resetAllStorage = (): void => {
  try {
    localStorage.removeItem(PREF_KEY_SETTINGS);
    localStorage.removeItem(PREF_KEY_REFS);
    localStorage.removeItem(PREF_KEY_NOTES);
    localStorage.removeItem(PREF_KEY_CONFIGURED);
    localStorage.removeItem(PREF_KEY_PROFILES);
    localStorage.removeItem(PREF_KEY_ACTIVE_PROFILE_ID);
  } catch (e) {
    console.error('Failed to reset storage', e);
  }
};

const PREF_KEY_PROFILES = 'VARDIYA_112_PROFILES';
const PREF_KEY_ACTIVE_PROFILE_ID = 'VARDIYA_112_ACTIVE_PROFILE_ID';

export const AVATAR_COLORS: ProfileAvatarColor[] = ['emerald', 'sky', 'amber', 'rose', 'indigo'];

export const normalizeTurkishText = (str: string): string => {
  return (str || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ');
};

export const findMatchingGroupByName = (
  personName: string,
  groupMembers: string[],
  groupNames: string[]
): ProfileGroupMatchResult | null => {
  const queryNorm = normalizeTurkishText(personName);
  if (!queryNorm || queryNorm.length < 2) return null;

  const queryTokens = queryNorm.split(' ').filter((t) => t.length >= 2);
  if (queryTokens.length === 0) return null;

  let partialCandidate: ProfileGroupMatchResult | null = null;

  for (let i = 0; i < groupMembers.length; i++) {
    const rawGroup = groupMembers[i] || '';
    const entries = rawGroup
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const entryNorm = normalizeTurkishText(entry);
      if (!entryNorm) continue;

      // 1. Exact full match
      if (entryNorm === queryNorm) {
        return {
          groupIdx: i,
          groupName: groupNames[i] || `${i + 1}. Grup`,
          matchedMemberName: entry,
          confidence: 'exact',
        };
      }

      const entryTokens = entryNorm.split(' ').filter(Boolean);

      // 2. First name or full token match (e.g. "Tufan" matches "Tufan Uysal", or "Tufan Uysal" matches "Tufan")
      const allQueryTokensInEntry = queryTokens.every((qt) =>
        entryTokens.some((et) => et === qt || (qt.length >= 3 && et.startsWith(qt)))
      );
      const allEntryTokensInQuery =
        entryTokens.length > 0 &&
        entryTokens.every((et) => queryTokens.some((qt) => qt === et));

      if (allQueryTokensInEntry || allEntryTokensInQuery) {
        if (!partialCandidate) {
          partialCandidate = {
            groupIdx: i,
            groupName: groupNames[i] || `${i + 1}. Grup`,
            matchedMemberName: entry,
            confidence: entryTokens[0] === queryTokens[0] ? 'exact' : 'partial',
          };
        }
      }
    }
  }

  return partialCandidate;
};

export const ensureMemberInGroupList = (
  memberName: string,
  targetGroupIdx: number,
  groupMembers: string[],
  numGroups: number
): string[] => {
  const cleanName = formatTitleCaseTR(memberName || '');
  const nextMembers = [...groupMembers].map((m) => formatMemberListTitleCaseTR(m || ''));
  while (nextMembers.length < numGroups) nextMembers.push('');

  if (!cleanName || targetGroupIdx < 0 || targetGroupIdx >= numGroups) {
    return nextMembers;
  }

  const targetNorm = normalizeTurkishText(cleanName);
  const currentEntries = (nextMembers[targetGroupIdx] || '')
    .split(',')
    .map((s) => formatTitleCaseTR(s))
    .filter(Boolean);

  const alreadyExists = currentEntries.some((entry) => {
    const eNorm = normalizeTurkishText(entry);
    return eNorm === targetNorm || eNorm.split(' ')[0] === targetNorm.split(' ')[0];
  });

  if (!alreadyExists) {
    currentEntries.push(cleanName);
    nextMembers[targetGroupIdx] = currentEntries.join(', ');
  }

  return nextMembers;
};

export const loadStoredProfiles = (
  currentSettings: AppSettings,
  currentRefs: RefRecord[],
  currentNotes: NoteItem[]
): UserProfile[] => {
  try {
    const raw = localStorage.getItem(PREF_KEY_PROFILES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback below
  }

  // Bootstrap initial default profile from existing refHistory/settings
  const initialGroupIdx = currentRefs.length > 0 ? currentRefs[0].myGroupIdx : 0;
  const firstGroupMembers = (currentSettings.groupMembers[initialGroupIdx] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultName = firstGroupMembers[0] || 'Ana Profilim';

  const defaultProfile: UserProfile = {
    id: 'profile-default',
    name: defaultName,
    role: '112 Personeli',
    avatarColor: 'emerald',
    groupIdx: initialGroupIdx,
    isGroupConfirmed: currentRefs.length > 0,
    matchedSource: currentRefs.length > 0 ? 'Mevcut Kurulum' : undefined,
    refHistory: currentRefs,
    notes: currentNotes,
    createdAt: new Date().toISOString(),
  };

  return [defaultProfile];
};

export const saveStoredProfiles = (profiles: UserProfile[]): void => {
  try {
    localStorage.setItem(PREF_KEY_PROFILES, JSON.stringify(profiles));
  } catch (e) {
    console.error('Failed to save profiles', e);
  }
};

export const loadActiveProfileId = (profiles: UserProfile[]): string => {
  try {
    const savedId = localStorage.getItem(PREF_KEY_ACTIVE_PROFILE_ID);
    if (savedId && profiles.some((p) => p.id === savedId)) {
      return savedId;
    }
  } catch {
    // ignore
  }
  return profiles[0]?.id || 'profile-default';
};

export const saveActiveProfileId = (id: string): void => {
  try {
    localStorage.setItem(PREF_KEY_ACTIVE_PROFILE_ID, id);
  } catch (e) {
    console.error('Failed to save active profile id', e);
  }
};

