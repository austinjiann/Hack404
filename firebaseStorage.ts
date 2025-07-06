// Initializes Firebase Storage for Expo React Native
import { getStorage } from 'firebase/storage';
import type { FirebaseApp } from 'firebase/app';
import { app } from './firebaseRealtime';

export const storage = getStorage(app as FirebaseApp);
