import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  UserCredential,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { getCapacitorPlugins, isCapacitorNative } from './utils/nativeBridge';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with automatic long-polling detection and persistent IndexedDB cache.
// This ensures 100% reliability inside Capacitor Android WebViews (where WebChannel streams
// can stall) and keeps institution shift tables available even offline.
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
})();

// Initialize Auth with browserLocalPersistence and indexedDBLocalPersistence
// so both Web/iFrame popups and Capacitor Android WebView persist sessions reliably.
export const auth = (() => {
  try {
    const instance = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    instance.languageCode = 'tr';
    return instance;
  } catch {
    const instance = getAuth(app);
    instance.languageCode = 'tr';
    return instance;
  }
})();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
  hl: 'tr',
});

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const GOOGLE_OAUTH_CLIENT_ID = firebaseConfig.oAuthClientId || '';

// Store the latest Google OAuth ID Token in sessionStorage when ?android_auth=1 is used
const ANDROID_BRIDGE_TOKEN_KEY = 'VARDIYA_112_LAST_GOOGLE_ID_TOKEN';

export function getLastGoogleIdToken(): string | null {
  try {
    return sessionStorage.getItem(ANDROID_BRIDGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveLastGoogleIdToken(idToken?: string | null) {
  if (!idToken) return;
  try {
    sessionStorage.setItem(ANDROID_BRIDGE_TOKEN_KEY, idToken);
  } catch {
    // ignore storage restrictions
  }
}

// Process any pending OAuth redirect result on startup (for Android WebView fallback)
void getRedirectResult(auth, browserPopupRedirectResolver)
  .then((res) => {
    if (res) {
      const cred = GoogleAuthProvider.credentialFromResult(res);
      saveLastGoogleIdToken(cred?.idToken);
    }
  })
  .catch(() => {
    // ignore redirect check errors on normal boots
  });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

/**
 * Direct Firebase authentication using a Google OAuth ID Token (from Google Identity Services
 * or the Android Chrome Browser Bridge). Does not redirect through *.firebaseapp.com/__/auth/handler.
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<UserCredential> {
  const cleanToken = idToken.trim();
  if (!cleanToken) {
    throw new Error('Geçerli bir Google kimlik doğrulama kodu (ID Token) girilmedi.');
  }
  saveLastGoogleIdToken(cleanToken);
  const credential = GoogleAuthProvider.credential(cleanToken);
  return await signInWithCredential(auth, credential);
}

/**
 * Multi-tier Google Sign-In for Bureau / Admin users that works seamlessly
 * across Web, PWA, and Capacitor Android APKs:
 * 1) Capacitor Native FirebaseAuthentication / GoogleAuth plugin (if installed in APK)
 * 2) Standard `signInWithPopup` (captures Google ID token for Android bridge if requested)
 * 3) Automatic fallback to `signInWithRedirect` if Android WebView blocks popups
 */
export async function signInBureauWithGoogle(): Promise<UserCredential | null> {
  if (isCapacitorNative()) {
    const plugins = getCapacitorPlugins();

    // Option A: @capacitor-firebase/authentication plugin
    if (
      plugins?.FirebaseAuthentication &&
      typeof plugins.FirebaseAuthentication.signInWithGoogle === 'function'
    ) {
      try {
        const res = await plugins.FirebaseAuthentication.signInWithGoogle();
        const idToken = res?.credential?.idToken;
        if (idToken) {
          return await signInWithGoogleIdToken(idToken);
        }
      } catch {
        // Fall through to Option B / popup
      }
    }

    // Option B: @codetrix-studio/capacitor-google-auth plugin
    if (plugins?.GoogleAuth && typeof plugins.GoogleAuth.signIn === 'function') {
      try {
        if (typeof plugins.GoogleAuth.initialize === 'function' && GOOGLE_OAUTH_CLIENT_ID) {
          await plugins.GoogleAuth.initialize({
            clientId: GOOGLE_OAUTH_CLIENT_ID,
            scopes: ['profile', 'email'],
            grantOfflineAccess: true,
          });
        }
        const googleUser = await plugins.GoogleAuth.signIn();
        const idToken = googleUser?.authentication?.idToken || googleUser?.idToken;
        if (idToken) {
          return await signInWithGoogleIdToken(idToken);
        }
      } catch {
        // Fall through to popup/redirect
      }
    }
  }

  try {
    const result = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    saveLastGoogleIdToken(cred?.idToken);
    return result;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (
      isCapacitorNative() &&
      (code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/cancelled-popup-request')
    ) {
      await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
      return null;
    }
    throw err;
  }
}

export async function signOutBureau() {
  try {
    sessionStorage.removeItem(ANDROID_BRIDGE_TOKEN_KEY);
  } catch {
    // ignore
  }
  return signOut(auth);
}

/**
 * Builds authenticated headers (Firebase JWT Bearer token + CSRF custom header)
 * for all protected backend API requests (`/api/*`).
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'Vardiya112Client',
  };
  try {
    if (auth.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      }
    }
  } catch {
    // Proceed with base headers if token refresh fails offline
  }
  return headers;
}

