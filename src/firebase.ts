import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';
import firebaseConfigLocal from '../firebase-applet-config.json';

// Prioritize local config for manual setup, fallback to env vars for production/Vercel
const firebaseConfig = {
  apiKey: firebaseConfigLocal.apiKey || (import.meta as any).env.VITE_FIREBASE_API_KEY,
  authDomain: firebaseConfigLocal.authDomain || (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: firebaseConfigLocal.projectId || (import.meta as any).env.VITE_FIREBASE_PROJECT_ID,
  appId: firebaseConfigLocal.appId || (import.meta as any).env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: firebaseConfigLocal.firestoreDatabaseId || (import.meta as any).env.VITE_FIREBASE_FIRESTORE_DB_ID,
  storageBucket: firebaseConfigLocal.storageBucket,
  messagingSenderId: firebaseConfigLocal.messagingSenderId,
  measurementId: firebaseConfigLocal.measurementId,
  databaseURL: (firebaseConfigLocal as any).databaseURL,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Analytics (optional/async check)
export const analytics = isSupported().then(yes => yes ? getAnalytics(app) : null);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default app;
