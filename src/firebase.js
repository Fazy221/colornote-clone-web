import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';

// Pulled from .env.local (see .env.local.example) — never hardcode these.
// Note: unlike a server API key, Firebase's web config isn't a secret; it's
// meant to be visible in client code. Real protection comes from Firestore
// security rules (locking each user to their own uid), not from hiding this
// object. It's still kept in env vars so dev/prod configs can differ and it
// doesn't get committed by accident.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  // Loud and early, rather than a cryptic Firebase SDK error later.
  console.error(
    `Firebase config missing: ${missing.join(', ')}. ` +
    `Copy .env.local.example to .env.local and fill in your project's values ` +
    `(Firebase console → Project settings → General → Your apps → SDK setup and configuration).`
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// A cache that survives closing the tab (and is shared by tabs), so that opening the app reads from
// Firestore only the notes that changed since last time, not the whole diary again. Firestore bills
// every document it sends, and the free plan allows 50,000 reads a day; the diary is ~1,800 notes.
// Where the browser has no IndexedDB, or this was already set up, fall back to the plain memory cache.
function openFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}
export const db = openFirestore();
export const googleProvider = new GoogleAuthProvider();
