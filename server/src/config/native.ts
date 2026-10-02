/**
 * The addresses the Android and iOS apps call the API from. A Capacitor app is a web page served from the
 * phone itself: on iOS from capacitor://localhost, on Android from https://localhost. They are always
 * allowed, next to the web app's own address (CLIENT_ORIGIN).
 */
export const NATIVE_APP_ORIGINS = ['capacitor://localhost', 'https://localhost'] as const;
