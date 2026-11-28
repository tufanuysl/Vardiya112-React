import React, { useState, useMemo, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  UserCheck,
  UserPlus,
  Users,
  Sparkles,
  CheckCircle2,
  Check,
  Trash2,
  Edit3,
  X,
  Calendar,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import {
  AppSettings,
  InstitutionUnitDoc,
  ProfileAvatarColor,
  RefRecord,
  UnitProfileLockDoc,
  UserProfile,
} from '../types';
import {
  AVATAR_COLORS,
  findMatchingGroupByName,
} from '../storage';
import {
  getGroupAnchorDateTime,
  isSamePersonNameTR,
  querySingleDayForGroup,
  toISODate,
  trDateFormatter,
  verifyGoogleAccountMatchesPerson,
} from '../shiftEngine';

interface ProfileManagerModalProps {
  profiles: UserProfile[];
  activeProfileId: string;
  settings: AppSettings;
  activeRefHistory: RefRecord[];
  isLight: boolean;
  activeUnit?: InstitutionUnitDoc | null;
  activeUnitProfileLocks?: UnitProfileLockDoc[];
  currentUser?: User | null;
  isAuthorizedAdmin?: boolean;
  onTriggerToast?: (title: string, message: string) => void;
  onSelectProfile: (profileId: string) => void;
  onSaveProfile: (
    profile: UserProfile,
    updatedSettings?: AppSettings,
    makeActive?: boolean
  ) => void;
  onDeleteProfile: (profileId: string) => void;
  onClose?: () => void;
  inlineMode?: boolean;
}

const AVATAR_BG_CLASSES: Record<ProfileAvatarColor, string> = {
  emerald: 'bg-emerald-600 text-white',
  sky: 'bg-sky-600 text-white',
  amber: 'bg-amber-500 text-white',
  rose: 'bg-rose-600 text-white',
  indigo: 'bg-indigo-600 text-white',
};

export const ProfileManagerModal: React.FC<ProfileManagerModalProps> = ({
  profiles,
  activeProfileId,
  settings,
  activeRefHistory,
  isLight,
  currentUser,
  onTriggerToast,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
  onClose,
  inlineMode = false,
}) => {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);

  // Form states
  const [nameInput, setNameInput] = useState<string>('');
  const [roleInput, setRoleInput] = useState<string>('112 Personeli');
  const [avatarColor, setAvatarColor] = useState<ProfileAvatarColor>('emerald');
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number>(0);
  const [isMatchApproved, setIsMatchApproved] = useState<boolean>(false);
  const [matchedSourceLabel, setMatchedSourceLabel] = useState<string>('Manuel Seçim');

  // Shift-date-based group finder state
  const [showDateFinder, setShowDateFinder] = useState<boolean>(false);
  const [finderDate, setFinderDate] = useState<string>(() => toISODate(new Date()));
  const [finderShiftType, setFinderShiftType] = useState<'GUNDUZ' | 'AKSAM'>('GUNDUZ');

  // Real-time automatic name-to-group match check
  const autoNameMatch = useMemo(() => {
    if (!nameInput || nameInput.trim().length < 2) return null;
    return findMatchingGroupByName(nameInput, settings.groupMembers, settings.groupNames);
  }, [nameInput, settings.groupMembers, settings.groupNames]);

  // When autoNameMatch finds a group as the user types (e.g. "Tufan"), highlight it for approval
  useEffect(() => {
    if (autoNameMatch && (isCreatingNew || editingProfileId)) {
      setSelectedGroupIdx(autoNameMatch.groupIdx);
      setMatchedSourceLabel(`Personel Listesi (${autoNameMatch.matchedMemberName})`);
      // Require explicit user confirmation on the matched card so it's a true confirmed system
      setIsMatchApproved(false);
    }
  }, [autoNameMatch?.groupIdx, autoNameMatch?.matchedMemberName, isCreatingNew, editingProfileId]);

  // All existing staff names across groups for 1-tap quick pick
  const allKnownStaffMembers = useMemo(() => {
    const list: Array<{ name: string; groupIdx: number; groupName: string }> = [];
    for (let i = 0; i < settings.numGroups; i++) {
      const raw = settings.groupMembers[i] || '';
      const names = raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const n of names) {
        list.push({
          name: n,
          groupIdx: i,
          groupName: settings.groupNames[i] || `${i + 1}. Grup`,
        });
      }
    }
    return list;
  }, [settings.groupMembers, settings.groupNames, settings.numGroups]);

  // Find which group has the shift on finderDate + finderShiftType (when base reference exists)
  const dateMatchedGroupIdx = useMemo(() => {
    if (!activeRefHistory || activeRefHistory.length === 0) return null;
    for (let g = 0; g < settings.numGroups; g++) {
      const info = querySingleDayForGroup(finderDate, g, settings, activeRefHistory, []);
      if (finderShiftType === 'GUNDUZ' && info.dayShift) return g;
      if (finderShiftType === 'AKSAM' && info.nightShift) return g;
    }
    return null;
  }, [finderDate, finderShiftType, activeRefHistory, settings]);

  const startCreateNew = () => {
    setEditingProfileId(null);
    setIsCreatingNew(true);
    setNameInput('');
    setRoleInput('112 Personeli');
    setAvatarColor(AVATAR_COLORS[profiles.length % AVATAR_COLORS.length]);
    setSelectedGroupIdx(0);
    setIsMatchApproved(false);
    setMatchedSourceLabel('Manuel Seçim');
    setShowDateFinder(false);
  };

  const startEditProfile = (p: UserProfile) => {
    setIsCreatingNew(false);
    setEditingProfileId(p.id);
    setNameInput(p.name);
    setRoleInput(p.role || '112 Personeli');
    setAvatarColor(p.avatarColor || 'emerald');
    setSelectedGroupIdx(p.groupIdx);
    setIsMatchApproved(p.isGroupConfirmed);
    setMatchedSourceLabel(p.matchedSource || 'Onaylı Grup');
    setShowDateFinder(false);
  };

  const cancelForm = () => {
    setIsCreatingNew(false);
    setEditingProfileId(null);
  };

  // Compute derived RefRecord for targetGroupIdx based on existing system reference
  const buildRefHistoryForGroup = (
    targetGroupIdx: number,
    existingProfileRefs?: RefRecord[]
  ): RefRecord[] => {
    const baseRef =
      activeRefHistory[0] ||
      (existingProfileRefs && existingProfileRefs[0]) || {
        validFrom: '1970-01-01',
        myGroupIdx: targetGroupIdx,
        refDate: toISODate(new Date()),
        refType: 'GUNDUZ' as const,
      };

    if (activeRefHistory.length > 0) {
      const [anchorDT, anchorType] = getGroupAnchorDateTime(
        targetGroupIdx,
        activeRefHistory[0],
        settings
      );
      return [
        {
          validFrom: '1970-01-01',
          myGroupIdx: targetGroupIdx,
          refDate: toISODate(anchorDT),
          refType: anchorType,
        },
      ];
    }

    return [
      {
        ...baseRef,
        myGroupIdx: targetGroupIdx,
      },
    ];
  };

  const handleConfirmAndSaveProfile = () => {
    const cleanName = nameInput.trim() || 'Kullanıcı Profili';

    if (
      currentUser &&
      cleanName !== 'Ana Profilim' &&
      !verifyGoogleAccountMatchesPerson(cleanName, currentUser).matched
    ) {
      onTriggerToast?.(
        'Google Hesap İsmi Eşleşmiyor',
        `"${cleanName}" ismi giriş yaptığınız Google hesabının adıyla eşleşmiyor. Yalnızca kendi adınızla profil oluşturabilirsiniz.`
      );
      return;
    }

    const safeGroupIdx = Math.max(0, Math.min(settings.numGroups - 1, selectedGroupIdx));

    const existingProfile = editingProfileId
      ? profiles.find((p) => p.id === editingProfileId)
      : undefined;

    const nextRefs = buildRefHistoryForGroup(safeGroupIdx, existingProfile?.refHistory);

    const newProfile: UserProfile = {
      id: existingProfile ? existingProfile.id : `profile-${Date.now()}`,
      name: cleanName,
      role: roleInput.trim() || '112 Personeli',
      avatarColor,
      groupIdx: safeGroupIdx,
      isGroupConfirmed: true,
      matchedSource:
        autoNameMatch && autoNameMatch.groupIdx === safeGroupIdx
          ? `Otomatik İsim Eşleşmesi (${autoNameMatch.matchedMemberName})`
          : matchedSourceLabel,
      refHistory: nextRefs,
      notes:
        existingProfile && isSamePersonNameTR(existingProfile.name, cleanName)
          ? (existingProfile.notes || []).filter((it) => {
              if (cleanName === 'Ana Profilim') return true;
              const np = (it.swapMyPerson || '').trim();
              const sp = (it.swapWithPerson || '').trim();
              return (
                (Boolean(np) && isSamePersonNameTR(cleanName, np)) ||
                (it.type === 'Nöbet Değişimi' && Boolean(sp) && isSamePersonNameTR(cleanName, sp))
              );
            })
          : [],
      createdAt: existingProfile ? existingProfile.createdAt : new Date().toISOString(),
    };

    let updatedSettings: AppSettings | undefined;
    if (cleanName !== 'Ana Profilim') {
      updatedSettings = {
        ...settings,
        activeWorkerName: cleanName,
      };
    }

    onSaveProfile(newProfile, updatedSettings, true);
    setIsCreatingNew(false);
    setEditingProfileId(null);
  };

  // Quick-approve a detected group match for an existing profile in the list
  const handleQuickApproveExistingProfileMatch = (
    profile: UserProfile,
    matchedGroupIdx: number,
    matchedMemberName: string
  ) => {
    const nextRefs = buildRefHistoryForGroup(matchedGroupIdx, profile.refHistory);
    const updatedProfile: UserProfile = {
      ...profile,
      groupIdx: matchedGroupIdx,
      isGroupConfirmed: true,
      matchedSource: `Otomatik İsim Eşleşmesi (${matchedMemberName})`,
      refHistory: nextRefs,
    };
    onSaveProfile(updatedProfile, undefined, profile.id === activeProfileId);
  };

  const content = (
    <div className="flex flex-col gap-4 select-none">
      {/* HEADER (Only shown when in modal mode) */}
      {!inlineMode && (
        <div className="flex items-center justify-between border-b pb-3 border-slate-500/15">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
                isLight
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight">
                Kullanıcı Profilleri ve Otomatik Eşleştirme
              </h2>
              <p className="text-[11px] text-slate-400">
                Birden fazla profil oluşturun; isminizden grubunuz onaylı olarak otomatik eşleşsin
              </p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-xl transition cursor-pointer ${
                isLight
                  ? 'text-slate-500 hover:bg-slate-200/70'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* MEVCUT PROFİLLER LİSTESİ */}
      {!isCreatingNew && !editingProfileId && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Kayıtlı Profiller ({profiles.length})
            </span>
            <button
              type="button"
              onClick={startCreateNew}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Yeni Profil Ekle</span>
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {profiles.map((prof) => {
              const isActive = prof.id === activeProfileId;
              const groupLabel =
                settings.groupNames[prof.groupIdx] || `${prof.groupIdx + 1}. Grup`;
              const liveMatch = findMatchingGroupByName(
                prof.name,
                settings.groupMembers,
                settings.groupNames
              );
              const hasUnconfirmedAutoMatch =
                liveMatch &&
                (liveMatch.groupIdx !== prof.groupIdx || !prof.isGroupConfirmed);

              return (
                <div
                  key={prof.id}
                  className={`p-3 rounded-2xl border transition flex flex-col gap-2.5 ${
                    isActive
                      ? isLight
                        ? 'bg-emerald-50/70 border-emerald-400 shadow-xs'
                        : 'bg-emerald-950/25 border-emerald-500/50'
                      : isLight
                      ? 'bg-white border-slate-200/80'
                      : 'bg-slate-900/50 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div
                      onClick={() => onSelectProfile(prof.id)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                    >
                      <div
                        className={`w-10 h-10 rounded-2xl font-display font-black text-sm flex items-center justify-center shrink-0 shadow-xs ${
                          AVATAR_BG_CLASSES[prof.avatarColor || 'emerald']
                        }`}
                      >
                        {(prof.name || 'K').trim().slice(0, 2).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-extrabold truncate">{prof.name}</span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500/20 text-emerald-500 uppercase tracking-wider">
                              Aktif Profil
                            </span>
                          )}
                          {prof.isGroupConfirmed && (
                            <span className="flex items-center gap-0.5 text-[10px] font-bold text-sky-400">
                              <ShieldCheck className="w-3 h-3" />
                              Onaylı
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                          <span className="font-bold text-rose-400">{groupLabel}</span>
                          {prof.role && (
                            <>
                              <span>·</span>
                              <span className="truncate">{prof.role}</span>
                            </>
                          )}
                          {prof.refHistory?.[0] && (
                            <>
                              <span>·</span>
                              <span>
                                Ref: {trDateFormatter(prof.refHistory[0].refDate)} (
                                {prof.refHistory[0].refType === 'GUNDUZ' ? 'Gündüz' : 'Gece'})
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => onSelectProfile(prof.id)}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                            isLight
                              ? 'bg-slate-900 text-white hover:bg-slate-800'
                              : 'bg-white text-slate-900 hover:bg-slate-200'
                          }`}
                        >
                          Geçiş Yap
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEditProfile(prof)}
                        className={`p-1.5 rounded-xl transition cursor-pointer ${
                          isLight
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                        title="Profili Düzenle"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {profiles.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteProfile(prof.id)}
                          className="p-1.5 rounded-xl text-rose-400 hover:bg-rose-500/15 transition cursor-pointer"
                          title="Profili Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Otomatik İsim-Grup Eşleşme Onay Uyarısı */}
                  {hasUnconfirmedAutoMatch && liveMatch && (
                    <div
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                        isLight
                          ? 'bg-amber-50 border-amber-300 text-amber-900'
                          : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
                      }`}
                    >
                      <div className="text-[11px] leading-snug">
                        <span className="font-bold">✨ Otomatik Eşleşme Bulundu: </span>
                        <span>
                          <strong>{prof.name}</strong> ismi{' '}
                          <strong>{liveMatch.groupName}</strong> personel listesinde (
                          {liveMatch.matchedMemberName}) tespit edildi!
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickApproveExistingProfileMatch(
                            prof,
                            liveMatch.groupIdx,
                            liveMatch.matchedMemberName
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[10px] font-extrabold shrink-0 flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <Check className="w-3 h-3" />
                        <span>Onayla ({liveMatch.groupName})</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* YENİ PROFİL OLUŞTURMA VEYA DÜZENLEME EKRANI (ONAYLI OTOMATİK GRUP EŞLEŞTİRME) */}
      {(isCreatingNew || editingProfileId) && (
        <div
          className={`p-3.5 rounded-2xl border flex flex-col gap-3.5 animate-fade-in ${
            isLight
              ? 'bg-white border-slate-200 shadow-xs'
              : 'bg-slate-900/75 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-500" />
              <span>
                {isCreatingNew
                  ? 'Yeni Kullanıcı Profili Oluştur (Onaylı Eşleştirme)'
                  : 'Profili ve Grup Eşleşmesini Düzenle'}
              </span>
            </h3>
            <button
              type="button"
              onClick={cancelForm}
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Vazgeç
            </button>
          </div>

          {/* 1. ADIM: İSİM GİRİŞİ (İsim girildiğinde personel listesinden otomatik grup arar) */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">
                1. Kullanıcı Adı / İsim (Örn: Tufan)
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="İsminizi yazın (Örn: Tufan Uysal)..."
                className={`w-full p-2.5 rounded-xl text-xs font-bold border outline-none transition ${
                  isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-900 focus:border-emerald-500'
                    : 'bg-slate-800/90 border-slate-700 text-white focus:border-emerald-500'
                }`}
              />
            </div>

            {/* Kayıtlı Personellerden Hızlı Seçim Çipleri */}
            {allKnownStaffMembers.length > 0 && (
              <div>
                <span className="text-[10px] font-semibold text-slate-400 block mb-1">
                  Veya Sistemde Kayıtlı Personellerden İsminize Dokunun:
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {allKnownStaffMembers.map((item, idx) => {
                    const isSelectedChip =
                      nameInput.trim().toLocaleLowerCase('tr-TR') ===
                      item.name.toLocaleLowerCase('tr-TR');
                    return (
                      <button
                        key={`${item.name}-${idx}`}
                        type="button"
                        onClick={() => {
                          setNameInput(item.name);
                          setSelectedGroupIdx(item.groupIdx);
                          setMatchedSourceLabel(`Personel Listesi (${item.name})`);
                          setIsMatchApproved(true);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                          isSelectedChip
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : isLight
                            ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>{item.name}</span>
                        <span className="opacity-70">({item.groupName})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* OTOMATİK İSİM-GRUP EŞLEŞME ONAY KARTI */}
            {autoNameMatch && (
              <div
                className={`p-3 rounded-xl border flex flex-col gap-2 transition ${
                  isMatchApproved && selectedGroupIdx === autoNameMatch.groupIdx
                    ? isLight
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                      : 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : isLight
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-amber-950/35 border-amber-500/40 text-amber-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs leading-snug">
                      <div className="font-extrabold">
                        Otomatik Grup Eşleşmesi Bulundu: {autoNameMatch.groupName}
                      </div>
                      <div className="text-[11px] opacity-85 mt-0.5">
                        Girilen <strong>&ldquo;{nameInput.trim()}&rdquo;</strong> ismi,{' '}
                        <strong>{autoNameMatch.groupName}</strong> personel listesinde (
                        <em>{autoNameMatch.matchedMemberName}</em>) tespit edildi.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {isMatchApproved && selectedGroupIdx === autoNameMatch.groupIdx ? (
                    <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{autoNameMatch.groupName} Eşleşmesi Onaylandı</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroupIdx(autoNameMatch.groupIdx);
                        setMatchedSourceLabel(
                          `Otomatik İsim Eşleşmesi (${autoNameMatch.matchedMemberName})`
                        );
                        setIsMatchApproved(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Eşleşmeyi Onayla ({autoNameMatch.groupName})</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Unvan / Rol ve Renk Seçimi */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-bold text-slate-400 block mb-1">
                Unvan / Açıklama (İsteğe Bağlı)
              </label>
              <input
                type="text"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
                placeholder="Örn: Paramedik, ATT, Çağrı Yönlendirici"
                className={`w-full p-2 rounded-xl text-xs font-semibold border outline-none ${
                  isLight
                    ? 'bg-slate-100 border-slate-200 text-slate-900'
                    : 'bg-slate-800 border-slate-700 text-white'
                }`}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 block mb-1">
                Profil Rengi
              </label>
              <div className="flex items-center gap-2 pt-1">
                {AVATAR_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setAvatarColor(col)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition cursor-pointer ${
                      AVATAR_BG_CLASSES[col]
                    } ${
                      avatarColor === col
                        ? 'ring-2 ring-offset-2 ring-emerald-400 scale-110'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                  >
                    {avatarColor === col && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 2. ADIM: GRUP SEÇİMİ VEYA NÖBET TARİHİNDEN OTOMATİK GRUP BULUCU */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-400">
                2. Eşleşen Nöbet Grubu
              </label>
              {activeRefHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDateFinder(!showDateFinder)}
                  className="text-[10px] font-bold text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Calendar className="w-3 h-3" />
                  <span>
                    {showDateFinder
                      ? 'Tarihten Bulucuyu Gizle'
                      : 'Nöbet Gününden Grubumu Otomatik Bul'}
                  </span>
                </button>
              )}
            </div>

            {/* Nöbet Gününden Otomatik Grup Bulucu (İsteğe Bağlı Yardımcı) */}
            {showDateFinder && activeRefHistory.length > 0 && (
              <div
                className={`p-2.5 rounded-xl border flex flex-col gap-2 ${
                  isLight
                    ? 'bg-sky-50/70 border-sky-200 text-slate-800'
                    : 'bg-sky-950/25 border-sky-500/30 text-slate-200'
                }`}
              >
                <span className="text-[10px] font-bold text-sky-400">
                  Bildiğiniz Bir Nöbet Gününüzü Seçin — Sistem Hangi Grupta Olduğunuzu Otomatik Bulsun:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={finderDate}
                    onChange={(e) => setFinderDate(e.target.value)}
                    className={`p-2 rounded-lg text-xs font-semibold border outline-none ${
                      isLight
                        ? 'bg-white border-slate-200 text-slate-900'
                        : 'bg-slate-900 border-slate-700 text-white'
                    }`}
                  />
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setFinderShiftType('GUNDUZ')}
                      className={`rounded-lg text-[11px] font-bold cursor-pointer ${
                        finderShiftType === 'GUNDUZ'
                          ? 'bg-amber-500 text-white'
                          : isLight
                          ? 'bg-white text-slate-700'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      ☀️ Gündüz
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinderShiftType('AKSAM')}
                      className={`rounded-lg text-[11px] font-bold cursor-pointer ${
                        finderShiftType === 'AKSAM'
                          ? 'bg-indigo-600 text-white'
                          : isLight
                          ? 'bg-white text-slate-700'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      🌙 Gece
                    </button>
                  </div>
                </div>

                {dateMatchedGroupIdx !== null && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-semibold">
                      {trDateFormatter(finderDate)}{' '}
                      {finderShiftType === 'GUNDUZ' ? 'Gündüz' : 'Gece'} nöbetçisi:{' '}
                      <strong className="text-sky-400">
                        {settings.groupNames[dateMatchedGroupIdx] ||
                          `${dateMatchedGroupIdx + 1}. Grup`}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGroupIdx(dateMatchedGroupIdx);
                        setMatchedSourceLabel(
                          `Nöbet Tarihi Eşleşmesi (${trDateFormatter(finderDate)})`
                        );
                        setIsMatchApproved(true);
                        setShowDateFinder(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Bu Grubu Onayla</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Grup Seçim Butonları */}
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: settings.numGroups }, (_, i) => {
                const isSelected = selectedGroupIdx === i;
                const isAutoSuggested = autoNameMatch?.groupIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedGroupIdx(i);
                      setIsMatchApproved(true);
                      if (autoNameMatch?.groupIdx !== i) {
                        setMatchedSourceLabel('Kullanıcı Seçimi');
                      }
                    }}
                    className={`py-2 px-1 rounded-xl text-xs font-bold transition cursor-pointer truncate relative ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    } ${isAutoSuggested && !isSelected ? 'ring-2 ring-amber-400' : ''}`}
                  >
                    {settings.groupNames[i] || `${i + 1}. Grup`}
                  </button>
                );
              })}
            </div>

          </div>

          {/* KAYDET VE ONAYLA BUTONU */}
          <button
            type="button"
            disabled={!nameInput.trim()}
            onClick={handleConfirmAndSaveProfile}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              Onayla ve{' '}
              {settings.groupNames[selectedGroupIdx] || `${selectedGroupIdx + 1}. Grup`} İle
              Profili Kaydet
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );

  if (inlineMode) {
    return content;
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg max-h-[85vh] rounded-3xl border overflow-y-auto shadow-2xl p-4 md:p-5 cursor-default ${
          isLight ? 'bg-[#F8FAFC] border-slate-200 text-slate-900' : 'bg-[#0F172A] border-slate-800 text-white'
        }`}
      >
        {content}
      </div>
    </div>
  );
};
