import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../firebase';
import {
  AppSettings,
  AuthorizedAdminDoc,
  InstitutionUnitDoc,
  NoteItem,
  RefRecord,
  RosterRecordType,
  UnitLeaveRequestDoc,
  UnitRosterNoteDoc,
} from '../types';
import {
  querySingleDayForGroup,
  toISODate,
  getActiveReferenceForDate,
  findSwappedPartnerGroupIdx,
  trDateFormatter,
  getShiftDurations,
  countInclusiveDays,
  groupConsecutiveRecords,
} from '../shiftEngine';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Check,
  ZoomIn,
  ZoomOut,
  Users,
  Layers,
  CalendarPlus,
  X,
  Building2,
  ShieldCheck,
  Plus,
  Trash2,
  Lock,
  UserCheck,
  Send,
  Clock,
  Pencil,
  RotateCcw,
  Wrench,
  Save,
  SlidersHorizontal,
  CheckSquare,
  Copy,
  Palette,
  StickyNote,
} from 'lucide-react';
import { useShare } from '../hooks/useShare';
import { renderRosterToCanvas } from '../utils/rosterCanvasExport';
import { VardiyaGoogleAuthCard } from './VardiyaGoogleAuthCard';
import {
  addUnitRosterNoteRangeToCloud,
  approveUnitLeaveRequestInCloud,
  deleteUnitRosterNoteFromCloud,
  getInstitutionMeta,
  isUserSuperAdmin,
  rejectOrDeleteUnitLeaveRequestInCloud,
  saveUnitTableMetaToCloud,
  submitUnitLeaveRequestToCloud,
  subscribeToMyAdminDoc,
  subscribeToUnitTableMeta,
  updateUnitRosterStructureInCloud,
} from '../services/institutionUnitService';

interface ShiftRosterTableModalProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  notes: NoteItem[];
  localNotes?: NoteItem[];
  activeUnitCloudNotes?: UnitRosterNoteDoc[];
  activeUnitLeaveRequests?: UnitLeaveRequestDoc[];
  onSaveLocalNotes?: (newLocalNotes: NoteItem[]) => void;
  onUpdateSettings?: (newSettings: AppSettings) => void;
  onTriggerToast?: (title: string, message: string) => void;
  activeProfileName?: string;
  calendarYear: number;
  calendarMonth: number; // 1-12
  onMonthChange: (year: number, month: number) => void;
  onOpenNoteForDate: (isoDate: string) => void;
  allUnits?: InstitutionUnitDoc[];
  activeUnit?: InstitutionUnitDoc | null;
  isAdminBureauMode?: boolean;
  onInspectPersonCalendar?: (personName: string, groupIdx: number) => void;
  onSelectUnit?: (unit: InstitutionUnitDoc | null) => void;
  onOpenBureauModal?: () => void;
  onClose: () => void;
}

const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

const WEEKDAY_UPPER_TR = [
  'PAZAR',
  'PAZARTESİ',
  'SALI',
  'ÇARŞAMBA',
  'PERŞEMBE',
  'CUMA',
  'CUMARTESİ',
];

type ZoomLevel = 'overview' | 'compact' | 'normal' | 'large';
type RosterMode = 'personnel' | 'groups';
type EntryRoleMode = 'user' | 'admin';
type TableThemeMode = 'classic' | 'modern' | 'dark' | 'contrast';

interface TableVisualPrefs {
  tableTheme: TableThemeMode;
  highlightWeekends: boolean;
  zebraGroups: boolean;
  colorizeShiftCodes: boolean;
  highlightToday: boolean;
  boldGroupDividers: boolean;
  showLegend: boolean;
  showTotalsColumn: boolean;
  rowDensity: 'compact' | 'normal' | 'comfortable';
  fontScale: 'sm' | 'md' | 'lg';
  customTitle: string;
}

const TABLE_PREFS_STORAGE_KEY = 'vardiya112_roster_table_prefs_v1';
const CELL_HIGHLIGHTS_STORAGE_KEY = 'vardiya112_roster_cell_highlights_v1';

const DEFAULT_TABLE_PREFS: TableVisualPrefs = {
  tableTheme: 'classic',
  highlightWeekends: false,
  zebraGroups: false,
  colorizeShiftCodes: false,
  highlightToday: true,
  boldGroupDividers: true,
  showLegend: true,
  showTotalsColumn: false,
  rowDensity: 'normal',
  fontScale: 'md',
  customTitle: '',
};

const CELL_HIGHLIGHT_SWATCHES: Array<{ id: string; label: string; hex: string }> = [
  { id: 'none', label: 'Renk Yok', hex: '' },
  { id: 'yellow', label: 'Sarı', hex: '#fef9c3' },
  { id: 'blue', label: 'Mavi', hex: '#dbeafe' },
  { id: 'green', label: 'Yeşil', hex: '#dcfce7' },
  { id: 'pink', label: 'Pembe', hex: '#fce7f3' },
  { id: 'purple', label: 'Lila', hex: '#f3e8ff' },
  { id: 'orange', label: 'Turuncu', hex: '#ffedd5' },
];

const loadTableVisualPrefs = (): TableVisualPrefs => {
  try {
    const raw = window.localStorage.getItem(TABLE_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_TABLE_PREFS;
    const parsed = JSON.parse(raw) as Partial<TableVisualPrefs>;
    return { ...DEFAULT_TABLE_PREFS, ...parsed };
  } catch {
    return DEFAULT_TABLE_PREFS;
  }
};

const loadCellHighlights = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(CELL_HIGHLIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

interface RosterRow {
  rowKey: string;
  siraNo: number;
  groupIdx: number;
  memberIdx: number;
  groupMemberCount: number;
  groupTag: string;
  personName: string;
  displayLabel: string;
  roleColor: 'leader' | 'deputy' | 'member';
  isLastInGroup: boolean;
  isCurrentUser: boolean;
}

interface CellState {
  code: string; // 'S' | 'A' | '24' | 'İZİNLİ' | ''
  variant: 'normal' | 'swap-in' | 'swap-out' | 'leave' | 'note' | 'cleared' | 'extra';
  detailLabel: string;
}

const normalizeTR = (value: string): string =>
  (value || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const isSamePersonTR = (a: string, b: string): boolean => {
  const na = normalizeTR(a);
  const nb = normalizeTR(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(' ');
  const pb = nb.split(' ');
  if (pa[0] === pb[0] && pa[0].length >= 3 && (pa.length === 1 || pb.length === 1)) {
    return true;
  }
  return false;
};

const formatGroupTag = (rawName: string | undefined, idx: number): string => {
  const cleaned = (rawName || `${idx + 1}. Grup`).trim();
  const numMatch =
    cleaned.match(/^(\d+)\.\s*Grup$/i) ||
    cleaned.match(/^Grup[\s-]*(\d+)$/i) ||
    cleaned.match(/^(\d+)$/);
  if (numMatch) {
    return `Grup-${numMatch[1]}`;
  }
  return cleaned;
};

const enumerateDateRangeISO = (startISO: string, endISO?: string): string[] => {
  const s = (startISO || '').trim();
  const e = (endISO || '').trim();
  if (!e || e <= s) return [s];
  const [sy, sm, sd] = s.split('-').map(Number);
  const [ey, em, ed] = e.split('-').map(Number);
  const startDt = new Date(sy, sm - 1, sd);
  const endDt = new Date(ey, em - 1, ed);
  const list: string[] = [];
  const cur = new Date(startDt);
  let safety = 0;
  while (cur <= endDt && safety < 45) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    list.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
  return list.length > 0 ? list : [s];
};

export const ShiftRosterTableModal: React.FC<ShiftRosterTableModalProps> = ({
  settings,
  refHistory,
  notes,
  localNotes = [],
  activeUnitCloudNotes = [],
  activeUnitLeaveRequests = [],
  onSaveLocalNotes,
  onUpdateSettings,
  onTriggerToast,
  activeProfileName,
  calendarYear,
  calendarMonth,
  onMonthChange,
  onOpenNoteForDate,
  allUnits = [],
  activeUnit = null,
  isAdminBureauMode = false,
  onInspectPersonCalendar,
  onSelectUnit,
  onOpenBureauModal,
  onClose,
}) => {
  // Open in full-roster 'overview' mode by default so the entire list & month is visible at once
  const [zoom, setZoom] = useState<ZoomLevel>('overview');
  const [rosterMode, setRosterMode] = useState<RosterMode>('personnel');
  const [shareDone, setShareDone] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [previewPng, setPreviewPng] = useState<{
    dataUrl: string;
    fileName: string;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    rowKey: string;
    dayIndex: number;
  } | null>(null);

  // Table Visual Customization & Per-Cell Color Highlights (persisted locally)
  const [tablePrefs, setTablePrefs] = useState<TableVisualPrefs>(() => loadTableVisualPrefs());
  const [showCustomizePanel, setShowCustomizePanel] = useState<boolean>(false);
  const [cellHighlights, setCellHighlights] = useState<Record<string, string>>(() =>
    loadCellHighlights()
  );

  // Press-and-Hold + Drag Multi-Cell Bulk Selection State
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(() => new Set());
  const [isDragSelecting, setIsDragSelecting] = useState<boolean>(false);
  const [bulkSaving, setBulkSaving] = useState<boolean>(false);
  const [showBulkNoteInput, setShowBulkNoteInput] = useState<boolean>(false);
  const [bulkNoteDraft, setBulkNoteDraft] = useState<string>('');

  const holdTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ rowIdx: number; dayIdx: number; x: number; y: number } | null>(
    null
  );
  const dragAnchorRef = useRef<{ rowIdx: number; dayIdx: number } | null>(null);
  const isDragSelectingRef = useRef<boolean>(false);
  const suppressNextClickRef = useRef<boolean>(false);

  // Auth & Role Tracking (Ana Yönetici vs Kurum Admini vs Bireysel Kullanıcı)
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  const [myAdminDoc, setMyAdminDoc] = useState<AuthorizedAdminDoc | null>(null);

  // Pro Table Editing State (Inline Row Reorder / Swap / Rename + Group & Personnel Studio Modal)
  const [isTableEditMode, setIsTableEditMode] = useState<boolean>(false);
  const [swapSourceSlot, setSwapSourceSlot] = useState<{
    groupIdx: number;
    memberIdx: number;
    personName: string;
  } | null>(null);
  const [inlineRenameSlot, setInlineRenameSlot] = useState<{
    groupIdx: number;
    memberIdx: number;
    value: string;
  } | null>(null);
  const [showStructureStudio, setShowStructureStudio] = useState<boolean>(false);
  const [studioGroupNames, setStudioGroupNames] = useState<string[]>([]);
  const [studioGroupMembers, setStudioGroupMembers] = useState<string[][]>([]);
  const [studioNewPersonByGroup, setStudioNewPersonByGroup] = useState<Record<number, string>>({});
  const [studioSwapPick, setStudioSwapPick] = useState<{ gIdx: number; mIdx: number } | null>(null);
  const [structureSaving, setStructureSaving] = useState<boolean>(false);
  const [quickCellSaving, setQuickCellSaving] = useState<boolean>(false);

  // In-Table Leave / On-Call / Clear Shift / Extra Shift / Note / Swap Entry Modal State & Top-Bar Active Role/Personnel
  const [showTableEntryModal, setShowTableEntryModal] = useState<boolean>(false);
  const [entryRoleMode, setEntryRoleMode] = useState<EntryRoleMode>(() =>
    isAdminBureauMode ? 'admin' : 'user'
  );
  const [entryType, setEntryType] = useState<RosterRecordType>('İzin / Rapor');
  const [entryLeaveSubType, setEntryLeaveSubType] = useState<
    'Yıllık İzin' | 'İdari İzin' | 'Ücretsiz İzin' | 'Raporlu' | 'Mazeret İzni'
  >('Yıllık İzin');
  const [entryStartDate, setEntryStartDate] = useState<string>(() => toISODate(new Date()));
  const [entryEndDate, setEntryEndDate] = useState<string>('');
  const [entryGroupIdx, setEntryGroupIdx] = useState<number>(0);
  const [entryPersonName, setEntryPersonName] = useState<string>('');
  const [entryShiftType, setEntryShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');
  const [entrySwapWithPerson, setEntrySwapWithPerson] = useState<string>('');
  const [entrySwapTargetDate, setEntrySwapTargetDate] = useState<string>('');
  const [entryDesc, setEntryDesc] = useState<string>('');
  const [entryError, setEntryError] = useState<string>('');
  const [entrySaving, setEntrySaving] = useState<boolean>(false);

  const { shareCanvas } = useShare();

  const todayISO = toISODate(new Date());
  const isConfigured = refHistory && refHistory.length > 0;

  const applyingCloudTableMetaRef = useRef<boolean>(false);
  const tableMetaSyncTimerRef = useRef<number | null>(null);
  const tablePrefsRef = useRef<TableVisualPrefs>(tablePrefs);
  const cellHighlightsRef = useRef<Record<string, string>>(cellHighlights);

  useEffect(() => {
    tablePrefsRef.current = tablePrefs;
    try {
      window.localStorage.setItem(TABLE_PREFS_STORAGE_KEY, JSON.stringify(tablePrefs));
    } catch {
      // ignore storage quota errors
    }
  }, [tablePrefs]);

  useEffect(() => {
    cellHighlightsRef.current = cellHighlights;
    try {
      window.localStorage.setItem(CELL_HIGHLIGHTS_STORAGE_KEY, JSON.stringify(cellHighlights));
    } catch {
      // ignore storage quota errors
    }
  }, [cellHighlights]);

  useEffect(() => {
    return () => {
      if (tableMetaSyncTimerRef.current !== null) {
        window.clearTimeout(tableMetaSyncTimerRef.current);
      }
    };
  }, []);

  const unitScopeKey = activeUnit?.id || 'local';
  const getCellHighlightKey = useCallback(
    (rowKey: string, isoDate: string) => `${unitScopeKey}::${rowKey}::${isoDate}`,
    [unitScopeKey]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  const isSuperAdmin = useMemo(
    () => Boolean(isAdminBureauMode) && isUserSuperAdmin(currentUser?.email),
    [isAdminBureauMode, currentUser?.email]
  );

  useEffect(() => {
    const unsub = subscribeToMyAdminDoc(currentUser?.email, (docData) => {
      setMyAdminDoc(docData);
    });
    return () => unsub();
  }, [currentUser?.email]);

  const isAuthorizedAdmin = Boolean(isAdminBureauMode) && (isSuperAdmin || Boolean(myAdminDoc));

  // Subscribe to shared cloud table styling & bulk cell highlights for the connected institution
  useEffect(() => {
    if (!activeUnit?.id) return;
    const scopePrefix = `${activeUnit.id}::`;
    const unsub = subscribeToUnitTableMeta(activeUnit.id, (meta) => {
      if (!meta) return;
      applyingCloudTableMetaRef.current = true;
      setTablePrefs({
        tableTheme: meta.tableTheme || 'classic',
        fontScale: meta.fontSize || 'md',
        rowDensity: meta.rowDensity || 'normal',
        highlightWeekends: Boolean(meta.highlightWeekends),
        zebraGroups: Boolean(meta.zebraGroups),
        colorizeShiftCodes: Boolean(meta.colorizeShiftCodes),
        showTotalsColumn: Boolean(meta.showTotalsColumn),
        highlightToday: meta.highlightToday !== false,
        boldGroupDividers: meta.boldGroupDividers !== false,
        showLegend: meta.showLegend !== false,
        customTitle: typeof meta.customTitle === 'string' ? meta.customTitle : '',
      });
      setCellHighlights((prev) => {
        const next: Record<string, string> = {};
        // Preserve other scopes while replacing current unit scope cleanly from server truth
        for (const [k, v] of Object.entries(prev)) {
          if (!k.startsWith(scopePrefix)) {
            next[k] = v;
          }
        }
        if (meta.cellHighlights && typeof meta.cellHighlights === 'object') {
          for (const [rawKey, hexVal] of Object.entries(meta.cellHighlights)) {
            if (typeof hexVal === 'string' && hexVal.trim()) {
              const normalizedKey = rawKey.startsWith(scopePrefix)
                ? rawKey
                : `${scopePrefix}${rawKey}`;
              next[normalizedKey] = hexVal;
            }
          }
        }
        return next;
      });
      window.setTimeout(() => {
        applyingCloudTableMetaRef.current = false;
      }, 0);
    });
    return () => unsub();
  }, [activeUnit?.id]);

  const scheduleTableMetaCloudSync = useCallback(
    (nextPrefs: TableVisualPrefs, nextAllHighlights: Record<string, string>) => {
      if (applyingCloudTableMetaRef.current) return;
      if (!activeUnit?.id || !isAuthorizedAdmin) return;

      if (tableMetaSyncTimerRef.current !== null) {
        window.clearTimeout(tableMetaSyncTimerRef.current);
      }

      const targetUnitId = activeUnit.id;
      const scopePrefix = `${targetUnitId}::`;
      tableMetaSyncTimerRef.current = window.setTimeout(() => {
        const unitRelativeHighlights: Record<string, string> = {};
        for (const [k, v] of Object.entries(nextAllHighlights)) {
          if (k.startsWith(scopePrefix) && typeof v === 'string' && v.trim()) {
            const relKey = k.slice(scopePrefix.length);
            if (relKey) {
              unitRelativeHighlights[relKey] = v;
            }
          }
        }
        void saveUnitTableMetaToCloud({
          unitId: targetUnitId,
          tableTheme: nextPrefs.tableTheme,
          fontSize: nextPrefs.fontScale,
          rowDensity: nextPrefs.rowDensity,
          highlightWeekends: nextPrefs.highlightWeekends,
          zebraGroups: nextPrefs.zebraGroups,
          colorizeShiftCodes: nextPrefs.colorizeShiftCodes,
          showTotalsColumn: nextPrefs.showTotalsColumn,
          highlightToday: nextPrefs.highlightToday,
          boldGroupDividers: nextPrefs.boldGroupDividers,
          showLegend: nextPrefs.showLegend,
          customTitle: nextPrefs.customTitle,
          cellHighlights: unitRelativeHighlights,
        }).catch(() => {
          // Error already handled inside saveUnitTableMetaToCloud
        });
      }, 350);
    },
    [activeUnit?.id, isAuthorizedAdmin]
  );

  const updateTablePref = useCallback(
    <K extends keyof TableVisualPrefs>(key: K, value: TableVisualPrefs[K]) => {
      setTablePrefs((prev) => {
        const next = { ...prev, [key]: value };
        scheduleTableMetaCloudSync(next, cellHighlightsRef.current);
        return next;
      });
    },
    [scheduleTableMetaCloudSync]
  );

  const resetTablePrefs = useCallback(() => {
    setTablePrefs(DEFAULT_TABLE_PREFS);
    scheduleTableMetaCloudSync(DEFAULT_TABLE_PREFS, cellHighlightsRef.current);
    onTriggerToast?.('Özelleştirmeler Sıfırlandı', 'Tablo görünümü varsayılan ayarlara döndürüldü.');
  }, [onTriggerToast, scheduleTableMetaCloudSync]);

  // Enforce strict role mode: Personnel -> always 'user', Admin -> always 'admin' (no cross-role switching)
  useEffect(() => {
    if (!isAdminBureauMode) {
      setEntryRoleMode('user');
      setIsTableEditMode(false);
      setShowStructureStudio(false);
      return;
    }
    setEntryRoleMode('admin');
  }, [isAdminBureauMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTableEntryModal) {
          setShowTableEntryModal(false);
        } else if (showCustomizePanel) {
          setShowCustomizePanel(false);
        } else if (selectedCellKeys.size > 0 || multiSelectMode) {
          setSelectedCellKeys(new Set());
          setMultiSelectMode(false);
          setShowBulkNoteInput(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showTableEntryModal, showCustomizePanel, selectedCellKeys.size, multiSelectMode]);

  const handlePrevMonth = () => {
    setSelectedCell(null);
    setSelectedCellKeys(new Set());
    if (calendarMonth === 1) {
      onMonthChange(calendarYear - 1, 12);
    } else {
      onMonthChange(calendarYear, calendarMonth - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedCell(null);
    setSelectedCellKeys(new Set());
    if (calendarMonth === 12) {
      onMonthChange(calendarYear + 1, 1);
    } else {
      onMonthChange(calendarYear, calendarMonth + 1);
    }
  };

  const cycleZoom = (dir: 1 | -1) => {
    const order: ZoomLevel[] = ['overview', 'compact', 'normal', 'large'];
    const idx = order.indexOf(zoom);
    const nextIdx = Math.min(order.length - 1, Math.max(0, idx + dir));
    setZoom(order[nextIdx]);
  };

  // All days in selected month
  const days = useMemo(() => {
    const totalDays = new Date(calendarYear, calendarMonth, 0).getDate();
    const list: Array<{
      dayNum: number;
      isoDate: string;
      weekdayUpper: string;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];
    for (let d = 1; d <= totalDays; d++) {
      const dt = new Date(calendarYear, calendarMonth - 1, d);
      const dow = dt.getDay(); // 0=Sun .. 6=Sat
      const iso = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(
        2,
        '0'
      )}`;
      list.push({
        dayNum: d,
        isoDate: iso,
        weekdayUpper: WEEKDAY_UPPER_TR[dow],
        isWeekend: dow === 0 || dow === 6,
        isToday: iso === todayISO,
      });
    }
    return list;
  }, [calendarYear, calendarMonth, todayISO]);

  const activeMonthRef = useMemo(() => {
    const firstISO = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-01`;
    return getActiveReferenceForDate(firstISO, refHistory);
  }, [calendarYear, calendarMonth, refHistory]);

  const myGroupIdx = activeMonthRef ? activeMonthRef.myGroupIdx : 0;
  const cleanActiveProfile =
    (activeProfileName && activeProfileName.trim() && activeProfileName.trim() !== 'Ana Profilim'
      ? activeProfileName.trim()
      : '') ||
    settings.activeWorkerName?.trim() ||
    '';
  const activeProfileDisplayName =
    cleanActiveProfile || activeProfileName?.trim() || 'Aktif Profil';

  // All personnel flattened for quick selection inside the table entry modal
  const allTablePersonnel = useMemo(() => {
    const list: Array<{ name: string; groupIdx: number; groupName: string }> = [];
    for (let g = 0; g < settings.numGroups; g++) {
      const gName = settings.groupNames[g] || `${g + 1}. Grup`;
      const rawMembers = (settings.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      rawMembers.forEach((m) => {
        list.push({ name: m, groupIdx: g, groupName: gName });
      });
    }
    return list;
  }, [settings.numGroups, settings.groupNames, settings.groupMembers]);

  const matchedActivePersonnel = useMemo(() => {
    if (!cleanActiveProfile) return null;
    return allTablePersonnel.find((p) => isSamePersonTR(p.name, cleanActiveProfile)) || null;
  }, [allTablePersonnel, cleanActiveProfile]);

  // Build rows (exact official 112 personnel roster or compact 1-row-per-group mode)
  const rows = useMemo<RosterRow[]>(() => {
    const result: RosterRow[] = [];
    let sira = 1;

    for (let g = 0; g < settings.numGroups; g++) {
      const groupTag = formatGroupTag(settings.groupNames[g], g);
      const rawMembers = (settings.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (rosterMode === 'groups' || rawMembers.length === 0) {
        const fallbackLabel =
          rawMembers.length > 0
            ? `${settings.groupNames[g] || `${g + 1}. Grup`} (${rawMembers.length} Kişi)`
            : settings.groupNames[g] || `${g + 1}. Grup`;
        result.push({
          rowKey: `group-${g}`,
          siraNo: sira++,
          groupIdx: g,
          memberIdx: -1,
          groupMemberCount: rawMembers.length,
          groupTag,
          personName: '',
          displayLabel: `(${groupTag}) ${fallbackLabel.toLocaleUpperCase('tr-TR')}`,
          roleColor: g === myGroupIdx ? 'deputy' : 'leader',
          isLastInGroup: true,
          isCurrentUser: g === myGroupIdx,
        });
      } else {
        rawMembers.forEach((person, memberIdx) => {
          const targetMatchName = cleanActiveProfile.trim();
          const isMe = targetMatchName
            ? isSamePersonTR(person, targetMatchName)
            : g === myGroupIdx && memberIdx === 0;
          result.push({
            rowKey: `g${g}-m${memberIdx}`,
            siraNo: sira++,
            groupIdx: g,
            memberIdx,
            groupMemberCount: rawMembers.length,
            groupTag,
            personName: person,
            displayLabel: `(${groupTag}) ${person.toLocaleUpperCase('tr-TR')}`,
            roleColor: memberIdx === 0 ? 'leader' : memberIdx === 1 ? 'deputy' : 'member',
            isLastInGroup: memberIdx === rawMembers.length - 1,
            isCurrentUser: isMe,
          });
        });
      }
    }
    return result;
  }, [
    settings.numGroups,
    settings.groupNames,
    settings.groupMembers,
    rosterMode,
    myGroupIdx,
    cleanActiveProfile,
  ]);

  // Keep entryPersonName initialized (preferring the active profile's personnel record)
  useEffect(() => {
    if (entryPersonName && allTablePersonnel.some((p) => p.name === entryPersonName)) {
      return;
    }
    const defaultPerson =
      matchedActivePersonnel ||
      allTablePersonnel.find((p) => p.groupIdx === myGroupIdx) ||
      allTablePersonnel[0];
    if (defaultPerson) {
      setEntryPersonName(defaultPerson.name);
      setEntryGroupIdx(defaultPerson.groupIdx);
    } else if (cleanActiveProfile) {
      setEntryPersonName(cleanActiveProfile);
      setEntryGroupIdx(myGroupIdx);
    }
  }, [allTablePersonnel, matchedActivePersonnel, cleanActiveProfile, myGroupIdx, entryPersonName]);

  // Precompute base shift matrix [groupIdx][dayIdx] -> 'S' | 'A' | '24' | ''
  const baseGroupMatrix = useMemo(() => {
    const matrix: Array<Array<'S' | 'A' | '24' | ''>> = [];
    for (let g = 0; g < settings.numGroups; g++) {
      const groupRow: Array<'S' | 'A' | '24' | ''> = [];
      for (const day of days) {
        if (!isConfigured) {
          groupRow.push('');
          continue;
        }
        const info = querySingleDayForGroup(day.isoDate, g, settings, refHistory, []);
        if (settings.is24HourSystem) {
          groupRow.push(info.dayShift || info.nightShift ? '24' : '');
        } else if (info.dayShift) {
          groupRow.push('S');
        } else if (info.nightShift) {
          groupRow.push('A');
        } else {
          groupRow.push('');
        }
      }
      matrix.push(groupRow);
    }
    return matrix;
  }, [days, settings, refHistory, isConfigured]);

  // Precompute resolved cell matrix for every row & day in a single memoized pass (O(1) lookup on render & PNG export)
  const cellMatrixByRow = useMemo<Record<string, CellState[]>>(() => {
    const describeBase = (code: string) => {
      if (code === '24') return `24 Saat Nöbeti (${settings.shift24Start})`;
      if (code === 'S') return `Sabah / Gündüz Nöbeti (${settings.dayStart} - ${settings.dayEnd})`;
      if (code === 'A') return `Akşam / Gece Nöbeti (${settings.nightStart} - ${settings.nightEnd})`;
      return 'İstirahat';
    };

    const notesByDate = new Map<string, NoteItem[]>();
    if (notes && notes.length > 0) {
      for (const note of notes) {
        if (note.date) {
          const list = notesByDate.get(note.date) || [];
          list.push(note);
          notesByDate.set(note.date, list);
        }
        if (note.type === 'Nöbet Değişimi' && note.swapTargetDate?.trim()) {
          const target = note.swapTargetDate.trim();
          if (target !== note.date) {
            const list = notesByDate.get(target) || [];
            list.push(note);
            notesByDate.set(target, list);
          }
        }
      }
    }

    const partnerGroupCache = new Map<number, number | null>();
    const getPartnerGroup = (note: NoteItem) => {
      if (partnerGroupCache.has(note.id)) return partnerGroupCache.get(note.id) ?? null;
      const gIdx = findSwappedPartnerGroupIdx(note, settings, refHistory);
      partnerGroupCache.set(note.id, gIdx);
      return gIdx;
    };

    const result: Record<string, CellState[]> = {};

    for (const row of rows) {
      const rowCells: CellState[] = [];
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const baseCode = baseGroupMatrix[row.groupIdx]?.[dayIdx] || '';
        const dayNotes = notesByDate.get(day.isoDate);

        if (!dayNotes || dayNotes.length === 0) {
          rowCells.push({
            code: baseCode,
            variant: 'normal',
            detailLabel: describeBase(baseCode),
          });
          continue;
        }

        let resolved: CellState | null = null;
        for (const note of dayNotes) {
          const sourceGroupIdx =
            typeof note.targetGroupIdx === 'number' ? note.targetGroupIdx : myGroupIdx;

          if (note.type === 'Nöbet Değişimi') {
            const mySwapPerson = (note.swapMyPerson || cleanActiveProfile || '').trim();
            const partnerSwapPerson = (note.swapWithPerson || '').trim();
            const cleanTargetDate = (note.swapTargetDate || '').trim();

            const isRowMyPerson = mySwapPerson
              ? row.personName
                ? isSamePersonTR(row.personName, mySwapPerson)
                : row.groupIdx === sourceGroupIdx
              : row.isCurrentUser;

            const isRowPartnerPerson = partnerSwapPerson
              ? row.personName
                ? isSamePersonTR(row.personName, partnerSwapPerson)
                : false
              : false;

            const targetCode = settings.is24HourSystem
              ? '24'
              : note.swapShiftType === 'GUNDUZ'
              ? 'S'
              : 'A';

            // 1. Target date (or same-day move / single-date shift change to swapShiftType)
            if (cleanTargetDate === day.isoDate) {
              if (isRowMyPerson) {
                resolved = {
                  code: targetCode,
                  variant: 'swap-in',
                  detailLabel: `Becayiş Nöbeti (${
                    partnerSwapPerson ? `${partnerSwapPerson} yerine` : note.desc || 'Değişim'
                  })`,
                };
                break;
              }
              const partnerGroupIdx = getPartnerGroup(note);
              if (
                isRowPartnerPerson &&
                cleanTargetDate !== note.date &&
                (Boolean(row.personName) || partnerGroupIdx === row.groupIdx)
              ) {
                resolved = {
                  code: '',
                  variant: 'swap-out',
                  detailLabel: `Nöbet Değişimi (${mySwapPerson || 'Değişim'} devraldı)`,
                };
                break;
              }
            }

            // 2. Source date (note.date === day.isoDate)
            if (note.date === day.isoDate) {
              if (!cleanTargetDate && !partnerSwapPerson) {
                // Direct single-date shift change to swapShiftType (S or A)
                if (isRowMyPerson) {
                  resolved = {
                    code: targetCode,
                    variant: 'swap-in',
                    detailLabel: `Nöbet Değişimi (${
                      targetCode === 'A' ? 'Akşam - A' : targetCode === 'S' ? 'Sabah - S' : '24 Saat'
                    }${note.desc ? ` · ${note.desc}` : ''})`,
                  };
                  break;
                }
              } else if (cleanTargetDate !== day.isoDate) {
                if (isRowMyPerson) {
                  resolved = {
                    code: '',
                    variant: 'swap-out',
                    detailLabel: `Nöbet Değişimi (Devredildi${
                      partnerSwapPerson ? ` · ${partnerSwapPerson}` : ''
                    }${cleanTargetDate ? ` → ${trDateFormatter(cleanTargetDate)}` : ''})`,
                  };
                  break;
                }
                if (isRowPartnerPerson) {
                  const myNormalCode =
                    baseGroupMatrix[sourceGroupIdx]?.[dayIdx] ||
                    (note.swapShiftType === 'AKSAM' ? 'A' : 'S');
                  resolved = {
                    code: myNormalCode,
                    variant: 'swap-in',
                    detailLabel: `Becayiş Nöbeti (${mySwapPerson || 'Grubum'} yerine)`,
                  };
                  break;
                }
              }
            }
          } else if (note.date === day.isoDate) {
            const noteTargetPerson = (note.swapMyPerson || '').trim();
            const isRowTarget = noteTargetPerson
              ? row.personName
                ? isSamePersonTR(row.personName, noteTargetPerson)
                : row.groupIdx === sourceGroupIdx
              : row.isCurrentUser;

            if (isRowTarget) {
              const lowerDesc = `${note.type} ${note.desc}`.toLocaleLowerCase('tr-TR');

              // 0. Nöbet Boşa Çıkarma -> Clears existing S/A shift to empty cell
              if (
                note.type === 'Nöbet Boşa Çıkarma' ||
                lowerDesc.includes('boşa çıkar') ||
                lowerDesc.includes('nöbet iptal')
              ) {
                resolved = {
                  code: '',
                  variant: 'cleared',
                  detailLabel: `⬜ Nöbet Boşa Çıkarıldı${note.desc ? ` · ${note.desc}` : ''}`,
                };
                break;
              }

              // 0b. Ek Nöbet -> Admin manually assigned S or A shift
              if (note.type === 'Ek Nöbet') {
                const extraCode = settings.is24HourSystem
                  ? '24'
                  : note.swapShiftType === 'AKSAM'
                  ? 'A'
                  : 'S';
                resolved = {
                  code: extraCode,
                  variant: 'extra',
                  detailLabel: `➕ Ek Nöbet (${
                    extraCode === 'A'
                      ? 'Akşam / Gece - A'
                      : extraCode === 'S'
                      ? 'Sabah / Gündüz - S'
                      : '24 Saat'
                  })${note.desc ? ` · ${note.desc}` : ''}`,
                };
                break;
              }

              // 1. İcap Nöbeti -> Yellow background ('note') with 'S' or 'A' (or '24')
              if (
                note.type === 'İcap Nöbeti' ||
                lowerDesc.includes('icap') ||
                lowerDesc.includes('i̇cap')
              ) {
                const icapCode = settings.is24HourSystem
                  ? '24'
                  : note.swapShiftType === 'AKSAM'
                  ? 'A'
                  : note.swapShiftType === 'GUNDUZ'
                  ? 'S'
                  : baseCode || 'S';
                resolved = {
                  code: icapCode,
                  variant: 'note',
                  detailLabel: `🟨 İcap Nöbeti (${
                    icapCode === 'A'
                      ? 'Akşam / Gece - A'
                      : icapCode === 'S'
                      ? 'Sabah / Gündüz - S'
                      : '24 Saat'
                  })${note.desc ? ` · ${note.desc}` : ''}`,
                };
                break;
              }

              // 2. İzin / Rapor / İdari İzin / Ücretsiz İzin -> Purple background ('leave')
              if (
                note.type === 'İzin / Rapor' ||
                lowerDesc.includes('izin') ||
                lowerDesc.includes('idari') ||
                lowerDesc.includes('rapor') ||
                lowerDesc.includes('yıllık') ||
                lowerDesc.includes('ücretsiz') ||
                lowerDesc.includes('ucretsiz')
              ) {
                const isIdari = lowerDesc.includes('idari');
                const isUcretsiz =
                  lowerDesc.includes('ücretsiz') || lowerDesc.includes('ucretsiz');
                const isRapor = lowerDesc.includes('rapor');
                const leaveCode = isIdari
                  ? 'İDARİ'
                  : isUcretsiz
                  ? 'ÜCR.İZ'
                  : isRapor
                  ? 'RAPOR'
                  : 'İZİNLİ';
                const leaveBadgeTitle = isIdari
                  ? 'İdari İzin'
                  : isUcretsiz
                  ? 'Ücretsiz İzin'
                  : isRapor
                  ? 'Raporlu'
                  : note.type;
                resolved = {
                  code: leaveCode,
                  variant: 'leave',
                  detailLabel: `🟪 ${leaveBadgeTitle}: ${note.desc || leaveBadgeTitle}`,
                };
                break;
              }

              // 3. Diğer Notlar / Görevlendirme
              resolved = {
                code: baseCode,
                variant: 'note',
                detailLabel: `${describeBase(baseCode)} · Not: ${note.desc || note.type}`,
              };
              break;
            }
          }
        }

        rowCells.push(
          resolved || {
            code: baseCode,
            variant: 'normal',
            detailLabel: describeBase(baseCode),
          }
        );
      }
      result[row.rowKey] = rowCells;
    }

    return result;
  }, [
    rows,
    days,
    baseGroupMatrix,
    notes,
    rosterMode,
    myGroupIdx,
    cleanActiveProfile,
    settings,
    refHistory,
  ]);

  // Zoom + Density + Font Scale sizing tokens
  const sizeConfig = useMemo(() => {
    const dense = tablePrefs.rowDensity === 'compact';
    const comfy = tablePrefs.rowDensity === 'comfortable';
    const fontSm = tablePrefs.fontScale === 'sm';
    const fontLg = tablePrefs.fontScale === 'lg';

    if (zoom === 'overview') {
      return {
        siraW: 'w-[18px] min-w-[18px]',
        nameLeft: 'left-[18px]',
        nameW: 'w-[92px] sm:w-[132px] min-w-[92px] sm:min-w-[132px] max-w-[132px]',
        dayW: 'w-[13.5px] sm:w-[19px] min-w-[13.5px] sm:min-w-[19px]',
        numRowH: 'h-[15px]',
        wdTop: 'top-[15px]',
        headerH: 'h-[38px]',
        rowH: dense ? 'h-[14px] sm:h-[16px]' : comfy ? 'h-[20px] sm:h-[24px]' : 'h-[16px] sm:h-[18px]',
        nameText: fontSm
          ? 'text-[6.5px] sm:text-[7.5px]'
          : fontLg
          ? 'text-[8.5px] sm:text-[10px]'
          : 'text-[7.5px] sm:text-[8.5px]',
        cellText: fontSm
          ? 'text-[6.5px] sm:text-[7.5px]'
          : fontLg
          ? 'text-[8.5px] sm:text-[10px]'
          : 'text-[7.5px] sm:text-[8.5px]',
        dayNumText: 'text-[7.5px] sm:text-[8.5px]',
        weekdayText: 'text-[6px] sm:text-[7px]',
      };
    }
    if (zoom === 'compact') {
      return {
        siraW: 'w-[24px] min-w-[24px]',
        nameLeft: 'left-[24px]',
        nameW: 'w-[132px] min-w-[132px] max-w-[148px]',
        dayW: 'w-[21px] min-w-[21px]',
        numRowH: 'h-[19px]',
        wdTop: 'top-[19px]',
        headerH: 'h-[54px]',
        rowH: dense ? 'h-[18px]' : comfy ? 'h-[27px]' : 'h-[21px]',
        nameText: fontSm ? 'text-[8px]' : fontLg ? 'text-[10.5px]' : 'text-[9px]',
        cellText: fontSm ? 'text-[8.5px]' : fontLg ? 'text-[11px]' : 'text-[9.5px]',
        dayNumText: 'text-[9px]',
        weekdayText: 'text-[7.5px]',
      };
    }
    if (zoom === 'large') {
      return {
        siraW: 'w-[36px] min-w-[36px]',
        nameLeft: 'left-[36px]',
        nameW: 'w-[205px] min-w-[205px] max-w-[235px]',
        dayW: 'w-[34px] min-w-[34px]',
        numRowH: 'h-[25px]',
        wdTop: 'top-[25px]',
        headerH: 'h-[78px]',
        rowH: dense ? 'h-[25px]' : comfy ? 'h-[38px]' : 'h-[30px]',
        nameText: fontSm ? 'text-[10.5px]' : fontLg ? 'text-[13px]' : 'text-[11.5px]',
        cellText: fontSm ? 'text-[11px]' : fontLg ? 'text-[14px]' : 'text-[12.5px]',
        dayNumText: 'text-[11.5px]',
        weekdayText: 'text-[9.5px]',
      };
    }
    return {
      siraW: 'w-[30px] min-w-[30px]',
      nameLeft: 'left-[30px]',
      nameW: 'w-[165px] min-w-[165px] max-w-[195px]',
      dayW: 'w-[27px] min-w-[27px]',
      numRowH: 'h-[22px]',
      wdTop: 'top-[22px]',
      headerH: 'h-[68px]',
      rowH: dense ? 'h-[21px]' : comfy ? 'h-[32px]' : 'h-[25px]',
      nameText: fontSm ? 'text-[9px]' : fontLg ? 'text-[11.5px]' : 'text-[10px]',
      cellText: fontSm ? 'text-[9.5px]' : fontLg ? 'text-[12.5px]' : 'text-[11px]',
      dayNumText: 'text-[10px]',
      weekdayText: 'text-[8.5px]',
    };
  }, [zoom, tablePrefs.rowDensity, tablePrefs.fontScale]);

  // Monthly shift count & total hours per row (for optional Totals column & PNG export)
  const rowTotalsMap = useMemo(() => {
    const [dayDurH, nightDurH] = getShiftDurations(settings);
    const map: Record<string, { shifts: number; hours: number }> = {};
    for (const row of rows) {
      const cells = cellMatrixByRow[row.rowKey] || [];
      let shifts = 0;
      let hours = 0;
      for (const c of cells) {
        if (!c || c.variant === 'leave' || c.variant === 'cleared' || c.variant === 'swap-out') {
          continue;
        }
        if (c.code === '24') {
          shifts += 1;
          hours += 24;
        } else if (c.code === 'S') {
          shifts += 1;
          hours += dayDurH;
        } else if (c.code === 'A') {
          shifts += 1;
          hours += nightDurH;
        }
      }
      map[row.rowKey] = { shifts, hours: Math.round(hours) };
    }
    return map;
  }, [rows, cellMatrixByRow, settings]);

  // Compute rectangular multi-cell selection set between two grid coordinates
  const buildRectSelectionSet = useCallback(
    (r1: number, d1: number, r2: number, d2: number): Set<string> => {
      const minR = Math.max(0, Math.min(r1, r2));
      const maxR = Math.min(rows.length - 1, Math.max(r1, r2));
      const minD = Math.max(0, Math.min(d1, d2));
      const maxD = Math.min(days.length - 1, Math.max(d1, d2));
      const next = new Set<string>();
      for (let r = minR; r <= maxR; r++) {
        const rowObj = rows[r];
        if (!rowObj) continue;
        for (let d = minD; d <= maxD; d++) {
          next.add(`${rowObj.rowKey}::${d}`);
        }
      }
      return next;
    },
    [rows, days.length]
  );

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  // Global pointer tracking for smooth press-and-hold drag multi-cell selection (touch + mouse)
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerStartRef.current && !isDragSelectingRef.current) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        if (Math.hypot(dx, dy) > 10) {
          clearHoldTimer();
          pointerStartRef.current = null;
        }
      }
      if (!isDragSelectingRef.current || !dragAnchorRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cellEl = el?.closest<HTMLElement>('[data-roster-row][data-roster-day]');
      if (!cellEl) return;
      const rAttr = Number(cellEl.dataset.rosterRow);
      const dAttr = Number(cellEl.dataset.rosterDay);
      if (Number.isFinite(rAttr) && Number.isFinite(dAttr)) {
        const anchor = dragAnchorRef.current;
        setSelectedCellKeys(buildRectSelectionSet(anchor.rowIdx, anchor.dayIdx, rAttr, dAttr));
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragSelectingRef.current) {
        e.preventDefault();
      }
    };

    const handlePointerUpOrCancel = () => {
      clearHoldTimer();
      pointerStartRef.current = null;
      if (isDragSelectingRef.current) {
        isDragSelectingRef.current = false;
        setIsDragSelecting(false);
        dragAnchorRef.current = null;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUpOrCancel);
    window.addEventListener('pointercancel', handlePointerUpOrCancel);
    return () => {
      clearHoldTimer();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('pointerup', handlePointerUpOrCancel);
      window.removeEventListener('pointercancel', handlePointerUpOrCancel);
    };
  }, [buildRectSelectionSet, clearHoldTimer]);

  const handleCellPointerDown = (
    e: React.PointerEvent<HTMLTableCellElement>,
    rIdx: number,
    dIdx: number
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearHoldTimer();
    const rowObj = rows[rIdx];
    if (!rowObj) return;

    if (multiSelectMode) {
      // Immediate drag-selection when Bulk Select mode is toggled ON
      dragAnchorRef.current = { rowIdx: rIdx, dayIdx: dIdx };
      isDragSelectingRef.current = true;
      setIsDragSelecting(true);
      suppressNextClickRef.current = true;
      setSelectedCellKeys(new Set([`${rowObj.rowKey}::${dIdx}`]));
      setSelectedCell({ rowKey: rowObj.rowKey, dayIndex: dIdx });
      return;
    }

    pointerStartRef.current = { rowIdx: rIdx, dayIdx: dIdx, x: e.clientX, y: e.clientY };
    holdTimerRef.current = window.setTimeout(() => {
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(18);
        }
      } catch {
        // ignore vibration errors
      }
      dragAnchorRef.current = { rowIdx: rIdx, dayIdx: dIdx };
      isDragSelectingRef.current = true;
      suppressNextClickRef.current = true;
      setIsDragSelecting(true);
      setMultiSelectMode(true);
      setSelectedCellKeys(new Set([`${rowObj.rowKey}::${dIdx}`]));
      setSelectedCell({ rowKey: rowObj.rowKey, dayIndex: dIdx });
    }, 260);
  };

  const handleCellClick = (
    e: React.MouseEvent<HTMLTableCellElement>,
    row: RosterRow,
    rIdx: number,
    dIdx: number,
    isoDate: string
  ) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (e.shiftKey && selectedCell) {
      const anchorR = rows.findIndex((r) => r.rowKey === selectedCell.rowKey);
      if (anchorR >= 0) {
        setMultiSelectMode(true);
        setSelectedCellKeys(buildRectSelectionSet(anchorR, selectedCell.dayIndex, rIdx, dIdx));
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || multiSelectMode) {
      const key = `${row.rowKey}::${dIdx}`;
      setSelectedCellKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setSelectedCell({ rowKey: row.rowKey, dayIndex: dIdx });
      return;
    }

    setSelectedCellKeys(new Set());
    setSelectedCell({ rowKey: row.rowKey, dayIndex: dIdx });
    setEntryStartDate(isoDate);
    if (entryRoleMode === 'admin') {
      setEntryGroupIdx(row.groupIdx);
      if (row.personName) {
        setEntryPersonName(row.personName);
      }
    }
  };

  const handleSelectEntireRow = (row: RosterRow) => {
    setMultiSelectMode(true);
    const next = new Set<string>();
    for (let d = 0; d < days.length; d++) {
      next.add(`${row.rowKey}::${d}`);
    }
    setSelectedCellKeys(next);
    setSelectedCell({ rowKey: row.rowKey, dayIndex: 0 });
  };

  const handleSelectEntireDayColumn = (dIdx: number) => {
    setMultiSelectMode(true);
    const next = new Set<string>();
    for (const row of rows) {
      next.add(`${row.rowKey}::${dIdx}`);
    }
    setSelectedCellKeys(next);
    if (rows[0]) {
      setSelectedCell({ rowKey: rows[0].rowKey, dayIndex: dIdx });
    }
  };

  const clearBulkSelection = () => {
    setSelectedCellKeys(new Set());
    setMultiSelectMode(false);
    setShowBulkNoteInput(false);
    setBulkNoteDraft('');
  };

  const selectedCellsList = useMemo(() => {
    const list: Array<{ row: RosterRow; day: (typeof days)[number]; dayIndex: number }> = [];
    if (selectedCellKeys.size === 0) return list;
    const rowByKey = new Map(rows.map((r) => [r.rowKey, r]));
    selectedCellKeys.forEach((key) => {
      const sepIdx = key.lastIndexOf('::');
      if (sepIdx < 0) return;
      const rKey = key.slice(0, sepIdx);
      const dIdx = Number(key.slice(sepIdx + 2));
      const row = rowByKey.get(rKey);
      const day = days[dIdx];
      if (row && day) {
        list.push({ row, day, dayIndex: dIdx });
      }
    });
    return list;
  }, [selectedCellKeys, rows, days]);

  const selectedUniquePeopleCount = useMemo(
    () => new Set(selectedCellsList.map((item) => item.row.rowKey)).size,
    [selectedCellsList]
  );

  const selectedUniqueDaysCount = useMemo(
    () => new Set(selectedCellsList.map((item) => item.day.isoDate)).size,
    [selectedCellsList]
  );

  const selectedDetail = useMemo(() => {
    if (!selectedCell) return null;
    const row = rows.find((r) => r.rowKey === selectedCell.rowKey);
    const day = days[selectedCell.dayIndex];
    if (!row || !day) return null;
    const state = cellMatrixByRow[row.rowKey]?.[selectedCell.dayIndex];
    if (!state) return null;
    return {
      row,
      day,
      state,
    };
  }, [selectedCell, rows, days, cellMatrixByRow]);

  const handleOpenTableEntryModal = (_preferredRole?: EntryRoleMode) => {
    setEntryError('');
    const effectiveRole: EntryRoleMode = isAdminBureauMode ? 'admin' : 'user';
    setEntryRoleMode(effectiveRole);

    const fallbackISO =
      calendarYear === new Date().getFullYear() && calendarMonth === new Date().getMonth() + 1
        ? todayISO
        : `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-01`;

    setEntryStartDate(selectedDetail ? selectedDetail.day.isoDate : fallbackISO);
    setEntryEndDate('');
    if (selectedDetail?.state.code === 'A') {
      setEntryShiftType('AKSAM');
    } else if (selectedDetail?.state.code === 'S') {
      setEntryShiftType('GUNDUZ');
    }

    if (effectiveRole === 'user') {
      if (matchedActivePersonnel) {
        setEntryPersonName(matchedActivePersonnel.name);
        setEntryGroupIdx(matchedActivePersonnel.groupIdx);
      } else if (cleanActiveProfile) {
        setEntryPersonName(cleanActiveProfile);
        setEntryGroupIdx(myGroupIdx);
      }
    } else if (selectedDetail) {
      setEntryGroupIdx(selectedDetail.row.groupIdx);
      if (selectedDetail.row.personName) {
        setEntryPersonName(selectedDetail.row.personName);
      }
    } else if (!entryPersonName) {
      const fallbackPerson =
        matchedActivePersonnel?.name ||
        cleanActiveProfile ||
        allTablePersonnel.find((p) => p.groupIdx === myGroupIdx)?.name ||
        allTablePersonnel[0]?.name ||
        '';
      setEntryPersonName(fallbackPerson);
    }
    setShowTableEntryModal(true);
  };

  const handleSaveTableEntry = async () => {
    setEntryError('');
    const targetPerson = (entryPersonName || cleanActiveProfile || '').trim();

    if (entryRoleMode === 'admin') {
      if (!currentUser || !isAuthorizedAdmin) {
        setEntryError(
          'Yönetici olarak tüm kuruma veri girebilmek için Ana Yönetici tarafından yetkilendirilmiş Kurum Admini hesabıyla giriş yapmalısınız.'
        );
        return;
      }
      if (!activeUnit) {
        setEntryError(
          'Resmi yönetici verisi girmek için önce üstteki Kurum menüsünden bir kurum seçin veya Büro panelinden kurumunuzu yayınlayın.'
        );
        return;
      }
      if (!targetPerson) {
        setEntryError('Lütfen işlem yapılacak personeli seçin.');
        return;
      }

      setEntrySaving(true);
      try {
        const effectiveEnd =
          entryType === 'İzin / Rapor' ||
          entryType === 'İcap Nöbeti' ||
          entryType === 'Nöbet Boşa Çıkarma'
            ? entryEndDate.trim() || undefined
            : undefined;

        if (
          entryType === 'Ek Nöbet' ||
          entryType === 'Nöbet Boşa Çıkarma' ||
          entryType === 'İzin / Rapor' ||
          entryType === 'İcap Nöbeti' ||
          entryType === 'Nöbet Değişimi'
        ) {
          const targetDates = new Set(enumerateDateRangeISO(entryStartDate, effectiveEnd));
          if (entryType === 'Nöbet Değişimi' && entrySwapTargetDate.trim()) {
            targetDates.add(entrySwapTargetDate.trim());
          }
          const conflictingCloud = activeUnitCloudNotes.filter(
            (cn) =>
              (targetDates.has(cn.date) ||
                (cn.type === 'Nöbet Değişimi' &&
                  Boolean(cn.swapTargetDate?.trim()) &&
                  targetDates.has(cn.swapTargetDate!.trim()))) &&
              isSamePersonTR(cn.personName, targetPerson) &&
              (cn.type === 'Ek Nöbet' ||
                cn.type === 'Nöbet Boşa Çıkarma' ||
                cn.type === 'İzin / Rapor' ||
                cn.type === 'İcap Nöbeti' ||
                cn.type === 'Nöbet Değişimi')
          );
          for (const cn of conflictingCloud) {
            await deleteUnitRosterNoteFromCloud(activeUnit.id, cn.id);
          }
        }

        const effectiveEntryDesc =
          entryType === 'İzin / Rapor'
            ? entryDesc.trim()
              ? entryDesc.trim().toLowerCase().includes(entryLeaveSubType.toLowerCase())
                ? entryDesc.trim()
                : `${entryLeaveSubType} · ${entryDesc.trim()}`
              : entryLeaveSubType
            : entryDesc.trim();

        const addedCount = await addUnitRosterNoteRangeToCloud({
          unitId: activeUnit.id,
          startDate: entryStartDate,
          endDate: effectiveEnd,
          type: entryType,
          personName: targetPerson,
          groupIdx: entryGroupIdx,
          swapWithPerson: entryType === 'Nöbet Değişimi' ? entrySwapWithPerson.trim() : '',
          swapTargetDate: entryType === 'Nöbet Değişimi' ? entrySwapTargetDate.trim() : '',
          swapShiftType: entryShiftType,
          desc: effectiveEntryDesc,
        });
        setEntryDesc('');
        setEntryEndDate('');
        onInspectPersonCalendar?.(targetPerson, entryGroupIdx);
        onTriggerToast?.(
          'Yönetici Kaydı Tabloya İşlendi',
          addedCount > 1
            ? `${targetPerson} için ${addedCount} günlük ${entryType === 'İzin / Rapor' ? entryLeaveSubType : entryType} kaydı kurum tablosuna ve kişinin bireysel takvimine işlendi.`
            : `${targetPerson} için ${trDateFormatter(entryStartDate)} tarihli ${entryType === 'İzin / Rapor' ? entryLeaveSubType : entryType} kaydı kurum tablosuna işlendi.`
        );
        setShowTableEntryModal(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err || 'Kayıt eklenemedi.');
        setEntryError(msg);
      } finally {
        setEntrySaving(false);
      }
      return;
    }

    // Standard User (Bireysel Kullanıcı): If connected to an institution unit, send to Yönetici Onayı!
    if (activeUnit) {
      if (!targetPerson) {
        setEntryError('Yönetici onayına göndermek için lütfen işlem yapılacak personeli seçin.');
        return;
      }
      setEntrySaving(true);
      try {
        const effectiveEntryDesc =
          entryType === 'İzin / Rapor'
            ? entryDesc.trim()
              ? entryDesc.trim().toLowerCase().includes(entryLeaveSubType.toLowerCase())
                ? entryDesc.trim()
                : `${entryLeaveSubType} · ${entryDesc.trim()}`
              : entryLeaveSubType
            : entryDesc.trim();
        await submitUnitLeaveRequestToCloud({
          unitId: activeUnit.id,
          startDate: entryStartDate,
          endDate:
            entryType === 'İzin / Rapor' ||
            entryType === 'İcap Nöbeti' ||
            entryType === 'Nöbet Boşa Çıkarma'
              ? entryEndDate.trim() || entryStartDate
              : entryStartDate,
          type: entryType === 'Görevlendirme' ? 'Not' : entryType,
          personName: targetPerson,
          groupIdx: entryGroupIdx,
          swapWithPerson: entryType === 'Nöbet Değişimi' ? entrySwapWithPerson.trim() : '',
          swapTargetDate: entryType === 'Nöbet Değişimi' ? entrySwapTargetDate.trim() : '',
          swapShiftType: entryShiftType,
          desc: effectiveEntryDesc,
        });
        setEntryDesc('');
        setEntryEndDate('');
        onTriggerToast?.(
          'Yönetici Onayına Gönderildi',
          `${targetPerson} için ${entryType === 'İzin / Rapor' ? entryLeaveSubType : entryType} talebi yönetici onayına iletildi. Onaylandığında ana takvime ve tabloya otomatik işlenecektir.`
        );
        setShowTableEntryModal(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err || 'Onaya gönderilemedi.');
        setEntryError(msg);
      } finally {
        setEntrySaving(false);
      }
      return;
    }

    // Standard User (Bireysel Kullanıcı) Local Table & Calendar Entry (when not connected to a server unit)
    if (!onSaveLocalNotes) {
      onOpenNoteForDate(entryStartDate);
      return;
    }

    const datesToAdd =
      entryType === 'İzin / Rapor' ||
      entryType === 'İcap Nöbeti' ||
      entryType === 'Nöbet Boşa Çıkarma'
        ? enumerateDateRangeISO(entryStartDate, entryEndDate)
        : [entryStartDate];

    const baseId = Date.now();
    const resolvedLocalDesc =
      entryType === 'İzin / Rapor'
        ? entryDesc.trim()
          ? entryDesc.trim().toLowerCase().includes(entryLeaveSubType.toLowerCase())
            ? entryDesc.trim()
            : `${entryLeaveSubType} · ${entryDesc.trim()}`
          : entryLeaveSubType
        : entryDesc.trim();
    const createdNotes: NoteItem[] = datesToAdd.map((iso, idx) => ({
      id: baseId + idx,
      date: iso,
      type: entryType,
      desc:
        resolvedLocalDesc ||
        (entryType === 'İzin / Rapor'
          ? entryLeaveSubType
          : entryType === 'İcap Nöbeti'
          ? `İcap Nöbeti (${entryShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
          : entryType === 'Nöbet Boşa Çıkarma'
          ? 'Nöbet Boşa Çıkarıldı'
          : entryType === 'Ek Nöbet'
          ? `Ek Nöbet (${entryShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
          : entryType === 'Nöbet Değişimi'
          ? `Nöbet Değişimi (${entryShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
          : entryType),
      isNewRef: false,
      targetGroupIdx: entryGroupIdx,
      swapMyPerson: targetPerson,
      swapWithPerson: entryType === 'Nöbet Değişimi' ? entrySwapWithPerson.trim() : undefined,
      swapTargetDate: entryType === 'Nöbet Değişimi' ? entrySwapTargetDate.trim() : undefined,
      swapShiftType: entryShiftType,
    }));

    const targetDateSet = new Set(datesToAdd);
    if (entryType === 'Nöbet Değişimi' && entrySwapTargetDate.trim()) {
      targetDateSet.add(entrySwapTargetDate.trim());
    }
    const filteredLocalNotes = localNotes.filter((ln) => {
      if (
        entryType !== 'Ek Nöbet' &&
        entryType !== 'Nöbet Boşa Çıkarma' &&
        entryType !== 'İzin / Rapor' &&
        entryType !== 'İcap Nöbeti' &&
        entryType !== 'Nöbet Değişimi'
      ) {
        return true;
      }
      const sameDate =
        targetDateSet.has(ln.date) ||
        (ln.type === 'Nöbet Değişimi' &&
          Boolean(ln.swapTargetDate?.trim()) &&
          targetDateSet.has(ln.swapTargetDate!.trim()));
      if (!sameDate) return true;
      const samePerson = ln.swapMyPerson
        ? isSamePersonTR(ln.swapMyPerson, targetPerson)
        : ln.targetGroupIdx === entryGroupIdx;
      return !samePerson;
    });

    onSaveLocalNotes([...filteredLocalNotes, ...createdNotes]);
    setEntryDesc('');
    setEntryEndDate('');
    if (targetPerson) {
      onInspectPersonCalendar?.(targetPerson, entryGroupIdx);
    }
    onTriggerToast?.(
      'Bireysel Tablo Kaydı Eklendi',
      createdNotes.length > 1
        ? `${createdNotes.length} günlük ${entryType} kaydı kişisel tablonuza ve takviminize eklendi.`
        : `${trDateFormatter(entryStartDate)} tarihli ${entryType} kaydı kişisel tablonuza eklendi.`
    );
    setShowTableEntryModal(false);
  };

  // =========================================================================
  // PRO TABLE STRUCTURE EDITING HELPERS (Group Names, Rename, Move ↑↓, Swap, Transfer)
  // =========================================================================
  const canEditTableStructure = activeUnit
    ? isAuthorizedAdmin
    : Boolean(onUpdateSettings);

  const parseMembersMatrix = (): string[][] => {
    return Array.from({ length: settings.numGroups }, (_, g) =>
      (settings.groupMembers[g] || '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  };

  const persistRosterStructure = async (
    nextGroupNames: string[],
    nextMembersMatrix: string[][],
    toastTitle: string,
    toastMessage: string
  ) => {
    const serializedMembers = nextMembersMatrix.map((arr) =>
      arr
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ')
    );
    const cleanedNames = Array.from({ length: settings.numGroups }, (_, g) =>
      (nextGroupNames[g] || `${g + 1}. Grup`).trim() || `${g + 1}. Grup`
    );

    setStructureSaving(true);
    try {
      if (activeUnit) {
        if (!isAuthorizedAdmin) {
          onTriggerToast?.(
            'Yönetici Yetkisi Gerekli',
            'Kurum personel listesini değiştirmek için Yetkili Kurum Admini olarak giriş yapmalısınız.'
          );
          return;
        }
        await updateUnitRosterStructureInCloud({
          unit: activeUnit,
          groupNames: cleanedNames,
          groupMembers: serializedMembers,
        });
      } else if (onUpdateSettings) {
        onUpdateSettings({
          ...settings,
          groupNames: cleanedNames,
          groupMembers: serializedMembers,
        });
      }
      onTriggerToast?.(toastTitle, toastMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || 'Güncellenemedi.');
      onTriggerToast?.('Düzenleme Hatası', msg);
    } finally {
      setStructureSaving(false);
    }
  };

  const handleOpenStructureStudio = () => {
    if (activeUnit && !isAuthorizedAdmin) {
      setEntryRoleMode('admin');
      setShowTableEntryModal(true);
      return;
    }
    setStudioGroupNames(
      Array.from({ length: settings.numGroups }, (_, g) => settings.groupNames[g] || `${g + 1}. Grup`)
    );
    setStudioGroupMembers(parseMembersMatrix());
    setStudioNewPersonByGroup({});
    setStudioSwapPick(null);
    setShowStructureStudio(true);
  };

  const handleInlineMoveMember = async (groupIdx: number, memberIdx: number, dir: -1 | 1) => {
    const matrix = parseMembersMatrix();
    const list = [...(matrix[groupIdx] || [])];
    const targetIdx = memberIdx + dir;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const movedName = list[memberIdx];
    [list[memberIdx], list[targetIdx]] = [list[targetIdx], list[memberIdx]];
    matrix[groupIdx] = list;
    await persistRosterStructure(
      settings.groupNames,
      matrix,
      'Personel Sırası Güncellendi',
      `${movedName} yeni sırasına taşındı (${targetIdx === 0 ? 'Grup Sorumlusu' : targetIdx === 1 ? 'Grup Sorumlusu Yrd.' : `${targetIdx + 1}. Sıra`}).`
    );
  };

  const handleInlineSwapClick = async (groupIdx: number, memberIdx: number, personName: string) => {
    if (!swapSourceSlot) {
      setSwapSourceSlot({ groupIdx, memberIdx, personName });
      onTriggerToast?.(
        'Yer Değiştirme Seçildi',
        `${personName} seçildi. Yerini değiştirmek istediğiniz diğer personelin ⇄ butonuna dokunun.`
      );
      return;
    }
    if (swapSourceSlot.groupIdx === groupIdx && swapSourceSlot.memberIdx === memberIdx) {
      setSwapSourceSlot(null);
      return;
    }

    const matrix = parseMembersMatrix();
    const aList = [...(matrix[swapSourceSlot.groupIdx] || [])];
    const bList =
      swapSourceSlot.groupIdx === groupIdx ? aList : [...(matrix[groupIdx] || [])];

    const nameA = aList[swapSourceSlot.memberIdx];
    const nameB = bList[memberIdx];
    if (!nameA || !nameB) {
      setSwapSourceSlot(null);
      return;
    }

    if (swapSourceSlot.groupIdx === groupIdx) {
      [aList[swapSourceSlot.memberIdx], aList[memberIdx]] = [nameB, nameA];
      matrix[groupIdx] = aList;
    } else {
      aList[swapSourceSlot.memberIdx] = nameB;
      bList[memberIdx] = nameA;
      matrix[swapSourceSlot.groupIdx] = aList;
      matrix[groupIdx] = bList;
    }

    setSwapSourceSlot(null);
    await persistRosterStructure(
      settings.groupNames,
      matrix,
      'Personel Yerleri Değiştirildi',
      `${nameA} ↔ ${nameB} tabloda anında yer değiştirdi.`
    );
  };

  const handleCommitInlineRename = async () => {
    if (!inlineRenameSlot) return;
    const clean = inlineRenameSlot.value.trim();
    if (!clean) {
      setInlineRenameSlot(null);
      return;
    }
    const matrix = parseMembersMatrix();
    const list = [...(matrix[inlineRenameSlot.groupIdx] || [])];
    const oldName = list[inlineRenameSlot.memberIdx];
    if (!oldName || oldName === clean) {
      setInlineRenameSlot(null);
      return;
    }
    list[inlineRenameSlot.memberIdx] = clean;
    matrix[inlineRenameSlot.groupIdx] = list;
    setInlineRenameSlot(null);
    await persistRosterStructure(
      settings.groupNames,
      matrix,
      'Personel Adı Güncellendi',
      `${oldName} → ${clean} olarak güncellendi.`
    );
  };

  // =========================================================================
  // 1-TAP QUICK CELL OVERRIDE (Clear Shift, Assign S/A, İzinli, İcap, Reset)
  // =========================================================================
  const handleQuickCellAction = async (
    actionType:
      | 'CLEAR'
      | 'ASSIGN_S'
      | 'ASSIGN_A'
      | 'LEAVE'
      | 'LEAVE_IDARI'
      | 'LEAVE_UCRETSIZ'
      | 'ICAP_S'
      | 'ICAP_A'
      | 'RESET'
  ) => {
    if (!selectedDetail) return;
    const targetDate = selectedDetail.day.isoDate;
    const targetPerson = (selectedDetail.row.personName || cleanActiveProfile || '').trim();
    const targetGroupIdx = selectedDetail.row.groupIdx;

    if (!targetPerson) {
      onTriggerToast?.('Personel Gerekli', 'Hızlı hücre işlemi için Personel görünümünde bir personel satırı seçin.');
      return;
    }

    if (activeUnit && !isAuthorizedAdmin) {
      setEntryRoleMode('admin');
      setShowTableEntryModal(true);
      return;
    }

    setQuickCellSaving(true);
    try {
      // Remove any existing overrides for this person on this exact date first so the new state is clean
      const matchingCloud = activeUnitCloudNotes.filter(
        (cn) =>
          (cn.date === targetDate ||
            (cn.type === 'Nöbet Değişimi' && cn.swapTargetDate?.trim() === targetDate)) &&
          (isSamePersonTR(cn.personName, targetPerson) ||
            (cn.type === 'Nöbet Değişimi' && isSamePersonTR(cn.swapWithPerson, targetPerson)))
      );
      const matchingLocal = localNotes.filter(
        (ln) =>
          (ln.date === targetDate ||
            (ln.type === 'Nöbet Değişimi' && ln.swapTargetDate?.trim() === targetDate)) &&
          (ln.swapMyPerson
            ? isSamePersonTR(ln.swapMyPerson, targetPerson)
            : ln.targetGroupIdx === targetGroupIdx)
      );

      if (activeUnit && isAuthorizedAdmin) {
        for (const cn of matchingCloud) {
          await deleteUnitRosterNoteFromCloud(activeUnit.id, cn.id);
        }
      } else if (onSaveLocalNotes && matchingLocal.length > 0) {
        const removeIds = new Set(matchingLocal.map((it) => it.id));
        onSaveLocalNotes(localNotes.filter((it) => !removeIds.has(it.id)));
      }

      if (actionType === 'RESET') {
        onInspectPersonCalendar?.(targetPerson, targetGroupIdx);
        onTriggerToast?.(
          'Hücre Varsayılana Döndürüldü',
          `${targetPerson} · ${trDateFormatter(targetDate)} tarihindeki özel değişiklikler temizlendi.`
        );
        return;
      }

      const typeMap: Record<
        Exclude<typeof actionType, 'RESET'>,
        { type: RosterRecordType; shift: 'GUNDUZ' | 'AKSAM'; desc: string }
      > = {
        CLEAR: {
          type: 'Nöbet Boşa Çıkarma',
          shift: 'GUNDUZ',
          desc: 'Yönetici tarafından boşa çıkarıldı',
        },
        ASSIGN_S: {
          type: 'Ek Nöbet',
          shift: 'GUNDUZ',
          desc: 'Manuel Sabah (S) Nöbeti',
        },
        ASSIGN_A: {
          type: 'Ek Nöbet',
          shift: 'AKSAM',
          desc: 'Manuel Akşam (A) Nöbeti',
        },
        LEAVE: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'İzinli',
        },
        LEAVE_IDARI: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'İdari İzin',
        },
        LEAVE_UCRETSIZ: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'Ücretsiz İzin',
        },
        ICAP_S: {
          type: 'İcap Nöbeti',
          shift: 'GUNDUZ',
          desc: 'İcap Nöbeti (S)',
        },
        ICAP_A: {
          type: 'İcap Nöbeti',
          shift: 'AKSAM',
          desc: 'İcap Nöbeti (A)',
        },
      };

      const cfg = typeMap[actionType];
      if (activeUnit && isAuthorizedAdmin) {
        await addUnitRosterNoteRangeToCloud({
          unitId: activeUnit.id,
          startDate: targetDate,
          type: cfg.type,
          personName: targetPerson,
          groupIdx: targetGroupIdx,
          swapShiftType: cfg.shift,
          desc: cfg.desc,
        });
      } else if (onSaveLocalNotes) {
        const removeIds = new Set(matchingLocal.map((it) => it.id));
        const filtered = localNotes.filter((it) => !removeIds.has(it.id));
        onSaveLocalNotes([
          ...filtered,
          {
            id: Date.now(),
            date: targetDate,
            type: cfg.type,
            desc: cfg.desc,
            isNewRef: false,
            targetGroupIdx,
            swapMyPerson: targetPerson,
            swapShiftType: cfg.shift,
          },
        ]);
      }

      onInspectPersonCalendar?.(targetPerson, targetGroupIdx);
      onTriggerToast?.(
        'Tablo Hücresi Güncellendi',
        `${targetPerson} (${trDateFormatter(targetDate)}) → ${cfg.desc}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || 'İşlem yapılamadı.');
      onTriggerToast?.('İşlem Hatası', msg);
    } finally {
      setQuickCellSaving(false);
    }
  };

  // =========================================================================
  // BULK MULTI-CELL ACTIONS (Color Highlight, Copy, Bulk Shift / Leave / Note)
  // =========================================================================
  const handleApplyCellHighlight = (hex: string) => {
    const targets =
      selectedCellsList.length > 0
        ? selectedCellsList
        : selectedDetail
        ? [
            {
              row: selectedDetail.row,
              day: selectedDetail.day,
              dayIndex: selectedCell?.dayIndex ?? 0,
            },
          ]
        : [];
    if (targets.length === 0) return;

    setCellHighlights((prev) => {
      const next = { ...prev };
      for (const t of targets) {
        const key = getCellHighlightKey(t.row.rowKey, t.day.isoDate);
        if (!hex) {
          delete next[key];
        } else {
          next[key] = hex;
        }
      }
      scheduleTableMetaCloudSync(tablePrefsRef.current, next);
      return next;
    });
    onTriggerToast?.(
      hex ? 'Hücre Rengi Uygulandı' : 'Hücre Rengi Temizlendi',
      `${targets.length} bölme güncellendi.`
    );
  };

  const handleCopyBulkSelection = async () => {
    if (selectedCellsList.length === 0) return;
    const sorted = [...selectedCellsList].sort((a, b) =>
      a.row.siraNo !== b.row.siraNo
        ? a.row.siraNo - b.row.siraNo
        : a.dayIndex - b.dayIndex
    );
    const lines = sorted.map((item) => {
      const cell = cellMatrixByRow[item.row.rowKey]?.[item.dayIndex];
      const code = cell?.code || 'İstirahat';
      return `${item.row.displayLabel} · ${trDateFormatter(item.day.isoDate)} (${item.day.weekdayUpper}): ${code}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      onTriggerToast?.('Seçim Kopyalandı', `${lines.length} bölme panoya kopyalandı.`);
    } catch {
      onTriggerToast?.('Kopyalanamadı', 'Tarayıcı pano erişimine izin vermedi.');
    }
  };

  const handleBulkCellsAction = async (
    actionType:
      | 'CLEAR'
      | 'ASSIGN_S'
      | 'ASSIGN_A'
      | 'LEAVE'
      | 'LEAVE_IDARI'
      | 'LEAVE_UCRETSIZ'
      | 'ICAP_S'
      | 'ICAP_A'
      | 'RESET'
      | 'NOTE',
    customNoteText?: string
  ) => {
    if (selectedCellsList.length === 0) return;

    const validTargets = selectedCellsList
      .map((t) => ({
        row: t.row,
        day: t.day,
        person: (t.row.personName || cleanActiveProfile || '').trim(),
        groupIdx: t.row.groupIdx,
      }))
      .filter((t) => Boolean(t.person));

    if (validTargets.length === 0) {
      onTriggerToast?.(
        'Personel Satırı Seçin',
        'Toplu nöbet/izin işlemi için Personel görünümünde hücre seçin.'
      );
      return;
    }

    if (activeUnit && !isAuthorizedAdmin) {
      onTriggerToast?.(
        'Yetki Gerekli',
        'Kurum çizelgesinde toplu veri değiştirmek için Kurum Yöneticisi yetkisi gerekir. Hücre renklendirme ve kopyalama özelliğini serbestçe kullanabilirsiniz.'
      );
      return;
    }

    setBulkSaving(true);
    try {
      // 1. Clean existing overrides for all targeted (person, date) cells
      const targetPairKeys = new Set(
        validTargets.map((t) => `${normalizeTR(t.person)}::${t.day.isoDate}`)
      );

      if (activeUnit && isAuthorizedAdmin) {
        const toDeleteCloud = activeUnitCloudNotes.filter((cn) =>
          targetPairKeys.has(`${normalizeTR(cn.personName)}::${cn.date}`)
        );
        await Promise.all(
          toDeleteCloud.map((cn) => deleteUnitRosterNoteFromCloud(activeUnit.id, cn.id))
        );
      }

      const cleanedLocal = localNotes.filter((ln) => {
        const p = (ln.swapMyPerson || '').trim();
        if (!p) return true;
        return !targetPairKeys.has(`${normalizeTR(p)}::${ln.date}`);
      });

      if (actionType === 'RESET') {
        if (!activeUnit && onSaveLocalNotes) {
          onSaveLocalNotes(cleanedLocal);
        }
        // Also clear custom color highlights on reset
        setCellHighlights((prev) => {
          const next = { ...prev };
          for (const t of selectedCellsList) {
            delete next[getCellHighlightKey(t.row.rowKey, t.day.isoDate)];
          }
          scheduleTableMetaCloudSync(tablePrefsRef.current, next);
          return next;
        });
        onTriggerToast?.(
          'Toplu Sıfırlama Tamamlandı',
          `${validTargets.length} bölme varsayılan nöbet düzenine döndürüldü.`
        );
        clearBulkSelection();
        return;
      }

      const typeMap: Record<
        Exclude<typeof actionType, 'RESET'>,
        { type: RosterRecordType; shift: 'GUNDUZ' | 'AKSAM'; desc: string }
      > = {
        CLEAR: {
          type: 'Nöbet Boşa Çıkarma',
          shift: 'GUNDUZ',
          desc: 'Toplu boşa çıkarıldı',
        },
        ASSIGN_S: {
          type: 'Ek Nöbet',
          shift: 'GUNDUZ',
          desc: 'Toplu Sabah (S) Nöbeti',
        },
        ASSIGN_A: {
          type: 'Ek Nöbet',
          shift: 'AKSAM',
          desc: 'Toplu Akşam (A) Nöbeti',
        },
        LEAVE: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'İzinli',
        },
        LEAVE_IDARI: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'İdari İzin',
        },
        LEAVE_UCRETSIZ: {
          type: 'İzin / Rapor',
          shift: 'GUNDUZ',
          desc: 'Ücretsiz İzin',
        },
        ICAP_S: {
          type: 'İcap Nöbeti',
          shift: 'GUNDUZ',
          desc: 'İcap Nöbeti (S)',
        },
        ICAP_A: {
          type: 'İcap Nöbeti',
          shift: 'AKSAM',
          desc: 'İcap Nöbeti (A)',
        },
        NOTE: {
          type: 'Not',
          shift: 'GUNDUZ',
          desc: (customNoteText || '').trim() || 'Not',
        },
      };

      const cfg = typeMap[actionType];

      if (activeUnit && isAuthorizedAdmin) {
        // Deduplicate by (person, isoDate) and write concurrently in chunks
        const uniqueMap = new Map<string, (typeof validTargets)[number]>();
        for (const t of validTargets) {
          uniqueMap.set(`${normalizeTR(t.person)}::${t.day.isoDate}`, t);
        }
        const uniqueList = Array.from(uniqueMap.values());
        await Promise.all(
          uniqueList.map((t) =>
            addUnitRosterNoteRangeToCloud({
              unitId: activeUnit.id,
              startDate: t.day.isoDate,
              type: cfg.type,
              personName: t.person,
              groupIdx: t.groupIdx,
              swapShiftType: cfg.shift,
              desc: cfg.desc,
            })
          )
        );
      } else if (onSaveLocalNotes) {
        const baseId = Date.now();
        const newItems: NoteItem[] = validTargets.map((t, idx) => ({
          id: baseId + idx,
          date: t.day.isoDate,
          type: cfg.type,
          desc: cfg.desc,
          isNewRef: false,
          targetGroupIdx: t.groupIdx,
          swapMyPerson: t.person,
          swapShiftType: cfg.shift,
        }));
        onSaveLocalNotes([...cleanedLocal, ...newItems]);
      }

      if (validTargets[0]) {
        onInspectPersonCalendar?.(validTargets[0].person, validTargets[0].groupIdx);
      }
      onTriggerToast?.(
        'Toplu İşlem Uygulandı',
        `${validTargets.length} bölme için "${cfg.desc}" kaydedildi.`
      );
      clearBulkSelection();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || 'Toplu işlem yapılamadı.');
      onTriggerToast?.('Toplu İşlem Hatası', msg);
    } finally {
      setBulkSaving(false);
    }
  };

  const pendingLeaveRequests = useMemo(
    () => activeUnitLeaveRequests.filter((r) => r.status === 'PENDING'),
    [activeUnitLeaveRequests]
  );

  // Existing notes for the selected date in the Table Entry Modal (consecutive days grouped into a single range entry)
  const matchingLocalNotesForDate = useMemo(() => {
    const grouped = groupConsecutiveRecords(localNotes);
    return grouped.filter(
      (grp) =>
        (grp.startDate <= entryStartDate && grp.endDate >= entryStartDate) ||
        grp.swapTargetDate === entryStartDate
    );
  }, [localNotes, entryStartDate]);

  const matchingCloudNotesForDate = useMemo(() => {
    const grouped = groupConsecutiveRecords(activeUnitCloudNotes);
    return grouped.filter(
      (grp) =>
        (grp.startDate <= entryStartDate && grp.endDate >= entryStartDate) ||
        grp.swapTargetDate === entryStartDate
    );
  }, [activeUnitCloudNotes, entryStartDate]);

  const effectiveSheetTitle = useMemo(() => {
    if (tablePrefs.customTitle.trim()) {
      return tablePrefs.customTitle.trim().toLocaleUpperCase('tr-TR');
    }
    const unitPrefix = activeUnit?.name
      ? `${activeUnit.name.toLocaleUpperCase('tr-TR')} — `
      : settings.activeUnitName
      ? `${settings.activeUnitName.toLocaleUpperCase('tr-TR')} — `
      : '';
    return `${unitPrefix}${MONTH_NAMES_TR[calendarMonth - 1].toLocaleUpperCase(
      'tr-TR'
    )} ${calendarYear} AYLIK NÖBET ÇİZELGESİ`;
  }, [tablePrefs.customTitle, activeUnit?.name, settings.activeUnitName, calendarMonth, calendarYear]);

  const buildRosterCanvas = () => {
    const title = effectiveSheetTitle;
    const subtitle = settings.is24HourSystem
      ? `24 Saat Sistemi (${settings.shift24Start})`
      : `S: ${settings.dayStart}-${settings.dayEnd} · A: ${settings.nightStart}-${settings.nightEnd}`;
    const legendText = `Kırmızı: Grup Sorumlusu · Mavi: Grup Sorumlusu Yardımcısı · S: Sabah (${settings.dayStart}-${settings.dayEnd}) · A: Akşam (${settings.nightStart}-${settings.nightEnd}) · Sarı (S/A): İcap Nöbeti · Mavi Dolgu: Nöbet Değişimi · Mor: İzinli`;

    return renderRosterToCanvas({
      title,
      subtitle,
      days,
      rows,
      getCell: (row, dayIdx) => {
        const st = cellMatrixByRow[row.rowKey]?.[dayIdx];
        const isoDate = days[dayIdx]?.isoDate || '';
        const customBg = isoDate
          ? cellHighlights[getCellHighlightKey(row.rowKey, isoDate)]
          : undefined;
        return st
          ? { code: st.code, variant: st.variant, customBg }
          : { code: '', variant: 'normal', customBg };
      },
      getRowTotals: (row) => rowTotalsMap[row.rowKey] || { shifts: 0, hours: 0 },
      styleOptions: {
        tableTheme: tablePrefs.tableTheme,
        highlightWeekends: tablePrefs.highlightWeekends,
        zebraGroups: tablePrefs.zebraGroups,
        colorizeShiftCodes: tablePrefs.colorizeShiftCodes,
        highlightToday: tablePrefs.highlightToday,
        boldGroupDividers: tablePrefs.boldGroupDividers,
        showLegend: tablePrefs.showLegend,
        showTotalsColumn: tablePrefs.showTotalsColumn,
        rowDensity: tablePrefs.rowDensity,
      },
      legendText,
    });
  };

  const handleOpenPngPreview = () => {
    const canvas = buildRosterCanvas();
    const dataUrl = canvas.toDataURL('image/png');
    const fileName = `nobet-cizelgesi-${calendarYear}-${String(calendarMonth).padStart(2, '0')}.png`;
    setPreviewPng({ dataUrl, fileName, canvas });
  };

  const handleExportTablePng = async (
    mode: 'share' | 'download',
    existing?: { canvas: HTMLCanvasElement; fileName: string }
  ) => {
    const canvas = existing?.canvas || buildRosterCanvas();
    const fileName =
      existing?.fileName ||
      `nobet-cizelgesi-${calendarYear}-${String(calendarMonth).padStart(2, '0')}.png`;
    const ok = await shareCanvas(canvas, fileName, mode);
    if (ok) {
      if (mode === 'download') {
        setDownloadDone(true);
        window.setTimeout(() => setDownloadDone(false), 2000);
      } else {
        setShareDone(true);
        window.setTimeout(() => setShareDone(false), 2000);
      }
    }
  };

  return (
    <div
      data-no-swipe="true"
      className="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100 select-none"
    >
      {/* ROW 1: COMPACT NAVIGATION, MONTH SWITCHER, OVERVIEW ZOOM & EXPORT BAR (ZERO OVERLAP) */}
      <header className="flex items-center justify-between gap-1 px-2 sm:px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        {/* Left: Back Button */}
        <button
          type="button"
          onClick={onClose}
          className="h-8 px-2 sm:px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer shrink-0 whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Takvim</span>
        </button>

        {/* Center: Month Switcher */}
        <div className="flex items-center gap-0.5 bg-slate-800/90 border border-slate-700/80 rounded-xl px-1 py-0.5 shrink-0">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-slate-700 text-slate-200 transition cursor-pointer"
            aria-label="Önceki Ay"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] sm:text-xs font-extrabold tracking-tight px-1 whitespace-nowrap tabular-nums">
            {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear}
          </span>
          <button
            type="button"
            onClick={handleNextMonth}
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-slate-700 text-slate-200 transition cursor-pointer"
            aria-label="Sonraki Ay"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Full-List Overview Toggle, Zoom & Export */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => (z === 'overview' ? 'normal' : 'overview'))}
            className={`h-8 px-2 rounded-xl border text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
              zoom === 'overview'
                ? 'bg-emerald-600 border-emerald-400 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Tüm Listeye Hakim Genel Görünüm / Yakın Görünüm"
          >
            <span>{zoom === 'overview' ? 'Tam Liste' : 'Genel'}</span>
          </button>

          <button
            type="button"
            onClick={() => cycleZoom(-1)}
            disabled={zoom === 'overview'}
            className="w-7 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-slate-200 flex items-center justify-center transition cursor-pointer"
            title="Uzaklaştır"
            aria-label="Uzaklaştır"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => cycleZoom(1)}
            disabled={zoom === 'large'}
            className="w-7 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-slate-200 flex items-center justify-center transition cursor-pointer"
            title="Yakınlaştır"
            aria-label="Yakınlaştır"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleOpenPngPreview}
            className="h-8 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
            title="PNG Önizle ve İndir"
            aria-label="PNG Önizle ve İndir"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">PNG</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportTablePng('share')}
            className={`h-8 px-2 rounded-xl text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
              shareDone
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
            title="Tabloyu Görsel Olarak Paylaş"
            aria-label="Paylaş"
          >
            {shareDone ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{shareDone ? 'Hazır' : 'Paylaş'}</span>
          </button>
        </div>
      </header>

      {/* ROW 2: TOP CONTROL PANEL — INSTITUTION SELECTOR + VERİ GİRİŞİ ROLÜ (PERSONEL / YÖNETİCİ) & PERSONEL SEÇİMİ */}
      <div className="px-2 sm:px-3 py-1.5 bg-slate-900/95 border-b border-slate-800 flex-shrink-0 space-y-1.5">
        {/* Sub-row 2A: Institution Switcher + Roster View Mode + Bureau Server Button */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            {onSelectUnit ? (
              <select
                value={activeUnit?.id || '__LOCAL__'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__LOCAL__') {
                    onSelectUnit(null);
                  } else {
                    const target = allUnits.find((u) => u.id === val) || null;
                    if (target) onSelectUnit(target);
                  }
                }}
                className="h-7 px-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-[11px] font-extrabold outline-none cursor-pointer min-w-0 flex-1 max-w-[220px] sm:max-w-xs truncate"
              >
                <option value="__LOCAL__">Kişisel / Yerel Çizelgem</option>
                {allUnits.map((u) => {
                  const meta = getInstitutionMeta(u.institutionType);
                  return (
                    <option key={u.id} value={u.id}>
                      {meta.emoji} [{meta.shortLabel}] {u.name}
                    </option>
                  );
                })}
              </select>
            ) : (
              <span className="text-[11px] font-extrabold text-slate-200 truncate">
                {activeUnit?.name || 'Kişisel / Yerel Çizelgem'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                if (multiSelectMode) {
                  clearBulkSelection();
                } else {
                  setMultiSelectMode(true);
                  setShowCustomizePanel(false);
                }
              }}
              className={`h-7 px-2 rounded-lg border text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                multiSelectMode || selectedCellsList.length > 1
                  ? 'bg-indigo-600 border-indigo-400 text-white shadow-xs'
                  : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              }`}
              title="Bölmeleri basılı tutup sürükleyerek veya dokunarak toplu seç"
            >
              <CheckSquare className="w-3 h-3 shrink-0" />
              <span>
                {selectedCellsList.length > 0
                  ? `Seçili (${selectedCellsList.length})`
                  : 'Toplu Seç'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowCustomizePanel((prev) => !prev)}
              className={`h-7 px-2 rounded-lg border text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                showCustomizePanel
                  ? 'bg-sky-600 border-sky-400 text-white shadow-xs'
                  : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              }`}
              title="Tablo teması, renkler, yoğunluk, toplam sütunu ve başlık özelleştirme"
            >
              <SlidersHorizontal className="w-3 h-3 shrink-0" />
              <span>Özelleştir</span>
            </button>

            <button
              type="button"
              onClick={() => setRosterMode((m) => (m === 'personnel' ? 'groups' : 'personnel'))}
              className={`h-7 px-2 rounded-lg border text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                rosterMode === 'personnel'
                  ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  : 'bg-sky-600 border-sky-500 text-white'
              }`}
            >
              {rosterMode === 'personnel' ? (
                <>
                  <Users className="w-3 h-3 shrink-0" />
                  <span>Personel</span>
                </>
              ) : (
                <>
                  <Layers className="w-3 h-3 shrink-0" />
                  <span>Gruplar</span>
                </>
              )}
            </button>

            {isAdminBureauMode && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (activeUnit && !isAuthorizedAdmin) {
                      setEntryRoleMode('admin');
                      setShowTableEntryModal(true);
                      return;
                    }
                    setRosterMode('personnel');
                    setSwapSourceSlot(null);
                    setInlineRenameSlot(null);
                    setIsTableEditMode((prev) => !prev);
                  }}
                  className={`h-7 px-2 rounded-lg border text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0 ${
                    isTableEditMode
                      ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-xs'
                      : 'bg-slate-800 border-slate-700 text-amber-300 hover:bg-slate-700'
                  }`}
                  title="Tablo üzerinde doğrudan isim değiştirme, sıra (↑↓) ve yer değiştirme (⇄) modunu aç/kapat"
                >
                  <ArrowLeftRight className="w-3 h-3 shrink-0" />
                  <span>{isTableEditMode ? 'Düzenleme Açık' : 'Sıra / Yer'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenStructureStudio}
                  className="h-7 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0"
                  title="Grup adlarını, personel isimlerini, gruplar arası transferi ve sıralamayı düzenle"
                >
                  <Wrench className="w-3 h-3 shrink-0" />
                  <span className="hidden sm:inline">Grup / İsim</span>
                  <span className="sm:hidden">Düzenle</span>
                </button>

                {onOpenBureauModal && (
                  <button
                    type="button"
                    onClick={onOpenBureauModal}
                    className="h-7 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span>
                      {isSuperAdmin ? 'Yönetici' : isAuthorizedAdmin ? 'Admin' : 'İdari Büro'}
                    </span>
                    {pendingLeaveRequests.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black leading-none">
                        {pendingLeaveRequests.length}
                      </span>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sub-row 2B: Personnel-only active profile & request entry bar (Hidden completely in Admin mode) */}
        {!isAdminBureauMode && (
          <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/80">
            <div
              className="min-w-0 flex-1 h-7 px-2.5 rounded-lg bg-sky-950/55 border border-sky-500/35 text-sky-100 text-[11px] font-extrabold flex items-center gap-1.5 overflow-hidden"
              title={`Aktif Profil: ${
                matchedActivePersonnel
                  ? `(${formatGroupTag(
                      matchedActivePersonnel.groupName,
                      matchedActivePersonnel.groupIdx
                    )}) ${matchedActivePersonnel.name}`
                  : activeProfileDisplayName
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              {matchedActivePersonnel && (
                <span className="hidden sm:inline text-sky-300/85 font-bold shrink-0">
                  ({formatGroupTag(matchedActivePersonnel.groupName, matchedActivePersonnel.groupIdx)})
                </span>
              )}
              <span className="truncate">{activeProfileDisplayName}</span>
            </div>

            <button
              type="button"
              onClick={() => handleOpenTableEntryModal('user')}
              className="h-7 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10.5px] font-extrabold flex items-center gap-1 transition cursor-pointer shrink-0 whitespace-nowrap shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Talep / Veri Gir</span>
              <span className="sm:hidden">Veri Gir</span>
            </button>
          </div>
        )}
      </div>

      {/* LIVE TABLE CUSTOMIZATION STUDIO PANEL */}
      {showCustomizePanel && (
        <div className="px-3 py-2.5 bg-slate-900 border-b border-slate-700/90 flex-shrink-0 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Palette className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-xs font-bold text-white truncate">
                Tablo Özelleştirme Seçenekleri
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={resetTablePrefs}
                className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Sıfırla</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCustomizePanel(false)}
                className="h-7 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
              >
                Tamam
              </button>
            </div>
          </div>

          {/* Row 1: Table Theme + Font Size + Row Density */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* Theme Picker */}
            <div className="space-y-1">
              <span className="block text-[10.5px] font-semibold text-slate-400">Tablo Teması</span>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'classic', label: 'Klasik' },
                    { id: 'modern', label: 'Modern' },
                    { id: 'dark', label: 'Koyu' },
                    { id: 'contrast', label: 'Kontrast' },
                  ] as Array<{ id: TableThemeMode; label: string }>
                ).map((themeOpt) => (
                  <button
                    key={themeOpt.id}
                    type="button"
                    onClick={() => updateTablePref('tableTheme', themeOpt.id)}
                    className={`h-7 px-1.5 rounded-lg border text-[10.5px] font-semibold transition cursor-pointer truncate ${
                      tablePrefs.tableTheme === themeOpt.id
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {themeOpt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Scale */}
            <div className="space-y-1">
              <span className="block text-[10.5px] font-semibold text-slate-400">Yazı Boyutu</span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'sm', label: 'Küçük' },
                    { id: 'md', label: 'Normal' },
                    { id: 'lg', label: 'Büyük' },
                  ] as Array<{ id: 'sm' | 'md' | 'lg'; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateTablePref('fontScale', opt.id)}
                    className={`h-7 px-2 rounded-lg border text-[10.5px] font-semibold transition cursor-pointer ${
                      tablePrefs.fontScale === opt.id
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row Density */}
            <div className="space-y-1">
              <span className="block text-[10.5px] font-semibold text-slate-400">
                Satır Yüksekliği
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'compact', label: 'Sıkışık' },
                    { id: 'normal', label: 'Dengeli' },
                    { id: 'comfortable', label: 'Ferah' },
                  ] as Array<{ id: 'compact' | 'normal' | 'comfortable'; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateTablePref('rowDensity', opt.id)}
                    className={`h-7 px-2 rounded-lg border text-[10.5px] font-semibold transition cursor-pointer ${
                      tablePrefs.rowDensity === opt.id
                        ? 'bg-sky-600 border-sky-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: 1-Tap Visual Toggles */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(
              [
                { key: 'highlightWeekends', label: 'Hafta Sonu Vurgusu' },
                { key: 'zebraGroups', label: 'Grup Renk Şeridi' },
                { key: 'colorizeShiftCodes', label: 'S / A Renkli Kod' },
                { key: 'showTotalsColumn', label: 'Toplam Nöbet / Saat Sütunu' },
                { key: 'highlightToday', label: 'Bugün Vurgusu' },
                { key: 'boldGroupDividers', label: 'Kalın Grup Çizgisi' },
                { key: 'showLegend', label: 'Alt Açıklama' },
              ] as Array<{
                key:
                  | 'highlightWeekends'
                  | 'zebraGroups'
                  | 'colorizeShiftCodes'
                  | 'showTotalsColumn'
                  | 'highlightToday'
                  | 'boldGroupDividers'
                  | 'showLegend';
                label: string;
              }>
            ).map((toggle) => {
              const active = tablePrefs[toggle.key];
              return (
                <button
                  key={toggle.key}
                  type="button"
                  onClick={() => updateTablePref(toggle.key, !active)}
                  className={`h-7 px-2.5 rounded-lg border text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-emerald-600/25 border-emerald-400/70 text-emerald-200'
                      : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {active && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                  <span>{toggle.label}</span>
                </button>
              );
            })}
          </div>

          {/* Row 3: Custom Sheet Title Override */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tablePrefs.customTitle}
              onChange={(e) => updateTablePref('customTitle', e.target.value)}
              placeholder="Özel tablo başlığı (boş bırakılırsa otomatik kurum ve ay başlığı kullanılır)..."
              className="flex-1 h-8 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs font-medium outline-none focus:border-sky-400"
            />
            {tablePrefs.customTitle && (
              <button
                type="button"
                onClick={() => updateTablePref('customTitle', '')}
                className="h-8 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold cursor-pointer shrink-0"
              >
                Temizle
              </button>
            )}
          </div>
        </div>
      )}

      {/* MULTI-SELECT MODE HELPER STRIP */}
      {multiSelectMode && (
        <div className="px-2.5 py-1.5 bg-indigo-950/90 border-b border-indigo-500/40 text-indigo-100 text-[11px] font-semibold flex items-center justify-between gap-2 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <CheckSquare className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
            <span className="truncate">
              {isDragSelecting
                ? `Sürükleniyor: ${selectedCellsList.length} bölme seçili...`
                : 'Toplu Seçim Açık: Hücrelerde basılı tutup sürükleyin, satır numarasına veya gün sayısına dokunarak tüm satırı/günü seçin.'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (rows.length === 0 || days.length === 0) return;
                setSelectedCellKeys(buildRectSelectionSet(0, 0, rows.length - 1, days.length - 1));
              }}
              className="h-6 px-2 rounded-md bg-indigo-800 hover:bg-indigo-700 text-indigo-100 text-[10px] font-bold cursor-pointer whitespace-nowrap"
            >
              Tümünü Seç
            </button>
            <button
              type="button"
              onClick={clearBulkSelection}
              className="h-6 px-2 rounded-md bg-white text-slate-950 text-[10px] font-bold cursor-pointer whitespace-nowrap"
            >
              Bitir
            </button>
          </div>
        </div>
      )}

      {/* UNCONFIGURED NOTICE */}
      {!isConfigured && (
        <div className="px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-[11px] font-medium text-center flex-shrink-0">
          Vardiyaların otomatik dolması için üstteki <strong>Kurum Paneli</strong> butonundan bir
          kurum seçin veya Ayarlar bölümünden referans nöbet tarihi tanımlayın.
        </div>
      )}

      {/* INLINE EDIT MODE STATUS BANNER */}
      {isTableEditMode && (
        <div className="px-2.5 py-1.5 bg-amber-500/20 border-b border-amber-400/40 text-amber-100 text-[10.5px] font-bold flex items-center justify-between gap-2 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span>
              {swapSourceSlot
                ? `⇄ Yer Değiştirme Aktif: "${swapSourceSlot.personName}" seçili — yer değişecek diğer kişinin ⇄ butonuna dokunun.`
                : '🛠️ Satır Düzenleme Modu Aktif: İsimlerin yanındaki ↑↓ ile sıra (Kırmızı Sorumlu / Mavi Yrd.), ⇄ ile iki kişinin yerini, ✏️ ile ismini anında değiştirin.'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {swapSourceSlot && (
              <button
                type="button"
                onClick={() => setSwapSourceSlot(null)}
                className="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 text-[10px] font-extrabold cursor-pointer"
              >
                Seçimi İptal Et
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsTableEditMode(false);
                setSwapSourceSlot(null);
                setInlineRenameSlot(null);
              }}
              className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-black cursor-pointer"
            >
              Bitir
            </button>
          </div>
        </div>
      )}

      {/* SCROLLABLE OFFICIAL ROSTER SHEET VIEWPORT */}
      {(() => {
        const isDarkSheet = tablePrefs.tableTheme === 'dark';
        const isModernSheet = tablePrefs.tableTheme === 'modern';
        const isContrastSheet = tablePrefs.tableTheme === 'contrast';

        const outerViewportBg = isDarkSheet ? 'bg-slate-950' : 'bg-slate-200';
        const sheetCardClass = isDarkSheet
          ? 'bg-[#0b1120] text-slate-100 border-slate-700'
          : isModernSheet
          ? 'bg-white text-slate-900 border-slate-300'
          : 'bg-white text-slate-900 border-slate-400';
        const cellBorderColor = isDarkSheet
          ? 'border-slate-700'
          : isContrastSheet
          ? 'border-slate-950'
          : isModernSheet
          ? 'border-slate-300'
          : 'border-slate-800';
        const strongBorderColor = isDarkSheet ? 'border-slate-500' : 'border-slate-900';
        const headerBaseBg = isDarkSheet
          ? 'bg-[#111827] text-slate-100'
          : isModernSheet
          ? 'bg-slate-50 text-slate-900'
          : 'bg-white text-slate-900';
        const todayHeaderBg = isDarkSheet
          ? 'bg-sky-900/70 text-sky-100 border-t-2 border-t-sky-400'
          : 'bg-sky-100 text-sky-900 border-t-2 border-t-sky-600';
        const weekendHeaderBg = isDarkSheet ? 'bg-[#1e1b2e]' : 'bg-rose-50/90';

        return (
          <div
            className={`flex-1 overflow-auto p-1 sm:p-3 ${outerViewportBg} ${
              isDragSelecting ? 'touch-none' : ''
            }`}
          >
            <div className={`inline-block min-w-full shadow-lg border p-1.5 sm:p-2.5 ${sheetCardClass}`}>
              {/* Official Sheet Title */}
              <div
                className={`flex items-center justify-between gap-2 pb-1.5 mb-1 border-b flex-wrap ${
                  isDarkSheet ? 'border-slate-700' : 'border-slate-300'
                }`}
              >
                <h1
                  className={`text-[11px] sm:text-sm font-black tracking-wide uppercase truncate ${
                    isDarkSheet ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  {effectiveSheetTitle}
                </h1>
                <span
                  className={`text-[9.5px] sm:text-[11px] font-semibold whitespace-nowrap tabular-nums ${
                    isDarkSheet ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {settings.is24HourSystem
                    ? `24 Saat Sistemi (${settings.shift24Start})`
                    : `S: ${settings.dayStart}-${settings.dayEnd} · A: ${settings.nightStart}-${settings.nightEnd}`}
                </span>
              </div>

              {/* MATRIX TABLE */}
              <table
                className={`w-full border-collapse table-fixed ${
                  isDarkSheet ? 'bg-[#0b1120] text-slate-100' : 'bg-white text-slate-900'
                }`}
              >
                <colgroup>
                  <col className={sizeConfig.siraW} />
                  <col
                    className={
                      isTableEditMode
                        ? 'w-[190px] sm:w-[240px] min-w-[190px] sm:min-w-[240px]'
                        : sizeConfig.nameW
                    }
                  />
                  {days.map((d) => (
                    <col key={`col-${d.isoDate}`} className={sizeConfig.dayW} />
                  ))}
                  {tablePrefs.showTotalsColumn && (
                    <col className="w-[46px] sm:w-[56px] min-w-[46px] sm:min-w-[56px]" />
                  )}
                </colgroup>
                <thead>
                  {/* Header Row 1: SIRA NO, PERSONEL ADI SOYADI, Day Numbers 1..31, Optional Totals */}
                  <tr className={headerBaseBg}>
                    <th
                      rowSpan={2}
                      className={`sticky top-0 left-0 z-30 border ${cellBorderColor} ${headerBaseBg} text-center font-extrabold leading-tight align-middle px-0.5 overflow-hidden ${sizeConfig.siraW} ${sizeConfig.dayNumText}`}
                    >
                      <div className="flex flex-col items-center justify-center leading-tight">
                        <span>{zoom === 'overview' ? '#' : 'SIRA'}</span>
                        {zoom !== 'overview' && <span>NO</span>}
                      </div>
                    </th>
                    <th
                      rowSpan={2}
                      className={`sticky top-0 ${sizeConfig.nameLeft} z-30 border ${cellBorderColor} border-r-[2px] ${strongBorderColor} ${headerBaseBg} text-center font-extrabold leading-tight align-middle px-1 overflow-hidden ${
                        isTableEditMode
                          ? 'w-[190px] sm:w-[240px] min-w-[190px] sm:min-w-[240px]'
                          : sizeConfig.nameW
                      } ${sizeConfig.dayNumText}`}
                    >
                      <div className="flex flex-col items-center justify-center leading-tight truncate">
                        <span>PERSONEL</span>
                        <span>ADI SOYADI</span>
                      </div>
                    </th>
                    {days.map((d, dIdx) => (
                      <th
                        key={`num-${d.isoDate}`}
                        onClick={() => {
                          if (multiSelectMode || selectedCellsList.length > 0) {
                            handleSelectEntireDayColumn(dIdx);
                          }
                        }}
                        title={
                          multiSelectMode
                            ? `${d.dayNum} ${MONTH_NAMES_TR[calendarMonth - 1]} sütununu toplu seç`
                            : undefined
                        }
                        className={`sticky top-0 z-20 border ${cellBorderColor} text-center font-extrabold tabular-nums p-0 overflow-hidden ${sizeConfig.numRowH} ${sizeConfig.dayW} ${sizeConfig.dayNumText} ${
                          multiSelectMode ? 'cursor-pointer hover:bg-indigo-500/20' : ''
                        } ${
                          tablePrefs.highlightToday && d.isToday
                            ? todayHeaderBg
                            : tablePrefs.highlightWeekends && d.isWeekend
                            ? weekendHeaderBg
                            : headerBaseBg
                        }`}
                      >
                        {d.dayNum}
                      </th>
                    ))}
                    {tablePrefs.showTotalsColumn && (
                      <th
                        rowSpan={2}
                        className={`sticky top-0 z-20 border ${cellBorderColor} border-l-[2px] ${strongBorderColor} ${headerBaseBg} text-center font-extrabold leading-tight align-middle px-0.5 overflow-hidden ${sizeConfig.dayNumText}`}
                      >
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span>TOP</span>
                          <span className="text-[7px] opacity-75">NÖB/SA</span>
                        </div>
                      </th>
                    )}
                  </tr>

                  {/* Header Row 2: Vertical Rotated Turkish Weekday Names */}
                  <tr className={headerBaseBg}>
                    {days.map((d, dIdx) => (
                      <th
                        key={`wd-${d.isoDate}`}
                        onClick={() => {
                          if (multiSelectMode || selectedCellsList.length > 0) {
                            handleSelectEntireDayColumn(dIdx);
                          }
                        }}
                        className={`sticky ${sizeConfig.wdTop} z-20 border ${cellBorderColor} border-b-[2px] ${strongBorderColor} align-middle p-0 overflow-hidden ${sizeConfig.dayW} ${sizeConfig.headerH} ${
                          multiSelectMode ? 'cursor-pointer hover:bg-indigo-500/20' : ''
                        } ${
                          tablePrefs.highlightToday && d.isToday
                            ? isDarkSheet
                              ? 'bg-sky-900/70'
                              : 'bg-sky-100'
                            : tablePrefs.highlightWeekends && d.isWeekend
                            ? weekendHeaderBg
                            : headerBaseBg
                        }`}
                      >
                        <div className="w-full h-full flex items-center justify-center overflow-hidden">
                          <span
                            style={{
                              writingMode: 'vertical-rl',
                              transform: 'rotate(180deg)',
                            }}
                            className={`font-bold tracking-tight whitespace-nowrap leading-none ${sizeConfig.weekdayText} ${
                              d.isWeekend
                                ? isDarkSheet
                                  ? 'text-rose-400'
                                  : 'text-red-600'
                                : isDarkSheet
                                ? 'text-slate-200'
                                : 'text-slate-900'
                            }`}
                          >
                            {d.weekdayUpper}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row, rIdx) => {
                    const groupBorderClass =
                      tablePrefs.boldGroupDividers && row.isLastInGroup
                        ? `border-b-[2px] ${isDarkSheet ? 'border-b-slate-500' : 'border-b-slate-900'}`
                        : `border-b ${
                            isDarkSheet
                              ? 'border-b-slate-700'
                              : isModernSheet
                              ? 'border-b-slate-300'
                              : 'border-b-slate-700'
                          }`;

                    const isAltGroup = tablePrefs.zebraGroups && row.groupIdx % 2 === 1;
                    const rowSurfaceBg = row.isCurrentUser
                      ? isDarkSheet
                        ? 'bg-[#2a2210]'
                        : 'bg-amber-50'
                      : isAltGroup
                      ? isDarkSheet
                        ? 'bg-[#131d31]'
                        : 'bg-slate-50'
                      : isDarkSheet
                      ? 'bg-[#0f172a]'
                      : 'bg-white';

                    const nameColorClass =
                      row.roleColor === 'leader'
                        ? isDarkSheet
                          ? 'text-rose-300 font-bold'
                          : 'text-[#b91c1c] font-bold'
                        : row.roleColor === 'deputy'
                        ? isDarkSheet
                          ? 'text-sky-300 font-bold'
                          : 'text-[#1d4ed8] font-bold'
                        : isDarkSheet
                        ? 'text-slate-100 font-medium'
                        : 'text-slate-900 font-medium';

                    const rowTotal = rowTotalsMap[row.rowKey] || { shifts: 0, hours: 0 };

                    return (
                      <tr key={row.rowKey} className={`${sizeConfig.rowH} ${rowSurfaceBg}`}>
                        {/* Sticky SIRA NO (Tap to select entire row when multi-select is active) */}
                        <td
                          onClick={() => {
                            if (multiSelectMode || selectedCellsList.length > 0) {
                              handleSelectEntireRow(row);
                            }
                          }}
                          title={
                            multiSelectMode
                              ? `${row.displayLabel} satırının tamamını seç`
                              : undefined
                          }
                          className={`sticky left-0 z-10 border-x ${cellBorderColor} ${groupBorderClass} text-center font-bold tabular-nums px-0.5 overflow-hidden ${sizeConfig.siraW} ${sizeConfig.nameText} ${rowSurfaceBg} ${
                            multiSelectMode ? 'cursor-pointer hover:bg-indigo-500/25' : ''
                          }`}
                        >
                          {row.siraNo}
                        </td>

                        {/* Sticky PERSONEL ADI SOYADI */}
                        <td
                          onClick={() => {
                            if (!isTableEditMode && (multiSelectMode || selectedCellsList.length > 0)) {
                              handleSelectEntireRow(row);
                            }
                          }}
                          className={`sticky ${sizeConfig.nameLeft} z-10 border-r-[2px] ${strongBorderColor} border-l ${cellBorderColor} ${groupBorderClass} text-left px-1 overflow-hidden ${
                            isTableEditMode
                              ? 'w-[190px] sm:w-[240px] min-w-[190px] sm:min-w-[240px]'
                              : `${sizeConfig.nameW} truncate`
                          } ${sizeConfig.nameText} ${nameColorClass} ${
                            swapSourceSlot?.groupIdx === row.groupIdx &&
                            swapSourceSlot?.memberIdx === row.memberIdx
                              ? 'bg-amber-200 text-slate-950'
                              : rowSurfaceBg
                          } ${
                            !isTableEditMode && multiSelectMode
                              ? 'cursor-pointer hover:bg-indigo-500/20'
                              : ''
                          }`}
                          title={row.displayLabel}
                        >
                          {isTableEditMode && row.memberIdx >= 0 ? (
                            <div className="flex items-center justify-between gap-1 w-full">
                              {inlineRenameSlot &&
                              inlineRenameSlot.groupIdx === row.groupIdx &&
                              inlineRenameSlot.memberIdx === row.memberIdx ? (
                                <div className="flex items-center gap-0.5 flex-1 min-w-0">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={inlineRenameSlot.value}
                                    onChange={(e) =>
                                      setInlineRenameSlot({
                                        ...inlineRenameSlot,
                                        value: e.target.value,
                                      })
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void handleCommitInlineRename();
                                      if (e.key === 'Escape') setInlineRenameSlot(null);
                                    }}
                                    className="w-full min-w-0 px-1 py-0.5 text-[10px] font-bold bg-white border border-sky-500 rounded text-slate-900 outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleCommitInlineRename()}
                                    className="p-0.5 rounded bg-emerald-600 text-white shrink-0 cursor-pointer"
                                    title="Kaydet"
                                  >
                                    <Check className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="truncate flex-1 min-w-0">{row.displayLabel}</span>
                              )}

                              {(!inlineRenameSlot ||
                                inlineRenameSlot.groupIdx !== row.groupIdx ||
                                inlineRenameSlot.memberIdx !== row.memberIdx) && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    type="button"
                                    disabled={structureSaving || row.memberIdx <= 0}
                                    onClick={() =>
                                      void handleInlineMoveMember(row.groupIdx, row.memberIdx, -1)
                                    }
                                    className="p-0.5 rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-30 text-slate-900 cursor-pointer"
                                    title="Yukarı Taşı"
                                  >
                                    <ArrowUp className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      structureSaving || row.memberIdx >= row.groupMemberCount - 1
                                    }
                                    onClick={() =>
                                      void handleInlineMoveMember(row.groupIdx, row.memberIdx, 1)
                                    }
                                    className="p-0.5 rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-30 text-slate-900 cursor-pointer"
                                    title="Aşağı Taşı"
                                  >
                                    <ArrowDown className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={structureSaving}
                                    onClick={() =>
                                      void handleInlineSwapClick(
                                        row.groupIdx,
                                        row.memberIdx,
                                        row.personName
                                      )
                                    }
                                    className={`p-0.5 rounded cursor-pointer ${
                                      swapSourceSlot?.groupIdx === row.groupIdx &&
                                      swapSourceSlot?.memberIdx === row.memberIdx
                                        ? 'bg-amber-500 text-slate-950'
                                        : swapSourceSlot
                                        ? 'bg-sky-600 text-white'
                                        : 'bg-sky-100 hover:bg-sky-200 text-sky-900'
                                    }`}
                                    title="Başka Kişiyle Yer Değiştir"
                                  >
                                    <ArrowLeftRight className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={structureSaving}
                                    onClick={() =>
                                      setInlineRenameSlot({
                                        groupIdx: row.groupIdx,
                                        memberIdx: row.memberIdx,
                                        value: row.personName,
                                      })
                                    }
                                    className="p-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 cursor-pointer"
                                    title="İsmi Düzenle"
                                  >
                                    <Pencil className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            row.displayLabel
                          )}
                        </td>

                        {/* Day Shift Cells (Press-and-Hold + Drag Multi-Select Enabled) */}
                        {days.map((day, dIdx) => {
                          const cell = cellMatrixByRow[row.rowKey]?.[dIdx] || {
                            code: '',
                            variant: 'normal' as const,
                            detailLabel: 'İstirahat',
                          };
                          const cellMultiKey = `${row.rowKey}::${dIdx}`;
                          const isMultiSelected = selectedCellKeys.has(cellMultiKey);
                          const isSingleSelected =
                            selectedCellKeys.size === 0 &&
                            selectedCell?.rowKey === row.rowKey &&
                            selectedCell?.dayIndex === dIdx;

                          const customBgHex =
                            cellHighlights[getCellHighlightKey(row.rowKey, day.isoDate)] || '';

                          let bgClass =
                            tablePrefs.highlightToday && day.isToday
                              ? isDarkSheet
                                ? 'bg-[#0f2942]'
                                : 'bg-sky-50'
                              : tablePrefs.highlightWeekends && day.isWeekend
                              ? isDarkSheet
                                ? 'bg-[#1a1729]'
                                : 'bg-rose-50/60'
                              : rowSurfaceBg;

                          let textClass = isDarkSheet
                            ? 'text-slate-100 font-semibold'
                            : 'text-slate-900 font-semibold';

                          if (tablePrefs.colorizeShiftCodes && cell.variant === 'normal') {
                            if (cell.code === 'S') {
                              textClass = isDarkSheet
                                ? 'text-amber-300 font-extrabold'
                                : 'text-amber-700 font-extrabold';
                            } else if (cell.code === 'A') {
                              textClass = isDarkSheet
                                ? 'text-indigo-300 font-extrabold'
                                : 'text-indigo-700 font-extrabold';
                            } else if (cell.code === '24') {
                              textClass = isDarkSheet
                                ? 'text-rose-300 font-extrabold'
                                : 'text-rose-700 font-extrabold';
                            }
                          }

                          if (cell.variant === 'swap-in') {
                            bgClass = 'bg-[#bae6fd]';
                            textClass = 'text-slate-950 font-extrabold';
                          } else if (cell.variant === 'swap-out') {
                            bgClass = 'bg-[#fde047]';
                            textClass = 'text-slate-900 font-bold';
                          } else if (cell.variant === 'leave') {
                            bgClass = 'bg-[#7e22ce]';
                            textClass = 'text-white font-extrabold text-[7.5px] tracking-tighter';
                          } else if (cell.variant === 'note') {
                            bgClass = 'bg-[#fef08a]';
                            textClass = 'text-slate-950 font-bold';
                          } else if (cell.variant === 'extra') {
                            bgClass = 'bg-[#bbf7d0]';
                            textClass = 'text-emerald-950 font-extrabold';
                          } else if (cell.variant === 'cleared') {
                            bgClass = isDarkSheet ? 'bg-slate-900/70' : 'bg-slate-100';
                            textClass = 'text-slate-400 font-semibold';
                          }

                          if (customBgHex) {
                            textClass = 'text-slate-950 font-bold';
                          }

                          return (
                            <td
                              key={`${row.rowKey}-${day.isoDate}`}
                              data-roster-row={rIdx}
                              data-roster-day={dIdx}
                              onPointerDown={(e) => handleCellPointerDown(e, rIdx, dIdx)}
                              onClick={(e) => handleCellClick(e, row, rIdx, dIdx, day.isoDate)}
                              onContextMenu={(e) => e.preventDefault()}
                              style={customBgHex ? { backgroundColor: customBgHex } : undefined}
                              className={`relative border-x ${cellBorderColor} ${groupBorderClass} text-center align-middle p-0 cursor-pointer transition-colors overflow-hidden ${
                                customBgHex ? '' : bgClass
                              } ${
                                isMultiSelected
                                  ? 'ring-2 ring-inset ring-indigo-600 z-10'
                                  : isSingleSelected
                                  ? 'outline-2 outline-rose-600 -outline-offset-2 z-10'
                                  : ''
                              }`}
                            >
                              {isMultiSelected && (
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-0 bg-indigo-500/25"
                                />
                              )}
                              <span
                                className={`relative block leading-none tabular-nums truncate ${
                                  cell.variant === 'leave'
                                    ? zoom === 'overview'
                                      ? 'text-[6.5px] sm:text-[7.5px]'
                                      : ''
                                    : sizeConfig.cellText
                                } ${textClass}`}
                              >
                                {cell.variant === 'leave' && zoom === 'overview'
                                  ? cell.code === 'İDARİ'
                                    ? 'İDR'
                                    : cell.code === 'ÜCR.İZ'
                                    ? 'ÜCR'
                                    : cell.code === 'RAPOR'
                                    ? 'RPR'
                                    : 'İZİN'
                                  : cell.code}
                              </span>
                            </td>
                          );
                        })}

                        {/* Optional Monthly Totals Column */}
                        {tablePrefs.showTotalsColumn && (
                          <td
                            className={`border-l-[2px] ${strongBorderColor} border-r ${cellBorderColor} ${groupBorderClass} text-center align-middle px-0.5 tabular-nums font-bold overflow-hidden ${sizeConfig.nameText} ${rowSurfaceBg}`}
                            title={`${row.displayLabel}: ${rowTotal.shifts} nöbet (${rowTotal.hours} saat)`}
                          >
                            {rowTotal.shifts}g/{rowTotal.hours}s
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Authentic Bottom Roster Legend */}
              {tablePrefs.showLegend && (
                <div
                  className={`mt-2 pt-1.5 border-t flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9.5px] sm:text-[10px] leading-snug ${
                    isDarkSheet
                      ? 'border-slate-700 text-slate-300'
                      : 'border-slate-300 text-slate-700'
                  }`}
                >
                  <span
                    className={`font-bold ${isDarkSheet ? 'text-rose-300' : 'text-[#b91c1c]'}`}
                  >
                    Kırmızı: Grup Sorumlusu
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-bold ${isDarkSheet ? 'text-sky-300' : 'text-[#1d4ed8]'}`}
                  >
                    Mavi: Grup Sorumlusu Yardımcısı
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className={isDarkSheet ? 'text-white' : 'text-slate-900'}>S</strong>:
                    Sabah ({settings.dayStart}-{settings.dayEnd})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    <strong className={isDarkSheet ? 'text-white' : 'text-slate-900'}>A</strong>:
                    Akşam ({settings.nightStart}-{settings.nightEnd})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 bg-[#fef08a] border border-slate-600" />
                    <span>İcap (S / A)</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 bg-[#bbf7d0] border border-slate-600" />
                    <span>Ek Nöbet</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 bg-[#bae6fd] border border-slate-600" />
                    <span>Değişim</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 bg-[#7e22ce] border border-slate-600" />
                    <span>İzinli</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* BOTTOM BAR MODE A: BULK MULTI-CELL ACTION BAR */}
      {selectedCellsList.length > 0 && (selectedCellsList.length > 1 || multiSelectMode) ? (
        <div className="px-2.5 sm:px-3 py-2 bg-slate-900 border-t border-indigo-500/40 flex flex-col gap-2 flex-shrink-0">
          {/* Summary + Copy / Clear */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-white truncate tabular-nums">
                  {selectedCellsList.length} bölme seçili
                  <span className="text-slate-400 font-semibold">
                    {' '}
                    · {selectedUniquePeopleCount} satır · {selectedUniqueDaysCount} gün
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyBulkSelection()}
                className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                title="Seçili bölmeleri metin olarak kopyala"
              >
                <Copy className="w-3 h-3" />
                <span>Kopyala</span>
              </button>
              <button
                type="button"
                onClick={clearBulkSelection}
                className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-rose-950 border border-slate-700 text-slate-300 hover:text-rose-200 text-[10.5px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
              >
                <X className="w-3 h-3" />
                <span>Temizle</span>
              </button>
            </div>
          </div>

          {/* Bulk Cell Color Swatches (Available for everyone!) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-bold text-slate-400 shrink-0 flex items-center gap-1">
              <Palette className="w-3 h-3 text-sky-400" />
              <span>Bölme Rengi:</span>
            </span>
            {CELL_HIGHLIGHT_SWATCHES.map((sw) => (
              <button
                key={sw.id}
                type="button"
                onClick={() => handleApplyCellHighlight(sw.hex)}
                title={sw.label}
                className="h-6 px-2 rounded-md border border-slate-600 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer shrink-0 hover:scale-105 bg-slate-800 text-slate-200"
              >
                <span
                  className="w-3 h-3 rounded-xs border border-slate-500 shrink-0"
                  style={{ backgroundColor: sw.hex || 'transparent' }}
                />
                <span>{sw.label}</span>
              </button>
            ))}
          </div>

          {/* Bulk Shift / Leave / Icap / Note Overrides (Admin OR Local Table) */}
          {((isAdminBureauMode && canEditTableStructure) || !activeUnit) && (
            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                <span className="text-[10px] font-bold text-indigo-300 shrink-0">
                  Toplu İşlem:
                </span>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('CLEAR')}
                  className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  Boşa Çıkar
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('ASSIGN_S')}
                  className="h-7 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/50 text-white text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  S Ata
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('ASSIGN_A')}
                  className="h-7 px-2.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 border border-emerald-500/50 text-white text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  A Ata
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('LEAVE')}
                  className="h-7 px-2.5 rounded-lg bg-purple-700 hover:bg-purple-600 border border-purple-400/50 text-white text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  İzinli
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('LEAVE_IDARI')}
                  className="h-7 px-2.5 rounded-lg bg-purple-800 hover:bg-purple-700 border border-purple-400/50 text-white text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  İdari İzin
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('LEAVE_UCRETSIZ')}
                  className="h-7 px-2.5 rounded-lg bg-fuchsia-800 hover:bg-fuchsia-700 border border-fuchsia-400/50 text-white text-[10.5px] font-bold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  Ücretsiz İzin
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('ICAP_S')}
                  className="h-7 px-2.5 rounded-lg bg-[#fef08a] hover:bg-amber-300 text-slate-950 text-[10.5px] font-black shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  İcap S
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('ICAP_A')}
                  className="h-7 px-2.5 rounded-lg bg-[#fde047] hover:bg-amber-400 text-slate-950 text-[10.5px] font-black shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  İcap A
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => setShowBulkNoteInput((prev) => !prev)}
                  className={`h-7 px-2.5 rounded-lg border text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                    showBulkNoteInput
                      ? 'bg-sky-600 border-sky-400 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-sky-200'
                  }`}
                >
                  <StickyNote className="w-3 h-3" />
                  <span>Toplu Not</span>
                </button>
                <button
                  type="button"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkCellsAction('RESET')}
                  className="h-7 px-2.5 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200 text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Varsayılana Döndür</span>
                </button>
              </div>

              {showBulkNoteInput && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={bulkNoteDraft}
                    onChange={(e) => setBulkNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && bulkNoteDraft.trim()) {
                        void handleBulkCellsAction('NOTE', bulkNoteDraft);
                      }
                    }}
                    placeholder="Seçili bölmelere eklenecek notu yazın..."
                    className="flex-1 h-8 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-medium outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    disabled={bulkSaving || !bulkNoteDraft.trim()}
                    onClick={() => void handleBulkCellsAction('NOTE', bulkNoteDraft)}
                    className="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {bulkSaving ? 'İşleniyor...' : 'Uygula'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* BOTTOM BAR MODE B: SINGLE CELL INSPECTION & 1-TAP PRO QUICK EDIT BAR */
        selectedDetail && (
          <div className="px-2.5 sm:px-3 py-2 bg-slate-900 border-t border-slate-800 flex flex-col gap-1.5 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-bold text-slate-400 truncate tabular-nums">
                  {selectedDetail.day.dayNum} {MONTH_NAMES_TR[calendarMonth - 1]} {calendarYear} ·{' '}
                  {selectedDetail.day.weekdayUpper}
                  {rosterMode === 'personnel' && selectedDetail.row.roleColor === 'leader'
                    ? ' · Grup Sorumlusu'
                    : rosterMode === 'personnel' && selectedDetail.row.roleColor === 'deputy'
                    ? ' · Grup Sorumlusu Yardımcısı'
                    : ''}
                  <span className="hidden sm:inline text-slate-500">
                    {' '}
                    · Toplu seçim için basılı tutup sürükleyin
                  </span>
                </div>
                <div className="text-[11.5px] font-extrabold text-white truncate">
                  {selectedDetail.row.displayLabel} — {selectedDetail.state.detailLabel}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleOpenTableEntryModal(isAdminBureauMode ? entryRoleMode : 'user')}
                className={`h-8 px-3 rounded-xl text-white text-[11px] font-extrabold flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
                  isAdminBureauMode && entryRoleMode === 'admin'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-sky-600 hover:bg-sky-500'
                }`}
                title="Detaylı veya çok günlü veri giriş ekranını aç"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>
                  {isAdminBureauMode && entryRoleMode === 'admin'
                    ? 'Detaylı İşle'
                    : 'Talep / İşle'}
                </span>
              </button>
            </div>

            {/* 1-TAP ADMIN QUICK CELL OVERRIDE BAR + CELL COLOR SWATCHES */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-1 border-t border-slate-800/80 no-scrollbar">
              {isAdminBureauMode &&
                (entryRoleMode === 'admin' || !activeUnit) &&
                canEditTableStructure &&
                selectedDetail.row.personName && (
                  <>
                    <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                      Hızlı İşlem:
                    </span>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('CLEAR')}
                      className="h-6 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                      title="Var olan S veya A nöbetini boşa çıkar (kutucuğu boşalt)"
                    >
                      Boşa Çıkar
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('ASSIGN_S')}
                      className="h-6 px-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 border border-emerald-500/50 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      S Ata
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('ASSIGN_A')}
                      className="h-6 px-2 rounded-lg bg-emerald-800/80 hover:bg-emerald-700 border border-emerald-500/50 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      A Ata
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('LEAVE')}
                      className="h-6 px-2 rounded-lg bg-purple-700 hover:bg-purple-600 border border-purple-400/50 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      İzinli
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('LEAVE_IDARI')}
                      className="h-6 px-2 rounded-lg bg-purple-800 hover:bg-purple-700 border border-purple-400/50 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      İdari İzin
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('LEAVE_UCRETSIZ')}
                      className="h-6 px-2 rounded-lg bg-fuchsia-800 hover:bg-fuchsia-700 border border-fuchsia-400/50 text-white text-[10px] font-extrabold shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      Ücretsiz İzin
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('ICAP_S')}
                      className="h-6 px-2 rounded-lg bg-[#fef08a] hover:bg-amber-300 text-slate-950 text-[10px] font-black shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      İcap S
                    </button>
                    <button
                      type="button"
                      disabled={quickCellSaving}
                      onClick={() => void handleQuickCellAction('ICAP_A')}
                      className="h-6 px-2 rounded-lg bg-[#fde047] hover:bg-amber-400 text-slate-950 text-[10px] font-black shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      İcap A
                    </button>
                    {selectedDetail.state.variant !== 'normal' && (
                      <button
                        type="button"
                        disabled={quickCellSaving}
                        onClick={() => void handleQuickCellAction('RESET')}
                        className="h-6 px-2 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-500/50 text-rose-200 text-[10px] font-extrabold inline-flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-40"
                        title="Özel kaydı silip grubun standart nöbetine geri döndür"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Sıfırla</span>
                      </button>
                    )}
                    <span className="text-slate-700 shrink-0" aria-hidden="true">
                      |
                    </span>
                  </>
                )}

              <span className="text-[9.5px] font-bold text-slate-400 shrink-0 flex items-center gap-1">
                <Palette className="w-3 h-3 text-sky-400" />
                <span>Renk:</span>
              </span>
              {CELL_HIGHLIGHT_SWATCHES.map((sw) => (
                <button
                  key={`single-${sw.id}`}
                  type="button"
                  onClick={() => handleApplyCellHighlight(sw.hex)}
                  title={sw.label}
                  className="w-5 h-5 rounded-md border border-slate-500 shrink-0 cursor-pointer hover:scale-110 transition flex items-center justify-center"
                  style={{ backgroundColor: sw.hex || '#1e293b' }}
                >
                  {!sw.hex && <X className="w-3 h-3 text-slate-300" />}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* =====================================================================
          IN-TABLE LEAVE / ON-CALL (İCAP) / NOTE / SWAP ENTRY MODAL
          (WITH EXPLICIT YÖNETİCİ vs BİREYSEL KULLANICI DISTINCTION)
         ===================================================================== */}
      {showTableEntryModal && (
        <div
          onClick={() => setShowTableEntryModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 bg-slate-950/60 flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-black text-white truncate">
                  Tabloya İzin, İcap, Not veya Değişim İşle
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  {isAdminBureauMode
                    ? 'Yetkili kurum yöneticisi (admin) resmi çizelge kaydı'
                    : 'Kendi izin, icap, nöbet değişimi veya not kaydınızı oluşturun'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTableEntryModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* Role Mode Explanation Banner */}
              {!isAdminBureauMode || entryRoleMode === 'user' ? (
                <div className="p-2.5 rounded-2xl bg-sky-950/40 border border-sky-500/35 text-[11px] text-sky-200 font-semibold leading-snug">
                  👤 <strong>Personel Kaydı:</strong>{' '}
                  {activeUnit ? (
                    <>
                      Girdiğiniz izin, icap veya not talebi kurum onayına gönderilir. Onaylandığında
                      otomatik olarak <strong>takviminize ve aylık çizelgeye</strong> işlenir.
                    </>
                  ) : (
                    <>
                      Girdiğiniz izin, icap veya not kendi telefonunuzdaki tablonuza ve bireysel
                      takviminize kaydedilir.
                    </>
                  )}
                </div>
              ) : (
                <div className="p-2.5 rounded-2xl bg-rose-950/40 border border-rose-500/35 text-[11px] text-rose-200 font-semibold leading-snug">
                  🛡️ <strong>Yönetici (Admin) Resmi Veri Girişi:</strong> Girdiğiniz izin, icap veya
                  not doğrudan sunucuya işlenir; hem <strong>tüm kurumun ortak tablosunda</strong>{' '}
                  hem de <strong>ilgili personelin bireysel takviminde</strong> anında görünür.
                </div>
              )}

              {/* Pending Approval Requests Banner: ONLY visible in Admin (İdari Büro) mode */}
              {isAdminBureauMode && pendingLeaveRequests.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-950/35 border border-amber-500/40 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        Yönetici Onayı Bekleyen Talepler ({pendingLeaveRequests.length})
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-200/80">
                      Onaylandığında Ana Takvime Geçer
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {pendingLeaveRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-2 rounded-xl bg-slate-950/90 border border-amber-500/30 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-white truncate flex items-center gap-1.5 flex-wrap">
                            <span>{req.personName}</span>
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-black">
                              {req.type === 'İcap Nöbeti'
                                ? `İcap (${req.swapShiftType === 'AKSAM' ? 'A' : 'S'})`
                                : req.type === 'Nöbet Değişimi'
                                ? `Değişim (${req.swapShiftType === 'AKSAM' ? 'Akşam - A' : 'Sabah - S'})`
                                : req.type}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-black">
                              {countInclusiveDays(req.startDate, req.endDate || req.startDate)} Gün
                            </span>
                          </div>
                          <div className="text-[10.5px] text-slate-400 truncate">
                            {trDateFormatter(req.startDate)}
                            {req.endDate && req.endDate !== req.startDate
                              ? ` – ${trDateFormatter(req.endDate)} (${countInclusiveDays(
                                  req.startDate,
                                  req.endDate
                                )} Gün)`
                              : ''}{' '}
                            {req.desc ? `· ${req.desc}` : ''}
                          </div>
                        </div>

                        {isAuthorizedAdmin && activeUnit ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const daysCount = await approveUnitLeaveRequestInCloud(req);
                                  onTriggerToast?.(
                                    'Talep Onaylandı & Ana Takvime İşlendi',
                                    `${req.personName} için ${daysCount} günlük ${req.type} kaydı ana takvime ve tabloya aktarıldı.`
                                  );
                                } catch (e) {
                                  setEntryError(
                                    e instanceof Error ? e.message : 'Onaylama başarısız.'
                                  );
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-extrabold cursor-pointer"
                            >
                              Onayla
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await rejectOrDeleteUnitLeaveRequestInCloud(req.unitId, req.id);
                                  onTriggerToast?.(
                                    'Talep Reddedildi',
                                    `${req.personName} talebi listeden kaldırıldı.`
                                  );
                                } catch (e) {
                                  setEntryError(
                                    e instanceof Error ? e.message : 'Silme başarısız.'
                                  );
                                }
                              }}
                              className="px-2 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 text-[10.5px] font-bold cursor-pointer"
                            >
                              Reddet
                            </button>
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-[10px] font-extrabold shrink-0">
                            ⏳ Onay Bekliyor
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entryError && (
                <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                  {entryError}
                </div>
              )}

              {/* If Admin mode is selected, check if user is authorized by Ana Yönetici */}
              {entryRoleMode === 'admin' && !currentUser ? (
                <VardiyaGoogleAuthCard
                  isLight={false}
                  compact
                  onError={(msg) => setEntryError(msg)}
                />
              ) : entryRoleMode === 'admin' && !isAuthorizedAdmin ? (
                <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-center space-y-2.5">
                  <Lock className="w-7 h-7 text-amber-400 mx-auto" />
                  <div className="text-xs font-extrabold text-amber-200">
                    Hesabınızın ({currentUser?.email}) Kurum Admin Yetkisi Bulunmuyor
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Kurum tablosuna resmi veri girebilmek için{' '}
                    <strong>Ana Yönetici</strong> tarafından admin olarak yetkilendirilmiş
                    olmanız gerekmektedir.
                  </p>
                </div>
              ) : (
                /* Data Entry Form (Active for Bireysel User OR Authorized Admin) */
                <div className="space-y-3">
                  {/* Record Type Selector Buttons */}
                  <div>
                    <label className="block text-[11px] font-extrabold text-slate-400 mb-1.5">
                      İşlem Türü Seçin
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEntryType('İzin / Rapor');
                          setEntryLeaveSubType('Yıllık İzin');
                        }}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'İzin / Rapor' &&
                          entryLeaveSubType !== 'İdari İzin' &&
                          entryLeaveSubType !== 'Ücretsiz İzin'
                            ? 'bg-purple-600 border-purple-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        🟪 İzin / Rapor
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEntryType('İzin / Rapor');
                          setEntryLeaveSubType('İdari İzin');
                        }}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'İzin / Rapor' && entryLeaveSubType === 'İdari İzin'
                            ? 'bg-purple-600 border-purple-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        🏛️ İdari İzin
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEntryType('İzin / Rapor');
                          setEntryLeaveSubType('Ücretsiz İzin');
                        }}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'İzin / Rapor' && entryLeaveSubType === 'Ücretsiz İzin'
                            ? 'bg-purple-600 border-purple-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        ⏸️ Ücretsiz İzin
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntryType('İcap Nöbeti')}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'İcap Nöbeti'
                            ? 'bg-[#fef08a] border-amber-500 text-slate-950'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        🟨 İcap (S / A)
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntryType('Nöbet Boşa Çıkarma')}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'Nöbet Boşa Çıkarma'
                            ? 'bg-slate-200 border-white text-slate-950'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        ⬜ Nöbeti Boşa Çıkar
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntryType('Ek Nöbet')}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'Ek Nöbet'
                            ? 'bg-emerald-600 border-emerald-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        ➕ Ek Nöbet (S / A)
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntryType('Nöbet Değişimi')}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'Nöbet Değişimi'
                            ? 'bg-sky-600 border-sky-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        🔄 Değişim
                      </button>

                      <button
                        type="button"
                        onClick={() => setEntryType('Not')}
                        className={`py-2 px-2 rounded-xl text-[11px] font-extrabold border transition cursor-pointer ${
                          entryType === 'Not'
                            ? 'bg-amber-600 border-amber-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        📝 Tablo Notu
                      </button>
                    </div>

                    {entryType === 'İzin / Rapor' && (
                      <div className="mt-2 pt-2 border-t border-slate-800">
                        <span className="block text-[10px] font-extrabold uppercase tracking-wider text-purple-300 mb-1.5">
                          İzin / Rapor Alt Türü:
                        </span>
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
                              onClick={() => setEntryLeaveSubType(sub)}
                              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-extrabold border transition cursor-pointer ${
                                entryLeaveSubType === sub
                                  ? 'bg-purple-600 border-purple-400 text-white'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-purple-500/50'
                              }`}
                            >
                              {sub}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Person & Group Selection */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-400 mb-1">
                        İlgili Personel
                      </label>
                      {allTablePersonnel.length > 0 ? (
                        <select
                          value={entryPersonName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEntryPersonName(val);
                            const found = allTablePersonnel.find((p) => p.name === val);
                            if (found) setEntryGroupIdx(found.groupIdx);
                          }}
                          className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none"
                        >
                          <option value="">Personel Seçin...</option>
                          {allTablePersonnel.map((p, idx) => (
                            <option key={`${p.name}-${idx}`} value={p.name}>
                              ({p.groupName}) {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={entryPersonName}
                          onChange={(e) => setEntryPersonName(e.target.value)}
                          placeholder="Personel Adı Soyadı"
                          className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none"
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-400 mb-1">
                        Grup
                      </label>
                      <select
                        value={entryGroupIdx}
                        onChange={(e) => setEntryGroupIdx(parseInt(e.target.value, 10))}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none"
                      >
                        {Array.from({ length: settings.numGroups }, (_, i) => (
                          <option key={i} value={i}>
                            {settings.groupNames[i] || `${i + 1}. Grup`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Date & Optional End Date for Leave / On-Call / Cancel Shift */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-400 mb-1">
                        {entryType === 'İzin / Rapor' ||
                        entryType === 'İcap Nöbeti' ||
                        entryType === 'Nöbet Boşa Çıkarma'
                          ? 'Başlangıç Tarihi'
                          : 'Tarih'}
                      </label>
                      <input
                        type="date"
                        value={entryStartDate}
                        onChange={(e) => setEntryStartDate(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none"
                      />
                    </div>

                    {(entryType === 'İzin / Rapor' ||
                      entryType === 'İcap Nöbeti' ||
                      entryType === 'Nöbet Boşa Çıkarma') && (
                      <div>
                        <label className="text-[10.5px] font-bold text-slate-400 flex items-center justify-between gap-1 mb-1">
                          <span>Bitiş Tarihi (Çok Günlü İse)</span>
                          {entryEndDate && entryEndDate >= entryStartDate && (
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-extrabold">
                              {countInclusiveDays(entryStartDate, entryEndDate)} Gün
                            </span>
                          )}
                        </label>
                        <input
                          type="date"
                          value={entryEndDate}
                          min={entryStartDate}
                          onChange={(e) => setEntryEndDate(e.target.value)}
                          className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Nöbet Boşa Çıkarma Info */}
                  {entryType === 'Nöbet Boşa Çıkarma' && (
                    <div className="p-2.5 rounded-2xl bg-slate-800/80 border border-slate-600 text-[11px] text-slate-200 leading-relaxed">
                      ⬜ Seçili personelin bu tarihteki mevcut <strong>S / A</strong> nöbeti
                      tablodan kaldırılarak <strong>BOŞ</strong> hale getirilir ve bireysel
                      takviminde dinlenme olarak güncellenir.
                    </div>
                  )}

                  {/* İcap Nöbeti OR Ek Nöbet Shift Choice: S (Sabah) or A (Akşam) */}
                  {(entryType === 'İcap Nöbeti' || entryType === 'Ek Nöbet') && (
                    <div
                      className={`p-3 rounded-2xl border space-y-1.5 ${
                        entryType === 'Ek Nöbet'
                          ? 'bg-emerald-950/35 border-emerald-500/40'
                          : 'bg-amber-500/15 border-amber-400/40'
                      }`}
                    >
                      <label
                        className={`block text-[11px] font-extrabold ${
                          entryType === 'Ek Nöbet' ? 'text-emerald-300' : 'text-amber-300'
                        }`}
                      >
                        {entryType === 'Ek Nöbet'
                          ? 'Eklenecek Manuel Nöbet (Tabloda Yeşil Kutucukta S veya A Yazar)'
                          : 'İcaba Gelinecek Nöbet (Tabloda Sarı Kutucuk İçinde S veya A Yazar)'}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEntryShiftType('GUNDUZ')}
                          className={`py-2 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                            entryShiftType === 'GUNDUZ'
                              ? entryType === 'Ek Nöbet'
                                ? 'bg-emerald-600 border-emerald-400 text-white shadow-sm'
                                : 'bg-[#fef08a] border-amber-500 text-slate-950 shadow-sm'
                              : 'bg-slate-950 border-slate-700 text-slate-300'
                          }`}
                        >
                          ☀️ Sabah / Gündüz (S)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryShiftType('AKSAM')}
                          className={`py-2 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                            entryShiftType === 'AKSAM'
                              ? entryType === 'Ek Nöbet'
                                ? 'bg-emerald-600 border-emerald-400 text-white shadow-sm'
                                : 'bg-[#fef08a] border-amber-500 text-slate-950 shadow-sm'
                              : 'bg-slate-950 border-slate-700 text-slate-300'
                          }`}
                        >
                          🌙 Akşam / Gece (A)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Nöbet Değişimi Fields */}
                  {entryType === 'Nöbet Değişimi' && (
                    <div className="p-3 rounded-2xl bg-sky-950/30 border border-sky-500/35 space-y-2.5">
                      <div>
                        <label className="block text-[10.5px] font-bold text-sky-300 mb-1.5">
                          Nöbet Vardiyası (Sabah / Akşam)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setEntryShiftType('GUNDUZ')}
                            className={`py-2 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                              entryShiftType === 'GUNDUZ'
                                ? 'bg-amber-500 border-amber-300 text-slate-950 shadow-sm'
                                : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-900'
                            }`}
                          >
                            ☀️ Sabah / Gündüz (S)
                          </button>
                          <button
                            type="button"
                            onClick={() => setEntryShiftType('AKSAM')}
                            className={`py-2 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                              entryShiftType === 'AKSAM'
                                ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                                : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-900'
                            }`}
                          >
                            🌙 Akşam / Gece (A)
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10.5px] font-bold text-sky-300 mb-1">
                            Yerine Nöbet Tutacak Personel
                          </label>
                          {allTablePersonnel.length > 0 ? (
                            <select
                              value={entrySwapWithPerson}
                              onChange={(e) => setEntrySwapWithPerson(e.target.value)}
                              className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold"
                            >
                              <option value="">Karşı Personel Seçin...</option>
                              {allTablePersonnel.map((p, idx) => (
                                <option key={`sw-${p.name}-${idx}`} value={p.name}>
                                  ({p.groupName}) {p.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={entrySwapWithPerson}
                              onChange={(e) => setEntrySwapWithPerson(e.target.value)}
                              placeholder="Karşı Personel Adı"
                              className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold"
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-[10.5px] font-bold text-sky-300 mb-1">
                            Karşılık Nöbet Tarihi (Opsiyonel)
                          </label>
                          <input
                            type="date"
                            value={entrySwapTargetDate}
                            onChange={(e) => setEntrySwapTargetDate(e.target.value)}
                            className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Note / Description Input */}
                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-400 mb-1">
                      İzin / İcap / Tablo Notu Açıklaması
                    </label>
                    <input
                      type="text"
                      value={entryDesc}
                      onChange={(e) => setEntryDesc(e.target.value)}
                      placeholder={
                        entryType === 'İzin / Rapor'
                          ? 'Örn: Yıllık İzin, Raporlu, İdari İzinli...'
                          : entryType === 'İcap Nöbeti'
                          ? 'Örn: Çağrı Alıcı İcap, Takviye İcap...'
                          : 'Tabloda görünecek notunuzu yazın...'
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-semibold outline-none"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="button"
                    disabled={entrySaving}
                    onClick={() => void handleSaveTableEntry()}
                    className={`w-full py-2.5 px-4 rounded-2xl text-xs font-black flex items-center justify-center gap-2 shadow-lg transition cursor-pointer ${
                      entryRoleMode === 'admin'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : activeUnit
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        : 'bg-sky-600 hover:bg-sky-500 text-white'
                    }`}
                  >
                    {entryRoleMode === 'user' && activeUnit ? (
                      <Send className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span>
                      {entrySaving
                        ? 'Gönderiliyor...'
                        : entryRoleMode === 'admin'
                        ? `🛡️ Yönetici Olarak Doğrudan Ana Takvime & Tabloya İşle (${entryType})`
                        : activeUnit
                        ? `🛡️ Yönetici Onayına Gönder (${entryType} → Onaylanınca Ana Takvime Geçer)`
                        : `👤 Bireysel Tabloma & Takvimime Ekle (${entryType})`}
                    </span>
                  </button>
                </div>
              )}

              {/* Existing Records on This Date (Consecutive days merged into a single range entry) */}
              {(matchingLocalNotesForDate.length > 0 || matchingCloudNotesForDate.length > 0) && (
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="text-[11px] font-extrabold text-slate-400">
                    {trDateFormatter(entryStartDate)} Tarihini Kapsayan Kayıtlar
                  </div>

                  {matchingCloudNotesForDate.map((grp) => (
                    <div
                      key={grp.key}
                      className="p-2.5 rounded-xl bg-slate-950 border border-rose-500/30 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-extrabold text-white truncate flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[10px] font-black">
                            🛡️ Resmi
                          </span>
                          <span>{grp.personName}</span>
                          <span>·</span>
                          <span className="text-amber-300">{grp.type}</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-black">
                            {grp.dayCount} Gün
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {trDateFormatter(grp.startDate)}
                          {grp.endDate !== grp.startDate
                            ? ` – ${trDateFormatter(grp.endDate)} (${grp.dayCount} Gün)`
                            : ''}{' '}
                          · {grp.desc || grp.type}
                        </div>
                      </div>
                      {isAuthorizedAdmin && activeUnit && (
                        <button
                          type="button"
                          onClick={async () => {
                            await Promise.all(
                              grp.items.map((cn) =>
                                deleteUnitRosterNoteFromCloud(activeUnit.id, cn.id)
                              )
                            );
                          }}
                          className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 transition cursor-pointer shrink-0"
                          title={
                            grp.dayCount > 1
                              ? `${grp.dayCount} günlük resmi kayıt aralığını sil`
                              : 'Resmi Kaydı Sil'
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {matchingLocalNotesForDate.map((grp) => {
                    const idSet = new Set(grp.items.map((it) => it.id));
                    return (
                      <div
                        key={grp.key}
                        className="p-2.5 rounded-xl bg-slate-950 border border-sky-500/30 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-extrabold text-white truncate flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 text-[10px] font-black">
                              👤 Bireysel
                            </span>
                            <span>{grp.personName || 'Kişisel'}</span>
                            <span>·</span>
                            <span className="text-sky-300">{grp.type}</span>
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-black">
                              {grp.dayCount} Gün
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {trDateFormatter(grp.startDate)}
                            {grp.endDate !== grp.startDate
                              ? ` – ${trDateFormatter(grp.endDate)} (${grp.dayCount} Gün)`
                              : ''}{' '}
                            · {grp.desc || grp.type}
                          </div>
                        </div>
                        {onSaveLocalNotes && (
                          <button
                            type="button"
                            onClick={() =>
                              onSaveLocalNotes(localNotes.filter((item) => !idSet.has(item.id)))
                            }
                            className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 transition cursor-pointer shrink-0"
                            title={
                              grp.dayCount > 1
                                ? `${grp.dayCount} günlük bireysel kayıt aralığını sil`
                                : 'Bireysel Kaydı Sil'
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PRO GROUP & PERSONNEL STRUCTURE EDITOR STUDIO MODAL
          (Rename Groups, Rename People, Move ↑↓, Transfer Group, Swap Two People, Add/Delete)
         ===================================================================== */}
      {showStructureStudio && (
        <div
          onClick={() => setShowStructureStudio(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[92vh] bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white"
          >
            {/* Studio Header */}
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 flex-shrink-0">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                  {activeUnit
                    ? `🛡️ ${activeUnit.name} — CANLI TABLO YAPISI DÜZENLEYİCİ`
                    : '🛠️ YEREL TABLO GRUP & PERSONEL DÜZENLEYİCİ'}
                </div>
                <h2 className="text-sm sm:text-base font-black truncate">
                  Grup Adları, Personel İsimleri, Sıralama &amp; Yer Değiştirme
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowStructureStudio(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Swap Instruction Banner */}
            {studioSwapPick && (
              <div className="px-4 py-2 bg-amber-500/20 border-b border-amber-400/40 text-amber-200 text-xs font-bold flex items-center justify-between gap-2 flex-shrink-0">
                <span>
                  ⇄ Yer Değiştirme Seçildi:{' '}
                  <strong>
                    {studioGroupMembers[studioSwapPick.gIdx]?.[studioSwapPick.mIdx]}
                  </strong>{' '}
                  — yerini değiştirmek istediğiniz diğer personelin <strong>⇄</strong> butonuna
                  tıklayın.
                </span>
                <button
                  type="button"
                  onClick={() => setStudioSwapPick(null)}
                  className="px-2 py-0.5 rounded-lg bg-slate-900 text-amber-300 text-[11px] font-extrabold cursor-pointer shrink-0"
                >
                  İptal
                </button>
              </div>
            )}

            {/* Scrollable Groups & Personnel Cards */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5">
              <div className="text-[11px] text-slate-400 leading-relaxed">
                Her grubun <strong>1. sırasındaki</strong> kişi tabloda{' '}
                <span className="text-rose-400 font-bold">Kırmızı (Grup Sorumlusu)</span>,{' '}
                <strong>2. sırasındaki</strong> kişi{' '}
                <span className="text-sky-400 font-bold">Mavi (Grup Sorumlusu Yrd.)</span> olarak
                görünür. İsimleri düzenleyebilir, ↑↓ ile sırayı değiştirebilir, ⇄ ile iki kişiyi
                (farklı gruplar arasında bile) takas edebilir veya grup seçicisiyle başka gruba
                aktarabilirsiniz.
              </div>

              {studioGroupMembers.map((members, gIdx) => (
                <div
                  key={`studio-grp-${gIdx}`}
                  className="p-3 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2.5"
                >
                  {/* Group Name Header Input */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="px-2 py-1 rounded-lg bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 text-[10px] font-black shrink-0">
                        GRUP {gIdx + 1}
                      </span>
                      <input
                        type="text"
                        value={studioGroupNames[gIdx] || ''}
                        onChange={(e) => {
                          const next = [...studioGroupNames];
                          next[gIdx] = e.target.value;
                          setStudioGroupNames(next);
                        }}
                        placeholder={`${gIdx + 1}. Grup`}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-extrabold outline-none focus:border-indigo-400"
                      />
                    </div>
                    <span className="text-[10.5px] font-bold text-slate-400 shrink-0">
                      {members.length} Personel
                    </span>
                  </div>

                  {/* Personnel Rows */}
                  <div className="space-y-1.5">
                    {members.map((person, mIdx) => {
                      const isSwapSelected =
                        studioSwapPick?.gIdx === gIdx && studioSwapPick?.mIdx === mIdx;
                      return (
                        <div
                          key={`st-${gIdx}-${mIdx}`}
                          className={`p-1.5 rounded-xl border flex flex-wrap sm:flex-nowrap items-center gap-1.5 transition ${
                            isSwapSelected
                              ? 'bg-amber-500/20 border-amber-400'
                              : 'bg-slate-900/90 border-slate-800'
                          }`}
                        >
                          {/* Rank Badge */}
                          <span
                            className={`w-7 h-7 rounded-lg text-[10px] font-black flex items-center justify-center shrink-0 ${
                              mIdx === 0
                                ? 'bg-rose-600/25 border border-rose-500/50 text-rose-300'
                                : mIdx === 1
                                ? 'bg-sky-600/25 border border-sky-500/50 text-sky-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                            title={
                              mIdx === 0
                                ? 'Grup Sorumlusu (Kırmızı)'
                                : mIdx === 1
                                ? 'Grup Sorumlusu Yardımcısı (Mavi)'
                                : `${mIdx + 1}. Sıra`
                            }
                          >
                            {mIdx === 0 ? 'S1' : mIdx === 1 ? 'Y2' : mIdx + 1}
                          </span>

                          {/* Editable Name */}
                          <input
                            type="text"
                            value={person}
                            onChange={(e) => {
                              const next = studioGroupMembers.map((arr) => [...arr]);
                              next[gIdx][mIdx] = e.target.value;
                              setStudioGroupMembers(next);
                            }}
                            className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-bold outline-none focus:border-sky-400"
                          />

                          {/* Group Transfer Dropdown */}
                          <select
                            value={gIdx}
                            onChange={(e) => {
                              const targetG = parseInt(e.target.value, 10);
                              if (targetG === gIdx) return;
                              const next = studioGroupMembers.map((arr) => [...arr]);
                              const [moved] = next[gIdx].splice(mIdx, 1);
                              if (moved) {
                                next[targetG].push(moved);
                                setStudioGroupMembers(next);
                              }
                            }}
                            className="h-7 px-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-[10.5px] font-bold outline-none cursor-pointer shrink-0"
                            title="Başka gruba aktar"
                          >
                            {studioGroupNames.map((gn, targetIdx) => (
                              <option key={`tr-${targetIdx}`} value={targetIdx}>
                                → {gn || `${targetIdx + 1}. Grup`}
                              </option>
                            ))}
                          </select>

                          {/* Action Buttons: Up, Down, Swap, Delete */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={mIdx === 0}
                              onClick={() => {
                                const next = studioGroupMembers.map((arr) => [...arr]);
                                [next[gIdx][mIdx - 1], next[gIdx][mIdx]] = [
                                  next[gIdx][mIdx],
                                  next[gIdx][mIdx - 1],
                                ];
                                setStudioGroupMembers(next);
                              }}
                              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center cursor-pointer"
                              title="Yukarı Taşı"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              disabled={mIdx === members.length - 1}
                              onClick={() => {
                                const next = studioGroupMembers.map((arr) => [...arr]);
                                [next[gIdx][mIdx + 1], next[gIdx][mIdx]] = [
                                  next[gIdx][mIdx],
                                  next[gIdx][mIdx + 1],
                                ];
                                setStudioGroupMembers(next);
                              }}
                              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 flex items-center justify-center cursor-pointer"
                              title="Aşağı Taşı"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (!studioSwapPick) {
                                  setStudioSwapPick({ gIdx, mIdx });
                                  return;
                                }
                                if (studioSwapPick.gIdx === gIdx && studioSwapPick.mIdx === mIdx) {
                                  setStudioSwapPick(null);
                                  return;
                                }
                                const next = studioGroupMembers.map((arr) => [...arr]);
                                const tmp = next[studioSwapPick.gIdx][studioSwapPick.mIdx];
                                next[studioSwapPick.gIdx][studioSwapPick.mIdx] = next[gIdx][mIdx];
                                next[gIdx][mIdx] = tmp;
                                setStudioGroupMembers(next);
                                setStudioSwapPick(null);
                              }}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer ${
                                isSwapSelected
                                  ? 'bg-amber-400 text-slate-950'
                                  : studioSwapPick
                                  ? 'bg-sky-600 text-white animate-pulse'
                                  : 'bg-sky-950 hover:bg-sky-900 text-sky-300 border border-sky-500/30'
                              }`}
                              title="İki Kişinin Yerini Değiştir"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const next = studioGroupMembers.map((arr) => [...arr]);
                                next[gIdx].splice(mIdx, 1);
                                setStudioGroupMembers(next);
                              }}
                              className="w-7 h-7 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-300 flex items-center justify-center cursor-pointer"
                              title="Personeli Gruptan Kaldır"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add New Person to This Group */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={studioNewPersonByGroup[gIdx] || ''}
                      onChange={(e) =>
                        setStudioNewPersonByGroup((prev) => ({
                          ...prev,
                          [gIdx]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = (studioNewPersonByGroup[gIdx] || '').trim();
                          if (!val) return;
                          const next = studioGroupMembers.map((arr) => [...arr]);
                          next[gIdx].push(val);
                          setStudioGroupMembers(next);
                          setStudioNewPersonByGroup((prev) => ({ ...prev, [gIdx]: '' }));
                        }
                      }}
                      placeholder={`${studioGroupNames[gIdx] || `${gIdx + 1}. Grup`} için yeni personel adı ekle...`}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs outline-none focus:border-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = (studioNewPersonByGroup[gIdx] || '').trim();
                        if (!val) return;
                        const next = studioGroupMembers.map((arr) => [...arr]);
                        next[gIdx].push(val);
                        setStudioGroupMembers(next);
                        setStudioNewPersonByGroup((prev) => ({ ...prev, [gIdx]: '' }));
                      }}
                      className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Ekle</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Studio Footer Save Button */}
            <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowStructureStudio(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={structureSaving}
                onClick={async () => {
                  await persistRosterStructure(
                    studioGroupNames,
                    studioGroupMembers,
                    'Tablo Grup & Personel Yapısı Kaydedildi',
                    activeUnit
                      ? `${activeUnit.name} tablosundaki tüm isim, sıra ve grup değişiklikleri canlı olarak sunucuda yayınlandı.`
                      : 'Tablodaki tüm grup adları ve personel değişiklikleri kaydedildi.'
                  );
                  setShowStructureStudio(false);
                }}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 shadow-lg cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>
                  {structureSaving
                    ? 'Kaydediliyor...'
                    : activeUnit
                    ? 'Değişiklikleri Canlı Yayınla'
                    : 'Değişiklikleri Kaydet'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INSTANT PNG PREVIEW & SAVE OVERLAY */}
      {previewPng && (
        <div
          onClick={() => setPreviewPng(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-white truncate">
                  PNG Çizelge Önizleme
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  Görseli indirebilir, paylaşabilir veya telefonda üzerine basılı tutup galeriye kaydedebilirsiniz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPng(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer shrink-0"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-slate-950/70 p-3 flex items-center justify-center">
              <img
                src={previewPng.dataUrl}
                alt={previewPng.fileName}
                className="max-w-full max-h-[65vh] object-contain rounded-lg border border-slate-700 bg-white select-auto"
              />
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800 bg-slate-900 flex-shrink-0">
              <button
                type="button"
                onClick={() =>
                  void handleExportTablePng('download', {
                    canvas: previewPng.canvas,
                    fileName: previewPng.fileName,
                  })
                }
                className={`h-10 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                  downloadDone
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white'
                }`}
              >
                {downloadDone ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                <span>{downloadDone ? 'İndirildi' : 'PNG İndir'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void handleExportTablePng('share', {
                    canvas: previewPng.canvas,
                    fileName: previewPng.fileName,
                  })
                }
                className={`h-10 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                  shareDone
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 hover:bg-rose-500 text-white'
                }`}
              >
                {shareDone ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span>{shareDone ? 'Hazır' : 'Paylaş'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
