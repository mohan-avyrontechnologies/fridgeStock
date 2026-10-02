import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PUSH_ACTIONS } from '@cook-first/shared';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The Android and iOS projects are plain files, so their important settings are checked here: the permissions
 * and the text that explains them, the push set-up, and that the app ID is the same everywhere.
 */

const CLIENT = path.resolve('.');
const REPO = path.resolve('..');
const read = (relative: string, base = CLIENT) => readFileSync(path.join(base, relative), 'utf8');

const manifest = () => read('android/app/src/main/AndroidManifest.xml');
const infoPlist = () => read('ios/App/App/Info.plist');
const appDelegate = () => read('ios/App/App/AppDelegate.swift');

describe('the app’s identity', () => {
  it('is called "Cook First" and wraps the built web app, served over https on Android', () => {
    const config = read('capacitor.config.ts');
    expect(config).toMatch(/appName: 'Cook First'/);
    expect(config).toMatch(/webDir: 'dist'/);
    expect(config).toMatch(/androidScheme: 'https'/);
    expect(read('ios/App/App/Info.plist')).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Cook First<\/string>/);
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(
      '<string name="app_name">Cook First</string>',
    );
  });

  it('has one app ID everywhere, and it is still the placeholder until you choose one', () => {
    const output = execFileSync(process.execPath, ['scripts/set-app-id.mjs', '--check'], { encoding: 'utf8' });
    expect(output).toContain('All places use com.example.cookfirst.');
    expect(read('capacitor.config.ts')).toMatch(/PLACEHOLDER/);
  });

  it('calls the API from the origins the server allows', () => {
    const server = read('server/src/config/native.ts', REPO);
    expect(server).toContain("'capacitor://localhost'");
    expect(server).toContain("'https://localhost'");
  });
});

describe('Android', () => {
  it('asks for the camera and for notifications, and does not insist on a camera', () => {
    const text = manifest();
    expect(text).toContain('<uses-permission android:name="android.permission.CAMERA" />');
    expect(text).toContain('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
    expect(text).toMatch(/android.hardware.camera"\s+android:required="false"/);
  });

  it('explains what the camera is for: identifying food, with photos saved privately to the household', () => {
    const rationale = read('android/app/src/main/res/values/strings.xml');
    expect(rationale).toMatch(
      /camera_permission_message">[^<]*identify your food[^<]*saved privately to your household/,
    );
    expect(manifest()).toMatch(/saved privately to\s+the person's household/);
  });

  it('shows reminders with its own messaging service in place of the plugin’s, and handles the buttons', () => {
    const text = manifest();
    expect(text).toMatch(
      /<service\s+android:name="com\.capacitorjs\.plugins\.pushnotifications\.MessagingService"\s+tools:node="remove"/,
    );
    expect(text).toMatch(/<service android:name="\.ActionMessagingService" android:exported="false">/);
    expect(text).toContain('com.google.firebase.MESSAGING_EVENT');
    expect(text).toMatch(/<receiver android:name="\.NotificationActionReceiver" android:exported="false"/);
    expect(text).toContain('default_notification_channel_id');
  });

  it('builds the notification from the server’s data message, with the same field names the server sends', () => {
    const service = read('android/app/src/main/java/com/example/cookfirst/ActionMessagingService.java');
    const server = read('server/src/services/fcmProvider.ts', REPO);
    for (const field of ['title', 'body', 'tag', 'url', 'actionToken', 'actions', 'actionUrl']) {
      expect(service, field).toContain(`data.get("${field}")`);
      expect(server, field).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(service).toContain('extends MessagingService');
    expect(service).toContain('CHANNEL_ID = "reminders"');
  });

  it('sends the button’s action to the API as {token, action}, the same call as the web app', () => {
    const receiver = read('android/app/src/main/java/com/example/cookfirst/NotificationActionReceiver.java');
    expect(receiver).toContain('.put("token", token).put("action", action)');
    expect(receiver).toContain('setRequestMethod("POST")');
    expect(receiver).toContain('"Content-Type", "application/json"');
  });

  it('opens a tapped notification’s page through the web view, the way the web app expects', () => {
    const activity = read('android/app/src/main/java/com/example/cookfirst/MainActivity.java');
    const app = read('src/App.tsx');
    expect(activity).toContain("CustomEvent('cook-first:open-page'");
    expect(activity).toContain('__cookFirstPendingUrl');
    expect(read('src/platform/events.ts')).toContain("'cook-first:open-page'");
    expect(app).toContain('__cookFirstPendingUrl');
  });

  it('has Firebase Messaging on the app’s own build, and picks up google-services.json when you add it', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('com.google.firebase:firebase-messaging');
    expect(gradle).toContain("apply plugin: 'com.google.gms.google-services'");
  });
});

describe('iOS', () => {
  it('explains the camera and the photo library in the permission boxes, privately saved and used to identify food', () => {
    const text = infoPlist();
    for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
      const description = text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
      expect(description, key).toBeDefined();
      expect(description, key).toMatch(/identif/i);
      expect(description, key).toMatch(/saved privately to your household/i);
    }
    expect(text).toContain('NSPhotoLibraryAddUsageDescription');
  });

  it('can receive notifications in the background', () => {
    expect(infoPlist()).toMatch(/<key>UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>/);
    expect(read('ios/App/App/App.entitlements')).toMatch(/<key>aps-environment<\/key>\s*<string>development<\/string>/);
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(project.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
  });

  it('uses Firebase for the push token, with the setup the Capacitor docs describe', () => {
    const delegate = appDelegate();
    expect(delegate).toContain('FirebaseApp.configure()');
    expect(delegate).toContain('Messaging.messaging().apnsToken = deviceToken');
    expect(delegate).toContain('.capacitorDidRegisterForRemoteNotifications');
    expect(delegate).toContain('.capacitorDidFailToRegisterForRemoteNotifications');
    expect(read('ios/App/Podfile')).toContain("pod 'FirebaseMessaging'");
  });

  it('registers the same notification category and buttons the server sends', () => {
    const delegate = appDelegate();
    const server = read('server/src/services/fcmProvider.ts', REPO);
    const serverCategory = server.match(/IOS_ACTION_CATEGORY = '([^']+)'/)![1];
    expect(delegate).toContain(`reminderCategory = "${serverCategory}"`);
    // The same action ids as the web app and the server, and the same button titles as the server's copy.
    const titles = read('server/src/copy.ts', REPO).match(/actions: \{ USED: '([^']+)', SNOOZE: '([^']+)' \}/)!;
    expect(PUSH_ACTIONS).toEqual(['USED', 'SNOOZE']);
    expect(delegate).toContain(`identifier: "USED", title: "${titles[1]}"`);
    expect(delegate).toContain(`identifier: "SNOOZE", title: "${titles[2]}"`);
    expect(delegate).toContain('UNUserNotificationCenter.current().setNotificationCategories');
  });

  it('is built with CocoaPods, because the ML Kit barcode scanner and Firebase need it', () => {
    const podfile = read('ios/App/Podfile');
    expect(podfile).toContain('CapacitorMlkitBarcodeScanning');
    expect(podfile).toContain('CapacitorPushNotifications');
    expect(podfile).toContain('CapacitorCamera');
    expect(podfile).toContain('AparajitaCapacitorSecureStorage');
  });
});

describe('what is not committed', () => {
  it('keeps your own Firebase files and API address out of the repository', () => {
    const ignore = read('.gitignore', REPO);
    for (const entry of [
      'client/android/app/google-services.json',
      'client/ios/App/App/GoogleService-Info.plist',
      'client/.env.native',
    ]) {
      expect(ignore, entry).toContain(entry);
    }
  });

  it('documents the production API address for the apps in an example file', () => {
    expect(read('.env.native.example')).toMatch(/^VITE_API_URL=https:\/\//m);
  });
});

describe('npm run native:set-app-id', () => {
  let temp: string | undefined;
  afterEach(() => {
    if (temp) rmSync(temp, { recursive: true, force: true });
    temp = undefined;
  });

  /** A scratch copy of just the four files the script changes. */
  function scratch() {
    temp = mkdtempSync(path.join(os.tmpdir(), 'cook-first-appid-'));
    for (const file of [
      'capacitor.config.ts',
      'android/app/build.gradle',
      'android/app/src/main/res/values/strings.xml',
      'ios/App/App.xcodeproj/project.pbxproj',
    ]) {
      mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      cpSync(path.join(CLIENT, file), path.join(temp, file));
    }
    return temp;
  }

  const run = (args: string[]) => {
    try {
      return {
        code: 0,
        output: execFileSync(process.execPath, ['scripts/set-app-id.mjs', ...args], {
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, output: failure.stdout + failure.stderr };
    }
  };

  it('changes the ID in every place, and leaves the Java package (the Android namespace) alone', () => {
    const dir = scratch();
    const result = run(['--root', dir, 'com.acme.cook']);
    expect(result.code).toBe(0);
    expect(read('capacitor.config.ts', dir)).toContain("appId: 'com.acme.cook'");
    expect(read('android/app/build.gradle', dir)).toContain('applicationId "com.acme.cook"');
    expect(read('android/app/build.gradle', dir)).toContain('namespace = "com.example.cookfirst"');
    const strings = read('android/app/src/main/res/values/strings.xml', dir);
    expect(strings).toContain('<string name="package_name">com.acme.cook</string>');
    expect(strings).toContain('<string name="custom_url_scheme">com.acme.cook</string>');
    expect(
      read('ios/App/App.xcodeproj/project.pbxproj', dir).match(/PRODUCT_BUNDLE_IDENTIFIER = com\.acme\.cook;/g),
    ).toHaveLength(2);
    expect(result.output).toContain('google-services.json');
    expect(run(['--root', dir, '--check']).output).toContain('All places use com.acme.cook.');
  });

  it('can be run again, and with another ID', () => {
    const dir = scratch();
    run(['--root', dir, 'com.acme.cook']);
    expect(run(['--root', dir, 'com.acme.cook']).code).toBe(0);
    expect(run(['--root', dir, 'org.other.cookfirst']).code).toBe(0);
    expect(run(['--root', dir, '--check']).output).toContain('All places use org.other.cookfirst.');
  });

  it('refuses an invalid ID and changes nothing', () => {
    const dir = scratch();
    const before = read('capacitor.config.ts', dir);
    for (const bad of ['cookfirst', 'Com.Acme.Cook', 'com.acme-cook', 'com..cook', '1com.acme', 'com.acme.cook!']) {
      const result = run(['--root', dir, bad]);
      expect(result.code, bad).toBe(2);
      expect(result.output, bad).toContain('not a valid app ID');
    }
    expect(read('capacitor.config.ts', dir)).toBe(before);
  });

  it('changes nothing at all when one of the places is missing', () => {
    const dir = scratch();
    rmSync(path.join(dir, 'ios/App/App.xcodeproj/project.pbxproj'));
    const before = read('capacitor.config.ts', dir);
    const result = run(['--root', dir, 'com.acme.cook']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('Nothing was changed');
    expect(read('capacitor.config.ts', dir)).toBe(before);
  });

  it('shows where the ID is set when asked, and says when they disagree', () => {
    const dir = scratch();
    expect(run(['--root', dir, '--check']).code).toBe(0);
    const gradle = path.join(dir, 'android/app/build.gradle');
    const text = readFileSync(gradle, 'utf8').replace(
      'applicationId "com.example.cookfirst"',
      'applicationId "com.different.id"',
    );
    writeFileSync(gradle, text);
    const result = run(['--root', dir, '--check']);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/DISAGREE: com\.example\.cookfirst, com\.different\.id/);
  });
});
