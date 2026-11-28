import React, { useState, useMemo, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  AppRoleMode,
  AppSettings,
  AuthorizedAdminDoc,
  InstitutionUnitDoc,
  RefRecord,
  UserCloudProfileDoc,
} from '../types';
import { getInstitutionMeta } from '../services/institutionUnitService';
import { signInBureauWithGoogle, signOutBureau } from '../firebase';
import {
  isSamePersonNameTR,
  toISODate,
  verifyGoogleAccountMatchesPerson,
} from '../shiftEngine';
import { formatTitleCaseTR } from '../storage';
import { TURKISH_PROVINCES } from '../utils/weather';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Crown,
  FileText,
  LogIn,
  LogOut,
  MapPin,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';

interface FirstLaunchAuthScreenProps {
  settings: AppSettings;
  refHistory: RefRecord[];
  allUnits: InstitutionUnitDoc[];
  activeUnit: InstitutionUnitDoc | null;
  currentUser: User | null;
  myAdminDoc: AuthorizedAdminDoc | null;
  cloudUserProfile?: UserCloudProfileDoc | null;
  isSuperAdmin: boolean;
  isAuthorizedAdmin: boolean;
  isLight: boolean;
  onCompleteLogin: (params: {
    roleMode: AppRoleMode;
    selectedUnit: InstitutionUnitDoc | null;
    selectedCity?: string;
    groupIdx: number;
    workerName: string;
    localRefDate?: string;
    localRefType?: 'GUNDUZ' | 'AKSAM';
    openBureauCreator?: boolean;
    kvkkAccepted?: boolean;
  }) => void;
}

export const FirstLaunchAuthScreen: React.FC<FirstLaunchAuthScreenProps> = ({
  settings,
  refHistory,
  allUnits,
  activeUnit,
  currentUser,
  cloudUserProfile = null,
  isSuperAdmin,
  isAuthorizedAdmin,
  isLight,
  onCompleteLogin,
}) => {
  // Always default to 'personnel' (Personel Girişi) on initial launch
  const [selectedRole, setSelectedRole] = useState<AppRoleMode>('personnel');
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const swipeStartRef = React.useRef<{
    x: number;
    y: number;
    active: boolean;
    locked: 'x' | 'y' | null;
  } | null>(null);
  const didSwipeDragRef = React.useRef<boolean>(false);

  const finishRoleSwipe = () => {
    const state = swipeStartRef.current;
    if (!state || !state.active) return;
    if (state.locked === 'x') {
      if (selectedRole === 'personnel' && swipeOffset < -45) {
        setSelectedRole('admin');
        if (selectedCity === '__LOCAL__') {
          setSelectedCity('');
          setSelectedUnitId('');
        }
        setErrorMsg('');
      } else if (selectedRole === 'admin' && swipeOffset > 45) {
        setSelectedRole('personnel');
        setErrorMsg('');
      }
    }
    swipeStartRef.current = null;
    setIsSwiping(false);
    setSwipeOffset(0);
  };

  // Build list of provinces that have active registered institutions on the server
  const serverProvinces = useMemo(() => {
    const map = new Map<string, { city: string; count: number }>();
    allUnits.forEach((u) => {
      const rawCity = (u.city || 'Kütahya').trim();
      const key = rawCity.toLocaleLowerCase('tr-TR');
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { city: rawCity, count: 1 });
      }
    });
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (isSamePersonNameTR(a.city, 'Kütahya')) return -1;
      if (isSamePersonNameTR(b.city, 'Kütahya')) return 1;
      return a.city.localeCompare(b.city, 'tr');
    });
    return list;
  }, [allUnits]);

  const otherProvinces = useMemo(() => {
    return TURKISH_PROVINCES.filter(
      (p) => !serverProvinces.some((sp) => isSamePersonNameTR(sp.city, p.name))
    );
  }, [serverProvinces]);

  const hasSavedLocalLogin = Boolean(
    settings.onboardingCompleted &&
      (settings.activeUnitId || settings.activeWorkerName || settings.appRoleMode === 'admin')
  );

  // Step 1: Selected Province (İl) — empty ('') until user selects or saved login exists
  const [selectedCity, setSelectedCity] = useState<string>(() => {
    if (!hasSavedLocalLogin) return '';
    if (activeUnit?.city) return activeUnit.city;
    if (settings.activeUnitId) {
      const matched = allUnits.find((u) => u.id === settings.activeUnitId);
      if (matched?.city) return matched.city;
    }
    return settings.weatherCity || '';
  });

  // Step 2: Selected Institution Unit ID — empty ('') until user selects or saved login exists
  const [selectedUnitId, setSelectedUnitId] = useState<string>(() => {
    if (!hasSavedLocalLogin) return '';
    if (activeUnit?.id) return activeUnit.id;
    if (settings.activeUnitId) return settings.activeUnitId;
    return '';
  });

  // Step 3: Group Index — null until user selects or saved login exists
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | null>(() => {
    if (!hasSavedLocalLogin) return null;
    return typeof refHistory[0]?.myGroupIdx === 'number' ? refHistory[0].myGroupIdx : null;
  });

  // Step 4: Personnel Name — empty ('') until user selects or saved login exists
  const [workerName, setWorkerName] = useState<string>(() => {
    if (!hasSavedLocalLogin) return '';
    return settings.activeWorkerName || '';
  });

  const [localRefDate, setLocalRefDate] = useState<string>(() =>
    hasSavedLocalLogin && refHistory[0]?.refDate ? refHistory[0].refDate : toISODate(new Date())
  );
  const [localRefType, setLocalRefType] = useState<'GUNDUZ' | 'AKSAM'>(() =>
    hasSavedLocalLogin && refHistory[0]?.refType ? refHistory[0].refType : 'GUNDUZ'
  );

  // Mandatory KVKK & Legal Consent State
  const [kvkkAccepted, setKvkkAccepted] = useState<boolean>(() =>
    hasSavedLocalLogin ? Boolean(settings.kvkkAccepted) : false
  );
  const [showKvkkModal, setShowKvkkModal] = useState<boolean>(false);

  const [hasManuallyEditedForm, setHasManuallyEditedForm] = useState<boolean>(false);
  const [hasRestoredCloudProfile, setHasRestoredCloudProfile] = useState<boolean>(false);

  // If the user already saved their login previously (locally or in cloudUserProfile), restore their saved fields once units load
  useEffect(() => {
    if (hasManuallyEditedForm) return;

    // 1. Restore from local saved login when allUnits finishes loading
    if (hasSavedLocalLogin && allUnits.length > 0 && settings.activeUnitId) {
      const savedUnit = allUnits.find((u) => u.id === settings.activeUnitId);
      if (savedUnit) {
        if (!selectedCity) setSelectedCity(savedUnit.city || '');
        if (!selectedUnitId) setSelectedUnitId(savedUnit.id);
      }
    }

    // 2. Restore from Firestore cloudUserProfile if user previously completed login on this account
    if (cloudUserProfile && !hasRestoredCloudProfile) {
      const hasCloudData = Boolean(
        cloudUserProfile.activeUnitId ||
          cloudUserProfile.activeUnitCity ||
          cloudUserProfile.workerName
      );
      if (hasCloudData) {
        const matchedCloudUnit = cloudUserProfile.activeUnitId
          ? allUnits.find((u) => u.id === cloudUserProfile.activeUnitId)
          : undefined;

        const restoredCity =
          matchedCloudUnit?.city || cloudUserProfile.activeUnitCity || selectedCity;
        if (restoredCity) {
          setSelectedCity(restoredCity);
        }
        if (matchedCloudUnit?.id || cloudUserProfile.activeUnitId) {
          setSelectedUnitId(matchedCloudUnit?.id || cloudUserProfile.activeUnitId || '');
        }
        if (
          typeof cloudUserProfile.myGroupIdx === 'number' &&
          cloudUserProfile.myGroupIdx >= 0
        ) {
          setSelectedGroupIdx(cloudUserProfile.myGroupIdx);
        }
        if (cloudUserProfile.workerName) {
          setWorkerName(cloudUserProfile.workerName);
        }
        if (cloudUserProfile.kvkkAccepted) {
          setKvkkAccepted(true);
        }
        if (!allUnits.length && cloudUserProfile.activeUnitId) {
          // Wait for allUnits to load so matchedCloudUnit can resolve city name
          return;
        }
      }
      setHasRestoredCloudProfile(true);
    }
  }, [
    allUnits,
    hasSavedLocalLogin,
    hasManuallyEditedForm,
    hasRestoredCloudProfile,
    cloudUserProfile,
    settings.activeUnitId,
    selectedCity,
    selectedUnitId,
  ]);

  // Filter server units by Step 1 (selectedCity)
  const cityUnits = useMemo(() => {
    if (!selectedCity || selectedCity === '__LOCAL__') return [];
    return allUnits.filter((u) => isSamePersonNameTR(u.city || 'Kütahya', selectedCity));
  }, [allUnits, selectedCity]);

  const chosenUnit = useMemo(() => {
    if (!selectedCity || selectedCity === '__LOCAL__' || !selectedUnitId) return null;
    return cityUnits.find((u) => u.id === selectedUnitId) || null;
  }, [selectedCity, selectedUnitId, cityUnits]);

  const effectiveNumGroups = chosenUnit ? chosenUnit.numGroups : settings.numGroups;
  const effectiveGroupNames = chosenUnit ? chosenUnit.groupNames : settings.groupNames;
  const effectiveGroupMembers = chosenUnit ? chosenUnit.groupMembers : settings.groupMembers;

  const [errorMsg, setErrorMsg] = useState<string>('');
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [logoError, setLogoError] = useState<boolean>(false);

  // Personnel list for the selected group on the server
  const groupMemberList = useMemo(() => {
    if (selectedGroupIdx === null || selectedGroupIdx < 0) return [];
    const raw = effectiveGroupMembers[selectedGroupIdx] || '';
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [effectiveGroupMembers, selectedGroupIdx]);

  // Count members per group for clear display in Step 3
  const groupMemberCounts = useMemo(() => {
    return Array.from({ length: effectiveNumGroups }, (_, idx) => {
      const raw = effectiveGroupMembers[idx] || '';
      return raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean).length;
    });
  }, [effectiveNumGroups, effectiveGroupMembers]);

  useEffect(() => {
    if (selectedGroupIdx !== null && selectedGroupIdx >= effectiveNumGroups) {
      setSelectedGroupIdx(null);
    }
  }, [effectiveNumGroups, selectedGroupIdx]);

  // Verify that the signed-in Google account matches the selected personnel name
  const googleIdentityCheck = useMemo(
    () => verifyGoogleAccountMatchesPerson(workerName, currentUser),
    [workerName, currentUser]
  );

  // If the signed-in Google user matches a member inside the chosen institution, find them for 1-click selection
  const matchedMemberInUnit = useMemo(() => {
    if (!chosenUnit || !currentUser) return null;
    for (let gIdx = 0; gIdx < chosenUnit.numGroups; gIdx++) {
      const raw = chosenUnit.groupMembers[gIdx] || '';
      const members = raw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const found = members.find(
        (m) => verifyGoogleAccountMatchesPerson(m, currentUser).matched
      );
      if (found) {
        return {
          groupIdx: gIdx,
          groupName: chosenUnit.groupNames[gIdx] || `${gIdx + 1}. Grup`,
          name: found,
        };
      }
    }
    return null;
  }, [chosenUnit, currentUser]);

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setAuthBusy(true);
    try {
      await signInBureauWithGoogle();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err || '');
      if (raw.includes('popup-closed-by-user') || raw.includes('cancelled-popup-request')) {
        setErrorMsg('Google giriş penceresi kapatıldı.');
      } else {
        setErrorMsg('Google ile giriş yapılamadı. Lütfen tekrar deneyin.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setErrorMsg('');
    try {
      await signOutBureau();
    } catch {
      // ignore
    }
  };

  const handlePersonnelSubmit = () => {
    setErrorMsg('');
    const cleanName = formatTitleCaseTR(workerName.trim());

    if (!selectedCity) {
      setErrorMsg('Lütfen 1. adımda il seçimi yapın.');
      return;
    }

    if (selectedCity !== '__LOCAL__' && !chosenUnit) {
      setErrorMsg('Lütfen 2. adımda kurum seçimi yapın.');
      return;
    }

    if (selectedGroupIdx === null || selectedGroupIdx < 0) {
      setErrorMsg('Lütfen 3. adımda nöbet grubunuzu seçin.');
      return;
    }

    if (chosenUnit && groupMemberList.length > 0 && !cleanName) {
      setErrorMsg('Lütfen 4. adımda listeden personel adınızı seçin.');
      return;
    }

    if (!cleanName) {
      setErrorMsg('Lütfen personel adınızı seçin veya girin.');
      return;
    }

    if (!currentUser) {
      setErrorMsg(
        'Personel girişi için personel adınızı seçtikten sonra Google hesabınızla giriş yapmalısınız.'
      );
      return;
    }

    if (!verifyGoogleAccountMatchesPerson(cleanName, currentUser).matched) {
      const googleDisplay = isSuperAdmin
        ? currentUser.displayName || 'Google Hesabı'
        : currentUser.displayName || currentUser.email || 'Google Hesabı';
      setErrorMsg(
        `Güvenlik doğrulaması başarısız: Google hesap adınız ("${googleDisplay}") seçtiğiniz "${cleanName}" ismiyle eşleşmiyor. Lütfen kendi isminizi seçin veya kendi adınıza kayıtlı Google hesabıyla giriş yapın.`
      );
      return;
    }

    if (!kvkkAccepted) {
      setErrorMsg(
        'Devam etmek için KVKK Aydınlatma Metni, Veri Gizliliği ve Kullanım Koşullarını onaylamalısınız.'
      );
      return;
    }

    onCompleteLogin({
      roleMode: 'personnel',
      selectedUnit: chosenUnit,
      selectedCity: selectedCity !== '__LOCAL__' ? selectedCity : undefined,
      groupIdx: selectedGroupIdx,
      workerName: cleanName,
      localRefDate,
      localRefType,
      kvkkAccepted: true,
    });
  };

  const handleAdminSubmit = (openBureauCreator = false) => {
    setErrorMsg('');
    if (!selectedCity) {
      setErrorMsg('Lütfen 1. adımda il seçimi yapın.');
      return;
    }
    if (cityUnits.length > 0 && !chosenUnit) {
      setErrorMsg('Lütfen 2. adımda kurum seçimi yapın.');
      return;
    }
    if (!currentUser) {
      setErrorMsg(
        'Admin (İdari Büro) girişi için önce Google hesabınızla yönetici doğrulaması yapmalısınız.'
      );
      return;
    }
    if (!isAuthorizedAdmin) {
      setErrorMsg(
        'Bu Google hesabının Admin (İdari Büro) yetkisi bulunmuyor. Yetkili bir hesapla giriş yapın veya Personel girişini kullanın.'
      );
      return;
    }
    onCompleteLogin({
      roleMode: 'admin',
      selectedUnit: chosenUnit || null,
      selectedCity: selectedCity !== '__LOCAL__' ? selectedCity : undefined,
      groupIdx: matchedMemberInUnit?.groupIdx ?? (selectedGroupIdx ?? 0),
      workerName:
        matchedMemberInUnit?.name ||
        workerName.trim() ||
        settings.activeWorkerName ||
        cloudUserProfile?.workerName ||
        '',
      openBureauCreator,
      kvkkAccepted: true,
    });
  };

  const maskedAccountLabel = currentUser
    ? isSuperAdmin
      ? currentUser.displayName || 'Ana Yönetici Hesabı'
      : currentUser.displayName || currentUser.email || 'Google Hesabı'
    : '';

  const canEnterPersonnel =
    Boolean(selectedCity) &&
    (selectedCity === '__LOCAL__' || Boolean(chosenUnit)) &&
    selectedGroupIdx !== null &&
    selectedGroupIdx >= 0 &&
    Boolean(workerName.trim()) &&
    Boolean(currentUser) &&
    googleIdentityCheck.matched &&
    kvkkAccepted;

  const canEnterAdmin =
    Boolean(selectedCity) &&
    (cityUnits.length === 0 || Boolean(chosenUnit)) &&
    Boolean(currentUser) &&
    isAuthorizedAdmin;

  const inputClass = `w-full h-10 sm:h-11 px-2.5 rounded-xl border text-xs sm:text-sm font-semibold outline-none transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
    isLight
      ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-500'
      : 'bg-slate-950/90 border-slate-700/90 text-white focus:border-sky-400'
  }`;

  const labelClass = `block text-[11px] font-extrabold mb-1 truncate ${
    isLight ? 'text-slate-600' : 'text-slate-300'
  }`;

  return (
    <div
      className={`fixed inset-0 z-50 h-[100dvh] w-full overflow-y-auto flex flex-col items-center justify-center px-3.5 py-2.5 select-none ${
        isLight
          ? 'bg-slate-100 text-slate-900'
          : 'bg-[#090d16] text-slate-100'
      }`}
    >
      <div className="w-full max-w-md mx-auto my-auto flex flex-col gap-2.5">
        {/* Compact Brand Header */}
        <div className="flex items-center justify-center gap-2.5">
          {!logoError ? (
            <img
              src="/vardiya112logo.png"
              alt="Vardiya 112"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl border border-rose-500/40 object-cover shadow-md shrink-0"
            />
          ) : (
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-rose-600 text-white font-black text-base flex items-center justify-center shadow-md shrink-0">
              112
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-black tracking-tight leading-tight">
              Vardiya 112
            </h1>
            <p
              className={`text-[11px] truncate ${
                isLight ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              İl · Kurum · Grup · Personel Giriş Sistemi
            </p>
          </div>
        </div>

        {/* Role Segmented Switcher + Swipe Indicator */}
        <div className="flex flex-col gap-1.5">
          <div
            className={`grid grid-cols-2 gap-1.5 p-1 rounded-2xl border ${
              isLight
                ? 'bg-slate-200/80 border-slate-300/80'
                : 'bg-[#111726] border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedRole('personnel');
                setErrorMsg('');
              }}
              className={`h-9 sm:h-10 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                selectedRole === 'personnel'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserCheck className="w-4 h-4 shrink-0" />
              <span>Personel Girişi</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedRole('admin');
                if (selectedCity === '__LOCAL__') {
                  setSelectedCity('');
                  setSelectedUnitId('');
                }
                setErrorMsg('');
              }}
              className={`h-9 sm:h-10 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                selectedRole === 'admin'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isSuperAdmin ? (
                <Crown className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              )}
              <span>Admin (İdari Büro)</span>
            </button>
          </div>

          {/* Page Dots & Swipe Hint */}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedRole('personnel');
                setErrorMsg('');
              }}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                selectedRole === 'personnel'
                  ? 'w-5 bg-sky-500'
                  : isLight
                  ? 'w-1.5 bg-slate-300'
                  : 'w-1.5 bg-slate-700'
              }`}
              aria-label="Personel Girişi Sayfası"
            />
            <span
              className={`text-[10px] font-bold tracking-wide ${
                isLight ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              ↔ Kaydırarak geçiş yapabilirsiniz
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedRole('admin');
                if (selectedCity === '__LOCAL__') {
                  setSelectedCity('');
                  setSelectedUnitId('');
                }
                setErrorMsg('');
              }}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                selectedRole === 'admin'
                  ? 'w-5 bg-rose-500'
                  : isLight
                  ? 'w-1.5 bg-slate-300'
                  : 'w-1.5 bg-slate-700'
              }`}
              aria-label="Admin Girişi Sayfası"
            />
          </div>
        </div>

        {/* Swipeable 2-Page Login Container (Page 1: Personel Girişi | Page 2: Admin İdari Büro) */}
        <div
          className={`rounded-2xl border shadow-lg overflow-hidden ${
            isLight
              ? 'bg-white border-slate-200'
              : 'bg-[#111726] border-slate-800'
          }`}
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            swipeStartRef.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
              active: true,
              locked: null,
            };
            didSwipeDragRef.current = false;
          }}
          onTouchMove={(e) => {
            const state = swipeStartRef.current;
            if (!state || !state.active || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - state.x;
            const dy = e.touches[0].clientY - state.y;

            if (!state.locked) {
              if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
              state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }

            if (state.locked === 'x') {
              didSwipeDragRef.current = true;
              setIsSwiping(true);
              if (
                (selectedRole === 'personnel' && dx > 0) ||
                (selectedRole === 'admin' && dx < 0)
              ) {
                setSwipeOffset(dx * 0.25);
              } else {
                setSwipeOffset(dx);
              }
            }
          }}
          onTouchEnd={finishRoleSwipe}
          onTouchCancel={finishRoleSwipe}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest('select, input, textarea, button')) return;
            swipeStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              active: true,
              locked: null,
            };
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
              if (
                (selectedRole === 'personnel' && dx > 0) ||
                (selectedRole === 'admin' && dx < 0)
              ) {
                setSwipeOffset(dx * 0.25);
              } else {
                setSwipeOffset(dx);
              }
            }
          }}
          onMouseUp={finishRoleSwipe}
          onMouseLeave={finishRoleSwipe}
          onClickCapture={(e) => {
            if (didSwipeDragRef.current) {
              e.stopPropagation();
              e.preventDefault();
              didSwipeDragRef.current = false;
            }
          }}
        >
          {errorMsg && (
            <div className="mx-3 sm:mx-4 mt-3 px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-400 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div
            className={`flex w-[200%] items-start will-change-transform ${
              isSwiping ? '' : 'transition-transform duration-300 ease-out'
            }`}
            style={{
              transform: `translate3d(calc(${
                selectedRole === 'personnel' ? '0%' : '-50%'
              } + ${swipeOffset}px), 0, 0)`,
            }}
          >
            {/* PAGE 1: PERSONEL GİRİŞİ (Default Initial Main Screen) */}
            <div className="w-1/2 shrink-0 p-3 sm:p-4 space-y-2.5">
              {/* Step Flow Indicator Strip — Personnel */}
              <div
                className={`grid grid-cols-5 gap-1 p-1 rounded-xl border text-[9.5px] sm:text-[10px] font-black text-center ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : 'bg-slate-950/70 border-slate-800 text-slate-400'
                }`}
              >
                <div
                  className={`py-1 px-0.5 rounded-lg truncate ${
                    selectedCity
                      ? isLight
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-sky-500/20 text-sky-300'
                      : ''
                  }`}
                >
                  1. İl
                </div>
                <div
                  className={`py-1 px-0.5 rounded-lg truncate ${
                    chosenUnit || selectedCity === '__LOCAL__'
                      ? isLight
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-sky-500/20 text-sky-300'
                      : ''
                  }`}
                >
                  2. Kurum
                </div>
                <div
                  className={`py-1 px-0.5 rounded-lg truncate ${
                    selectedGroupIdx !== null && selectedGroupIdx >= 0
                      ? isLight
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-sky-500/20 text-sky-300'
                      : ''
                  }`}
                >
                  3. Grup
                </div>
                <div
                  className={`py-1 px-0.5 rounded-lg truncate ${
                    workerName.trim()
                      ? isLight
                        ? 'bg-sky-100 text-sky-800'
                        : 'bg-sky-500/20 text-sky-300'
                      : ''
                  }`}
                >
                  4. Kişi
                </div>
                <div
                  className={`py-1 px-0.5 rounded-lg truncate ${
                    currentUser && googleIdentityCheck.matched && kvkkAccepted
                      ? isLight
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-emerald-500/20 text-emerald-300'
                      : currentUser && !googleIdentityCheck.matched
                      ? isLight
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-rose-500/20 text-rose-300'
                      : ''
                  }`}
                >
                  5. Doğrula
                </div>
              </div>

              <div className="space-y-2.5">
              {/* Row 1: Step 1 (İl Seçimi) & Step 2 (Seçilen İldeki Kurumlar) */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <label className={labelClass}>1. İl Seçimi</label>
                  <select
                    value={selectedCity}
                    onChange={(e) => {
                      const nextCity = e.target.value;
                      setHasManuallyEditedForm(true);
                      setSelectedCity(nextCity);
                      setSelectedUnitId('');
                      setSelectedGroupIdx(null);
                      setWorkerName('');
                      setErrorMsg('');
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">İl seçin...</option>
                    {serverProvinces.length > 0 && (
                      <optgroup label="Sunucuda Kayıtlı İller">
                        {serverProvinces.map((sp) => (
                          <option key={`srv-${sp.city}`} value={sp.city}>
                            📍 {sp.city} ({sp.count})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Tüm İller">
                      {otherProvinces.map((p) => (
                        <option key={`prov-${p.name}`} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="col-span-7">
                  <label className={labelClass}>
                    {selectedCity ? `2. ${selectedCity} Kurumları` : '2. Kurum Seçimi'}
                  </label>
                  {!selectedCity ? (
                    <select disabled value="" className={inputClass}>
                      <option value="">Önce il seçin...</option>
                    </select>
                  ) : cityUnits.length > 0 ? (
                    <select
                      value={selectedUnitId}
                      onChange={(e) => {
                        setHasManuallyEditedForm(true);
                        setSelectedUnitId(e.target.value);
                        setSelectedGroupIdx(null);
                        setWorkerName('');
                        setErrorMsg('');
                      }}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">Kurum seçin...</option>
                      {cityUnits.map((u) => {
                        const meta = getInstitutionMeta(u.institutionType);
                        return (
                          <option key={u.id} value={u.id}>
                            {meta.emoji} {u.name}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <div
                      className={`h-10 sm:h-11 px-2.5 rounded-xl border flex items-center justify-between gap-1 text-[11px] font-bold ${
                        isLight
                          ? 'bg-amber-50 border-amber-200 text-amber-800'
                          : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                      }`}
                    >
                      <span className="truncate">Bu ilde kayıtlı kurum yok</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Step 3 (Nöbet Grubu) & Step 4 (Personel Seçimi) — Always visible, starts empty */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <label className={labelClass}>3. Nöbet Grubu</label>
                  <select
                    disabled={!chosenUnit}
                    value={selectedGroupIdx !== null ? String(selectedGroupIdx) : ''}
                    onChange={(e) => {
                      setHasManuallyEditedForm(true);
                      const val = e.target.value;
                      if (val === '') {
                        setSelectedGroupIdx(null);
                        setWorkerName('');
                      } else {
                        setSelectedGroupIdx(parseInt(val, 10));
                        setWorkerName('');
                      }
                      setErrorMsg('');
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">
                      {!chosenUnit ? 'Önce kurum seçin...' : 'Grup seçin...'}
                    </option>
                    {chosenUnit &&
                      Array.from({ length: effectiveNumGroups }, (_, idx) => {
                        const gName = effectiveGroupNames[idx] || `${idx + 1}. Grup`;
                        const cnt = groupMemberCounts[idx] || 0;
                        return (
                          <option key={idx} value={String(idx)}>
                            {gName} {cnt > 0 ? `(${cnt})` : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div className="col-span-7">
                  <label className={labelClass}>
                    {selectedGroupIdx !== null && selectedGroupIdx >= 0
                      ? `4. Personel (${
                          effectiveGroupNames[selectedGroupIdx] || `${selectedGroupIdx + 1}. Grup`
                        })`
                      : '4. Personel Adı'}
                  </label>
                  {selectedGroupIdx === null || !chosenUnit ? (
                    <select disabled value="" className={inputClass}>
                      <option value="">Önce grup seçin...</option>
                    </select>
                  ) : groupMemberList.length > 0 ? (
                    <select
                      value={workerName}
                      onChange={(e) => {
                        setHasManuallyEditedForm(true);
                        setWorkerName(e.target.value);
                        setErrorMsg('');
                      }}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">Personel seçin...</option>
                      {groupMemberList.map((m) => (
                        <option key={`member-${selectedGroupIdx}-${m}`} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={workerName}
                      onChange={(e) => {
                        setHasManuallyEditedForm(true);
                        setWorkerName(e.target.value);
                        setErrorMsg('');
                      }}
                      placeholder="Adınız Soyadınız"
                      className={inputClass}
                    />
                  )}
                </div>
              </div>

              {/* Active selection summary badge (only shown once user has made selections) */}
              {(chosenUnit || workerName.trim()) && (
                <div
                  className={`px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-2 text-[11px] ${
                    isLight
                      ? 'bg-sky-50/80 border-sky-200 text-sky-900'
                      : 'bg-sky-950/25 border-sky-500/25 text-sky-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="font-bold truncate">
                      {chosenUnit ? `${chosenUnit.city} · ${chosenUnit.name}` : selectedCity}
                    </span>
                  </div>
                  {workerName.trim() && (
                    <span className="font-extrabold text-emerald-400 shrink-0 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {workerName}
                    </span>
                  )}
                </div>
              )}

              {/* Step 5: Mandatory Google Sign-In & Real Name Identity Matching for Personnel */}
              <div>
                <label className={labelClass}>
                  5. Google Hesabı ile Kimlik Eşleştirme (Zorunlu)
                </label>
                {currentUser ? (
                  googleIdentityCheck.matched ? (
                    <div
                      className={`min-h-[42px] px-3 py-1.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        isLight
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-emerald-950/30 border-emerald-500/35 text-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        <div className="min-w-0">
                          <div className="font-extrabold truncate">
                            Kimlik Eşleşti · {workerName}
                          </div>
                          <div className="text-[10.5px] opacity-80 truncate">
                            Google: {maskedAccountLabel}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleGoogleSignOut()}
                        className="text-[11px] font-bold opacity-80 hover:opacity-100 shrink-0 flex items-center gap-1 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Çıkış</span>
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`p-2.5 rounded-xl border space-y-2 text-xs ${
                        isLight
                          ? 'bg-rose-50 border-rose-300 text-rose-900'
                          : 'bg-rose-950/35 border-rose-500/45 text-rose-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-extrabold text-rose-400">
                              {workerName.trim()
                                ? 'Google Hesap İsmi Eşleşmiyor'
                                : 'Personel Adınızı Seçin'}
                            </div>
                            <div className="text-[11px] leading-snug opacity-90">
                              Google Hesabı: <strong>{maskedAccountLabel}</strong>
                              <br />
                              Seçili Personel: <strong>{workerName || 'Henüz Seçilmedi'}</strong>
                            </div>
                            <p className="text-[10.5px] leading-snug opacity-80">
                              Başka bir personelin verilerini görmek için farklı Google hesabı
                              kullanılamaz. Kendi adınızı seçin veya kendi Google hesabınızla giriş
                              yapın.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleGoogleSignOut()}
                          className="text-[11px] font-extrabold text-rose-300 hover:text-white shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/20 cursor-pointer"
                        >
                          <LogOut className="w-3 h-3" />
                          <span>Değiştir</span>
                        </button>
                      </div>

                      {matchedMemberInUnit && (
                        <button
                          type="button"
                          onClick={() => {
                            setHasManuallyEditedForm(true);
                            setSelectedGroupIdx(matchedMemberInUnit.groupIdx);
                            setWorkerName(matchedMemberInUnit.name);
                            setErrorMsg('');
                          }}
                          className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            Kendi Kaydımı Seç: {matchedMemberInUnit.name} (
                            {matchedMemberInUnit.groupName})
                          </span>
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="space-y-1">
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={() => void handleGoogleSignIn()}
                      className={`w-full h-10 sm:h-11 px-3 rounded-xl border text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap ${
                        isLight
                          ? 'bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-800'
                          : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-100'
                      }`}
                    >
                      <LogIn className="w-4 h-4 text-sky-400 shrink-0" />
                      <span className="truncate">
                        {authBusy
                          ? 'Google bağlantısı açılıyor...'
                          : 'Google ile Giriş Yap & İsmi Doğrula'}
                      </span>
                    </button>
                    <p
                      className={`text-[10.5px] leading-snug px-1 ${
                        isLight ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      Güvenlik gereği Google hesabınızdaki ad soyad, seçtiğiniz personel ismiyle
                      eşleşmelidir.
                    </p>
                  </div>
                )}
              </div>

              {/* Mandatory KVKK & Legal Consents Checkbox */}
              <div
                className={`p-2.5 rounded-xl border flex items-start gap-2.5 ${
                  kvkkAccepted
                    ? isLight
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-emerald-950/20 border-emerald-500/30'
                    : isLight
                    ? 'bg-slate-50 border-slate-300'
                    : 'bg-slate-950/70 border-slate-700/80'
                }`}
              >
                <input
                  id="kvkk-consent-checkbox"
                  type="checkbox"
                  checked={kvkkAccepted}
                  onChange={(e) => {
                    setKvkkAccepted(e.target.checked);
                    setErrorMsg('');
                  }}
                  className="mt-0.5 w-4 h-4 rounded accent-sky-600 cursor-pointer shrink-0"
                />
                <div className="text-[11px] leading-snug min-w-0 flex-1">
                  <label
                    htmlFor="kvkk-consent-checkbox"
                    className={`font-semibold cursor-pointer ${
                      isLight ? 'text-slate-700' : 'text-slate-300'
                    }`}
                  >
                    6698 sayılı <strong>KVKK Aydınlatma Metni</strong>,{' '}
                    <strong>Açık Rıza</strong> ve <strong>Kullanım Koşullarını</strong> okudum,
                    onaylıyorum.
                  </label>{' '}
                  <button
                    type="button"
                    onClick={() => setShowKvkkModal(true)}
                    className="inline-flex items-center gap-0.5 text-sky-400 hover:text-sky-300 font-extrabold underline cursor-pointer ml-1"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Metni Oku</span>
                  </button>
                </div>
              </div>

              {/* Primary CTA */}
              <button
                type="button"
                disabled={!canEnterPersonnel}
                onClick={handlePersonnelSubmit}
                className="w-full h-11 rounded-xl bg-sky-600 hover:bg-sky-500 active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-md shadow-sky-600/20 transition cursor-pointer whitespace-nowrap"
              >
                <span>
                  {!selectedCity
                    ? '1. Adımda İl Seçin'
                    : selectedCity !== '__LOCAL__' && !chosenUnit
                    ? '2. Adımda Kurum Seçin'
                    : selectedGroupIdx === null || selectedGroupIdx < 0
                    ? '3. Adımda Nöbet Grubunu Seçin'
                    : !workerName.trim()
                    ? '4. Adımda Personel Adınızı Seçin'
                    : !currentUser
                    ? '5. Adımda Google ile Giriş Yapın'
                    : !googleIdentityCheck.matched
                    ? 'Google Hesap İsmi Eşleşmiyor'
                    : !kvkkAccepted
                    ? 'KVKK Onayını İşaretleyin'
                    : 'Personel Olarak Giriş Yap'}
                </span>
                {canEnterPersonnel && <ArrowRight className="w-4 h-4 shrink-0" />}
              </button>
              </div>
            </div>

            {/* PAGE 2: ADMIN (İDARİ BÜRO) GİRİŞİ */}
            <div className="w-1/2 shrink-0 p-3 sm:p-4 space-y-3">
              {/* Step Flow Indicator Strip — Admin */}
              <div
                className={`grid grid-cols-3 gap-1 p-1 rounded-xl border text-[10px] font-black text-center ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : 'bg-slate-950/70 border-slate-800 text-slate-400'
                }`}
              >
                <div
                  className={`py-1 px-1 rounded-lg truncate ${
                    selectedCity
                      ? isLight
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-rose-500/20 text-rose-300'
                      : ''
                  }`}
                >
                  1. İl Seçimi
                </div>
                <div
                  className={`py-1 px-1 rounded-lg truncate ${
                    chosenUnit
                      ? isLight
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-rose-500/20 text-rose-300'
                      : ''
                  }`}
                >
                  2. Kurum Seçimi
                </div>
                <div
                  className={`py-1 px-1 rounded-lg truncate ${
                    currentUser && isAuthorizedAdmin
                      ? isLight
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-emerald-500/20 text-emerald-300'
                      : ''
                  }`}
                >
                  3. Yönetici
                </div>
              </div>

              <div className="space-y-3">
                {/* Row 1: Step 1 (İl Seçimi) & Step 2 (Seçilen İldeki Kurumlar) */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <label className={labelClass}>1. İl Seçimi</label>
                  <select
                    value={selectedCity === '__LOCAL__' ? '' : selectedCity}
                    onChange={(e) => {
                      setHasManuallyEditedForm(true);
                      setSelectedCity(e.target.value);
                      setSelectedUnitId('');
                      setErrorMsg('');
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">İl seçin...</option>
                    {serverProvinces.length > 0 && (
                      <optgroup label="Sunucuda Kayıtlı İller">
                        {serverProvinces.map((sp) => (
                          <option key={`adm-srv-${sp.city}`} value={sp.city}>
                            📍 {sp.city} ({sp.count})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Tüm İller">
                      {otherProvinces.map((p) => (
                        <option key={`adm-prov-${p.name}`} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="col-span-7">
                  <label className={labelClass}>
                    {selectedCity && selectedCity !== '__LOCAL__'
                      ? `2. ${selectedCity} Kurumları`
                      : '2. Kurum Seçimi'}
                  </label>
                  {!selectedCity || selectedCity === '__LOCAL__' ? (
                    <select disabled value="" className={inputClass}>
                      <option value="">Önce il seçin...</option>
                    </select>
                  ) : cityUnits.length > 0 ? (
                    <select
                      value={selectedUnitId}
                      onChange={(e) => {
                        setHasManuallyEditedForm(true);
                        setSelectedUnitId(e.target.value);
                        setErrorMsg('');
                      }}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">Kurum seçin...</option>
                      {cityUnits.map((u) => {
                        const meta = getInstitutionMeta(u.institutionType);
                        return (
                          <option key={u.id} value={u.id}>
                            {meta.emoji} {u.name}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <div
                      className={`h-10 sm:h-11 px-3 rounded-xl border flex items-center text-[11px] font-bold ${
                        isLight
                          ? 'bg-slate-100 border-slate-300 text-slate-600'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      Yeni Kurum Oluşturulabilir
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Mandatory Google Admin Auth Row */}
              <div>
                <label className={labelClass}>3. Yönetici Hesabı Doğrulama (Zorunlu)</label>
                {currentUser ? (
                  <div
                    className={`min-h-[42px] px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                      isAuthorizedAdmin
                        ? isLight
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-emerald-950/35 border-emerald-500/35 text-emerald-300'
                        : isLight
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-rose-950/35 border-rose-500/35 text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold truncate">
                          {isSuperAdmin
                            ? 'Ana Yönetici Doğrulandı'
                            : isAuthorizedAdmin
                            ? 'Kurum Admini Doğrulandı'
                            : 'Yönetici Yetkisi Bulunmuyor'}
                        </div>
                        {!isSuperAdmin && (
                          <div className="text-[11px] opacity-80 truncate">
                            {maskedAccountLabel}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleGoogleSignOut()}
                      className="text-[11px] font-bold opacity-80 hover:opacity-100 shrink-0 flex items-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Çıkış</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void handleGoogleSignIn()}
                    className={`w-full h-11 px-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap ${
                      isLight
                        ? 'bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-800'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-100'
                    }`}
                  >
                    <LogIn className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      {authBusy ? 'Giriş Yapılıyor...' : 'Google ile Yönetici Doğrula'}
                    </span>
                  </button>
                )}
              </div>

              {/* Primary Admin Entry CTA (Strictly gated by selection + Google Admin verification) */}
              <div className="space-y-1.5 pt-0.5">
                <button
                  type="button"
                  disabled={!canEnterAdmin}
                  onClick={() => handleAdminSubmit(false)}
                  className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-md shadow-rose-600/20 transition cursor-pointer whitespace-nowrap"
                >
                  <span>
                    {!selectedCity || selectedCity === '__LOCAL__'
                      ? '1. Adımda İl Seçin'
                      : cityUnits.length > 0 && !chosenUnit
                      ? '2. Adımda Kurum Seçin'
                      : !currentUser
                      ? '3. Adımda Google ile Doğrulayın'
                      : !isAuthorizedAdmin
                      ? 'Yetkili Yönetici Hesabı Gerekli'
                      : 'Admin (İdari Büro) Girişi'}
                  </span>
                  {canEnterAdmin && (
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  )}
                </button>

                {canEnterAdmin && (
                  <button
                    type="button"
                    onClick={() => handleAdminSubmit(true)}
                    className={`w-full h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                      isLight
                        ? 'text-slate-600 hover:bg-slate-100'
                        : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>İdari Büro Yönetim Panelini Aç</span>
                  </button>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KVKK AYDINLATMA METNİ & KULLANIM KOŞULLARI MODALI */}
      {showKvkkModal && (
        <div
          onClick={() => setShowKvkkModal(false)}
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-xs flex items-center justify-center p-3.5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md max-h-[82dvh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
              isLight
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-[#101726] border-slate-700 text-slate-100'
            }`}
          >
            <div
              className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                <h2 className="text-xs sm:text-sm font-black truncate">
                  KVKK Aydınlatma Metni &amp; Kullanım Koşulları
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowKvkkModal(false)}
                className="w-7 h-7 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs leading-relaxed">
              <div className="space-y-1">
                <h3 className="font-extrabold text-sky-400">
                  1. 6698 Sayılı KVKK Aydınlatma Metni
                </h3>
                <p className={isLight ? 'text-slate-600' : 'text-slate-300'}>
                  Vardiya 112 uygulaması kapsamında Google hesabınız üzerinden sağlanan temel kimlik
                  bilgileri (ad, e-posta, kullanıcı kimliği) ile seçtiğiniz il, kurum, nöbet grubu,
                  personel adı ve oluşturduğunuz bireysel izin/nöbet değişimi/not kayıtları yalnızca
                  nöbet çizelgesi takibi, kurum içi vardiya senkronizasyonu ve kimlik doğrulama
                  amacıyla işlenmektedir.
                </p>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-sky-400">
                  2. Açık Rıza ve Veri Gizliliği
                </h3>
                <p className={isLight ? 'text-slate-600' : 'text-slate-300'}>
                  Kişisel vardiya notlarınız, izin ve nöbet değişimi talepleriniz yalnızca seçili
                  personel hesabınıza özel olarak ayrıştırılır ve yetkili kurum idari bürosu
                  onay süreçleri dışında üçüncü kişi veya ticari kuruluşlarla paylaşılmaz. 6698
                  sayılı Kanun&apos;un 11. maddesi kapsamındaki bilgi talep etme, düzeltme ve
                  silme haklarınız saklıdır.
                </p>
              </div>

              <div className="space-y-1">
                <h3 className="font-extrabold text-sky-400">
                  3. Kullanım Koşulları ve Sorumluluk
                </h3>
                <p className={isLight ? 'text-slate-600' : 'text-slate-300'}>
                  Uygulamada yer alan vardiya, icap ve nöbet değişimi kayıtları planlama ve
                  bilgilendirme kolaylığı sağlar. Resmi nöbet listelerinde kurum idari bürosunun
                  onaylı çizelgeleri esas alınır. Kullanıcı, yalnızca kendi adına doğru personel
                  seçimi yaparak işlem gerçekleştirmeyi kabul eder.
                </p>
              </div>
            </div>

            <div
              className={`px-4 py-3 border-t flex items-center justify-end gap-2 ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => setShowKvkkModal(false)}
                className={`px-3 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                  isLight
                    ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => {
                  setKvkkAccepted(true);
                  setErrorMsg('');
                  setShowKvkkModal(false);
                }}
                className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold cursor-pointer"
              >
                Okudum, Onaylıyorum
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
