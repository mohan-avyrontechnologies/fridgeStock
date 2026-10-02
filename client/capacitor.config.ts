import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the built web app (client/dist) in native Android and iOS apps.
 *
 * APP ID: "com.example.cookfirst" is a PLACEHOLDER. Choose the real one (for example com.yourcompany.cookfirst)
 * before publishing, then run `npm run native:set-app-id -w client -- <the id>`, which changes it here, in the
 * Android project and in the iOS project. It can't be changed in the stores once an app is published.
 */
const config: CapacitorConfig = {
  appId: 'com.example.cookfirst',
  appName: 'Cook First',
  webDir: 'dist',
  server: {
    // The app is served from https://localhost on Android and capacitor://localhost on iOS. The API allows
    // both (server/src/config/native.ts).
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      // Show a reminder even while the app is open, without the system's sound: the app plays its own chime
      // (src/lib/chime.ts) once the person has touched the screen.
      presentationOptions: ['badge', 'alert'],
    },
  },
};

export default config;
