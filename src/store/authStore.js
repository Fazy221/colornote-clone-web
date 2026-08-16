import { create } from 'zustand';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
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
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged (below) picks up the result and sets `user`.
    } catch (e) {
      // Not logging e directly — avoid leaking anything sensitive to console
      // in a shared/screenshot-prone environment. Message is enough to act on.
      console.error('Google sign-in failed:', e.code);
      set({ error: e.code === 'auth/popup-closed-by-user' ? null : 'Sign-in failed. Please try again.' });
    }
  },

  signOutUser: async () => {
    await signOut(auth);
  },
}));

// Fired once at module load, keeps `user` in sync for the lifetime of the app.
onAuthStateChanged(auth, (firebaseUser) => {
  useAuthStore.setState({ user: firebaseUser });
});

export default useAuthStore;
