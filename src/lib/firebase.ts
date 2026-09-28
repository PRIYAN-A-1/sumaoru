import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// User's Firebase Project Configuration
export const firebaseConfig = {
  apiKey: "AIzaSyDePYhrYzEkCgoN4hU4Ah4z6v84QVyqyHQ",
  authDomain: "priyan-d3fd4.firebaseapp.com",
  projectId: "priyan-d3fd4",
  storageBucket: "priyan-d3fd4.firebasestorage.app",
  messagingSenderId: "99916095431",
  appId: "1:99916095431:web:896a64193e50e22fe503e2",
  measurementId: "G-BYMCM3YS56"
};

// Initialize Firebase App Singleton
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);

export default app;
