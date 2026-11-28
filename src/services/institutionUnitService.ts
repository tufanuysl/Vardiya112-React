import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppRoleMode,
  AppSettings,
  AppThemeId,
  AuthorizedAdminDoc,
  InstitutionType,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  RosterRecordType,
  UnitAnnouncementDoc,
  UnitLeaveRequestDoc,
  UnitProfileLockDoc,
  UnitRosterNoteDoc,
  UnitTableMetaDoc,
  UserCloudProfileDoc,
} from '../types';
import { isSamePersonNameTR } from '../shiftEngine';

export const SUPER_ADMIN_EMAIL = 'tufanuysal4545@gmail.com';

export function isUserSuperAdmin(email?: string | null): boolean {
  return (email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export interface InstitutionTypeMeta {
  id: InstitutionType;
  label: string;
  shortLabel: string;
  emoji: string;
  badgeClass: string;
  defaultUnitName: string;
}

export const INSTITUTION_TYPES: InstitutionTypeMeta[] = [
  {
    id: 'CAGRI_ALICI',
    label: '112 Çağrı Alıcı (ÇKM)',
    shortLabel: 'Çağrı Alıcı',
    emoji: '🎧',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    defaultUnitName: '112 Çağrı Alıcı Birimi',
  },
  {
    id: 'POLIS',
    label: 'Emniyet (Polis 112 / Haber Merkezi)',
    shortLabel: 'Polis',
    emoji: '🚓',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    defaultUnitName: 'Emniyet 112 Yönlendirme Birimi',
  },
  {
    id: 'JANDARMA',
    label: 'Jandarma 112 Birimi',
    shortLabel: 'Jandarma',
    emoji: '🛡️',
    badgeClass: 'bg-red-500/20 text-red-300 border-red-500/40',
    defaultUnitName: 'Jandarma 112 Yönlendirme Birimi',
  },
  {
    id: 'SAGLIK_112',
    label: '112 Acil Sağlık (KKM / İstasyon)',
    shortLabel: '112 Sağlık',
    emoji: '🚑',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    defaultUnitName: '112 Acil Sağlık Komuta Birimi',
  },
  {
    id: 'ITFAIYE',
    label: 'İtfaiye 112 Birimi',
    shortLabel: 'İtfaiye',
    emoji: '🚒',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    defaultUnitName: 'İtfaiye 112 Haber Merkezi',
  },
  {
    id: 'AFAD',
    label: 'AFAD Nöbet Birimi',
    shortLabel: 'AFAD',
    emoji: '⛺',
    badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    defaultUnitName: 'AFAD 112 Nöbet Birimi',
  },
  {
    id: 'ORMAN',
    label: 'Orman Yangın (112) Birimi',
    shortLabel: 'Orman',
    emoji: '🌲',
    badgeClass: 'bg-lime-500/20 text-lime-300 border-lime-500/40',
    defaultUnitName: 'Orman 112 Haber Merkezi',
  },
  {
    id: 'DIGER',
    label: 'Diğer Kurum / Birim',
    shortLabel: 'Diğer Kurum',
    emoji: '🏛️',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    defaultUnitName: 'Kurum Vardiya Birimi',
  },
];

export function getInstitutionMeta(type?: InstitutionType): InstitutionTypeMeta {
  return INSTITUTION_TYPES.find((it) => it.id === type) || INSTITUTION_TYPES[0];
}

export function sanitizeUnitCode(raw: string): string {
  const trMap: Record<string, string> = {
    ç: 'C',
    Ç: 'C',
    ğ: 'G',
    Ğ: 'G',
    ı: 'I',
    İ: 'I',
    ö: 'O',
    Ö: 'O',
    ş: 'S',
    Ş: 'S',
    ü: 'U',
    Ü: 'U',
  };
  const replaced = (raw || '')
    .split('')
    .map((c) => trMap[c] || c)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return replaced.length >= 2 ? replaced : 'KURUM-112';
}

export function makeSafeDocId(raw: string): string {
  const cleaned = sanitizeUnitCode(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 96);
  return cleaned || `unit-${Date.now()}`;
}

function clampString(val: string | undefined, maxLen: number, fallback = ''): string {
  const v = (val ?? fallback).trim();
  return v.slice(0, maxLen);
}

function ensureHHMM(val: string | undefined, fallback: string): string {
  const v = (val || '').trim();
  return /^[0-2][0-9]:[0-5][0-9]$/.test(v) ? v : fallback;
}

function ensureISODate(val: string | undefined, fallback: string): string {
  const v = (val || '').trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? v : fallback;
}

/**
 * Subscribes to all published InstitutionUnits in Firestore so any worker
 * (police, call taker, paramedic, firefighter) can select their unit and view its live roster.
 */
export function subscribeToAllUnits(
  onUnits: (units: InstitutionUnitDoc[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'units';
  const q = query(
    collection(db, path),
    where('numGroups', '>=', 2),
    where('numGroups', '<=', 10)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: InstitutionUnitDoc[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<InstitutionUnitDoc, 'id'>;
        list.push({
          ...data,
          id: docSnap.id,
        });
      });
      onUnits(list);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

/**
 * Forces a fresh fetch of all published InstitutionUnits directly from the Firestore server
 * (bypassing stale local browser cache after an app reset or device sync).
 */
export async function fetchAllUnitsFromServer(): Promise<InstitutionUnitDoc[]> {
  const path = 'units';
  const q = query(
    collection(db, path),
    where('numGroups', '>=', 2),
    where('numGroups', '<=', 10)
  );
  try {
    const snapshot = await getDocsFromServer(q);
    const list: InstitutionUnitDoc[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Omit<InstitutionUnitDoc, 'id'>;
      list.push({
        ...data,
        id: docSnap.id,
      });
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * Subscribes to a single InstitutionUnit document and its `/rosterNotes` subcollection in real time.
 */
export function subscribeToActiveUnit(
  unitId: string,
  onUnitChange: (unit: InstitutionUnitDoc | null) => void,
  onNotesChange: (notes: UnitRosterNoteDoc[]) => void,
  onLeaveRequestsChange?: (requests: UnitLeaveRequestDoc[]) => void,
  onProfileLocksChange?: (locks: UnitProfileLockDoc[]) => void,
  onAnnouncementsChange?: (announcements: UnitAnnouncementDoc[]) => void
): () => void {
  const unitPath = `units/${unitId}`;
  const notesPath = `units/${unitId}/rosterNotes`;
  const reqsPath = `units/${unitId}/leaveRequests`;
  const locksPath = `units/${unitId}/profileLocks`;
  const annsPath = `units/${unitId}/announcements`;

  const unsubUnit = onSnapshot(
    doc(db, 'units', unitId),
    (snap) => {
      if (!snap.exists()) {
        onUnitChange(null);
        return;
      }
      const data = snap.data() as Omit<InstitutionUnitDoc, 'id'>;
      onUnitChange({ ...data, id: snap.id });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, unitPath);
    }
  );

  const notesQuery = query(
    collection(db, 'units', unitId, 'rosterNotes'),
    where('unitId', '==', unitId)
  );
  const unsubNotes = onSnapshot(
    notesQuery,
    (snap) => {
      const list: UnitRosterNoteDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<UnitRosterNoteDoc, 'id'>;
        list.push({ ...data, id: d.id });
      });
      list.sort((a, b) => b.id.localeCompare(a.id));
      onNotesChange(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, notesPath);
    }
  );

  let unsubReqs = () => {};
  if (onLeaveRequestsChange) {
    const reqsQuery = query(
      collection(db, 'units', unitId, 'leaveRequests'),
      where('unitId', '==', unitId)
    );
    unsubReqs = onSnapshot(
      reqsQuery,
      (snap) => {
        const list: UnitLeaveRequestDoc[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<UnitLeaveRequestDoc, 'id'>;
          list.push({ ...data, id: d.id });
        });
        onLeaveRequestsChange(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, reqsPath);
      }
    );
  }

  let unsubLocks = () => {};
  if (onProfileLocksChange) {
    const locksQuery = query(
      collection(db, 'units', unitId, 'profileLocks'),
      where('unitId', '==', unitId)
    );
    unsubLocks = onSnapshot(
      locksQuery,
      (snap) => {
        const list: UnitProfileLockDoc[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<UnitProfileLockDoc, 'id'>;
          list.push({ ...data, id: d.id });
        });
        onProfileLocksChange(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, locksPath);
      }
    );
  }

  let unsubAnns = () => {};
  if (onAnnouncementsChange) {
    const annsQuery = query(
      collection(db, 'units', unitId, 'announcements'),
      where('unitId', '==', unitId)
    );
    unsubAnns = onSnapshot(
      annsQuery,
      (snap) => {
        const list: UnitAnnouncementDoc[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<UnitAnnouncementDoc, 'id'>;
          list.push({ ...data, id: d.id });
        });
        list.sort((a, b) => b.id.localeCompare(a.id));
        onAnnouncementsChange(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, annsPath);
      }
    );
  }

  return () => {
    unsubUnit();
    unsubNotes();
    unsubReqs();
    unsubLocks();
    unsubAnns();
  };
}

/**
 * Converts a Firestore UnitRosterNoteDoc list into NoteItem[] so the existing shiftEngine
 * and ShiftRosterTableModal automatically highlight every person's official leaves & swaps!
 */
export function convertCloudNotesToLocalNotes(
  cloudNotes: UnitRosterNoteDoc[]
): NoteItem[] {
  return cloudNotes.map((cn, idx) => {
    let hash = 0;
    for (let i = 0; i < cn.id.length; i++) {
      hash = (hash * 31 + cn.id.charCodeAt(i)) | 0;
    }
    const numericId = 900000 + Math.abs(hash) + idx;
    return {
      id: numericId,
      cloudNoteId: cn.id,
      date: cn.date,
      type: cn.type,
      desc: cn.desc || `${cn.personName} (${cn.type})`,
      isNewRef: false,
      swapMyPerson: cn.personName,
      swapWithPerson: cn.swapWithPerson || undefined,
      swapTargetDate: cn.swapTargetDate || undefined,
      swapShiftType: cn.swapShiftType,
      targetGroupIdx: cn.groupIdx,
    };
  });
}

/**
 * Creates or updates an InstitutionUnit in Firestore (Strict blueprint-validated payload).
 */
export async function saveInstitutionUnitToCloud(params: {
  existingUnit?: InstitutionUnitDoc | null;
  name: string;
  institutionType: InstitutionType;
  city: string;
  unitCode: string;
  settings: AppSettings;
  refDate: string;
  refGroupIdx: number;
  refType: 'GUNDUZ' | 'AKSAM';
  announcement: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Veri girişi için Büro / Yönetici girişi yapmalısınız.');
  }

  const cleanCode = sanitizeUnitCode(params.unitCode);
  const unitId = params.existingUnit?.id || makeSafeDocId(`${params.city}-${cleanCode}`);
  const numGroups = Math.min(10, Math.max(2, Math.round(params.settings.numGroups || 5)));

  const groupNames = Array.from({ length: numGroups }, (_, i) => {
    const raw = clampString(params.settings.groupNames[i], 60, `${i + 1}. Grup`);
    return raw.length >= 1 ? raw : `${i + 1}. Grup`;
  });

  const groupMembers = Array.from({ length: numGroups }, (_, i) =>
    clampString(params.settings.groupMembers[i], 1200, '')
  );

  const safeRefGroupIdx = Math.min(numGroups - 1, Math.max(0, Math.round(params.refGroupIdx || 0)));
  const cleanName = clampString(params.name, 100, '112 Kurum Birimi');
  const safeName = cleanName.length >= 2 ? cleanName : '112 Kurum Birimi';
  const cleanCity = clampString(params.city, 50, 'Manisa');
  const safeCity = cleanCity.length >= 2 ? cleanCity : 'Manisa';
  const ownerName = clampString(user.displayName || user.email || 'Büro Yöneticisi', 100, 'Büro Yöneticisi');

  const path = `units/${unitId}`;
  const existingDocData: Partial<InstitutionUnitDoc> | null = params.existingUnit || null;
  if (!existingDocData) {
    try {
      const snap = await getDoc(doc(db, 'units', unitId));
      if (snap.exists()) {
        const existingServerUnit = snap.data() as Partial<InstitutionUnitDoc>;
        throw new Error(
          `Sunucuda "${existingServerUnit.name || unitId}" (${cleanCode}) koduyla zaten kayıtlı bir kurum mevcut. Mevcut personel listesinin yanlışlıkla sıfırlanmaması için lütfen "Kurumlar" sekmesinden mevcut kurumu seçip düzenleyin veya farklı bir Kurum Kodu girin.`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('zaten kayıtlı bir kurum mevcut')) {
        throw err;
      }
      // Proceed with create if getDoc fails transiently
    }
  }

  if (existingDocData) {
    const existingOwnerUid = existingDocData.ownerUid || user.uid;
    const existingAdmins = Array.isArray(existingDocData.adminUids) && existingDocData.adminUids.length > 0
      ? existingDocData.adminUids.slice(0, 10)
      : [existingOwnerUid];
    if (!existingAdmins.includes(user.uid) && existingAdmins.length < 10) {
      existingAdmins.push(user.uid);
    }

    const updatePayload = {
      name: safeName,
      institutionType: params.institutionType,
      city: safeCity,
      unitCode: cleanCode,
      ownerName,
      adminUids: existingAdmins,
      numGroups,
      is24HourSystem: Boolean(params.settings.is24HourSystem),
      dayStart: ensureHHMM(params.settings.dayStart, '09:00'),
      dayEnd: ensureHHMM(params.settings.dayEnd, '19:00'),
      nightStart: ensureHHMM(params.settings.nightStart, '19:00'),
      nightEnd: ensureHHMM(params.settings.nightEnd, '09:00'),
      shift24Start: ensureHHMM(params.settings.shift24Start, '08:00'),
      restHours: Math.min(168, Math.max(12, Math.round(params.settings.restHours || 72))),
      dayRestHours: Math.min(
        168,
        Math.max(12, Math.round(params.settings.dayRestHours ?? params.settings.restHours ?? 72))
      ),
      nightRestHours: Math.min(
        168,
        Math.max(12, Math.round(params.settings.nightRestHours ?? params.settings.restHours ?? 72))
      ),
      shiftTransition:
        params.settings.shiftTransition === 'SAME' ? ('SAME' as const) : ('ALTERNATE' as const),
      groupCycleMode:
        params.settings.groupCycleMode === 'SEQUENTIAL'
          ? ('SEQUENTIAL' as const)
          : ('112_CLASSIC' as const),
      groupNames,
      groupMembers,
      refDate: ensureISODate(params.refDate, '2026-11-01'),
      refGroupIdx: safeRefGroupIdx,
      refType: params.refType === 'AKSAM' ? ('AKSAM' as const) : ('GUNDUZ' as const),
      announcement: clampString(params.announcement, 400, ''),
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'units', unitId), updatePayload);
      return unitId;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    const createPayload = {
      name: safeName,
      institutionType: params.institutionType,
      city: safeCity,
      unitCode: cleanCode,
      ownerUid: user.uid,
      ownerName,
      adminUids: [user.uid],
      numGroups,
      is24HourSystem: Boolean(params.settings.is24HourSystem),
      dayStart: ensureHHMM(params.settings.dayStart, '09:00'),
      dayEnd: ensureHHMM(params.settings.dayEnd, '19:00'),
      nightStart: ensureHHMM(params.settings.nightStart, '19:00'),
      nightEnd: ensureHHMM(params.settings.nightEnd, '09:00'),
      shift24Start: ensureHHMM(params.settings.shift24Start, '08:00'),
      restHours: Math.min(168, Math.max(12, Math.round(params.settings.restHours || 72))),
      dayRestHours: Math.min(
        168,
        Math.max(12, Math.round(params.settings.dayRestHours ?? params.settings.restHours ?? 72))
      ),
      nightRestHours: Math.min(
        168,
        Math.max(12, Math.round(params.settings.nightRestHours ?? params.settings.restHours ?? 72))
      ),
      shiftTransition:
        params.settings.shiftTransition === 'SAME' ? ('SAME' as const) : ('ALTERNATE' as const),
      groupCycleMode:
        params.settings.groupCycleMode === 'SEQUENTIAL'
          ? ('SEQUENTIAL' as const)
          : ('112_CLASSIC' as const),
      groupNames,
      groupMembers,
      refDate: ensureISODate(params.refDate, '2026-11-01'),
      refGroupIdx: safeRefGroupIdx,
      refType: params.refType === 'AKSAM' ? ('AKSAM' as const) : ('GUNDUZ' as const),
      announcement: clampString(params.announcement, 400, ''),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'units', unitId), createPayload);
      return unitId;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

/**
 * Updates only the groupNames and groupMembers arrays on an existing InstitutionUnit
 * directly from the Monthly Roster Table (rename person, reorder ↑↓, transfer group, swap positions, rename group).
 */
export async function updateUnitRosterStructureInCloud(params: {
  unit: InstitutionUnitDoc;
  groupNames: string[];
  groupMembers: string[];
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Tablo personel ve grup yapısını düzenlemek için yönetici girişi yapmalısınız.');
  }

  const numGroups = Math.min(10, Math.max(2, Math.round(params.unit.numGroups || 5)));
  const cleanGroupNames = Array.from({ length: numGroups }, (_, i) => {
    const raw = clampString(params.groupNames[i], 60, `${i + 1}. Grup`);
    return raw.length >= 1 ? raw : `${i + 1}. Grup`;
  });
  const cleanGroupMembers = Array.from({ length: numGroups }, (_, i) =>
    clampString(params.groupMembers[i], 1200, '')
  );

  const path = `units/${params.unit.id}`;
  try {
    await updateDoc(doc(db, 'units', params.unit.id), {
      groupNames: cleanGroupNames,
      groupMembers: cleanGroupMembers,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Syncs SettingsTab / PDF-Photo Importer edits (shift hours, rest hours, groups, personnel, reference date)
 * directly to the active InstitutionUnit document in Firestore so admin changes survive app resets.
 */
export async function syncUnitSettingsToCloud(params: {
  unit: InstitutionUnitDoc;
  settings: AppSettings;
  refRecord?: RefRecord | null;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const numGroups = Math.min(10, Math.max(2, Math.round(params.settings.numGroups || params.unit.numGroups || 5)));
  const cleanGroupNames = Array.from({ length: numGroups }, (_, i) => {
    const raw = clampString(params.settings.groupNames[i], 60, `${i + 1}. Grup`);
    return raw.length >= 1 ? raw : `${i + 1}. Grup`;
  });
  const cleanGroupMembers = Array.from({ length: numGroups }, (_, i) =>
    clampString(params.settings.groupMembers[i], 1200, '')
  );

  const restHours = Math.min(168, Math.max(12, Math.round(params.settings.restHours || params.unit.restHours || 48)));
  const dayRestHours = Math.min(
    168,
    Math.max(12, Math.round(params.settings.dayRestHours ?? restHours))
  );
  const nightRestHours = Math.min(
    168,
    Math.max(12, Math.round(params.settings.nightRestHours ?? restHours))
  );

  const updatePayload: Record<string, unknown> = {
    numGroups,
    is24HourSystem: Boolean(params.settings.is24HourSystem),
    dayStart: ensureHHMM(params.settings.dayStart, params.unit.dayStart || '09:00'),
    dayEnd: ensureHHMM(params.settings.dayEnd, params.unit.dayEnd || '19:00'),
    nightStart: ensureHHMM(params.settings.nightStart, params.unit.nightStart || '19:00'),
    nightEnd: ensureHHMM(params.settings.nightEnd, params.unit.nightEnd || '09:00'),
    shift24Start: ensureHHMM(params.settings.shift24Start, params.unit.shift24Start || '08:00'),
    restHours,
    dayRestHours,
    nightRestHours,
    shiftTransition:
      params.settings.shiftTransition === 'SAME' ? ('SAME' as const) : ('ALTERNATE' as const),
    groupCycleMode:
      params.settings.groupCycleMode === 'SEQUENTIAL'
        ? ('SEQUENTIAL' as const)
        : ('112_CLASSIC' as const),
    groupNames: cleanGroupNames,
    groupMembers: cleanGroupMembers,
    updatedAt: serverTimestamp(),
  };

  if (params.refRecord) {
    updatePayload.refDate = ensureISODate(params.refRecord.refDate, params.unit.refDate || '2026-11-01');
    updatePayload.refGroupIdx = Math.min(
      numGroups - 1,
      Math.max(0, Math.round(params.refRecord.myGroupIdx || 0))
    );
    updatePayload.refType =
      params.refRecord.refType === 'AKSAM' ? ('AKSAM' as const) : ('GUNDUZ' as const);
  } else if (params.unit.refGroupIdx >= numGroups) {
    updatePayload.refGroupIdx = 0;
  }

  const path = `units/${params.unit.id}`;
  try {
    await updateDoc(doc(db, 'units', params.unit.id), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Subscribes to shared Monthly Roster Table styling & bulk cell color highlights (`/units/{unitId}/tableMeta/style`).
 */
export function subscribeToUnitTableMeta(
  unitId: string | null | undefined,
  onMeta: (meta: UnitTableMetaDoc | null) => void
): () => void {
  if (!unitId) {
    onMeta(null);
    return () => {};
  }
  const path = `units/${unitId}/tableMeta/style`;
  return onSnapshot(
    doc(db, 'units', unitId, 'tableMeta', 'style'),
    (snap) => {
      if (!snap.exists()) {
        onMeta(null);
        return;
      }
      onMeta(snap.data() as UnitTableMetaDoc);
    },
    (error) => {
      // Non-fatal fallback if offline or not yet initialized
      if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.GET, path);
      }
      onMeta(null);
    }
  );
}

/**
 * Saves shared Monthly Roster Table styling & bulk cell color highlights to `/units/{unitId}/tableMeta/style`.
 * Strictly enforces blueprint constraints (customTitle <= 120 chars, cellHighlights <= 500 entries).
 */
export async function saveUnitTableMetaToCloud(params: {
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
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const sanitizedHighlights: Record<string, string> = {};
  const entries = Object.entries(params.cellHighlights || {});
  for (let i = 0; i < entries.length && Object.keys(sanitizedHighlights).length < 500; i++) {
    const [k, v] = entries[i];
    if (typeof k === 'string' && k.length > 0 && k.length <= 160 && typeof v === 'string' && v.length > 0 && v.length <= 32) {
      sanitizedHighlights[k] = v;
    }
  }

  const allowedThemes = ['classic', 'modern', 'dark', 'contrast'] as const;
  const allowedFonts = ['sm', 'md', 'lg'] as const;
  const allowedDensity = ['compact', 'normal', 'comfortable'] as const;

  const safeTheme = allowedThemes.includes(params.tableTheme) ? params.tableTheme : 'classic';
  const safeFont = allowedFonts.includes(params.fontSize) ? params.fontSize : 'md';
  const safeDensity = allowedDensity.includes(params.rowDensity) ? params.rowDensity : 'normal';
  const safeCustomTitle = clampString(params.customTitle, 120, '');

  const path = `units/${params.unitId}/tableMeta/style`;
  const metaRef = doc(db, 'units', params.unitId, 'tableMeta', 'style');

  const commonFields = {
    tableTheme: safeTheme,
    fontSize: safeFont,
    rowDensity: safeDensity,
    highlightWeekends: Boolean(params.highlightWeekends),
    zebraGroups: Boolean(params.zebraGroups),
    colorizeShiftCodes: Boolean(params.colorizeShiftCodes),
    showTotalsColumn: Boolean(params.showTotalsColumn),
    highlightToday: Boolean(params.highlightToday),
    boldGroupDividers: Boolean(params.boldGroupDividers),
    showLegend: Boolean(params.showLegend),
    customTitle: safeCustomTitle,
    cellHighlights: sanitizedHighlights,
    updatedByUid: user.uid,
    updatedAt: serverTimestamp(),
  };

  let alreadyExists = false;
  try {
    const existingSnap = await getDoc(metaRef);
    alreadyExists = existingSnap.exists();
  } catch {
    alreadyExists = false;
  }

  if (alreadyExists) {
    try {
      await updateDoc(metaRef, commonFields);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(metaRef, {
        unitId: params.unitId,
        ...commonFields,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

/**
 * Subscribes to the signed-in Google user's cloud session recovery profile (`/userProfiles/{uid}`).
 */
export function subscribeToUserCloudProfile(
  uid: string | null | undefined,
  onProfile: (profile: UserCloudProfileDoc | null) => void
): () => void {
  if (!uid) {
    onProfile(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'userProfiles', uid),
    (snap) => {
      if (!snap.exists()) {
        onProfile(null);
        return;
      }
      onProfile(snap.data() as UserCloudProfileDoc);
    },
    () => {
      onProfile(null);
    }
  );
}

/**
 * Saves the signed-in Google user's connected institution, role, group, and preferences to `/userProfiles/{uid}`
 * so resetting the device or switching devices restores their server link automatically (zero PII).
 */
export async function saveUserCloudProfileToCloud(params: {
  activeUnitId: string;
  activeUnitCity: string;
  appRoleMode: AppRoleMode;
  workerName: string;
  myGroupIdx: number;
  kvkkAccepted: boolean;
  theme: AppThemeId;
  defaultStartTab: 'home' | 'calendar';
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const path = `userProfiles/${user.uid}`;
  const profileRef = doc(db, 'userProfiles', user.uid);

  const safeTheme = clampString(params.theme, 20, 'dark');
  const commonFields = {
    activeUnitId: clampString(params.activeUnitId, 128, ''),
    activeUnitCity: clampString(params.activeUnitCity, 50, ''),
    appRoleMode: params.appRoleMode === 'admin' ? ('admin' as const) : ('personnel' as const),
    workerName: clampString(params.workerName, 100, ''),
    myGroupIdx: Math.min(9, Math.max(0, Math.round(params.myGroupIdx || 0))),
    kvkkAccepted: Boolean(params.kvkkAccepted),
    theme: safeTheme.length >= 2 ? safeTheme : 'dark',
    defaultStartTab: params.defaultStartTab === 'calendar' ? ('calendar' as const) : ('home' as const),
    updatedAt: serverTimestamp(),
  };

  let alreadyExists = false;
  try {
    const existingSnap = await getDoc(profileRef);
    alreadyExists = existingSnap.exists();
  } catch {
    alreadyExists = false;
  }

  if (alreadyExists) {
    try {
      await updateDoc(profileRef, commonFields);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(profileRef, {
        ownerUid: user.uid,
        ...commonFields,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

/**
 * Adds an official bureau roster note (Becayiş, İzin/Rapor, İcap Nöbeti, Nöbet Boşa Çıkarma, Ek Nöbet, Görevlendirme, Not) to `/units/{unitId}/rosterNotes/{noteId}`.
 */
export async function addUnitRosterNoteToCloud(params: {
  unitId: string;
  date: string;
  type: RosterRecordType;
  personName: string;
  groupIdx: number;
  swapWithPerson?: string;
  swapTargetDate?: string;
  swapShiftType?: 'GUNDUZ' | 'AKSAM';
  desc?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Büro kaydı eklemek için yönetici girişi yapmalısınız.');
  }

  const noteId = `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `units/${params.unitId}/rosterNotes/${noteId}`;

  const cleanPerson = clampString(params.personName, 100, 'Personel');
  const safePerson = cleanPerson.length >= 2 ? cleanPerson : 'Personel';
  const cleanTargetDate = params.swapTargetDate?.trim()
    ? ensureISODate(params.swapTargetDate, '')
    : '';

  const payload = {
    unitId: params.unitId,
    date: ensureISODate(params.date, '2026-11-01'),
    type: params.type,
    personName: safePerson,
    groupIdx: Math.min(9, Math.max(0, Math.round(params.groupIdx || 0))),
    swapWithPerson: clampString(params.swapWithPerson, 100, ''),
    swapTargetDate: cleanTargetDate,
    swapShiftType: params.swapShiftType === 'AKSAM' ? ('AKSAM' as const) : ('GUNDUZ' as const),
    desc: clampString(params.desc, 240, ''),
    authorUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'units', params.unitId, 'rosterNotes', noteId), payload);
    return noteId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Adds a range of official bureau roster notes (e.g., multi-day annual leave / report / icap)
 * across startDate .. endDate inclusive (max 31 days per batch).
 */
export async function addUnitRosterNoteRangeToCloud(params: {
  unitId: string;
  startDate: string;
  endDate?: string;
  type: RosterRecordType;
  personName: string;
  groupIdx: number;
  swapWithPerson?: string;
  swapTargetDate?: string;
  swapShiftType?: 'GUNDUZ' | 'AKSAM';
  desc?: string;
}): Promise<number> {
  const startISO = ensureISODate(params.startDate, '2026-11-01');
  const endISO =
    params.endDate && params.endDate.trim() && params.type !== 'Nöbet Değişimi'
      ? ensureISODate(params.endDate, startISO)
      : startISO;

  const [sy, sm, sd] = startISO.split('-').map((n) => parseInt(n, 10));
  const [ey, em, ed] = endISO.split('-').map((n) => parseInt(n, 10));
  const startDT = new Date(sy, sm - 1, sd);
  const endDT = new Date(ey, em - 1, ed);

  if (endDT.getTime() <= startDT.getTime()) {
    await addUnitRosterNoteToCloud({
      ...params,
      date: startISO,
    });
    return 1;
  }

  let count = 0;
  const cursor = new Date(startDT);
  while (cursor.getTime() <= endDT.getTime() && count < 31) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate()
    ).padStart(2, '0')}`;
    await addUnitRosterNoteToCloud({
      ...params,
      date: iso,
    });
    count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export async function deleteUnitRosterNoteFromCloud(
  unitId: string,
  noteId: string
): Promise<void> {
  const path = `units/${unitId}/rosterNotes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'units', unitId, 'rosterNotes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Publishes an official general announcement (with optional attached official letter / PDF / image)
 * to `/units/{unitId}/announcements/{annId}` and also updates the summary announcement text on `/units/{unitId}`.
 */
export async function addUnitAnnouncementToCloud(params: {
  unitId: string;
  title?: string;
  content: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentDataUrl?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Duyuru yayınlamak için yönetici girişi yapmalısınız.');
  }

  const cleanContent = clampString(params.content, 2000, '');
  if (!cleanContent) {
    throw new Error('Lütfen duyuru metnini yazın.');
  }

  const cleanTitle = clampString(params.title, 140, 'Resmi Kurum Duyurusu');
  const safeTitle = cleanTitle.length >= 1 ? cleanTitle : 'Resmi Kurum Duyurusu';
  const authorName = clampString(
    user.displayName || user.email || 'Kurum Yöneticisi',
    100,
    'Kurum Yöneticisi'
  );
  const safeAuthorName = authorName.length >= 1 ? authorName : 'Kurum Yöneticisi';

  const safeAttachmentName = clampString(params.attachmentName, 160, '');
  const safeAttachmentType = clampString(params.attachmentType, 80, '');
  const rawDataUrl = (params.attachmentDataUrl || '').trim();
  if (rawDataUrl.length > 900000) {
    throw new Error('Eklenen resmi yazı / PDF dosyası çok büyük (en fazla ~650 KB olmalıdır).');
  }

  const annId = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `units/${params.unitId}/announcements/${annId}`;

  const payload = {
    unitId: params.unitId,
    title: safeTitle,
    content: cleanContent,
    authorName: safeAuthorName,
    authorUid: user.uid,
    attachmentName: rawDataUrl ? safeAttachmentName : '',
    attachmentType: rawDataUrl ? safeAttachmentType : '',
    attachmentDataUrl: rawDataUrl,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'units', params.unitId, 'announcements', annId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  // Also sync latest announcement summary onto the parent unit document
  try {
    await updateDoc(doc(db, 'units', params.unitId), {
      announcement: clampString(cleanContent, 400, ''),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if parent summary update fails
  }

  return annId;
}

export async function deleteUnitAnnouncementFromCloud(
  unitId: string,
  announcementId: string
): Promise<void> {
  const path = `units/${unitId}/announcements/${announcementId}`;
  try {
    await deleteDoc(doc(db, 'units', unitId, 'announcements', announcementId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Any individual worker (even without Google sign-in) can submit a PENDING leave, on-call (icap),
 * shift swap, or note request to their connected institution unit for admin approval.
 */
export async function submitUnitLeaveRequestToCloud(params: {
  unitId: string;
  startDate: string;
  endDate?: string;
  type: RosterRecordType;
  personName: string;
  groupIdx: number;
  swapWithPerson?: string;
  swapTargetDate?: string;
  swapShiftType?: 'GUNDUZ' | 'AKSAM';
  desc?: string;
}): Promise<string> {
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const path = `units/${params.unitId}/leaveRequests/${reqId}`;

  const startISO = ensureISODate(params.startDate, '2026-11-01');
  const endISO =
    params.endDate && params.endDate.trim()
      ? ensureISODate(params.endDate, startISO)
      : startISO;
  const cleanPerson = clampString(params.personName, 100, 'Personel');
  const safePerson = cleanPerson.length >= 2 ? cleanPerson : 'Personel';
  const cleanTargetDate = params.swapTargetDate?.trim()
    ? ensureISODate(params.swapTargetDate, '')
    : '';

  const payload = {
    unitId: params.unitId,
    startDate: startISO,
    endDate: endISO < startISO ? startISO : endISO,
    type: params.type,
    personName: safePerson,
    groupIdx: Math.min(9, Math.max(0, Math.round(params.groupIdx || 0))),
    swapWithPerson: clampString(params.swapWithPerson, 100, ''),
    swapTargetDate: cleanTargetDate,
    swapShiftType: params.swapShiftType === 'AKSAM' ? ('AKSAM' as const) : ('GUNDUZ' as const),
    desc: clampString(params.desc, 240, ''),
    status: 'PENDING' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'units', params.unitId, 'leaveRequests', reqId), payload);
    return reqId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Authorized Admin approves a worker's leave/icap/swap/note request:
 * 1. Writes the official record(s) into `/units/{unitId}/rosterNotes` across `startDate..endDate`
 *    so the record immediately transitions into the main institution calendar & roster table.
 * 2. Marks the request as `'APPROVED'`.
 */
export async function approveUnitLeaveRequestInCloud(
  reqDoc: UnitLeaveRequestDoc
): Promise<number> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Talebi onaylamak için yönetici girişi yapmalısınız.');
  }

  const addedDays = await addUnitRosterNoteRangeToCloud({
    unitId: reqDoc.unitId,
    startDate: reqDoc.startDate,
    endDate: reqDoc.endDate,
    type: reqDoc.type,
    personName: reqDoc.personName,
    groupIdx: reqDoc.groupIdx,
    swapWithPerson: reqDoc.swapWithPerson,
    swapTargetDate: reqDoc.swapTargetDate,
    swapShiftType: reqDoc.swapShiftType,
    desc: reqDoc.desc,
  });

  const path = `units/${reqDoc.unitId}/leaveRequests/${reqDoc.id}`;
  try {
    await updateDoc(doc(db, 'units', reqDoc.unitId, 'leaveRequests', reqDoc.id), {
      status: 'APPROVED',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
  return addedDays;
}

/**
 * Authorized Admin rejects or deletes a leave request.
 */
export async function rejectOrDeleteUnitLeaveRequestInCloud(
  unitId: string,
  reqId: string
): Promise<void> {
  const path = `units/${unitId}/leaveRequests/${reqId}`;
  try {
    await deleteDoc(doc(db, 'units', unitId, 'leaveRequests', reqId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Checks whether a signed-in user's email is in `/authorizedAdmins/{email}`.
 */
export function subscribeToMyAdminDoc(
  email: string | null | undefined,
  onResult: (adminDoc: AuthorizedAdminDoc | null) => void
): () => void {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    onResult(null);
    return () => {};
  }
  const path = `authorizedAdmins/${cleanEmail}`;
  return onSnapshot(
    doc(db, 'authorizedAdmins', cleanEmail),
    (snap) => {
      if (!snap.exists()) {
        onResult(null);
        return;
      }
      onResult(snap.data() as AuthorizedAdminDoc);
    },
    () => {
      onResult(null);
    }
  );
}

/**
 * Subscribes to the full list of `/authorizedAdmins` (Only Super Admin & Authorized Admins can list).
 */
export function subscribeToAllAuthorizedAdmins(
  onAdmins: (admins: AuthorizedAdminDoc[]) => void
): () => void {
  const path = 'authorizedAdmins';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    (snap) => {
      const list: AuthorizedAdminDoc[] = [];
      snap.forEach((d) => {
        list.push(d.data() as AuthorizedAdminDoc);
      });
      onAdmins(list);
    },
    () => {
      onAdmins([]);
    }
  );
}

/**
 * Super Admin (`tufanuysal4545@gmail.com`) adds or updates an authorized institution admin by Google email.
 */
export async function addAuthorizedAdminToCloud(params: {
  email: string;
  name: string;
  institutionType: 'ALL' | InstitutionType;
  unitCode?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !isUserSuperAdmin(user.email)) {
    throw new Error('Yeni kurum admini ekleme yetkisi sadece Ana Yöneticiye aittir.');
  }

  const cleanEmail = (params.email || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanEmail)) {
    throw new Error('Lütfen geçerli bir Google e-posta adresi girin (örn: personel@gmail.com).');
  }

  const allowedTypes: Array<'ALL' | InstitutionType> = [
    'ALL',
    'CAGRI_ALICI',
    'POLIS',
    'JANDARMA',
    'ITFAIYE',
    'SAGLIK_112',
    'AFAD',
    'ORMAN',
    'DIGER',
  ];
  const safeInstType = allowedTypes.includes(params.institutionType)
    ? params.institutionType
    : 'ALL';

  const cleanName = clampString(params.name, 100, cleanEmail.split('@')[0]);
  const safeName = cleanName.length >= 2 ? cleanName : 'Kurum Admini';
  const safeUnitCode = clampString(params.unitCode, 40, '');
  const addedByEmail = (user.email || SUPER_ADMIN_EMAIL).trim().toLowerCase();
  const path = `authorizedAdmins/${cleanEmail}`;
  const adminRef = doc(db, 'authorizedAdmins', cleanEmail);

  let alreadyExists = false;
  try {
    const existingSnap = await getDoc(adminRef);
    alreadyExists = existingSnap.exists();
  } catch {
    alreadyExists = false;
  }

  if (alreadyExists) {
    try {
      await updateDoc(adminRef, {
        name: safeName,
        institutionType: safeInstType,
        unitCode: safeUnitCode,
        addedByEmail,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const createPayload = {
    email: cleanEmail,
    name: safeName,
    institutionType: safeInstType,
    unitCode: safeUnitCode,
    addedByEmail,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(adminRef, createPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeAuthorizedAdminFromCloud(email: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !isUserSuperAdmin(user.email)) {
    throw new Error('Admin yetkisi kaldırma işlemi sadece Ana Yönetici tarafından yapılabilir.');
  }
  const cleanEmail = (email || '').trim().toLowerCase();
  const path = `authorizedAdmins/${cleanEmail}`;
  try {
    await deleteDoc(doc(db, 'authorizedAdmins', cleanEmail));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Generates an ASCII-safe deterministic document key for a personnel name (matches `^[a-z0-9_\-]+$`, 2..80 chars).
 */
export function buildPersonLockKey(personName: string): string {
  const trMap: Record<string, string> = {
    ç: 'c',
    Ç: 'c',
    ğ: 'g',
    Ğ: 'g',
    ı: 'i',
    İ: 'i',
    I: 'i',
    ö: 'o',
    Ö: 'o',
    ş: 's',
    Ş: 's',
    ü: 'u',
    Ü: 'u',
  };
  const replaced = (personName || '')
    .trim()
    .split('')
    .map((ch) => trMap[ch] || ch)
    .join('')
    .toLowerCase();
  const slug = replaced
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug;
}

/**
 * Finds the active UnitProfileLockDoc matching a given personnel name.
 */
export function findProfileLockForPerson(
  personName: string,
  locks: UnitProfileLockDoc[]
): UnitProfileLockDoc | null {
  const clean = (personName || '').trim();
  if (!clean || !locks || locks.length === 0) return null;
  const targetKey = buildPersonLockKey(clean);
  for (const lk of locks) {
    if (lk.personKey === targetKey || isSamePersonNameTR(lk.personName, clean)) {
      return lk;
    }
  }
  return null;
}

/**
 * Returns the lock document if `personName` is locked by a DIFFERENT Google account (blocking impersonation).
 */
export function isPersonLockedByAnotherUser(
  personName: string,
  locks: UnitProfileLockDoc[],
  currentUid?: string | null
): UnitProfileLockDoc | null {
  const lk = findProfileLockForPerson(personName, locks);
  if (!lk) return null;
  if (currentUid && lk.ownerUid === currentUid) return null;
  return lk;
}

/**
 * Claims and locks a personnel profile name in `/units/{unitId}/profileLocks/{personKey}` to the signed-in Google account.
 * Prevents any other user from opening a profile under this name or seeing personal leave/roster data.
 */
export async function claimUnitProfileLockInCloud(params: {
  unitId: string;
  personName: string;
  groupIdx: number;
  existingLocks?: UnitProfileLockDoc[];
  isAdmin?: boolean;
}): Promise<UnitProfileLockDoc> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error(
      'Profilinizi kimlik korumasına almak için önce Google hesabınızla giriş yapmalısınız.'
    );
  }
  const cleanName = clampString(params.personName, 100, '');
  if (cleanName.length < 2) {
    throw new Error('Lütfen en az 2 karakterlik geçerli bir personel adı girin.');
  }
  const personKey = buildPersonLockKey(cleanName);
  if (personKey.length < 2) {
    throw new Error('Personel adı kilitleme için geçerli harf veya rakam içermelidir.');
  }

  const locksList = params.existingLocks || [];
  const existingForName = findProfileLockForPerson(cleanName, locksList);
  if (existingForName && existingForName.ownerUid !== user.uid) {
    throw new Error(
      `"${existingForName.personName}" profili başka bir doğrulanmış Google hesabına kilitlidir. Başkasının adına profil açamaz veya izin verilerini göremezsiniz.`
    );
  }

  // Anti-squatting: a standard user can only hold 1 verified personnel profile lock per unit
  if (!params.isAdmin) {
    const otherOwnedLock = locksList.find(
      (lk) => lk.ownerUid === user.uid && lk.personKey !== personKey
    );
    if (otherOwnedLock) {
      throw new Error(
        `Google hesabınız bu kurumda zaten "${otherOwnedLock.personName}" profiline kilitlidir. Başka bir personel adını kilitlemek için önce mevcut profil kilidinizi kaldırın.`
      );
    }
  }

  const path = `units/${params.unitId}/profileLocks/${personKey}`;
  const lockRef = doc(db, 'units', params.unitId, 'profileLocks', personKey);

  // Double-check live server doc to prevent race conditions
  try {
    const existingSnap = await getDoc(lockRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as UnitProfileLockDoc;
      if (existingData.ownerUid !== user.uid) {
        throw new Error(
          `"${existingData.personName}" profili başka bir doğrulanmış Google hesabına kilitlidir.`
        );
      }
      // Already owned by this user — update group/name if changed
      await updateDoc(lockRef, {
        personName: cleanName,
        groupIdx: Math.max(0, Math.min(9, Math.round(params.groupIdx))),
        ownerDisplayLabel: 'Doğrulanmış Google Hesabı',
        updatedAt: serverTimestamp(),
      });
      return {
        ...existingData,
        id: personKey,
        personName: cleanName,
        groupIdx: Math.max(0, Math.min(9, Math.round(params.groupIdx))),
      };
    }

    const payload = {
      unitId: params.unitId,
      personKey,
      personName: cleanName,
      groupIdx: Math.max(0, Math.min(9, Math.round(params.groupIdx))),
      ownerUid: user.uid,
      ownerDisplayLabel: 'Doğrulanmış Google Hesabı',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(lockRef, payload);
    return {
      id: personKey,
      unitId: params.unitId,
      personKey,
      personName: cleanName,
      groupIdx: payload.groupIdx,
      ownerUid: user.uid,
      ownerDisplayLabel: payload.ownerDisplayLabel,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('kilitlidir')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

/**
 * Releases a personnel profile lock (only callable by the verified lock owner or an Authorized Unit Admin).
 */
export async function releaseUnitProfileLockInCloud(params: {
  unitId: string;
  personKey: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Profil kilidini kaldırmak için Google hesabınızla giriş yapmalısınız.');
  }
  const path = `units/${params.unitId}/profileLocks/${params.personKey}`;
  try {
    await deleteDoc(doc(db, 'units', params.unitId, 'profileLocks', params.personKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}

/**
 * Applies a cloud InstitutionUnitDoc onto the local AppSettings and RefRecord[]
 * while preserving the worker's own selected personal group (myGroupIdx) if already set.
 */
export function applyUnitDocToLocalState(
  unit: InstitutionUnitDoc,
  currentSettings: AppSettings,
  currentRefs: RefRecord[],
  preferredMyGroupIdx?: number,
  preferredWorkerName?: string
): { nextSettings: AppSettings; nextRefs: RefRecord[] } {
  const nextSettings: AppSettings = {
    ...currentSettings,
    numGroups: unit.numGroups,
    is24HourSystem: unit.is24HourSystem,
    dayStart: unit.dayStart,
    dayEnd: unit.dayEnd,
    nightStart: unit.nightStart,
    nightEnd: unit.nightEnd,
    shift24Start: unit.shift24Start,
    restHours: unit.restHours,
    dayRestHours: unit.dayRestHours,
    nightRestHours: unit.nightRestHours,
    shiftTransition: unit.shiftTransition,
    groupCycleMode: unit.groupCycleMode,
    groupNames: unit.groupNames,
    groupMembers: unit.groupMembers,
    weatherCity: unit.city || currentSettings.weatherCity,
    activeUnitId: unit.id,
    activeUnitName: unit.name,
    activeUnitCode: unit.unitCode,
    activeUnitType: unit.institutionType,
    activeUnitAnnouncement: unit.announcement,
    activeWorkerName:
      preferredWorkerName !== undefined ? preferredWorkerName : currentSettings.activeWorkerName,
  };

  // Calculate the worker's own reference record aligned with the unit's official reference anchor!
  // In the unit doc, `unit.refGroupIdx` works `unit.refType` on `unit.refDate`.
  // If we store a reference record where `myGroupIdx === unit.refGroupIdx`, let's keep the worker's own group index
  // by computing the date when the worker's group has `unit.refType` or simply storing unit's reference anchor!
  // Wait: how does shiftEngine use `RefRecord`? Let's make sure every group `0..numGroups-1` resolves identically!
  const resolvedWorkerName =
    preferredWorkerName !== undefined ? preferredWorkerName : currentSettings.activeWorkerName;

  let matchedWorkerGroupIdx: number | undefined;
  if (resolvedWorkerName && resolvedWorkerName.trim()) {
    for (let g = 0; g < unit.numGroups; g++) {
      const members = (unit.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (members.some((m) => isSamePersonNameTR(m, resolvedWorkerName))) {
        matchedWorkerGroupIdx = g;
        break;
      }
    }
  }

  const myGroup =
    typeof matchedWorkerGroupIdx === 'number'
      ? matchedWorkerGroupIdx
      : typeof preferredMyGroupIdx === 'number' &&
        preferredMyGroupIdx >= 0 &&
        preferredMyGroupIdx < unit.numGroups
      ? preferredMyGroupIdx
      : currentRefs[0] && currentRefs[0].myGroupIdx < unit.numGroups
      ? currentRefs[0].myGroupIdx
      : unit.refGroupIdx;

  // Offset refDate so that `unit.refGroupIdx` always has `unit.refType` on `unit.refDate`
  // even when the worker selects a different `myGroupIdx` as their personal group!
  const useClassic112Order =
    unit.numGroups === 5 && (unit.groupCycleMode ?? '112_CLASSIC') === '112_CLASSIC';
  const cycleOrder = useClassic112Order
    ? [0, 4, 2, 3, 1]
    : Array.from({ length: unit.numGroups }, (_, i) => i);

  const unitAnchorPos = Math.max(0, cycleOrder.indexOf(unit.refGroupIdx));
  const myPos = Math.max(0, cycleOrder.indexOf(myGroup));
  const dayOffset = (((myPos - unitAnchorPos) % unit.numGroups) + unit.numGroups) % unit.numGroups;

  const [y, m, d] = unit.refDate.split('-').map((v) => parseInt(v, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dayOffset);
  const adjustedRefDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;

  const nextRefs: RefRecord[] = [
    {
      validFrom: '2020-01-01',
      myGroupIdx: myGroup,
      refDate: adjustedRefDate,
      refType: unit.refType,
    },
  ];

  return { nextSettings, nextRefs };
}
