import React, { useEffect, useRef, useState } from 'react';
import {
  FIREBASE_PROJECT_ID,
  getLastGoogleIdToken,
  GOOGLE_OAUTH_CLIENT_ID,
  signInBureauWithGoogle,
  signInWithGoogleIdToken,
} from '../firebase';
import {
  DEFAULT_CLOUD_API_BASE,
  getCustomApiBaseUrl,
  isCapacitorNative,
  openExternalSystemUrl,
  setCustomApiBaseUrl,
} from '../utils/nativeBridge';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LogIn,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            context?: 'signin' | 'signup' | 'use';
            ux_mode?: 'popup' | 'redirect';
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
              locale?: string;
            }
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface VardiyaGoogleAuthCardProps {
  isLight: boolean;
  compact?: boolean;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export const VardiyaGoogleAuthCard: React.FC<VardiyaGoogleAuthCardProps> = ({
  isLight,
  compact = false,
  onSuccess,
  onError,
}) => {
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string>('');
  const [showBrandingGuide, setShowBrandingGuide] = useState<boolean>(false);
  const [showAndroidBridge, setShowAndroidBridge] = useState<boolean>(() => isCapacitorNative());
  const [idTokenInput, setIdTokenInput] = useState<string>('');
  const [copiedBrandName, setCopiedBrandName] = useState<boolean>(false);
  const [copiedBridgeToken, setCopiedBridgeToken] = useState<boolean>(false);
  const [customServerUrl, setCustomServerUrl] = useState<string>(() => getCustomApiBaseUrl());
  const [savedServerBadge, setSavedServerBadge] = useState<boolean>(false);
  const [gisReady, setGisReady] = useState<boolean>(false);

  const gisButtonContainerRef = useRef<HTMLDivElement | null>(null);
  const isNativeApk = isCapacitorNative();

  const reportError = (msg: string) => {
    setLocalError(msg);
    if (onError) onError(msg);
  };

  const formatFriendlyAuthError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (raw.includes('auth/popup-closed-by-user') || raw.includes('auth/cancelled-popup-request')) {
      return 'Google giriş penceresi kapatıldı. Lütfen tekrar deneyin.';
    }
    if (raw.includes('auth/popup-blocked')) {
      return 'Açılır pencere engellendi. Aşağıdaki doğrudan Google butonunu veya Android APK Giriş Köprüsünü kullanabilirsiniz.';
    }
    if (
      raw.includes('auth/unauthorized-domain') ||
      raw.includes('auth/operation-not-supported-in-this-environment') ||
      raw.includes('disallowed_useragent')
    ) {
      setShowAndroidBridge(true);
      return 'Android WebView güvenlik kısıtlaması algılandı. Aşağıdaki "Android APK Giriş Köprüsü" ile tek dokunuşla giriş yapabilirsiniz.';
    }
    return raw || 'Giriş yapılırken bir hata oluştu.';
  };

  // Load Google Identity Services (GIS) script so users can sign in directly with
  // Vardiya 112 branding without redirecting through *.firebaseapp.com/__/auth/handler
  useEffect(() => {
    if (!GOOGLE_OAUTH_CLIENT_ID) return;

    let cancelled = false;

    const initGis = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          context: 'signin',
          ux_mode: 'popup',
          auto_select: false,
          callback: async (response) => {
            if (!response?.credential) return;
            setAuthLoading(true);
            setLocalError('');
            try {
              await signInWithGoogleIdToken(response.credential);
              if (onSuccess) onSuccess();
            } catch (err) {
              reportError(formatFriendlyAuthError(err));
            } finally {
              setAuthLoading(false);
            }
          },
        });

        if (gisButtonContainerRef.current) {
          gisButtonContainerRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(gisButtonContainerRef.current, {
            type: 'standard',
            theme: isLight ? 'outline' : 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 280,
            locale: 'tr',
          });
        }
        setGisReady(true);
      } catch {
        // Fallback to standard Firebase popup button
      }
    };

    if (window.google?.accounts?.id) {
      initGis();
      return () => {
        cancelled = true;
      };
    }

    const existingScript = document.getElementById('google-gsi-client-script') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', initGis);
      return () => {
        cancelled = true;
        existingScript.removeEventListener('load', initGis);
      };
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-client-script';
    script.src = 'https://accounts.google.com/gsi/client?hl=tr';
    script.async = true;
    script.defer = true;
    script.onload = initGis;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [isLight]);

  const handlePopupLogin = async () => {
    setLocalError('');
    setAuthLoading(true);
    try {
      await signInBureauWithGoogle();
      if (onSuccess) onSuccess();
    } catch (err) {
      reportError(formatFriendlyAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleTokenBridgeLogin = async () => {
    if (!idTokenInput.trim()) {
      reportError('Lütfen kopyaladığınız Vardiya 112 Google Giriş Anahtarını yapıştırın.');
      return;
    }
    setLocalError('');
    setAuthLoading(true);
    try {
      await signInWithGoogleIdToken(idTokenInput.trim());
      setIdTokenInput('');
      if (onSuccess) onSuccess();
    } catch (err) {
      reportError(formatFriendlyAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCopyBrandName = async () => {
    try {
      await navigator.clipboard.writeText('Vardiya 112');
      setCopiedBrandName(true);
      setTimeout(() => setCopiedBrandName(false), 2500);
    } catch {
      // ignore
    }
  };

  const handleSaveServerUrl = () => {
    setCustomApiBaseUrl(customServerUrl);
    setSavedServerBadge(true);
    setTimeout(() => setSavedServerBadge(false), 2500);
  };

  const existingBridgeToken = getLastGoogleIdToken();

  return (
    <div
      className={`rounded-2xl border transition ${
        compact ? 'p-3.5 space-y-3' : 'p-4 sm:p-5 space-y-4'
      } ${
        isLight
          ? 'bg-slate-50/95 border-slate-200 text-slate-800'
          : 'bg-slate-900/90 border-slate-800 text-slate-100'
      }`}
    >
      {/* Branded Vardiya 112 Identity Header */}
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-rose-500/60 bg-slate-950 shadow-lg flex items-center justify-center">
            <img
              src="/vardiya112logo.png"
              alt="Vardiya 112"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow">
            <ShieldCheck className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-black uppercase tracking-wider">
            <span>VARDİYA 112 RESMİ BULUT SUNUCUSU</span>
          </div>
          <h3 className="text-sm sm:text-base font-black">
            Vardiya 112 — Ana Yönetici &amp; Kurum Admini Girişi
          </h3>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
            Yalnızca <strong>Ana Yönetici</strong> ve yetkilendirdiği{' '}
            <strong>Kurum Adminleri</strong> resmi nöbet çizelgesi, izin, icap ve vardiya verisi
            yayınlayabilir.
          </p>
        </div>
      </div>

      {localError && (
        <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px] font-semibold text-center">
          {localError}
        </div>
      )}

      {/* Primary Vardiya 112 Google Sign-In Controls */}
      <div className="flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={handlePopupLogin}
          disabled={authLoading}
          className="w-full max-w-xs py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-rose-950/30 transition cursor-pointer"
        >
          <LogIn className="w-4 h-4 shrink-0" />
          <span>
            {authLoading ? 'Vardiya 112 Girişi Yapılıyor...' : 'Vardiya 112 — Google ile Giriş Yap'}
          </span>
        </button>

        {/* Direct Google Identity Services (GIS) Button - avoids firebaseapp.com redirect handler */}
        <div
          ref={gisButtonContainerRef}
          className={`min-h-[40px] flex items-center justify-center ${gisReady ? '' : 'hidden'}`}
        />
      </div>

      {/* Helper Toggle Buttons: 1) OAuth Brand Name "Vardiya 112" Fix, 2) Android APK Server & Login Bridge */}
      <div className="pt-2 border-t border-slate-700/40 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setShowBrandingGuide((prev) => !prev)}
          className={`px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold border flex items-center gap-1.5 transition cursor-pointer ${
            showBrandingGuide
              ? 'bg-indigo-600 text-white border-indigo-400'
              : isLight
              ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Google Ekranında &quot;Vardiya 112&quot; Adı Ayarı</span>
        </button>

        <button
          type="button"
          onClick={() => setShowAndroidBridge((prev) => !prev)}
          className={`px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold border flex items-center gap-1.5 transition cursor-pointer ${
            showAndroidBridge
              ? 'bg-emerald-600 text-white border-emerald-400'
              : isLight
              ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            Android APK Giriş &amp; Sunucu Köprüsü {isNativeApk ? '(APK Aktif)' : ''}
          </span>
        </button>
      </div>

      {/* PANEL 1: How to change "Firebase App / project-..." to "Vardiya 112" in Google OAuth Popup */}
      {showBrandingGuide && (
        <div
          className={`p-3.5 rounded-2xl border text-left space-y-2.5 text-[11px] leading-relaxed ${
            isLight
              ? 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
              : 'bg-indigo-950/40 border-indigo-500/40 text-indigo-100'
          }`}
        >
          <div className="font-black text-xs flex items-center justify-between gap-2">
            <span>🏷️ Google Giriş Penceresindeki İsmi &quot;Vardiya 112&quot; Yapma</span>
            <button
              type="button"
              onClick={handleCopyBrandName}
              className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-extrabold inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              {copiedBrandName ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>Kopyalandı</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>&quot;Vardiya 112&quot; Kopyala</span>
                </>
              )}
            </button>
          </div>

          <p className="opacity-90">
            Google hesap seçme penceresinde otomatik oluşturulan{' '}
            <code className="px-1 py-0.5 rounded bg-black/20 font-mono text-[10px]">
              Firebase App / {FIREBASE_PROJECT_ID}
            </code>{' '}
            yazısını Google güvenlik kuralları gereği yalnızca proje sahibi (
            <strong>Ana Yönetici</strong>) aşağıdaki 2 resmi Google sayfasından{' '}
            <strong>Vardiya 112</strong> olarak değiştirebilir (10 saniye sürer ve hem Web hem
            Android APK&apos;da kalıcı olarak <strong>Vardiya 112</strong> yazar):
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() =>
                void openExternalSystemUrl(
                  `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/settings/general`
                )
              }
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[11px] flex items-center justify-between gap-2 transition cursor-pointer"
            >
              <div className="text-left">
                <div>1. Firebase Proje Ayarları</div>
                <div className="text-[10px] font-normal opacity-85">
                  &quot;Herkese açık ad (Public-facing name)&quot; → Vardiya 112
                </div>
              </div>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() =>
                void openExternalSystemUrl(
                  `https://console.cloud.google.com/apis/credentials/consent?project=${FIREBASE_PROJECT_ID}`
                )
              }
              className="p-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-[11px] flex items-center justify-between gap-2 transition cursor-pointer"
            >
              <div className="text-left">
                <div>2. Google OAuth Onay Ekranı</div>
                <div className="text-[10px] font-normal opacity-85">
                  &quot;Edit App → App name&quot; → Vardiya 112
                </div>
              </div>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* PANEL 2: Android APK Login Bridge & Server Infrastructure Config */}
      {showAndroidBridge && (
        <div
          className={`p-3.5 rounded-2xl border text-left space-y-3 text-[11px] leading-relaxed ${
            isLight
              ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
              : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-100'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-black text-xs flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Android APK &amp; Sunucu Altyapısı Koruma Sistemi</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-black">
              ● Capacitor &amp; Firestore Long-Polling Hazır
            </span>
          </div>

          <p className="opacity-90">
            Uygulamayı Android APK&apos;ya taşıdığınızda <strong>Firebase Firestore</strong> bulut
            veritabanı (çevrimdışı önbellek + Android WebView uyumlu bağlantı) ve{' '}
            <strong>Bulut API Sunucusu</strong> kesintisiz çalışmaya devam eder.
          </p>

          {/* Step A: Android WebView Token Login Bridge (if Android WebView blocks Google popups) */}
          <div className="p-2.5 rounded-xl bg-black/20 border border-white/10 space-y-2">
            <div className="font-extrabold flex items-center gap-1.5 text-amber-300">
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>Android APK Google Giriş Köprüsü (WebView Popup Engeline Karşı)</span>
            </div>
            <p className="text-[10px] opacity-85">
              Android APK içinde Google açılır penceresi engellenirse, aşağıdaki butonla sistem
              tarayıcısında (Chrome) giriş yapıp tek dokunuşla aldığınız giriş kodunu buraya
              yapıştırarak APK içinde kalıcı yönetici oturumu açabilirsiniz:
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void openExternalSystemUrl(`${DEFAULT_CLOUD_API_BASE}/?android_auth=1`)
                }
                className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>1. Chrome Tarayıcıda Giriş Kodu Al</span>
              </button>

              {existingBridgeToken && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(existingBridgeToken);
                      setCopiedBridgeToken(true);
                      setTimeout(() => setCopiedBridgeToken(false), 2500);
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  {copiedBridgeToken ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Giriş Kodu Kopyalandı!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Mevcut Giriş Kodumu Kopyala</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={idTokenInput}
                onChange={(e) => setIdTokenInput(e.target.value)}
                placeholder="2. Kopyaladığınız Google Giriş Anahtarını (ID Token) buraya yapıştırın..."
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-[11px] outline-none"
              />
              <button
                type="button"
                onClick={handleTokenBridgeLogin}
                disabled={authLoading || !idTokenInput.trim()}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-extrabold shrink-0 cursor-pointer"
              >
                APK Girişi Yap
              </button>
            </div>
          </div>

          {/* Step B: Cloud API Base URL Configuration for Android APK */}
          <div className="p-2.5 rounded-xl bg-black/20 border border-white/10 space-y-1.5">
            <div className="font-extrabold flex items-center gap-1.5 text-sky-300">
              <Server className="w-3.5 h-3.5 shrink-0" />
              <span>Android APK Yardımcı Bulut Sunucu Adresi (Hava Durumu / AI / Takvim)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={customServerUrl}
                onChange={(e) => setCustomServerUrl(e.target.value)}
                placeholder={`Varsayılan: ${DEFAULT_CLOUD_API_BASE}`}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white text-[11px] font-mono outline-none"
              />
              <button
                type="button"
                onClick={handleSaveServerUrl}
                className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-extrabold shrink-0 cursor-pointer"
              >
                {savedServerBadge ? '✓ Kaydedildi' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
