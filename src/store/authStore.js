import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider, signInWithPopup, signInWithCredential,
  signOut, onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

// user: undefined = still checking on boot, null = signed out, object = signed in.
// Distinguishing "checking" from "signed out" matters so the sign-in screen
// doesn't flash for a moment on every reload before Firebase reports back.
const useAuthStore = create((set) => ({
  user: undefined,
  error: null,

  signInWithGoogle: async () => {
    set({ error: null });
    try {
      if (Capacitor.isNativePlatform()) {
        // signInWithPopup doesn't work inside a native WebView — Google
        // actively blocks OAuth from embedded browsers as a security
        // policy, so the popup just flashes or silently no-ops. Instead,
        // this plugin drives the native Android account picker, then hands
        // back a Google ID token that Firebase Auth exchanges for a session
        // — same end result (a Firebase Auth user), different route to get
        // there, kept behind this one branch so the rest of the app never
        // has to know which path ran.
        const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
        const credential = GoogleAuthProvider.credential(result.credential?.idToken);
        await signInWithCredential(auth, credential);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
      // onAuthStateChanged (below) picks up the result and sets `user`.
    } catch (e) {
      // Not logging e directly — avoid leaking anything sensitive to console
      // in a shared/screenshot-prone environment. Message is enough to act on.
      console.error('Google sign-in failed:', e.code);
      const cancelled = e.code === 'auth/popup-closed-by-user' || e.code === 'cancelled';
      set({ error: cancelled ? null : 'Sign-in failed. Please try again.' });
    }
  },

  signOutUser: async () => {
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut();
    }
    await signOut(auth);
  },
}));

// Fired once at module load, keeps `user` in sync for the lifetime of the app.
onAuthStateChanged(auth, (firebaseUser) => {
  useAuthStore.setState({ user: firebaseUser });
});

export default useAuthStore;
