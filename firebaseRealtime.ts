// Initializes Firebase Realtime Database for Expo React Native
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { firebaseConfig } from './firebaseConfig';

let app;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export { app };
export const realtimeDb = getDatabase(app);
