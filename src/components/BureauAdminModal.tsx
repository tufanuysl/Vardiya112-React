import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signOutBureau } from '../firebase';
import {
  AppSettings,
  AuthorizedAdminDoc,
  InstitutionType,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  RosterRecordType,
  UnitAnnouncementDoc,
  UnitLeaveRequestDoc,
  UnitRosterNoteDoc,
} from '../types';
import { ShiftScheduleImporter } from './ShiftScheduleImporter';
import { VardiyaGoogleAuthCard } from './VardiyaGoogleAuthCard';
import {
  addAuthorizedAdminToCloud,
  addUnitAnnouncementToCloud,
  addUnitRosterNoteRangeToCloud,
  approveUnitLeaveRequestInCloud,
  deleteUnitAnnouncementFromCloud,
  deleteUnitRosterNoteFromCloud,
  getInstitutionMeta,
  INSTITUTION_TYPES,
  isUserSuperAdmin,
  rejectOrDeleteUnitLeaveRequestInCloud,
  removeAuthorizedAdminFromCloud,
  sanitizeUnitCode,
  saveInstitutionUnitToCloud,
  subscribeToAllAuthorizedAdmins,
  subscribeToMyAdminDoc,
} from '../services/institutionUnitService';
import {
  SHIFT_PRESETS,
  formatMemberListTitleCaseTR,
  formatTitleCaseTR,
} from '../storage';
import { TURKISH_PROVINCES } from '../utils/weather';
import {
  countInclusiveDays,
  getShiftDurations,
  groupConsecutiveRecords,
  isSamePersonNameTR,
  querySingleDayForGroup,
  toISODate,
  trDateFormatter,
} from '../shiftEngine';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Crown,
  Download,
  FileSpreadsheet,
  FileText,
  LogOut,
  Megaphone,
  Minus,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

interface BureauAdminModalProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes?: NoteItem[];
  allUnits: InstitutionUnitDoc[];
  activeUnit: InstitutionUnitDoc | null;
  activeUnitCloudNotes: UnitRosterNoteDoc[];
  activeUnitLeaveRequests?: UnitLeaveRequestDoc[];
  activeUnitAnnouncements?: UnitAnnouncementDoc[];
  isLight: boolean;
  initialSection?: AdminSection;
  onSelectActiveUnit: (
    unit: InstitutionUnitDoc | null,
    preferredGroupIdx?: number,
    preferredWorkerName?: string
  ) => void;
  onUpdateSettings?: (s: AppSettings) => void;
  onSaveNotes?: (notes: NoteItem[], refs: RefRecord[]) => void;
  onOpenRosterTable: () => void;
  onResyncFromServer?: () => Promise<void>;
  onTriggerToast: (title: string, message: string) => void;
  onOpenFirstLaunchScreen?: () => void;
  onClose: () => void;
}

export type AdminSection = 'units' | 'identity' | 'shift_ref' | 'personnel' | 'records' | 'admins';
type RecordsSubView = 'pending' | 'create' | 'history';

const REST_PRESET_HOURS = [24, 48, 72, 96];

export const BureauAdminModal: React.FC<BureauAdminModalProps> = ({
  settings,
  refHistory,
  notes = [],
  allUnits,
  activeUnit,
  activeUnitCloudNotes,
  activeUnitLeaveRequests = [],
  activeUnitAnnouncements = [],
  isLight,
  initialSection,
  onSelectActiveUnit,
  onUpdateSettings,
  onSaveNotes,
  onOpenRosterTable,
  onResyncFromServer,
  onTriggerToast,
  onOpenFirstLaunchScreen,
  onClose,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  const [authError, setAuthError] = useState<string>('');

  // Role & Authorization state
  const [myAdminDoc, setMyAdminDoc] = useState<AuthorizedAdminDoc | null>(null);
  const [allAuthorizedAdmins, setAllAuthorizedAdmins] = useState<AuthorizedAdminDoc[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState<string>('');
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [newAdminInstType, setNewAdminInstType] = useState<InstitutionType | 'ALL'>('ALL');
  const [newAdminUnitCode, setNewAdminUnitCode] = useState<string>('');
  const [savingNewAdmin, setSavingNewAdmin] = useState<boolean>(false);

  // Navigation state
  const [adminSection, setAdminSection] = useState<AdminSection>(initialSection || 'units');
  const [refSetupMode, setRefSetupMode] = useState<'manual' | 'ai'>('manual');
  const [recordsSubView, setRecordsSubView] = useState<RecordsSubView>(() =>
    activeUnitLeaveRequests.some((r) => r.status === 'PENDING') ? 'pending' : 'create'
  );
  const [showInfraHelper, setShowInfraHelper] = useState<boolean>(false);

  useEffect(() => {
    if (initialSection) {
      setAdminSection(initialSection);
    }
  }, [initialSection]);

  // Institution Directory Filter State
  const [filterType, setFilterType] = useState<InstitutionType | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [recordSearchQuery, setRecordSearchQuery] = useState<string>('');

  // Admin Editor Form State
  const [editingUnitId, setEditingUnitId] = useState<string | null>(
    activeUnit?.id || allUnits[0]?.id || null
  );
  const [isCreatingNewDraft, setIsCreatingNewDraft] = useState<boolean>(false);
  const [resyncingServer, setResyncingServer] = useState<boolean>(false);
  const editingUnitDoc = useMemo(
    () => allUnits.find((u) => u.id === editingUnitId) || null,
    [allUnits, editingUnitId]
  );

  // Auto-select an existing server unit if units finish loading and user did not click "Yeni Kurum"
  useEffect(() => {
    if (!isCreatingNewDraft && !editingUnitId && allUnits.length > 0) {
      setEditingUnitId(activeUnit?.id || allUnits[0].id);
    }
  }, [isCreatingNewDraft, editingUnitId, allUnits, activeUnit?.id]);

  const [unitName, setUnitName] = useState<string>(
    activeUnit?.name || 'Manisa 112 Çağrı Alıcı Birimi'
  );
  const [unitType, setUnitType] = useState<InstitutionType>(
    activeUnit?.institutionType || 'CAGRI_ALICI'
  );
  const [unitCity, setUnitCity] = useState<string>(
    activeUnit?.city || settings.weatherCity || 'Manisa'
  );
  const [unitCode, setUnitCode] = useState<string>(activeUnit?.unitCode || 'MANISA-112-CKM');
  const [announcement, setAnnouncement] = useState<string>(activeUnit?.announcement || '');
  const [announcementTitle, setAnnouncementTitle] = useState<string>('');
  const [announcementAttachmentName, setAnnouncementAttachmentName] = useState<string>('');
  const [announcementAttachmentType, setAnnouncementAttachmentType] = useState<string>('');
  const [announcementAttachmentDataUrl, setAnnouncementAttachmentDataUrl] = useState<string>('');
  const [publishingAnnouncement, setPublishingAnnouncement] = useState<boolean>(false);

  // Shift configuration in Admin Form
  const [numGroups, setNumGroups] = useState<number>(
    activeUnit?.numGroups || settings.numGroups || 5
  );
  const [is24Hour, setIs24Hour] = useState<boolean>(
    activeUnit ? activeUnit.is24HourSystem : settings.is24HourSystem
  );
  const [dayStart, setDayStart] = useState<string>(
    activeUnit?.dayStart || settings.dayStart || '09:00'
  );
  const [dayEnd, setDayEnd] = useState<string>(activeUnit?.dayEnd || settings.dayEnd || '19:00');
  const [nightStart, setNightStart] = useState<string>(
    activeUnit?.nightStart || settings.nightStart || '19:00'
  );
  const [nightEnd, setNightEnd] = useState<string>(
    activeUnit?.nightEnd || settings.nightEnd || '09:00'
  );
  const [shift24Start, setShift24Start] = useState<string>(
    activeUnit?.shift24Start || settings.shift24Start || '08:00'
  );
  const [restHours, setRestHours] = useState<number>(
    activeUnit?.restHours || settings.restHours || 72
  );
  const [dayRestHours, setDayRestHours] = useState<number>(
    activeUnit?.dayRestHours ?? settings.dayRestHours ?? settings.restHours ?? 72
  );
  const [nightRestHours, setNightRestHours] = useState<number>(
    activeUnit?.nightRestHours ?? settings.nightRestHours ?? settings.restHours ?? 72
  );
  const [shiftTransition, setShiftTransition] = useState<'ALTERNATE' | 'SAME'>(
    activeUnit?.shiftTransition || (settings.shiftTransition === 'SAME' ? 'SAME' : 'ALTERNATE')
  );
  const [groupCycleMode, setGroupCycleMode] = useState<'112_CLASSIC' | 'SEQUENTIAL'>(
    activeUnit?.groupCycleMode || settings.groupCycleMode || '112_CLASSIC'
  );
  const [groupNames, setGroupNames] = useState<string[]>(
    activeUnit?.groupNames || settings.groupNames
  );
  const [groupMembers, setGroupMembers] = useState<string[]>(
    activeUnit?.groupMembers || settings.groupMembers
  );
  const [refDate, setRefDate] = useState<string>(
    activeUnit?.refDate || refHistory[0]?.refDate || toISODate(new Date())
  );
  const [refGroupIdx, setRefGroupIdx] = useState<number>(
    activeUnit?.refGroupIdx ?? refHistory[0]?.myGroupIdx ?? 0
  );
  const [refType, setRefType] = useState<'GUNDUZ' | 'AKSAM'>(
    activeUnit?.refType || refHistory[0]?.refType || 'GUNDUZ'
  );

  // Bureau Record Form
  const [noteDate, setNoteDate] = useState<string>(() => toISODate(new Date()));
  const [noteEndDate, setNoteEndDate] = useState<string>('');
  const [noteType, setNoteType] = useState<RosterRecordType>('İzin / Rapor');
  const [adminLeaveSubType, setAdminLeaveSubType] = useState<
    'Yıllık İzin' | 'İdari İzin' | 'Ücretsiz İzin' | 'Raporlu' | 'Mazeret İzni'
  >('Yıllık İzin');
  const [noteGroupIdx, setNoteGroupIdx] = useState<number>(0);
  const [notePersonName, setNotePersonName] = useState<string>('');
  const [noteSwapWithPerson, setNoteSwapWithPerson] = useState<string>('');
  const [noteSwapTargetDate, setNoteSwapTargetDate] = useState<string>('');
  const [noteSwapShiftType, setNoteSwapShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');
  const [noteDesc, setNoteDesc] = useState<string>('');

  const [savingUnit, setSavingUnit] = useState<boolean>(false);
  const [savingNote, setSavingNote] = useState<boolean>(false);

  // Personnel management helper states
  const [quickAddByGroup, setQuickAddByGroup] = useState<Record<number, string>>({});
  const [expandedBulkByGroup, setExpandedBulkByGroup] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  const isSuperAdmin = useMemo(
    () => isUserSuperAdmin(currentUser?.email),
    [currentUser?.email]
  );

  useEffect(() => {
    const unsub = subscribeToMyAdminDoc(currentUser?.email, (docData) => {
      setMyAdminDoc(docData);
    });
    return () => unsub();
  }, [currentUser?.email]);

  const isAuthorizedAdmin = isSuperAdmin || Boolean(myAdminDoc);

  const pendingLeaveRequests = useMemo(
    () => activeUnitLeaveRequests.filter((r) => r.status === 'PENDING'),
    [activeUnitLeaveRequests]
  );

  useEffect(() => {
    if (!isSuperAdmin) {
      setAllAuthorizedAdmins([]);
      return;
    }
    const unsub = subscribeToAllAuthorizedAdmins((list) => {
      setAllAuthorizedAdmins(list);
    });
    return () => unsub();
  }, [isSuperAdmin]);

  // Sync editor fields when editingUnitDoc changes
  useEffect(() => {
    if (!editingUnitDoc) return;
    setUnitName(editingUnitDoc.name);
    setUnitType(editingUnitDoc.institutionType);
    setUnitCity(editingUnitDoc.city);
    setUnitCode(editingUnitDoc.unitCode);
    setAnnouncement(editingUnitDoc.announcement || '');
    setNumGroups(editingUnitDoc.numGroups);
    setIs24Hour(editingUnitDoc.is24HourSystem);
    setDayStart(editingUnitDoc.dayStart);
    setDayEnd(editingUnitDoc.dayEnd);
    setNightStart(editingUnitDoc.nightStart);
    setNightEnd(editingUnitDoc.nightEnd);
    setShift24Start(editingUnitDoc.shift24Start);
    setRestHours(editingUnitDoc.restHours);
    setDayRestHours(editingUnitDoc.dayRestHours);
    setNightRestHours(editingUnitDoc.nightRestHours);
    setShiftTransition(editingUnitDoc.shiftTransition);
    setGroupCycleMode(editingUnitDoc.groupCycleMode);
    setGroupNames(editingUnitDoc.groupNames);
    setGroupMembers(editingUnitDoc.groupMembers);
    setRefDate(editingUnitDoc.refDate);
    setRefGroupIdx(editingUnitDoc.refGroupIdx);
    setRefType(editingUnitDoc.refType);
  }, [editingUnitDoc]);

  const filteredUnits = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    return allUnits.filter((u) => {
      if (filterType !== 'ALL' && u.institutionType !== filterType) return false;
      if (!q) return true;
      return (
        u.name.toLocaleLowerCase('tr-TR').includes(q) ||
        u.city.toLocaleLowerCase('tr-TR').includes(q) ||
        u.unitCode.toLocaleLowerCase('tr-TR').includes(q)
      );
    });
  }, [allUnits, filterType, searchQuery]);

  const groupedCloudNotes = useMemo(
    () => groupConsecutiveRecords(activeUnitCloudNotes),
    [activeUnitCloudNotes]
  );

  const filteredCloudNotes = useMemo(() => {
    const q = recordSearchQuery.trim().toLocaleLowerCase('tr-TR');
    if (!q) return groupedCloudNotes;
    return groupedCloudNotes.filter(
      (grp) =>
        grp.personName.toLocaleLowerCase('tr-TR').includes(q) ||
        grp.type.toLocaleLowerCase('tr-TR').includes(q) ||
        (grp.desc || '').toLocaleLowerCase('tr-TR').includes(q) ||
        trDateFormatter(grp.startDate).includes(q) ||
        trDateFormatter(grp.endDate).includes(q)
    );
  }, [groupedCloudNotes, recordSearchQuery]);

  const allPersonnelByGroup = useMemo(() => {
    return Array.from({ length: numGroups }, (_, gIdx) => {
      const raw = groupMembers[gIdx] || '';
      return raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    });
  }, [groupMembers, numGroups]);

  const totalPersonnelCount = useMemo(
    () => allPersonnelByGroup.reduce((sum, list) => sum + list.length, 0),
    [allPersonnelByGroup]
  );

  const flatPersonnelList = useMemo(() => {
    const list: Array<{ name: string; groupIdx: number; groupName: string }> = [];
    allPersonnelByGroup.forEach((members, gIdx) => {
      const gName = groupNames[gIdx] || `${gIdx + 1}. Grup`;
      members.forEach((m) => {
        list.push({ name: m, groupIdx: gIdx, groupName: gName });
      });
    });
    return list;
  }, [allPersonnelByGroup, groupNames]);

  const handleChangeGroupCount = (nextCount: number) => {
    const clamped = Math.max(2, Math.min(10, nextCount));
    setNumGroups(clamped);
    setGroupNames((prev) => {
      const copy = [...prev];
      while (copy.length < clamped) copy.push(`${copy.length + 1}. Grup`);
      return copy;
    });
    setGroupMembers((prev) => {
      const copy = [...prev];
      while (copy.length < clamped) copy.push('');
      return copy;
    });
    if (refGroupIdx >= clamped) {
      setRefGroupIdx(clamped - 1);
    }
  };

  const updateGroupMemberArray = (gIdx: number, nextList: string[]) => {
    setGroupMembers((prev) => {
      const copy = [...prev];
      while (copy.length <= gIdx) copy.push('');
      copy[gIdx] = nextList.map((s) => formatTitleCaseTR(s)).filter(Boolean).join(', ');
      return copy;
    });
  };

  const handleQuickAddMembersToGroup = (gIdx: number, rawInput?: string) => {
    const text = (rawInput !== undefined ? rawInput : quickAddByGroup[gIdx] || '').trim();
    if (!text) return;
    const incoming = text
      .split(/[,;\n]+/)
      .map((s) => formatTitleCaseTR(s))
      .filter(Boolean);
    if (incoming.length === 0) return;
    const currentList = allPersonnelByGroup[gIdx] || [];
    updateGroupMemberArray(gIdx, [...currentList, ...incoming]);
    setQuickAddByGroup((prev) => ({ ...prev, [gIdx]: '' }));
  };

  const handleMoveMemberOrder = (gIdx: number, memberIdx: number, direction: -1 | 1) => {
    const currentList = [...(allPersonnelByGroup[gIdx] || [])];
    const targetIdx = memberIdx + direction;
    if (targetIdx < 0 || targetIdx >= currentList.length) return;
    const temp = currentList[memberIdx];
    currentList[memberIdx] = currentList[targetIdx];
    currentList[targetIdx] = temp;
    updateGroupMemberArray(gIdx, currentList);
  };

  const handleTransferMemberGroup = (fromGIdx: number, memberIdx: number, toGIdx: number) => {
    if (fromGIdx === toGIdx) return;
    const sourceList = [...(allPersonnelByGroup[fromGIdx] || [])];
    const [person] = sourceList.splice(memberIdx, 1);
    if (!person) return;
    const destList = [...(allPersonnelByGroup[toGIdx] || []), person];
    setGroupMembers((prev) => {
      const copy = [...prev];
      while (copy.length <= Math.max(fromGIdx, toGIdx)) copy.push('');
      copy[fromGIdx] = sourceList.join(', ');
      copy[toGIdx] = destList.join(', ');
      return copy;
    });
  };

  const handleRemoveMemberFromGroup = (gIdx: number, memberIdx: number) => {
    const currentList = [...(allPersonnelByGroup[gIdx] || [])];
    currentList.splice(memberIdx, 1);
    updateGroupMemberArray(gIdx, currentList);
  };

  // Draft settings object for live 7-day shift & reference verification preview
  const draftPreviewSettings = useMemo<AppSettings>(
    () => ({
      ...settings,
      numGroups,
      is24HourSystem: is24Hour,
      dayStart,
      dayEnd,
      nightStart,
      nightEnd,
      shift24Start,
      restHours,
      dayRestHours,
      nightRestHours,
      shiftTransition,
      groupCycleMode,
      groupNames: Array.from({ length: numGroups }, (_, i) => groupNames[i] || `${i + 1}. Grup`),
      groupMembers: Array.from({ length: numGroups }, (_, i) => groupMembers[i] || ''),
    }),
    [
      settings,
      numGroups,
      is24Hour,
      dayStart,
      dayEnd,
      nightStart,
      nightEnd,
      shift24Start,
      restHours,
      dayRestHours,
      nightRestHours,
      shiftTransition,
      groupCycleMode,
      groupNames,
      groupMembers,
    ]
  );

  const shiftDurationInfo = useMemo(() => {
    const [dayHours, nightHours] = getShiftDurations(draftPreviewSettings);
    return { dayHours, nightHours };
  }, [draftPreviewSettings]);

  const sevenDayPreview = useMemo(() => {
    const baseISO = refDate || toISODate(new Date());
    const [y, m, d] = baseISO.split('-').map(Number);
    const startDt = new Date(y || 2026, (m || 1) - 1, d || 1);
    const tempRef: RefRecord[] = [
      {
        validFrom: '1970-01-01',
        myGroupIdx: Math.max(0, Math.min(numGroups - 1, refGroupIdx)),
        refDate: baseISO,
        refType,
      },
    ];

    return Array.from({ length: 7 }, (_, offset) => {
      const dt = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate() + offset);
      const iso = toISODate(dt);
      const dayGroups: string[] = [];
      const nightGroups: string[] = [];
      for (let g = 0; g < numGroups; g++) {
        const res = querySingleDayForGroup(iso, g, draftPreviewSettings, tempRef, []);
        const gLabel = groupNames[g] || `${g + 1}. Grup`;
        if (res.dayShift) dayGroups.push(gLabel);
        if (res.nightShift) nightGroups.push(gLabel);
      }
      return {
        iso,
        isRefDay: offset === 0,
        dayLabel: dayGroups.join(', ') || '—',
        nightLabel: nightGroups.join(', ') || '—',
      };
    });
  }, [refDate, refGroupIdx, refType, numGroups, draftPreviewSettings, groupNames]);

  const canEditSelectedUnit = Boolean(currentUser && isAuthorizedAdmin);

  const formatFriendlyError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : String(err || fallback);
    if (raw.includes('auth/popup-closed-by-user') || raw.includes('auth/cancelled-popup-request')) {
      return 'Google giriş penceresi kapatıldı. Lütfen tekrar giriş yapın.';
    }
    if (raw.includes('auth/popup-blocked')) {
      return 'Tarayıcı açılır pencereyi engelledi. Lütfen açılır pencereye izin verin.';
    }
    if (raw.includes('Missing or insufficient permissions')) {
      return 'Bu işlem için Ana Yönetici tarafından yetkilendirilmiş Kurum Admini olmanız gerekiyor.';
    }
    return raw || fallback;
  };

  const handlePrepareNewUnit = (typeOverride?: InstitutionType) => {
    const nextType = typeOverride || unitType;
    const meta = getInstitutionMeta(nextType);
    const city = settings.weatherCity || 'Manisa';
    setIsCreatingNewDraft(true);
    setEditingUnitId(null);
    setUnitType(nextType);
    setUnitCity(city);
    setUnitName(`${city} ${meta.defaultUnitName}`);
    setUnitCode(sanitizeUnitCode(`${city}-${meta.shortLabel}-112`));
    setAnnouncement('');
    setAdminSection('identity');
  };

  const handlePublishUnitToServer = async (): Promise<string | null> => {
    if (!currentUser || !isAuthorizedAdmin) return null;
    setSavingUnit(true);
    setAuthError('');
    try {
      const draftSettings: AppSettings = {
        ...settings,
        numGroups,
        is24HourSystem: is24Hour,
        dayStart,
        dayEnd,
        nightStart,
        nightEnd,
        shift24Start,
        restHours,
        dayRestHours,
        nightRestHours,
        shiftTransition,
        groupCycleMode,
        groupNames: Array.from({ length: numGroups }, (_, i) => groupNames[i] || `${i + 1}. Grup`),
        groupMembers: Array.from({ length: numGroups }, (_, i) => groupMembers[i] || ''),
      };

      const savedId = await saveInstitutionUnitToCloud({
        existingUnit: editingUnitDoc,
        name: unitName,
        institutionType: unitType,
        city: unitCity,
        unitCode,
        settings: draftSettings,
        refDate,
        refGroupIdx,
        refType,
        announcement,
      });

      setIsCreatingNewDraft(false);
      setEditingUnitId(savedId);

      const publishedDoc: InstitutionUnitDoc = {
        id: savedId,
        name: unitName.trim(),
        institutionType: unitType,
        city: unitCity,
        unitCode: sanitizeUnitCode(unitCode),
        ownerUid: editingUnitDoc?.ownerUid || currentUser.uid,
        ownerName: isSuperAdmin
          ? currentUser.displayName || 'Ana Yönetici'
          : currentUser.displayName || currentUser.email || 'Büro Yöneticisi',
        adminUids: editingUnitDoc?.adminUids || [currentUser.uid],
        numGroups,
        is24HourSystem: is24Hour,
        dayStart,
        dayEnd,
        nightStart,
        nightEnd,
        shift24Start,
        restHours,
        dayRestHours,
        nightRestHours,
        shiftTransition,
        groupCycleMode,
        groupNames: draftSettings.groupNames,
        groupMembers: draftSettings.groupMembers,
        refDate,
        refGroupIdx,
        refType,
        announcement,
      };
      onSelectActiveUnit(publishedDoc, publishedDoc.refGroupIdx);
      onTriggerToast(
        'Kurum Vardiyası Güncellendi',
        `${publishedDoc.name} (${publishedDoc.unitCode}) sunucuda canlı olarak yayınlandı.`
      );
      return savedId;
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Sunucuya kaydedilirken hata oluştu.'));
      return null;
    } finally {
      setSavingUnit(false);
    }
  };

  const handleSelectAnnouncementFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 650 * 1024) {
      setAuthError(
        'Eklenen resmi yazı veya PDF dosyası en fazla 650 KB olabilir. Lütfen daha küçük boyutlu bir PDF veya görsel seçin.'
      );
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl.length > 900000) {
        setAuthError('Dosya boyutu sunucu sınırını aşıyor (maksimum 650 KB).');
        return;
      }
      setAnnouncementAttachmentName(file.name);
      setAnnouncementAttachmentType(file.type || 'application/pdf');
      setAnnouncementAttachmentDataUrl(dataUrl);
      setAuthError('');
    };
    reader.onerror = () => {
      setAuthError('Dosya okunamadı. Lütfen tekrar deneyin.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePublishAnnouncementToCloud = async () => {
    const cleanText = announcement.trim();
    if (!cleanText) {
      setAuthError('Lütfen yayınlanacak duyuru metnini yazın.');
      return;
    }
    setPublishingAnnouncement(true);
    setAuthError('');
    try {
      let targetUnitId = editingUnitDoc?.id || activeUnit?.id || null;
      if (!targetUnitId) {
        targetUnitId = await handlePublishUnitToServer();
      }
      if (!targetUnitId) {
        setAuthError('Önce kurumu sunucuya kaydetmelisiniz.');
        return;
      }

      await addUnitAnnouncementToCloud({
        unitId: targetUnitId,
        title: announcementTitle.trim() || 'Resmi Kurum Duyurusu',
        content: cleanText,
        attachmentName: announcementAttachmentName,
        attachmentType: announcementAttachmentType,
        attachmentDataUrl: announcementAttachmentDataUrl,
      });

      setAnnouncementTitle('');
      setAnnouncementAttachmentName('');
      setAnnouncementAttachmentType('');
      setAnnouncementAttachmentDataUrl('');
      onTriggerToast(
        'Resmi Duyuru Yayınlandı',
        'Duyuru ve ekli belge sunucuya kaydedildi, personel ekranına gönderildi.'
      );
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Duyuru yayınlanırken hata oluştu.'));
    } finally {
      setPublishingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncementFromCloud = async (annId: string) => {
    const targetUnitId = editingUnitDoc?.id || activeUnit?.id;
    if (!targetUnitId) return;
    setAuthError('');
    try {
      await deleteUnitAnnouncementFromCloud(targetUnitId, annId);
      onTriggerToast('Duyuru Silindi', 'Seçilen duyuru sunucudan kaldırıldı.');
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Duyuru silinemedi.'));
    }
  };

  const handleOpenOrDownloadAttachment = (ann: {
    attachmentName: string;
    attachmentDataUrl: string;
  }) => {
    if (!ann.attachmentDataUrl) return;
    const link = document.createElement('a');
    link.href = ann.attachmentDataUrl;
    link.download = ann.attachmentName || 'resmi_yazi.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddOfficialRosterRecord = async () => {
    if (!notePersonName.trim()) {
      setAuthError('Lütfen ilgili personeli seçin veya adını yazın.');
      return;
    }
    setSavingNote(true);
    setAuthError('');
    try {
      let targetUnitId = editingUnitDoc?.id || activeUnit?.id || null;
      if (!targetUnitId) {
        targetUnitId = await handlePublishUnitToServer();
      }
      if (!targetUnitId) {
        setAuthError(
          'Kurum sunucuda oluşturulamadı. Lütfen önce "Kurum & Vardiya" bölümünden kurumu kaydedin.'
        );
        return;
      }

      const effectiveEnd =
        noteType === 'İzin / Rapor' ||
        noteType === 'İcap Nöbeti' ||
        noteType === 'Nöbet Boşa Çıkarma'
          ? noteEndDate.trim() || undefined
          : undefined;

      if (
        noteType === 'Ek Nöbet' ||
        noteType === 'Nöbet Boşa Çıkarma' ||
        noteType === 'İzin / Rapor' ||
        noteType === 'İcap Nöbeti'
      ) {
        const sISO = noteDate.trim();
        const eISO = effectiveEnd && effectiveEnd >= sISO ? effectiveEnd : sISO;
        const conflictingCloud = activeUnitCloudNotes.filter(
          (cn) =>
            cn.date >= sISO &&
            cn.date <= eISO &&
            isSamePersonNameTR(cn.personName, notePersonName.trim()) &&
            (cn.type === 'Ek Nöbet' ||
              cn.type === 'Nöbet Boşa Çıkarma' ||
              cn.type === 'İzin / Rapor' ||
              cn.type === 'İcap Nöbeti')
        );
        for (const cn of conflictingCloud) {
          await deleteUnitRosterNoteFromCloud(targetUnitId, cn.id);
        }
      }

      const effectiveNoteDesc =
        noteType === 'İzin / Rapor'
          ? noteDesc.trim()
            ? noteDesc.trim().toLowerCase().includes(adminLeaveSubType.toLowerCase())
              ? noteDesc.trim()
              : `${adminLeaveSubType} · ${noteDesc.trim()}`
            : adminLeaveSubType
          : noteDesc.trim();

      const addedDays = await addUnitRosterNoteRangeToCloud({
        unitId: targetUnitId,
        startDate: noteDate,
        endDate: effectiveEnd,
        type: noteType,
        personName: notePersonName.trim(),
        groupIdx: noteGroupIdx,
        swapWithPerson: noteType === 'Nöbet Değişimi' ? noteSwapWithPerson.trim() : '',
        swapTargetDate: noteType === 'Nöbet Değişimi' ? noteSwapTargetDate.trim() : '',
        swapShiftType: noteSwapShiftType,
        desc: effectiveNoteDesc,
      });
      setNoteDesc('');
      setNoteEndDate('');
      onTriggerToast(
        'Resmi Çizelge Kaydı Eklendi',
        addedDays > 1
          ? `${notePersonName} için ${addedDays} günlük ${noteType === 'İzin / Rapor' ? adminLeaveSubType : noteType} kaydı işlendi.`
          : `${notePersonName} için ${trDateFormatter(noteDate)} tarihli ${noteType === 'İzin / Rapor' ? adminLeaveSubType : noteType} kaydı işlendi.`
      );
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Kayıt eklenemedi.'));
    } finally {
      setSavingNote(false);
    }
  };

  const handleAddAuthorizedAdmin = async () => {
    if (!isSuperAdmin) return;
    setSavingNewAdmin(true);
    setAuthError('');
    try {
      await addAuthorizedAdminToCloud({
        email: newAdminEmail,
        name: newAdminName,
        institutionType: newAdminInstType,
        unitCode: newAdminUnitCode,
      });
      onTriggerToast(
        'Kurum Admini Yetkilendirildi',
        `${newAdminEmail.trim().toLowerCase()} artık kurum verisi yönetebilir.`
      );
      setNewAdminEmail('');
      setNewAdminName('');
      setNewAdminUnitCode('');
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Admin eklenirken hata oluştu.'));
    } finally {
      setSavingNewAdmin(false);
    }
  };

  const handleRemoveAuthorizedAdmin = async (email: string) => {
    if (!isSuperAdmin) return;
    setAuthError('');
    try {
      await removeAuthorizedAdminFromCloud(email);
      onTriggerToast('Admin Yetkisi Kaldırıldı', `${email} hesabının yönetici yetkisi iptal edildi.`);
    } catch (err) {
      setAuthError(formatFriendlyError(err, 'Admin silinemedi.'));
    }
  };

  // Consistent surface & input styling for both light and dark modes
  const surfaceBg = isLight ? 'bg-white text-slate-900' : 'bg-[#0b101b] text-slate-100';
  const sidebarBg = isLight
    ? 'bg-slate-50 border-slate-200'
    : 'bg-[#0f1523] border-slate-800/90';
  const borderHairline = isLight ? 'border-slate-200' : 'border-slate-800';
  const subtleCardBg = isLight
    ? 'bg-slate-50/90 border-slate-200'
    : 'bg-slate-900/60 border-slate-800';
  const mutedText = isLight ? 'text-slate-500' : 'text-slate-400';
  const labelClass = `block text-xs font-semibold mb-1.5 ${
    isLight ? 'text-slate-700' : 'text-slate-300'
  }`;
  const inputClass = `w-full h-10 px-3 rounded-lg border text-sm font-medium outline-none transition ${
    isLight
      ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15'
      : 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20'
  }`;

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.ReactNode;
    count?: number;
    highlight?: boolean;
  }> = [
    {
      id: 'units',
      label: 'Kurumlar',
      icon: <Building2 className="w-4 h-4 shrink-0" />,
      count: allUnits.length,
    },
    {
      id: 'shift_ref',
      label: 'Vardiya & Referans',
      icon: <CalendarClock className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'personnel',
      label: 'Gruplar & Personel',
      icon: <Users className="w-4 h-4 shrink-0" />,
      count: totalPersonnelCount,
    },
    {
      id: 'records',
      label: 'İzin & Talepler',
      icon: <ClipboardList className="w-4 h-4 shrink-0" />,
      count: pendingLeaveRequests.length > 0 ? pendingLeaveRequests.length : groupedCloudNotes.length,
      highlight: pendingLeaveRequests.length > 0,
    },
    {
      id: 'identity',
      label: 'Kurum Bilgisi',
      icon: <Settings2 className="w-4 h-4 shrink-0" />,
    },
    ...(isSuperAdmin
      ? [
          {
            id: 'admins' as AdminSection,
            label: 'Adminler',
            icon: <Crown className="w-4 h-4 shrink-0" />,
            count: allAuthorizedAdmins.length + 1,
          },
        ]
      : []),
  ];

  const showSaveFooter =
    Boolean(currentUser && isAuthorizedAdmin) &&
    (adminSection === 'identity' || adminSection === 'shift_ref' || adminSection === 'personnel');

  const signedInDisplayIdentity = isSuperAdmin
    ? `${currentUser?.displayName || 'Ana Yönetici'} · Ana Yönetici`
    : `${currentUser?.displayName || myAdminDoc?.name || currentUser?.email || 'Yönetici'} · Kurum Admini`;

  return (
    <div
      data-no-swipe="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-4xl h-[92vh] sm:h-[86vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${surfaceBg} ${borderHairline}`}
      >
        {/* TOP BAR (Single Clean Row, 3-Zone Discipline) */}
        <header
          className={`flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 border-b shrink-0 ${
            isLight ? 'bg-white border-slate-200' : 'bg-[#0f1523] border-slate-800'
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold tracking-tight truncate">
              Yönetici Paneli
            </h2>
            <p className={`text-xs truncate ${mutedText}`}>
              {currentUser && isAuthorizedAdmin
                ? signedInDisplayIdentity
                : 'Kurum vardiya sunucusu ve çizelge yönetimi'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentUser && isAuthorizedAdmin && activeUnit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRosterTable();
                }}
                className="h-9 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Çizelgeyi Aç</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center transition cursor-pointer shrink-0 ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                  : 'bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300'
              }`}
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* AUTH GATE: NOT SIGNED IN OR UNAUTHORIZED */}
        {!currentUser ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex items-center justify-center">
            <div className="w-full max-w-md space-y-4">
              {authError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-400 text-xs font-medium flex items-center justify-between gap-2">
                  <span>{authError}</span>
                  <button
                    type="button"
                    onClick={() => setAuthError('')}
                    className="p-1 hover:opacity-80 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <VardiyaGoogleAuthCard isLight={isLight} onError={(msg) => setAuthError(msg)} />
              {onOpenFirstLaunchScreen && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFirstLaunchScreen();
                    }}
                    className={`text-xs font-semibold underline cursor-pointer ${mutedText}`}
                  >
                    Giriş ekranına dön
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : !isAuthorizedAdmin ? (
          <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
            <div
              className={`w-full max-w-md p-6 rounded-2xl border text-center space-y-4 ${subtleCardBg}`}
            >
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold">Yönetici Yetkisi Bulunamadı</h3>
                <p className={`text-xs leading-relaxed ${mutedText}`}>
                  Giriş yapılan hesap: <strong className="font-mono">{currentUser.email}</strong>.
                  <br />
                  Kurum verilerini yönetebilmek için hesabınızın Ana Yönetici tarafından Yetkili
                  Kurum Adminleri listesine eklenmesi gerekir.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                {onOpenFirstLaunchScreen && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFirstLaunchScreen();
                    }}
                    className="w-full sm:w-auto h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Giriş Ekranına Dön
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void signOutBureau()}
                  className={`w-full sm:w-auto h-10 px-4 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                    isLight
                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Farklı Hesapla Giriş Yap</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* AUTHORIZED ADMIN WORKSPACE: SIDEBAR + MAIN VIEWPORT */
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* MOBILE CONTEXT & NAVIGATION BAR (< md) */}
            <div className={`md:hidden border-b shrink-0 ${sidebarBg}`}>
              {/* Active Unit Quick Switcher Row */}
              <div className="px-3.5 pt-3 pb-2 flex items-center gap-2">
                <select
                  aria-label="Yönetilen Kurum"
                  value={editingUnitId || '__NEW__'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__NEW__') {
                      handlePrepareNewUnit();
                    } else {
                      setIsCreatingNewDraft(false);
                      setEditingUnitId(val);
                      const found = allUnits.find((u) => u.id === val);
                      if (found) onSelectActiveUnit(found, found.refGroupIdx);
                    }
                  }}
                  className={`flex-1 min-w-0 h-9 px-2.5 rounded-lg border text-xs font-semibold outline-none truncate ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900'
                      : 'bg-slate-900 border-slate-700 text-slate-100'
                  }`}
                >
                  <option value="__NEW__">+ Yeni Kurum Taslağı</option>
                  {allUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.city} · {u.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handlePrepareNewUnit()}
                  className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Yeni</span>
                </button>
              </div>

              {/* Single-Line Horizontal Scrollable Section Tabs */}
              <nav className="flex items-center gap-1 px-3 pb-2.5 overflow-x-auto no-scrollbar">
                {navItems.map((item) => {
                  const isActive = adminSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAdminSection(item.id)}
                      className={`h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                        isActive
                          ? isLight
                            ? 'bg-slate-900 text-white'
                            : 'bg-indigo-600 text-white'
                          : isLight
                          ? 'text-slate-600 hover:bg-slate-200/70'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {typeof item.count === 'number' && (
                        <span
                          className={`text-[11px] font-mono tabular-nums ${
                            item.highlight
                              ? 'text-amber-400 font-bold'
                              : isActive
                              ? 'opacity-85'
                              : 'opacity-65'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* DESKTOP LEFT SIDEBAR (>= md) */}
            <aside
              className={`hidden md:flex md:w-60 shrink-0 border-r flex-col justify-between p-3.5 overflow-y-auto ${sidebarBg}`}
            >
              <div className="space-y-4">
                {/* Active Unit Selector */}
                <div className="space-y-2">
                  <label className={`block text-[11px] font-semibold ${mutedText}`}>
                    Yönetilen Kurum
                  </label>
                  <select
                    aria-label="Yönetilen Kurum"
                    value={editingUnitId || '__NEW__'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__NEW__') {
                        handlePrepareNewUnit();
                      } else {
                        setIsCreatingNewDraft(false);
                        setEditingUnitId(val);
                        const found = allUnits.find((u) => u.id === val);
                        if (found) onSelectActiveUnit(found, found.refGroupIdx);
                      }
                    }}
                    className={`w-full h-9 px-2.5 rounded-lg border text-xs font-semibold outline-none truncate cursor-pointer ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900'
                        : 'bg-slate-900 border-slate-700 text-slate-100'
                    }`}
                  >
                    <option value="__NEW__">+ Yeni Kurum Taslağı</option>
                    {allUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.city} · {u.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handlePrepareNewUnit()}
                    className={`w-full h-9 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                      isLight
                        ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-800'
                        : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yeni Kurum Oluştur</span>
                  </button>
                </div>

                {/* Primary Vertical Navigation */}
                <nav className="space-y-1 pt-2 border-t border-slate-800/40">
                  {navItems.map((item) => {
                    const isActive = adminSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setAdminSection(item.id)}
                        className={`w-full h-10 px-3 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 transition cursor-pointer ${
                          isActive
                            ? isLight
                              ? 'bg-slate-900 text-white'
                              : 'bg-indigo-600 text-white'
                            : isLight
                            ? 'text-slate-700 hover:bg-slate-200/70'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          {item.icon}
                          <span className="truncate">{item.label}</span>
                        </span>
                        {typeof item.count === 'number' && (
                          <span
                            className={`text-xs font-mono tabular-nums shrink-0 ${
                              item.highlight
                                ? isActive
                                  ? 'text-amber-300 font-bold'
                                  : 'text-amber-400 font-bold'
                                : isActive
                                ? 'text-white/80'
                                : mutedText
                            }`}
                          >
                            {item.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Sidebar Footer Utilities */}
              <div className={`pt-3 mt-4 border-t space-y-1.5 ${borderHairline}`}>
                {onOpenFirstLaunchScreen && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFirstLaunchScreen();
                    }}
                    className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-2 transition cursor-pointer ${
                      isLight
                        ? 'text-slate-600 hover:bg-slate-200/70'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Giriş Ekranına Dön</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void signOutBureau()}
                  className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-2 transition cursor-pointer ${
                    isLight
                      ? 'text-rose-600 hover:bg-rose-50'
                      : 'text-rose-400 hover:bg-rose-950/50'
                  }`}
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Oturumu Kapat</span>
                </button>
              </div>
            </aside>

            {/* MAIN CONTENT COLUMN */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                {/* Inline Error Banner */}
                {authError && (
                  <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-400 text-xs font-medium flex items-center justify-between gap-2">
                    <span>{authError}</span>
                    <button
                      type="button"
                      onClick={() => setAuthError('')}
                      className="p-1 hover:opacity-80 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Collapsible APK / Google Setup Helper */}
                {showInfraHelper && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${mutedText}`}>
                        APK &amp; Google OAuth Ayarları
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowInfraHelper(false)}
                        className={`text-xs font-semibold cursor-pointer ${mutedText}`}
                      >
                        Gizle
                      </button>
                    </div>
                    <VardiyaGoogleAuthCard
                      isLight={isLight}
                      compact
                      onError={(msg) => setAuthError(msg)}
                    />
                  </div>
                )}

                {/* =========================================================
                    SECTION 1: KURUMLAR (INSTITUTION DIRECTORY)
                   ========================================================= */}
                {adminSection === 'units' && (
                  <div className="space-y-5">
                    {/* AKTİF KURUM HIZLI YÖNETİM MERKEZİ (Vardiya Saatleri & Referans, Nöbet Grupları & Personeller, Kurum Bilgisi, İzinler) */}
                    <div
                      className={`p-4 rounded-xl border space-y-3.5 ${
                        isLight
                          ? 'bg-indigo-50/50 border-indigo-200/80'
                          : 'bg-indigo-950/20 border-indigo-500/25'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">
                            Aktif Kurum Yönetim Merkezi
                          </div>
                          <h3 className="text-sm sm:text-base font-bold truncate mt-0.5">
                            {unitName} ({unitCity})
                          </h3>
                        </div>
                        {onResyncFromServer && (
                          <button
                            type="button"
                            disabled={resyncingServer}
                            onClick={async () => {
                              setResyncingServer(true);
                              try {
                                await onResyncFromServer();
                              } finally {
                                setResyncingServer(false);
                              }
                            }}
                            className={`h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap disabled:opacity-50 self-start sm:self-auto ${
                              isLight
                                ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${resyncingServer ? 'animate-spin' : ''}`}
                            />
                            <span>{resyncingServer ? 'Yenileniyor...' : 'Sunucudan Yenile'}</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* 1. Vardiya Saatleri ve Referans Kartı */}
                        <button
                          type="button"
                          onClick={() => setAdminSection('shift_ref')}
                          className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start justify-between gap-3 group ${
                            isLight
                              ? 'bg-white hover:bg-sky-50/70 border-slate-200/90 shadow-2xs'
                              : 'bg-slate-900/90 hover:bg-slate-800/90 border-slate-800'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <CalendarClock className="w-4 h-4 text-sky-500 shrink-0" />
                              <span className="text-xs font-bold">Vardiya Saatleri ve Referans</span>
                            </div>
                            <p className={`text-[11px] truncate ${mutedText}`}>
                              {is24Hour
                                ? `24 Saat Nöbet (${shift24Start})`
                                : `Gündüz ${dayStart}–${dayEnd} · Gece ${nightStart}–${nightEnd}`}
                            </p>
                            <p className="text-[11px] font-semibold text-sky-500 truncate">
                              Ref: {groupNames[refGroupIdx] || `${refGroupIdx + 1}. Grup`} ·{' '}
                              {trDateFormatter(refDate)} ({refType === 'GUNDUZ' ? 'Gündüz' : 'Gece'})
                            </p>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition ${
                              isLight
                                ? 'bg-sky-50 text-sky-700 group-hover:bg-sky-600 group-hover:text-white'
                                : 'bg-sky-950/70 text-sky-300 group-hover:bg-sky-600 group-hover:text-white'
                            }`}
                          >
                            Düzenle →
                          </span>
                        </button>

                        {/* 2. Nöbet Grupları ve Personeller Kartı */}
                        <button
                          type="button"
                          onClick={() => setAdminSection('personnel')}
                          className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start justify-between gap-3 group ${
                            isLight
                              ? 'bg-white hover:bg-emerald-50/70 border-slate-200/90 shadow-2xs'
                              : 'bg-slate-900/90 hover:bg-slate-800/90 border-slate-800'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="text-xs font-bold">Nöbet Grupları ve Personeller</span>
                            </div>
                            <p className={`text-[11px] truncate ${mutedText}`}>
                              {numGroups} nöbet grubu · Toplam {totalPersonnelCount} kayıtlı personel
                            </p>
                            <p className="text-[11px] font-semibold text-emerald-500 truncate">
                              Grup isimleri, personel listesi ve sorumlular
                            </p>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition ${
                              isLight
                                ? 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'
                                : 'bg-emerald-950/70 text-emerald-300 group-hover:bg-emerald-600 group-hover:text-white'
                            }`}
                          >
                            Düzenle →
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold">Kayıtlı Kurumlar</h3>
                        <p className={`text-xs mt-0.5 ${mutedText}`}>
                          Yönetmek istediğiniz kurumu seçin veya yeni bir birim oluşturun.
                        </p>
                      </div>
                    </div>

                    {/* Search & Category Filters */}
                    <div className="space-y-2.5">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="İl, kurum adı veya kurum kodu ile ara..."
                          className={`${inputClass} pl-9`}
                        />
                      </div>

                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                        <button
                          type="button"
                          onClick={() => setFilterType('ALL')}
                          className={`h-8 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer whitespace-nowrap shrink-0 ${
                            filterType === 'ALL'
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : isLight
                              ? 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          Tümü ({allUnits.length})
                        </button>
                        {INSTITUTION_TYPES.map((inst) => {
                          const count = allUnits.filter(
                            (u) => u.institutionType === inst.id
                          ).length;
                          const isSelected = filterType === inst.id;
                          return (
                            <button
                              key={inst.id}
                              type="button"
                              onClick={() => setFilterType(inst.id)}
                              className={`h-8 px-3 rounded-lg text-xs font-semibold border transition cursor-pointer whitespace-nowrap shrink-0 ${
                                isSelected
                                  ? 'bg-indigo-600 border-indigo-500 text-white'
                                  : isLight
                                  ? 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                              }`}
                            >
                              {inst.shortLabel}
                              {count > 0 ? ` (${count})` : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Directory List */}
                    {filteredUnits.length === 0 ? (
                      <div
                        className={`p-8 rounded-xl border text-center space-y-3 ${subtleCardBg}`}
                      >
                        <p className={`text-sm font-medium ${mutedText}`}>
                          Bu filtreye uygun kayıtlı kurum bulunamadı.
                        </p>
                        <button
                          type="button"
                          onClick={() => handlePrepareNewUnit()}
                          className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Yeni Kurum Oluştur</span>
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl border divide-y overflow-hidden ${borderHairline} ${
                          isLight ? 'divide-slate-200 bg-white' : 'divide-slate-800 bg-slate-900/40'
                        }`}
                      >
                        {filteredUnits.map((u) => {
                          const meta = getInstitutionMeta(u.institutionType);
                          const isConnected = activeUnit?.id === u.id;
                          const unitPersonnelCount = (u.groupMembers || []).reduce((acc, raw) => {
                            const count = raw
                              .split(/[,;\n]+/)
                              .map((s) => s.trim())
                              .filter(Boolean).length;
                            return acc + count;
                          }, 0);

                          return (
                            <div
                              key={u.id}
                              className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                                isConnected
                                  ? isLight
                                    ? 'bg-indigo-50/70'
                                    : 'bg-indigo-950/30'
                                  : ''
                              }`}
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <h4 className="text-sm font-bold truncate">{u.name}</h4>
                                  {isConnected && (
                                    <span className="text-[11px] font-semibold text-emerald-500 whitespace-nowrap shrink-0">
                                      Aktif
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={`text-xs flex items-center gap-1.5 flex-wrap tabular-nums ${mutedText}`}
                                >
                                  <span>{meta.shortLabel}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{u.city}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono">{u.unitCode}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{u.numGroups} Grup</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{unitPersonnelCount} Personel</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsCreatingNewDraft(false);
                                    setEditingUnitId(u.id);
                                    onSelectActiveUnit(u, u.refGroupIdx);
                                    setAdminSection('identity');
                                  }}
                                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                                    isLight
                                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                                  }`}
                                >
                                  Kurum Bilgisi
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsCreatingNewDraft(false);
                                    setEditingUnitId(u.id);
                                    onSelectActiveUnit(u, u.refGroupIdx);
                                    setAdminSection('shift_ref');
                                  }}
                                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                                    isLight
                                      ? 'bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-700'
                                      : 'bg-sky-950/50 hover:bg-sky-900/60 border-sky-500/30 text-sky-300'
                                  }`}
                                >
                                  Referans &amp; Saatler
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsCreatingNewDraft(false);
                                    setEditingUnitId(u.id);
                                    onSelectActiveUnit(u, u.refGroupIdx);
                                    setAdminSection('personnel');
                                  }}
                                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                                    isLight
                                      ? 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
                                      : 'bg-indigo-950/50 hover:bg-indigo-900/60 border-indigo-500/30 text-indigo-300'
                                  }`}
                                >
                                  Gruplar &amp; Personel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsCreatingNewDraft(false);
                                    setEditingUnitId(u.id);
                                    onSelectActiveUnit(u, u.refGroupIdx);
                                    onTriggerToast(
                                      `${u.name} Seçildi`,
                                      'Kurum çizelgesi ve yönetim verileri yüklendi.'
                                    );
                                  }}
                                  className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                                    isConnected
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                  }`}
                                >
                                  {isConnected ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Seçili</span>
                                    </>
                                  ) : (
                                    <span>Seç</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* =========================================================
                    SECTION 2: KURUM KİMLİĞİ VE DUYURU
                   ========================================================= */}
                {adminSection === 'identity' && (
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">
                          {editingUnitDoc ? 'Kurum Kimliği ve Duyuru' : 'Yeni Kurum Oluştur'}
                        </h3>
                        <p className={`text-xs mt-0.5 ${mutedText}`}>
                          Kurumun temel kimlik bilgilerini ve personel ekranında görünecek resmi duyuruyu düzenleyin.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdminSection('shift_ref')}
                        className="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto shrink-0"
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                        <span>Referans &amp; Saatlere Geç →</span>
                      </button>
                    </div>

                    <section className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                      <h4 className={`text-xs font-bold uppercase tracking-wider ${mutedText}`}>
                        1. Kurum Kimlik Bilgileri
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className={labelClass}>Kurum Kategorisi</label>
                          <select
                            value={unitType}
                            onChange={(e) => {
                              const nextT = e.target.value as InstitutionType;
                              setUnitType(nextT);
                              if (!editingUnitId) {
                                const meta = getInstitutionMeta(nextT);
                                setUnitName(`${unitCity} ${meta.defaultUnitName}`);
                                setUnitCode(
                                  sanitizeUnitCode(`${unitCity}-${meta.shortLabel}-112`)
                                );
                              }
                            }}
                            className={inputClass}
                          >
                            {INSTITUTION_TYPES.map((inst) => (
                              <option key={inst.id} value={inst.id}>
                                {inst.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>İl</label>
                          <select
                            value={unitCity}
                            onChange={(e) => setUnitCity(e.target.value)}
                            className={inputClass}
                          >
                            {TURKISH_PROVINCES.map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Kurum / Birim Adı</label>
                          <input
                            type="text"
                            value={unitName}
                            onChange={(e) => setUnitName(e.target.value)}
                            placeholder="Örn: Kütahya 112 Çağrı Alıcı"
                            className={inputClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>Resmi Kurum Kodu</label>
                          <input
                            type="text"
                            value={unitCode}
                            onChange={(e) => setUnitCode(sanitizeUnitCode(e.target.value))}
                            placeholder="KUTAHYA-112-CKM"
                            className={`${inputClass} font-mono uppercase`}
                          />
                        </div>
                      </div>
                    </section>

                    <section className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${mutedText}`}>
                          <Megaphone className="w-3.5 h-3.5 text-amber-500" />
                          <span>2. Kurum Geneli Resmi Büro Duyurusu</span>
                        </h4>
                        <span className={`text-[11px] font-medium ${mutedText}`}>
                          Sunucuya kaydedilir · PDF / Resmi Yazı eklenebilir
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className={labelClass}>Duyuru Başlığı (İsteğe Bağlı)</label>
                          <input
                            type="text"
                            value={announcementTitle}
                            onChange={(e) => setAnnouncementTitle(e.target.value)}
                            maxLength={140}
                            placeholder="Örn: Kasım Ayı Nöbet Çizelgesi ve Resmi Yazı"
                            className={inputClass}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>
                            Duyuru Metni (Personel ekranında bildirim ikonu üzerinde gösterilir)
                          </label>
                          <textarea
                            rows={3}
                            value={announcement}
                            onChange={(e) => setAnnouncement(e.target.value)}
                            maxLength={1800}
                            placeholder="Örn: Kasım ayı resmi nöbet çizelgesi yayınlanmıştır. Ekli resmi yazıyı inceleyerek izin taleplerinizi ayın 25'ine kadar iletiniz."
                            className={`w-full p-3 rounded-lg border text-sm font-medium outline-none transition resize-none ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15'
                                : 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20'
                            }`}
                          />
                        </div>

                        {/* File / PDF Attachment Picker */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <label
                              className={`h-9 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                                isLight
                                  ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                              }`}
                            >
                              <Paperclip className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>Resmi Yazı / PDF / Belge Ekle</span>
                              <input
                                type="file"
                                accept=".pdf,application/pdf,image/*,.doc,.docx"
                                onChange={handleSelectAnnouncementFile}
                                className="hidden"
                              />
                            </label>

                            {announcementAttachmentName ? (
                              <div
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${
                                  isLight
                                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                                    : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                                }`}
                              >
                                <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <span className="max-w-[200px] truncate">
                                  {announcementAttachmentName}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAnnouncementAttachmentName('');
                                    setAnnouncementAttachmentType('');
                                    setAnnouncementAttachmentDataUrl('');
                                  }}
                                  className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
                                  title="Eki Kaldır"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className={`text-[11px] ${mutedText}`}>
                                PDF veya görsel (maks. 650 KB)
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={publishingAnnouncement || !announcement.trim()}
                            onClick={() => void handlePublishAnnouncementToCloud()}
                            className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0"
                          >
                            <Megaphone className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {publishingAnnouncement
                                ? 'Sunucuya Kaydediliyor...'
                                : 'Duyuruyu Yayınla'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Published Announcements List Below Form */}
                      <div className={`pt-4 mt-3 border-t space-y-2.5 ${borderHairline}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
                            Yayınlanan Kurum Duyuruları ({activeUnitAnnouncements.length})
                          </span>
                        </div>

                        {activeUnitAnnouncements.length === 0 ? (
                          <div
                            className={`p-3.5 rounded-lg border text-xs ${
                              isLight
                                ? 'bg-white border-slate-200 text-slate-500'
                                : 'bg-slate-900/50 border-slate-800 text-slate-400'
                            }`}
                          >
                            Henüz kayıtlı duyuru bulunmuyor. Yukarıdaki alandan duyuru metni ve resmi yazı PDF dosyası ekleyerek yayınlayabilirsiniz.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {activeUnitAnnouncements.map((ann) => (
                              <div
                                key={ann.id}
                                className={`p-3 rounded-lg border flex flex-col gap-2 ${
                                  isLight
                                    ? 'bg-white border-slate-200 text-slate-800'
                                    : 'bg-slate-900/80 border-slate-800 text-slate-100'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold truncate">
                                      {ann.title || 'Resmi Kurum Duyurusu'}
                                    </div>
                                    <div className={`text-[11px] ${mutedText}`}>
                                      {ann.authorName || 'Yönetici'}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteAnnouncementFromCloud(ann.id)}
                                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition cursor-pointer shrink-0"
                                    title="Duyuruyu Sil"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                                  {ann.content}
                                </p>

                                {ann.attachmentDataUrl && (
                                  <div className="pt-1">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrDownloadAttachment(ann)}
                                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
                                        isLight
                                          ? 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900'
                                          : 'bg-amber-950/40 hover:bg-amber-900/50 border-amber-500/40 text-amber-200'
                                      }`}
                                    >
                                      <Download className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                      <span className="truncate max-w-[230px]">
                                        {ann.attachmentName || 'Resmi Yazı / PDF İndir'}
                                      </span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {/* =========================================================
                    SECTION 3: NÖBET REFERANSI VE VARDİYA SAATLERİ (DETAYLI ADMİN YÖNETİMİ)
                   ========================================================= */}
                {adminSection === 'shift_ref' && (
                  <div className="space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">
                          Nöbet Referansı ve Vardiya Saatleri
                        </h3>
                        <p className={`text-xs mt-0.5 ${mutedText}`}>
                          Kurumun referans nöbet başlangıcını, vardiya saatlerini, izin sürelerini ve grup döngüsünü detaylı olarak yapılandırın.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdminSection('personnel')}
                        className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto shrink-0"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Gruplar &amp; Personele Geç →</span>
                      </button>
                    </div>

                    {/* AKTİF VARDİYA & REFERANS ÖZET KARTI */}
                    <div
                      className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isLight
                          ? 'bg-sky-50/80 border-sky-200 text-slate-900'
                          : 'bg-sky-950/25 border-sky-500/25 text-slate-100'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-sky-500">
                          Canlı Kurum Vardiya &amp; Referans Özeti · {unitName}
                        </div>
                        <div className="text-sm font-bold truncate">
                          Referans: {groupNames[refGroupIdx] || `${refGroupIdx + 1}. Grup`} ·{' '}
                          {trDateFormatter(refDate)} (
                          {is24Hour
                            ? '24 Saat Nöbet'
                            : refType === 'GUNDUZ'
                            ? '☀️ Sabah / Gündüz - S'
                            : '🌙 Akşam / Gece - A'}
                          )
                        </div>
                        <div className={`text-xs flex items-center gap-1.5 flex-wrap ${mutedText}`}>
                          <span>{numGroups} Nöbet Grubu</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {is24Hour
                              ? `24 Saat (${shift24Start})`
                              : `Gündüz ${dayStart}–${dayEnd} (${shiftDurationInfo.dayHours}s) / Gece ${nightStart}–${nightEnd} (${shiftDurationInfo.nightHours}s)`}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {!is24Hour && dayRestHours !== nightRestHours
                              ? `${dayRestHours}s Gündüz İzni / ${nightRestHours}s Gece İzni`
                              : `${restHours} Saat İzin`}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 self-start sm:self-center ${
                          isLight
                            ? 'bg-sky-500/15 text-sky-800'
                            : 'bg-sky-500/20 text-sky-300'
                        }`}
                      >
                        {groupCycleMode === 'SEQUENTIAL' ? 'Sıralı Döngü' : '112 Klasik Döngü'}
                      </span>
                    </div>

                    {/* KURULUM YÖNTEMİ SEÇİMİ: MANUEL DETAYLI KURULUM vs PDF / FOTOĞRAFTAN OTOMATİK KURULUM */}
                    <div
                      className={`p-1 rounded-xl border grid grid-cols-2 gap-1.5 ${
                        isLight
                          ? 'bg-slate-100 border-slate-200/90'
                          : 'bg-slate-900/80 border-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setRefSetupMode('manual')}
                        className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          refSetupMode === 'manual'
                            ? isLight
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'bg-slate-800 text-white shadow-xs'
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <span className="truncate">Manuel Kurulum &amp; Saatler</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setRefSetupMode('ai')}
                        className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          refSetupMode === 'ai'
                            ? isLight
                              ? 'bg-white text-emerald-700 shadow-xs'
                              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 shadow-xs'
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="truncate">PDF / Fotoğraftan Kur</span>
                      </button>
                    </div>

                    {refSetupMode === 'ai' && (
                      <div className="space-y-3 animate-fade-in">
                        <ShiftScheduleImporter
                          settings={draftPreviewSettings}
                          refHistory={refHistory}
                          notes={notes}
                          isLight={isLight}
                          onUpdateSettings={(nextSettings) => {
                            setNumGroups(nextSettings.numGroups);
                            setIs24Hour(nextSettings.is24HourSystem);
                            setDayStart(nextSettings.dayStart);
                            setDayEnd(nextSettings.dayEnd);
                            setNightStart(nextSettings.nightStart);
                            setNightEnd(nextSettings.nightEnd);
                            setShift24Start(nextSettings.shift24Start);
                            setRestHours(nextSettings.restHours);
                            setDayRestHours(nextSettings.dayRestHours ?? nextSettings.restHours);
                            setNightRestHours(
                              nextSettings.nightRestHours ?? nextSettings.restHours
                            );
                            if (nextSettings.shiftTransition) {
                              setShiftTransition(
                                nextSettings.shiftTransition === 'SAME' ? 'SAME' : 'ALTERNATE'
                              );
                            }
                            if (nextSettings.groupCycleMode) {
                              setGroupCycleMode(nextSettings.groupCycleMode);
                            }
                            setGroupNames(nextSettings.groupNames);
                            setGroupMembers(nextSettings.groupMembers);
                            onUpdateSettings?.(nextSettings);
                          }}
                          onSaveNotes={(nextNotes, nextRefs) => {
                            onSaveNotes?.(nextNotes, nextRefs);
                          }}
                          onSyncLocalRefState={(gIdx, rDate, rType) => {
                            setRefGroupIdx(gIdx);
                            setRefDate(rDate);
                            setRefType(rType);
                          }}
                          onFeedback={(msg) =>
                            onTriggerToast('Çizelge Aktarıldı', msg)
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setRefSetupMode('manual')}
                          className={`w-full h-10 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                            isLight
                              ? 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                          }`}
                        >
                          ← Manuel Nöbet Referansı ve Saat Ayarlarına Dön
                        </button>
                      </div>
                    )}

                    {refSetupMode === 'manual' && (
                      <>
                    {/* 1. ADIM: NÖBET REFERANS BAŞLANGICI (BAŞLANGIÇ NOKTASI) */}
                    <section className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0">
                            1
                          </span>
                          <div>
                            <h4 className="text-sm font-bold">
                              Nöbet Referans Başlangıcı (Hesaplama Başlangıç Noktası)
                            </h4>
                            <p className={`text-xs ${mutedText}`}>
                              Bilinen bir nöbet gününü, o gün nöbetçi olan grubu ve vardiyasını seçin. Tüm takvim bu referansa göre dizilir.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Nöbetçi Grup Seçim Butonları */}
                      <div>
                        <label className={labelClass}>1. Referans Nöbetçi Grubu Seçin</label>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                          {Array.from({ length: numGroups }, (_, i) => {
                            const isSelected = refGroupIdx === i;
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setRefGroupIdx(i)}
                                className={`h-10 px-2.5 rounded-lg border text-xs font-bold transition cursor-pointer truncate ${
                                  isSelected
                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                                    : isLight
                                    ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                                }`}
                              >
                                {groupNames[i] || `${i + 1}. Grup`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Referans Tarih ve Vardiya Türü */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold">2. Referans Nöbet Tarihi</label>
                            <button
                              type="button"
                              onClick={() => setRefDate(toISODate(new Date()))}
                              className="text-[11px] font-semibold text-indigo-500 hover:underline cursor-pointer"
                            >
                              Bugünü Seç
                            </button>
                          </div>
                          <input
                            type="date"
                            value={refDate}
                            onChange={(e) => setRefDate(e.target.value)}
                            className={`${inputClass} font-mono tabular-nums`}
                          />
                        </div>

                        <div>
                          <label className={labelClass}>3. O Günkü Nöbet Vardiya Türü</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setRefType('GUNDUZ')}
                              className={`h-10 px-3 rounded-lg border text-xs font-bold transition cursor-pointer ${
                                refType === 'GUNDUZ'
                                  ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-xs'
                                  : isLight
                                  ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                            >
                              ☀️ Sabah / Gündüz (S)
                            </button>
                            <button
                              type="button"
                              onClick={() => setRefType('AKSAM')}
                              className={`h-10 px-3 rounded-lg border text-xs font-bold transition cursor-pointer ${
                                refType === 'AKSAM'
                                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                                  : isLight
                                  ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                            >
                              🌙 Akşam / Gece (A)
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* 2. ADIM: ÇALIŞMA SİSTEMİ VE HAZIR VARDİYA ŞABLONLARI */}
                    <section className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-full bg-sky-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0">
                            2
                          </span>
                          <div>
                            <h4 className="text-sm font-bold">
                              Çalışma Sistemi ve Hazır Vardiya Şablonları
                            </h4>
                            <p className={`text-xs ${mutedText}`}>
                              Standart 112/kurum şablonlarından birini tek tıkla uygulayın veya grup sayısını belirleyin.
                            </p>
                          </div>
                        </div>

                        {/* Toplam Grup Sayısı Hızlı Kontrol */}
                        <div className="flex items-center gap-1.5 self-start sm:self-auto">
                          <button
                            type="button"
                            disabled={numGroups <= 2}
                            onClick={() => handleChangeGroupCount(numGroups - 1)}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center disabled:opacity-30 cursor-pointer ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-700'
                                : 'bg-slate-900 border-slate-700 text-slate-200'
                            }`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-bold px-2 tabular-nums">
                            {numGroups} Grup
                          </span>
                          <button
                            type="button"
                            disabled={numGroups >= 10}
                            onClick={() => handleChangeGroupCount(numGroups + 1)}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center disabled:opacity-30 cursor-pointer ${
                              isLight
                                ? 'bg-white border-slate-300 text-slate-700'
                                : 'bg-slate-900 border-slate-700 text-slate-200'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {SHIFT_PRESETS.filter((p) => p.id !== 'CUSTOM').map((preset) => {
                          const isPresetActive =
                            is24Hour === preset.is24HourSystem &&
                            dayStart === preset.dayStart &&
                            dayEnd === preset.dayEnd &&
                            nightStart === preset.nightStart &&
                            nightEnd === preset.nightEnd &&
                            numGroups === preset.numGroups &&
                            dayRestHours === preset.dayRestHours &&
                            nightRestHours === preset.nightRestHours;

                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setIs24Hour(preset.is24HourSystem);
                                setDayStart(preset.dayStart);
                                setDayEnd(preset.dayEnd);
                                setNightStart(preset.nightStart);
                                setNightEnd(preset.nightEnd);
                                setShift24Start(preset.shift24Start);
                                setRestHours(preset.restHours);
                                setDayRestHours(preset.dayRestHours);
                                setNightRestHours(preset.nightRestHours);
                                handleChangeGroupCount(preset.numGroups);
                                setShiftTransition(preset.shiftTransition);
                              }}
                              className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-start justify-between gap-2 ${
                                isPresetActive
                                  ? isLight
                                    ? 'bg-indigo-50 border-indigo-400 text-slate-900 shadow-xs'
                                    : 'bg-indigo-950/40 border-indigo-500/60 text-white shadow-xs'
                                  : isLight
                                  ? 'bg-white hover:bg-slate-50 border-slate-200'
                                  : 'bg-slate-900/90 hover:bg-slate-800/80 border-slate-800'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold flex items-center gap-1.5">
                                  <span className="text-indigo-500">{preset.shortBadge}</span>
                                  <span>·</span>
                                  <span className="truncate">{preset.name}</span>
                                </div>
                                <div className={`text-[11px] mt-1 leading-snug ${mutedText}`}>
                                  {preset.desc}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-1 rounded-md text-[10px] font-bold shrink-0 ${
                                  isPresetActive
                                    ? 'bg-indigo-600 text-white'
                                    : isLight
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {isPresetActive ? 'Seçili ✓' : 'Uygula'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {/* 3. ADIM: DETAYLI VARDİYA SAATLERİ, DİNLENME SÜRELERİ VE DÖNGÜ AYARLARI */}
                    <section className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-full bg-indigo-500 text-white text-xs font-black flex items-center justify-center shrink-0">
                          3
                        </span>
                        <div>
                          <h4 className="text-sm font-bold">
                            Detaylı Vardiya Saatleri, İzin Süreleri ve Döngü Düzeni
                          </h4>
                          <p className={`text-xs ${mutedText}`}>
                            Gündüz/gece başlangıç-bitiş saatlerini, vardiya sonrası izin saatlerini ve grup geçiş algoritmasını özelleştirin.
                          </p>
                        </div>
                      </div>

                      {/* Çalışma Düzeni, Vardiya Geçişi ve Grup Döngü Modu */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        <div>
                          <label className={labelClass}>Çalışma Sistemi</label>
                          <select
                            value={is24Hour ? '24H' : '12H'}
                            onChange={(e) => setIs24Hour(e.target.value === '24H')}
                            className={inputClass}
                          >
                            <option value="12H">Gündüz / Gece (S / A)</option>
                            <option value="24H">24 Saat Kesintisiz Nöbet</option>
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Vardiya Geçiş Düzeni</label>
                          <select
                            value={shiftTransition}
                            onChange={(e) =>
                              setShiftTransition(e.target.value === 'SAME' ? 'SAME' : 'ALTERNATE')
                            }
                            className={inputClass}
                          >
                            <option value="ALTERNATE">Dönüşümlü (Gündüz ↔ Gece)</option>
                            <option value="SAME">Sabit (Hep Aynı Vardiya)</option>
                          </select>
                        </div>

                        <div>
                          <label className={labelClass}>Grup Döngü Sırası</label>
                          <select
                            value={groupCycleMode}
                            onChange={(e) =>
                              setGroupCycleMode(
                                e.target.value === 'SEQUENTIAL' ? 'SEQUENTIAL' : '112_CLASSIC'
                              )
                            }
                            className={inputClass}
                          >
                            <option value="112_CLASSIC">112 Klasik Döngü</option>
                            <option value="SEQUENTIAL">Sıralı Döngü (1 → 2 → 3...)</option>
                          </select>
                        </div>
                      </div>

                      {/* Gündüz & Gece Detay Kartları */}
                      {is24Hour ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div>
                            <label className={labelClass}>24 Saat Nöbet Başlangıç Saati</label>
                            <input
                              type="time"
                              value={shift24Start}
                              onChange={(e) => setShift24Start(e.target.value)}
                              className={`${inputClass} font-mono tabular-nums`}
                            />
                          </div>
                          <div>
                            <label className={labelClass}>24 Saat Nöbet Sonrası İzin (Saat)</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={12}
                                max={168}
                                value={restHours}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (val >= 12 && val <= 168) {
                                    setRestHours(val);
                                    setDayRestHours(val);
                                    setNightRestHours(val);
                                  }
                                }}
                                className={`${inputClass} font-mono tabular-nums`}
                              />
                              <div className="flex items-center gap-1 shrink-0">
                                {REST_PRESET_HOURS.map((h) => (
                                  <button
                                    key={h}
                                    type="button"
                                    onClick={() => {
                                      setRestHours(h);
                                      setDayRestHours(h);
                                      setNightRestHours(h);
                                    }}
                                    className={`h-10 px-2.5 rounded-lg border text-xs font-bold cursor-pointer ${
                                      restHours === h
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : isLight
                                        ? 'bg-white border-slate-300 text-slate-700'
                                        : 'bg-slate-900 border-slate-700 text-slate-300'
                                    }`}
                                  >
                                    {h}s
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          {/* Gündüz Vardiyası Kutusu */}
                          <div
                            className={`p-3.5 rounded-xl border space-y-3 ${
                              isLight
                                ? 'bg-amber-50/50 border-amber-200/80'
                                : 'bg-amber-950/15 border-amber-500/25'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-amber-500">
                                ☀️ Sabah / Gündüz Vardiyası (S)
                              </span>
                              <span className="text-[11px] font-mono font-bold text-amber-500">
                                {shiftDurationInfo.dayHours} Saat Nöbet
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div>
                                <label className={labelClass}>Başlangıç Saati</label>
                                <input
                                  type="time"
                                  value={dayStart}
                                  onChange={(e) => setDayStart(e.target.value)}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Bitiş Saati</label>
                                <input
                                  type="time"
                                  value={dayEnd}
                                  onChange={(e) => setDayEnd(e.target.value)}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                              </div>
                            </div>

                            <div>
                              <label className={labelClass}>
                                Gündüz Nöbeti Sonrası İzin Süresi (Saat)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={12}
                                  max={168}
                                  value={dayRestHours}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (val >= 12 && val <= 168) {
                                      setDayRestHours(val);
                                    }
                                  }}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                                {REST_PRESET_HOURS.map((h) => (
                                  <button
                                    key={`day-rest-${h}`}
                                    type="button"
                                    onClick={() => setDayRestHours(h)}
                                    className={`h-10 px-2.5 rounded-lg border text-xs font-bold transition cursor-pointer shrink-0 ${
                                      dayRestHours === h
                                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                                        : isLight
                                        ? 'bg-white border-slate-300 text-slate-700'
                                        : 'bg-slate-900 border-slate-700 text-slate-300'
                                    }`}
                                  >
                                    {h}s
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Gece Vardiyası Kutusu */}
                          <div
                            className={`p-3.5 rounded-xl border space-y-3 ${
                              isLight
                                ? 'bg-indigo-50/50 border-indigo-200/80'
                                : 'bg-indigo-950/15 border-indigo-500/25'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-indigo-400">
                                🌙 Akşam / Gece Vardiyası (A)
                              </span>
                              <span className="text-[11px] font-mono font-bold text-indigo-400">
                                {shiftDurationInfo.nightHours} Saat Nöbet
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div>
                                <label className={labelClass}>Başlangıç Saati</label>
                                <input
                                  type="time"
                                  value={nightStart}
                                  onChange={(e) => setNightStart(e.target.value)}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Bitiş Saati</label>
                                <input
                                  type="time"
                                  value={nightEnd}
                                  onChange={(e) => setNightEnd(e.target.value)}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                              </div>
                            </div>

                            <div>
                              <label className={labelClass}>
                                Gece Nöbeti Sonrası İzin Süresi (Saat)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={12}
                                  max={168}
                                  value={nightRestHours}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (val >= 12 && val <= 168) {
                                      setNightRestHours(val);
                                      setRestHours(val);
                                    }
                                  }}
                                  className={`${inputClass} font-mono tabular-nums`}
                                />
                                {REST_PRESET_HOURS.map((h) => (
                                  <button
                                    key={`night-rest-${h}`}
                                    type="button"
                                    onClick={() => {
                                      setNightRestHours(h);
                                      setRestHours(h);
                                    }}
                                    className={`h-10 px-2.5 rounded-lg border text-xs font-bold transition cursor-pointer shrink-0 ${
                                      nightRestHours === h
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : isLight
                                        ? 'bg-white border-slate-300 text-slate-700'
                                        : 'bg-slate-900 border-slate-700 text-slate-300'
                                    }`}
                                  >
                                    {h}s
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </section>

                    {/* 4. ADIM: CANLI 7 GÜNLÜK NÖBET REFERANSI DOĞRULAMA ÖNİZLEMESİ */}
                    <section className={`p-4 sm:p-5 rounded-xl border space-y-3 ${subtleCardBg}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CalendarClock className="w-4 h-4 text-emerald-500 shrink-0" />
                          <h4 className="text-sm font-bold">
                            Canlı 7 Günlük Referans Doğrulama Önizlemesi
                          </h4>
                        </div>
                        <span className={`text-xs ${mutedText}`}>
                          Kaydetmeden önce döngüyü kontrol edin
                        </span>
                      </div>

                      <div
                        className={`rounded-xl border overflow-hidden ${borderHairline} ${
                          isLight ? 'bg-white' : 'bg-slate-950/60'
                        }`}
                      >
                        <div
                          className={`grid grid-cols-3 px-3.5 py-2 text-[11px] font-bold border-b ${borderHairline} ${
                            isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-900 text-slate-400'
                          }`}
                        >
                          <span>Tarih</span>
                          <span>☀️ Sabah / Gündüz ({dayStart}–{dayEnd})</span>
                          <span>🌙 Akşam / Gece ({nightStart}–{nightEnd})</span>
                        </div>
                        <div className={`divide-y ${isLight ? 'divide-slate-200' : 'divide-slate-800'}`}>
                          {sevenDayPreview.map((row) => (
                            <div
                              key={row.iso}
                              className={`grid grid-cols-3 px-3.5 py-2 text-xs items-center ${
                                row.isRefDay
                                  ? isLight
                                    ? 'bg-amber-50/70 font-bold'
                                    : 'bg-amber-950/25 font-bold'
                                  : ''
                              }`}
                            >
                              <span className="font-mono tabular-nums truncate">
                                {trDateFormatter(row.iso)}{' '}
                                {row.isRefDay && (
                                  <span className="text-[10px] text-amber-500">(Referans)</span>
                                )}
                              </span>
                              <span className="font-semibold text-amber-500 truncate">
                                {row.dayLabel}
                              </span>
                              <span className="font-semibold text-indigo-400 truncate">
                                {row.nightLabel}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                      </>
                    )}
                  </div>
                )}

                {/* =========================================================
                    SECTION 4: GRUPLAR VE PERSONEL LİSTESİ (DETAYLI YÖNETİM)
                   ========================================================= */}
                {adminSection === 'personnel' && (
                  <div className="space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold">Gruplar ve Personel Listesi</h3>
                        <p className={`text-xs mt-0.5 ${mutedText}`}>
                          Her gruptaki 1. sıradaki isim <strong>Grup Sorumlusu</strong>, 2. sıradaki isim <strong>Sorumlu Yardımcısı</strong> olarak resmi nöbet çizelgesinde otomatik işaretlenir.
                        </p>
                      </div>

                      {/* Grup Sayısı Hızlı Kontrolü */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-semibold ${mutedText}`}>Toplam Grup:</span>
                        <button
                          type="button"
                          disabled={numGroups <= 2}
                          onClick={() => handleChangeGroupCount(numGroups - 1)}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center disabled:opacity-30 cursor-pointer ${
                            isLight
                              ? 'bg-white border-slate-300 text-slate-700'
                              : 'bg-slate-900 border-slate-700 text-slate-200'
                          }`}
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-bold px-2 tabular-nums">
                          {numGroups} Grup
                        </span>
                        <button
                          type="button"
                          disabled={numGroups >= 10}
                          onClick={() => handleChangeGroupCount(numGroups + 1)}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center disabled:opacity-30 cursor-pointer ${
                            isLight
                              ? 'bg-white border-slate-300 text-slate-700'
                              : 'bg-slate-900 border-slate-700 text-slate-200'
                          }`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Grup Dağılım Özeti Çubuğu */}
                    <div
                      className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${subtleCardBg}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {Array.from({ length: numGroups }, (_, idx) => (
                          <span
                            key={`sum-${idx}`}
                            className={`px-2.5 py-1 rounded-lg border font-semibold tabular-nums ${
                              isLight
                                ? 'bg-white border-slate-200 text-slate-700'
                                : 'bg-slate-900 border-slate-800 text-slate-200'
                            }`}
                          >
                            {groupNames[idx] || `${idx + 1}. Grup`}:{' '}
                            <strong className="text-indigo-500">
                              {allPersonnelByGroup[idx]?.length || 0}
                            </strong>{' '}
                            kişi
                          </span>
                        ))}
                      </div>
                      <span className="font-mono font-bold text-emerald-500">
                        Toplam {totalPersonnelCount} Personel
                      </span>
                    </div>

                    {/* Grup Kartları */}
                    <div className="space-y-4">
                      {Array.from({ length: numGroups }, (_, gIdx) => {
                        const members = allPersonnelByGroup[gIdx] || [];
                        const isBulkOpen = Boolean(expandedBulkByGroup[gIdx]);
                        const quickVal = quickAddByGroup[gIdx] || '';

                        return (
                          <div
                            key={gIdx}
                            className={`p-4 rounded-xl border space-y-3.5 ${subtleCardBg}`}
                          >
                            {/* Grup Başlığı & Araçlar */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                              <div className="flex items-center gap-2.5">
                                <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                                  {gIdx + 1}
                                </span>
                                <input
                                  type="text"
                                  value={groupNames[gIdx] || `${gIdx + 1}. Grup`}
                                  onChange={(e) => {
                                    const next = [...groupNames];
                                    next[gIdx] = e.target.value;
                                    setGroupNames(next);
                                  }}
                                  placeholder={`${gIdx + 1}. Grup`}
                                  className={`h-9 px-3 rounded-lg border text-xs font-bold outline-none w-44 ${
                                    isLight
                                      ? 'bg-white border-slate-300 text-slate-900'
                                      : 'bg-slate-900 border-slate-700 text-slate-100'
                                  }`}
                                />
                                <span className={`text-xs font-mono tabular-nums ${mutedText}`}>
                                  ({members.length} personel)
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap">
                                {members.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = [...groupMembers];
                                      next[gIdx] = formatMemberListTitleCaseTR(next[gIdx] || '');
                                      setGroupMembers(next);
                                    }}
                                    className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                                      isLight
                                        ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                                    }`}
                                  >
                                    İsimleri Düzenle
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedBulkByGroup((prev) => ({
                                      ...prev,
                                      [gIdx]: !prev[gIdx],
                                    }))
                                  }
                                  className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                                    isBulkOpen
                                      ? 'bg-indigo-600 border-indigo-500 text-white'
                                      : isLight
                                      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                                  }`}
                                >
                                  {isBulkOpen ? 'Toplu Metni Gizle' : 'Toplu Metin Düzenle'}
                                </button>
                              </div>
                            </div>

                            {/* Hızlı Personel Ekleme Satırı */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={quickVal}
                                onChange={(e) =>
                                  setQuickAddByGroup((prev) => ({
                                    ...prev,
                                    [gIdx]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleQuickAddMembersToGroup(gIdx);
                                  }
                                }}
                                placeholder="Yeni personel adı yazıp Enter'a veya Ekle'ye basın (virgülle çoklu ekleyebilirsiniz)..."
                                className={inputClass}
                              />
                              <button
                                type="button"
                                disabled={!quickVal.trim()}
                                onClick={() => handleQuickAddMembersToGroup(gIdx)}
                                className="h-10 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap"
                              >
                                <Plus className="w-4 h-4" />
                                <span>Personel Ekle</span>
                              </button>
                            </div>

                            {/* Sıralı Personel Listesi (Rol Rozetli, Sıra Değiştirmeli ve Grup Aktarmalı) */}
                            {members.length === 0 ? (
                              <div
                                className={`p-4 rounded-lg border text-center text-xs ${borderHairline} ${mutedText}`}
                              >
                                Bu grupta henüz kayıtlı personel bulunmuyor. Yukarıdaki kutudan personel ekleyin.
                              </div>
                            ) : (
                              <div
                                className={`rounded-xl border divide-y overflow-hidden ${borderHairline} ${
                                  isLight
                                    ? 'divide-slate-200 bg-white'
                                    : 'divide-slate-800 bg-slate-950/60'
                                }`}
                              >
                                {members.map((person, mIdx) => {
                                  const roleTag =
                                    mIdx === 0
                                      ? 'Grup Sorumlusu'
                                      : mIdx === 1
                                      ? 'Sorumlu Yrd.'
                                      : 'Personel';
                                  const roleColorClass =
                                    mIdx === 0
                                      ? 'text-amber-500 font-bold'
                                      : mIdx === 1
                                      ? 'text-sky-400 font-bold'
                                      : mutedText;

                                  return (
                                    <div
                                      key={`${person}-${mIdx}`}
                                      className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <span
                                          className={`w-6 h-6 rounded-md text-[11px] font-mono font-bold flex items-center justify-center shrink-0 ${
                                            mIdx === 0
                                              ? 'bg-amber-500/20 text-amber-500'
                                              : mIdx === 1
                                              ? 'bg-sky-500/20 text-sky-400'
                                              : isLight
                                              ? 'bg-slate-100 text-slate-600'
                                              : 'bg-slate-800 text-slate-400'
                                          }`}
                                        >
                                          {mIdx + 1}
                                        </span>
                                        <span className="text-xs sm:text-sm font-bold truncate">
                                          {person}
                                        </span>
                                        <span className={`text-[11px] shrink-0 ${roleColorClass}`}>
                                          · {roleTag}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                                        {/* Yukarı / Aşağı Sıra Değiştir */}
                                        <button
                                          type="button"
                                          disabled={mIdx === 0}
                                          onClick={() => handleMoveMemberOrder(gIdx, mIdx, -1)}
                                          title="Sırayı Yukarı Taşı"
                                          className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-25 cursor-pointer ${
                                            isLight
                                              ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                                          }`}
                                        >
                                          <ArrowUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={mIdx === members.length - 1}
                                          onClick={() => handleMoveMemberOrder(gIdx, mIdx, 1)}
                                          title="Sırayı Aşağı Taşı"
                                          className={`w-7 h-7 rounded-md border flex items-center justify-center disabled:opacity-25 cursor-pointer ${
                                            isLight
                                              ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                                          }`}
                                        >
                                          <ArrowDown className="w-3.5 h-3.5" />
                                        </button>

                                        {/* Başka Gruba Aktar */}
                                        <select
                                          aria-label="Grubunu Değiştir"
                                          value={gIdx}
                                          onChange={(e) =>
                                            handleTransferMemberGroup(
                                              gIdx,
                                              mIdx,
                                              parseInt(e.target.value, 10)
                                            )
                                          }
                                          className={`h-7 px-2 rounded-md border text-[11px] font-semibold outline-none cursor-pointer ${
                                            isLight
                                              ? 'bg-slate-50 border-slate-200 text-slate-700'
                                              : 'bg-slate-900 border-slate-700 text-slate-300'
                                          }`}
                                        >
                                          {Array.from({ length: numGroups }, (_, targetG) => (
                                            <option key={targetG} value={targetG}>
                                              {groupNames[targetG] || `${targetG + 1}. Grup`}
                                            </option>
                                          ))}
                                        </select>

                                        {/* Sil */}
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveMemberFromGroup(gIdx, mIdx)}
                                          title="Personeli Gruptan Çıkar"
                                          className={`w-7 h-7 rounded-md border flex items-center justify-center transition cursor-pointer ${
                                            isLight
                                              ? 'bg-white hover:bg-rose-50 border-slate-200 text-rose-600'
                                              : 'bg-slate-900 hover:bg-rose-950/60 border-slate-700 text-rose-400'
                                          }`}
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Açılır/Kapanır Toplu Metin Düzenleme Alanı */}
                            {isBulkOpen && (
                              <div className="pt-2 space-y-1.5">
                                <label className={`block text-[11px] font-semibold ${mutedText}`}>
                                  Toplu Personel Listesi (İsimleri virgülle veya alt alta yazın)
                                </label>
                                <textarea
                                  rows={3}
                                  value={groupMembers[gIdx] || ''}
                                  onChange={(e) => {
                                    const next = [...groupMembers];
                                    next[gIdx] = e.target.value;
                                    setGroupMembers(next);
                                  }}
                                  onBlur={(e) => {
                                    const next = [...groupMembers];
                                    next[gIdx] = formatMemberListTitleCaseTR(e.target.value);
                                    setGroupMembers(next);
                                  }}
                                  placeholder="1. Grup Sorumlusu, 2. Grup Sorumlusu Yardımcısı, 3. Personel..."
                                  className={`w-full p-3 rounded-lg border text-xs sm:text-sm font-medium outline-none resize-y ${
                                    isLight
                                      ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500'
                                      : 'bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400'
                                  }`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* =========================================================
                    SECTION 4: İZİN, İCAP & TALEPLER (CLEAN 3-PART WORKFLOW)
                   ========================================================= */}
                {adminSection === 'records' && (
                  <div className="space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold">İzin, İcap ve Kayıt Yönetimi</h3>
                        <p className={`text-xs mt-0.5 ${mutedText}`}>
                          Personel taleplerini onaylayın veya doğrudan resmi çizelge kaydı ekleyin.
                        </p>
                      </div>
                    </div>

                    {/* Clean Segmented Sub-View Switcher */}
                    <div
                      className={`grid grid-cols-3 gap-1 p-1 rounded-xl border ${
                        isLight
                          ? 'bg-slate-100 border-slate-200'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setRecordsSubView('pending')}
                        className={`h-9 px-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap truncate ${
                          recordsSubView === 'pending'
                            ? isLight
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'bg-slate-800 text-white shadow-xs'
                            : mutedText
                        }`}
                      >
                        Onay Bekleyen ({pendingLeaveRequests.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecordsSubView('create')}
                        className={`h-9 px-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap truncate ${
                          recordsSubView === 'create'
                            ? isLight
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'bg-slate-800 text-white shadow-xs'
                            : mutedText
                        }`}
                      >
                        Yeni Kayıt Ekle
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecordsSubView('history')}
                        className={`h-9 px-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap truncate ${
                          recordsSubView === 'history'
                            ? isLight
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'bg-slate-800 text-white shadow-xs'
                            : mutedText
                        }`}
                      >
                        Kayıtlar ({groupedCloudNotes.length})
                      </button>
                    </div>

                    {/* SUB-VIEW A: PENDING REQUESTS */}
                    {recordsSubView === 'pending' && (
                      <div className="space-y-3">
                        {pendingLeaveRequests.length === 0 ? (
                          <div
                            className={`p-8 rounded-xl border text-center space-y-2 ${subtleCardBg}`}
                          >
                            <Clock className={`w-6 h-6 mx-auto ${mutedText}`} />
                            <p className="text-sm font-semibold">Onay bekleyen talep yok</p>
                            <p className={`text-xs ${mutedText}`}>
                              Personeller kendi takvimlerinden izin, icap veya nöbet değişimi talebi
                              gönderdiğinde burada listelenir.
                            </p>
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl border divide-y overflow-hidden ${borderHairline} ${
                              isLight
                                ? 'divide-slate-200 bg-white'
                                : 'divide-slate-800 bg-slate-900/40'
                            }`}
                          >
                            {pendingLeaveRequests.map((req) => {
                              const reqDayCount = countInclusiveDays(req.startDate, req.endDate);
                              return (
                              <div
                                key={req.id}
                                className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="text-sm font-bold truncate">{req.personName}</div>
                                  <div
                                    className={`text-xs flex items-center gap-1.5 flex-wrap tabular-nums ${mutedText}`}
                                  >
                                    <span className="font-semibold text-amber-500">
                                      {req.type === 'İcap Nöbeti'
                                        ? `İcap (${req.swapShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
                                        : req.type === 'Nöbet Değişimi'
                                        ? `Nöbet Değişimi (${req.swapShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
                                        : req.type}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono">
                                      {trDateFormatter(req.startDate)}
                                      {req.endDate && req.endDate !== req.startDate
                                        ? ` – ${trDateFormatter(req.endDate)}`
                                        : ''}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-bold text-emerald-500">
                                      {reqDayCount} Gün
                                    </span>
                                  </div>
                                  {(req.swapWithPerson || req.desc) && (
                                    <div className={`text-xs ${mutedText}`}>
                                      {req.swapWithPerson
                                        ? `Karşı Personel: ${req.swapWithPerson}${
                                            req.swapTargetDate
                                              ? ` (${trDateFormatter(req.swapTargetDate)})`
                                              : ''
                                          }`
                                        : req.desc}
                                    </div>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const addedDays = await approveUnitLeaveRequestInCloud(req);
                                        onTriggerToast(
                                          'Talep Onaylandı',
                                          `${req.personName} için ${addedDays} günlük ${req.type} kaydı çizelgeye işlendi.`
                                        );
                                      } catch (err) {
                                        setAuthError(
                                          formatFriendlyError(err, 'Talep onaylanamadı.')
                                        );
                                      }
                                    }}
                                    className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Onayla</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await rejectOrDeleteUnitLeaveRequestInCloud(
                                          req.unitId,
                                          req.id
                                        );
                                        onTriggerToast(
                                          'Talep Reddedildi',
                                          `${req.personName} talebi silindi.`
                                        );
                                      } catch (err) {
                                        setAuthError(formatFriendlyError(err, 'Talep silinemedi.'));
                                      }
                                    }}
                                    className={`h-9 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                                      isLight
                                        ? 'bg-white hover:bg-rose-50 border-rose-200 text-rose-600'
                                        : 'bg-rose-950/40 hover:bg-rose-900/60 border-rose-500/30 text-rose-300'
                                    }`}
                                  >
                                    Reddet
                                  </button>
                                </div>
                              </div>
                            );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUB-VIEW B: CREATE NEW OFFICIAL RECORD */}
                    {recordsSubView === 'create' && (
                      <div className={`p-4 sm:p-5 rounded-xl border space-y-4 ${subtleCardBg}`}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div>
                            <label className={labelClass}>Kayıt Türü</label>
                            <select
                              value={
                                noteType === 'İzin / Rapor' && adminLeaveSubType === 'İdari İzin'
                                  ? 'İzin / Rapor::İdari İzin'
                                  : noteType === 'İzin / Rapor' &&
                                    adminLeaveSubType === 'Ücretsiz İzin'
                                  ? 'İzin / Rapor::Ücretsiz İzin'
                                  : noteType
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'İzin / Rapor::İdari İzin') {
                                  setNoteType('İzin / Rapor');
                                  setAdminLeaveSubType('İdari İzin');
                                } else if (val === 'İzin / Rapor::Ücretsiz İzin') {
                                  setNoteType('İzin / Rapor');
                                  setAdminLeaveSubType('Ücretsiz İzin');
                                } else {
                                  setNoteType(val as RosterRecordType);
                                  if (val === 'İzin / Rapor') {
                                    setAdminLeaveSubType('Yıllık İzin');
                                  }
                                }
                              }}
                              className={inputClass}
                            >
                              <option value="İzin / Rapor">İzin / Rapor (Yıllık / Mazeret)</option>
                              <option value="İzin / Rapor::İdari İzin">İdari İzin</option>
                              <option value="İzin / Rapor::Ücretsiz İzin">Ücretsiz İzin</option>
                              <option value="İcap Nöbeti">İcap Nöbeti (S / A)</option>
                              <option value="Nöbet Boşa Çıkarma">Nöbeti Boşa Çıkar / İptal Et</option>
                              <option value="Ek Nöbet">Ek Nöbet Ata (S / A)</option>
                              <option value="Nöbet Değişimi">Nöbet Değişimi (Becayiş)</option>
                              <option value="Not">Resmi Tablo Notu</option>
                              <option value="Görevlendirme">Görevlendirme</option>
                              <option value="Diğer">Diğer Büro Notu</option>
                            </select>
                          </div>

                          <div>
                            <label className={labelClass}>Personel</label>
                            {flatPersonnelList.length > 0 ? (
                              <select
                                value={notePersonName}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setNotePersonName(val);
                                  const found = flatPersonnelList.find((p) => p.name === val);
                                  if (found) setNoteGroupIdx(found.groupIdx);
                                }}
                                className={inputClass}
                              >
                                <option value="">Personel seçin...</option>
                                {flatPersonnelList.map((p, idx) => (
                                  <option key={`${p.name}-${idx}`} value={p.name}>
                                    {p.name} ({p.groupName})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={notePersonName}
                                onChange={(e) => setNotePersonName(e.target.value)}
                                placeholder="Ad Soyad"
                                className={inputClass}
                              />
                            )}
                          </div>

                          <div>
                            <label className={labelClass}>
                              {noteType === 'İzin / Rapor' ||
                              noteType === 'İcap Nöbeti' ||
                              noteType === 'Nöbet Boşa Çıkarma'
                                ? 'Başlangıç Tarihi'
                                : 'Tarih'}
                            </label>
                            <input
                              type="date"
                              value={noteDate}
                              onChange={(e) => setNoteDate(e.target.value)}
                              className={`${inputClass} font-mono tabular-nums`}
                            />
                          </div>

                          {(noteType === 'İzin / Rapor' ||
                            noteType === 'İcap Nöbeti' ||
                            noteType === 'Nöbet Boşa Çıkarma') && (
                            <div>
                              <label className={labelClass}>
                                Bitiş Tarihi (Opsiyonel)
                                {noteEndDate && noteEndDate >= noteDate && (
                                  <span className="ml-1.5 font-mono text-emerald-500">
                                    · {countInclusiveDays(noteDate, noteEndDate)} Gün
                                  </span>
                                )}
                              </label>
                              <input
                                type="date"
                                value={noteEndDate}
                                min={noteDate}
                                onChange={(e) => setNoteEndDate(e.target.value)}
                                className={`${inputClass} font-mono tabular-nums`}
                              />
                            </div>
                          )}
                        </div>

                        {noteType === 'İzin / Rapor' && (
                          <div>
                            <label className={labelClass}>İzin / Rapor Alt Türü</label>
                            <div className="flex flex-wrap gap-1.5">
                              {(
                                [
                                  'Yıllık İzin',
                                  'İdari İzin',
                                  'Ücretsiz İzin',
                                  'Raporlu',
                                  'Mazeret İzni',
                                ] as const
                              ).map((sub) => (
                                <button
                                  key={sub}
                                  type="button"
                                  onClick={() => setAdminLeaveSubType(sub)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                    adminLeaveSubType === sub
                                      ? 'bg-purple-600 border-purple-500 text-white'
                                      : isLight
                                      ? 'bg-white border-slate-300 text-slate-700 hover:border-purple-400'
                                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-purple-500/60'
                                  }`}
                                >
                                  {sub}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Shift Type Selection for Ek Nöbet / İcap Nöbeti */}
                        {(noteType === 'Ek Nöbet' || noteType === 'İcap Nöbeti') && (
                          <div>
                            <label className={labelClass}>Vardiya Türü</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setNoteSwapShiftType('GUNDUZ')}
                                className={`h-10 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                                  noteSwapShiftType === 'GUNDUZ'
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-700'
                                    : 'bg-slate-900 border-slate-700 text-slate-300'
                                }`}
                              >
                                Sabah / Gündüz (S)
                              </button>
                              <button
                                type="button"
                                onClick={() => setNoteSwapShiftType('AKSAM')}
                                className={`h-10 px-3 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                                  noteSwapShiftType === 'AKSAM'
                                    ? 'bg-indigo-600 border-indigo-500 text-white'
                                    : isLight
                                    ? 'bg-white border-slate-300 text-slate-700'
                                    : 'bg-slate-900 border-slate-700 text-slate-300'
                                }`}
                              >
                                Akşam / Gece (A)
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Extra Fields for Nöbet Değişimi */}
                        {noteType === 'Nöbet Değişimi' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                            <div>
                              <label className={labelClass}>Karşı Personel</label>
                              {flatPersonnelList.length > 0 ? (
                                <select
                                  value={noteSwapWithPerson}
                                  onChange={(e) => setNoteSwapWithPerson(e.target.value)}
                                  className={inputClass}
                                >
                                  <option value="">Karşı personel seçin...</option>
                                  {flatPersonnelList.map((p, idx) => (
                                    <option key={`swap-${p.name}-${idx}`} value={p.name}>
                                      {p.name} ({p.groupName})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={noteSwapWithPerson}
                                  onChange={(e) => setNoteSwapWithPerson(e.target.value)}
                                  placeholder="Karşı Personel Adı"
                                  className={inputClass}
                                />
                              )}
                            </div>

                            <div>
                              <label className={labelClass}>Karşılık Tarihi</label>
                              <input
                                type="date"
                                value={noteSwapTargetDate}
                                onChange={(e) => setNoteSwapTargetDate(e.target.value)}
                                className={`${inputClass} font-mono tabular-nums`}
                              />
                            </div>

                            <div>
                              <label className={labelClass}>Karşılık Vardiya</label>
                              <select
                                value={noteSwapShiftType}
                                onChange={(e) =>
                                  setNoteSwapShiftType(
                                    e.target.value === 'AKSAM' ? 'AKSAM' : 'GUNDUZ'
                                  )
                                }
                                className={inputClass}
                              >
                                <option value="GUNDUZ">Sabah / Gündüz (S)</option>
                                <option value="AKSAM">Akşam / Gece (A)</option>
                              </select>
                            </div>
                          </div>
                        )}

                        <div>
                          <label className={labelClass}>Açıklama / Not</label>
                          <input
                            type="text"
                            value={noteDesc}
                            onChange={(e) => setNoteDesc(e.target.value)}
                            placeholder="Örn: Yıllık izin, rapor, icap veya görevlendirme açıklaması..."
                            className={inputClass}
                          />
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => void handleAddOfficialRosterRecord()}
                            disabled={savingNote || !canEditSelectedUnit}
                            className="w-full sm:w-auto h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                          >
                            <Plus className="w-4 h-4" />
                            <span>{savingNote ? 'Kaydediliyor...' : 'Çizelgeye Kaydet'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* SUB-VIEW C: APPROVED CLOUD RECORDS HISTORY */}
                    {recordsSubView === 'history' && (
                      <div className="space-y-3">
                        {activeUnitCloudNotes.length > 0 && (
                          <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type="text"
                              value={recordSearchQuery}
                              onChange={(e) => setRecordSearchQuery(e.target.value)}
                              placeholder="Personel, tarih veya kayıt türü ara..."
                              className={`${inputClass} pl-9`}
                            />
                          </div>
                        )}

                        {filteredCloudNotes.length === 0 ? (
                          <div
                            className={`p-8 rounded-xl border text-center text-xs ${subtleCardBg} ${mutedText}`}
                          >
                            İşlenmiş resmi çizelge kaydı bulunmuyor.
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl border divide-y overflow-hidden ${borderHairline} ${
                              isLight
                                ? 'divide-slate-200 bg-white'
                                : 'divide-slate-800 bg-slate-900/40'
                            }`}
                          >
                            {filteredCloudNotes.map((grp) => (
                              <div
                                key={grp.key}
                                className="p-3.5 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-sm font-semibold truncate">
                                    {grp.personName}
                                  </div>
                                  <div
                                    className={`text-xs flex items-center gap-1.5 flex-wrap tabular-nums ${mutedText}`}
                                  >
                                    <span className="font-mono">
                                      {grp.startDate === grp.endDate
                                        ? trDateFormatter(grp.startDate)
                                        : `${trDateFormatter(grp.startDate)} – ${trDateFormatter(grp.endDate)}`}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-bold text-emerald-500">
                                      {grp.dayCount} Gün
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span
                                      className={`font-semibold ${
                                        grp.type === 'İzin / Rapor'
                                          ? 'text-purple-400'
                                          : grp.type === 'İcap Nöbeti'
                                          ? 'text-amber-400'
                                          : 'text-sky-400'
                                      }`}
                                    >
                                      {grp.type === 'İcap Nöbeti'
                                        ? `İcap (${grp.swapShiftType === 'AKSAM' ? 'A' : 'S'})`
                                        : grp.type}
                                    </span>
                                    {(grp.swapWithPerson || grp.desc) && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="truncate">
                                          {grp.swapWithPerson
                                            ? `${grp.swapWithPerson}${
                                                grp.swapTargetDate
                                                  ? ` (${trDateFormatter(grp.swapTargetDate)})`
                                                  : ''
                                              }`
                                            : grp.desc}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {canEditSelectedUnit && activeUnit && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await Promise.all(
                                        grp.items.map((cn) =>
                                          deleteUnitRosterNoteFromCloud(activeUnit.id, cn.id)
                                        )
                                      );
                                      onTriggerToast(
                                        'Kayıt Silindi',
                                        grp.dayCount > 1
                                          ? `${grp.personName} için ${grp.dayCount} günlük ${grp.type} kaydı kaldırıldı.`
                                          : `${grp.personName} kaydı kaldırıldı.`
                                      );
                                    }}
                                    className={`w-9 h-9 rounded-lg border flex items-center justify-center transition cursor-pointer shrink-0 ${
                                      isLight
                                        ? 'bg-white hover:bg-rose-50 border-slate-200 text-rose-600'
                                        : 'bg-slate-900 hover:bg-rose-950/60 border-slate-800 text-rose-400'
                                    }`}
                                    title={grp.dayCount > 1 ? `${grp.dayCount} Günlük Kaydı Sil` : 'Kaydı Sil'}
                                    aria-label="Kaydı Sil"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* =========================================================
                    SECTION 5: YETKİLİ ADMİNLER (SUPER ADMIN ONLY)
                   ========================================================= */}
                {adminSection === 'admins' && isSuperAdmin && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-base font-bold">Yetkili Kurum Adminleri</h3>
                      <p className={`text-xs mt-0.5 ${mutedText}`}>
                        Kurum adına vardiya, izin ve icap verisi yönetebilecek Google hesaplarını
                        yetkilendirin.
                      </p>
                    </div>

                    {/* Add New Admin Form */}
                    <div className={`p-4 sm:p-5 rounded-xl border space-y-3.5 ${subtleCardBg}`}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className={labelClass}>Google E-Posta Adresi</label>
                          <input
                            type="email"
                            value={newAdminEmail}
                            onChange={(e) => setNewAdminEmail(e.target.value)}
                            placeholder="ornek@gmail.com"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Ad Soyad / Ünvan</label>
                          <input
                            type="text"
                            value={newAdminName}
                            onChange={(e) => setNewAdminName(e.target.value)}
                            placeholder="Örn: Ahmet Yılmaz (Polis Büro)"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Yetkili Kurum Türü</label>
                          <select
                            value={newAdminInstType}
                            onChange={(e) =>
                              setNewAdminInstType(e.target.value as InstitutionType | 'ALL')
                            }
                            className={inputClass}
                          >
                            <option value="ALL">Tüm Kurumlar</option>
                            {INSTITUTION_TYPES.map((inst) => (
                              <option key={inst.id} value={inst.id}>
                                {inst.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Kurum Kodu (Opsiyonel)</label>
                          <input
                            type="text"
                            value={newAdminUnitCode}
                            onChange={(e) =>
                              setNewAdminUnitCode(
                                e.target.value ? sanitizeUnitCode(e.target.value) : ''
                              )
                            }
                            placeholder="Örn: KUTAHYA-POLIS-112"
                            className={`${inputClass} font-mono uppercase`}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => void handleAddAuthorizedAdmin()}
                          disabled={savingNewAdmin || !newAdminEmail.trim()}
                          className="w-full sm:w-auto h-10 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                        >
                          <UserPlus className="w-4 h-4" />
                          <span>
                            {savingNewAdmin ? 'Yetkilendiriliyor...' : 'Admin Olarak Ekle'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Authorized Admins List */}
                    <div
                      className={`rounded-xl border divide-y overflow-hidden ${borderHairline} ${
                        isLight ? 'divide-slate-200 bg-white' : 'divide-slate-800 bg-slate-900/40'
                      }`}
                    >
                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold flex items-center gap-2">
                            <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>Ana Yönetici</span>
                          </div>
                          <div className={`text-xs mt-0.5 ${mutedText}`}>
                            Kurucu Yetkili · Tüm Kurumlar
                          </div>
                        </div>
                      </div>

                      {allAuthorizedAdmins.length === 0 ? (
                        <div className={`p-6 text-center text-xs ${mutedText}`}>
                          Henüz eklenmiş alt kurum admini bulunmuyor.
                        </div>
                      ) : (
                        allAuthorizedAdmins.map((adm) => (
                          <div
                            key={adm.email}
                            className="p-3.5 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-sm font-semibold truncate">{adm.name}</div>
                              <div
                                className={`text-xs flex items-center gap-1.5 flex-wrap ${mutedText}`}
                              >
                                <span className="font-mono">{adm.email}</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {adm.institutionType === 'ALL'
                                    ? 'Tüm Kurumlar'
                                    : getInstitutionMeta(adm.institutionType).shortLabel}
                                </span>
                                {adm.unitCode && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono">{adm.unitCode}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            {!isUserSuperAdmin(adm.email) && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveAuthorizedAdmin(adm.email)}
                                className={`w-9 h-9 rounded-lg border flex items-center justify-center transition cursor-pointer shrink-0 ${
                                  isLight
                                    ? 'bg-white hover:bg-rose-50 border-slate-200 text-rose-600'
                                    : 'bg-slate-900 hover:bg-rose-950/60 border-slate-800 text-rose-400'
                                }`}
                                title="Yetkiyi Kaldır"
                                aria-label="Yetkiyi Kaldır"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Mobile Utility Links (At bottom of scrollable area on mobile only) */}
                <div className={`md:hidden pt-4 border-t flex items-center justify-end gap-2 flex-wrap ${borderHairline}`}>
                  <div className="flex items-center gap-2">
                    {onOpenFirstLaunchScreen && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenFirstLaunchScreen();
                        }}
                        className={`h-9 px-3 rounded-lg border text-xs font-medium cursor-pointer ${
                          isLight
                            ? 'bg-slate-50 border-slate-200 text-slate-700'
                            : 'bg-slate-900 border-slate-800 text-slate-300'
                        }`}
                      >
                        Giriş Ekranı
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void signOutBureau()}
                      className={`h-9 px-3 rounded-lg border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                        isLight
                          ? 'bg-rose-50 border-rose-200 text-rose-600'
                          : 'bg-rose-950/40 border-rose-500/30 text-rose-400'
                      }`}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Çıkış</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* CONTEXTUAL STICKY SAVE FOOTER (Only shown on Kurum & Vardiya or Personeller) */}
              {showSaveFooter && (
                <footer
                  className={`px-4 sm:px-6 py-3 border-t flex items-center justify-between gap-3 shrink-0 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0f1523] border-slate-800'
                  }`}
                >
                  <div className={`text-xs truncate min-w-0 ${mutedText}`}>
                    {editingUnitDoc ? (
                      <>
                        Düzenlenen: <strong className={isLight ? 'text-slate-900' : 'text-slate-100'}>{unitName}</strong>
                      </>
                    ) : (
                      <span>Yeni kurum taslağı kaydedilmeye hazır</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handlePublishUnitToServer()}
                    disabled={savingUnit || !canEditSelectedUnit}
                    className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-4 h-4 ${savingUnit ? 'animate-spin' : ''}`} />
                    <span>
                      {savingUnit
                        ? 'Kaydediliyor...'
                        : editingUnitDoc
                        ? 'Değişiklikleri Kaydet'
                        : 'Kurumu Yayınla'}
                    </span>
                  </button>
                </footer>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
