import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  alertFor,
  DEFAULT_ALERTS,
  NOTIFICATION_CHANNELS,
  PUSH_KINDS,
  SOUND_NAMES,
  type AlertSettings,
} from '@cook-first/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ANDROID_CHANNELS } from '../platform/native/channels';

/**
 * The sound files and the Android and iOS project settings that make reminder sounds work, checked as files
 * (no phone is needed): the channels the server names exist, the sound files are where the apps look for them,
 * and nothing asks for a full-screen alarm, a notification that rings on, or an iOS critical alert.
 */

const CLIENT = path.resolve('.');
const REPO = path.resolve('..');
const read = (relative: string, base = CLIENT) => readFileSync(path.join(base, relative), 'utf8');

const SOUND_DIR = 'assets/sounds';
const RAW = 'android/app/src/main/res/raw';

/** How long a CAF of linear PCM plays, in seconds. */
function cafSeconds(file: Buffer): number {
  expect(file.toString('ascii', 0, 4)).toBe('caff');
  let offset = 8;
  let rate = 0;
  let bytesPerFrame = 0;
  while (offset + 12 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = Number(file.readBigInt64BE(offset + 4));
    if (id === 'desc') {
      rate = file.readDoubleBE(offset + 12);
      bytesPerFrame = file.readUInt32BE(offset + 12 + 16);
    }
    if (id === 'data') return (size - 4) / bytesPerFrame / rate;
    offset += 12 + size;
  }
  throw new Error('no data chunk');
}

/** A 16-bit mono PCM WAV of silence, `seconds` long. */
function silentWav(seconds: number, rate = 8000): Buffer {
  const bytes = Math.floor(seconds * rate) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.alloc(bytes)]);
}

describe('the sound files', () => {
  it('has a gentle, a strong and a meal sound, named as placeholders until licensed files are added', () => {
    expect(SOUND_NAMES).toEqual(['gentle', 'strong', 'meal']);
    const files = readdirSync(path.join(CLIENT, SOUND_DIR)).sort();
    for (const name of SOUND_NAMES) {
      expect(files, name).toContain(`${name}.placeholder.wav`);
      expect(files, name).toContain(`${name}.placeholder.caf`);
    }
    expect(existsSync(path.join(CLIENT, SOUND_DIR, 'README.md'))).toBe(true);
    expect(read(`${SOUND_DIR}/README.md`)).toMatch(/placeholder/i);
  });

  it('the placeholders are real audio, short, and different from each other', () => {
    const sizes = new Set<number>();
    for (const name of SOUND_NAMES) {
      const wav = readFileSync(path.join(CLIENT, SOUND_DIR, `${name}.placeholder.wav`));
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      const seconds = (wav.length - 44) / 2 / wav.readUInt32LE(24);
      expect(seconds, name).toBeGreaterThan(0.5);
      expect(seconds, name).toBeLessThan(5); // one short sound, never a ringtone that goes on
      sizes.add(wav.length);
      expect(cafSeconds(readFileSync(path.join(CLIENT, SOUND_DIR, `${name}.placeholder.caf`)))).toBeCloseTo(seconds, 2);
    }
    expect(sizes.size).toBe(3);
  });

  it('the Android project has each as a raw resource, and the iOS project as a .caf under 30 seconds in its Resources', () => {
    const project = read('ios/App/App.xcodeproj/project.pbxproj');
    for (const name of SOUND_NAMES) {
      expect(
        readdirSync(path.join(CLIENT, RAW)).filter((file) => file.startsWith(`reminder_${name}.`)),
        name,
      ).toHaveLength(1);
      expect(cafSeconds(readFileSync(path.join(CLIENT, `ios/App/App/${name}.caf`))), name).toBeLessThan(30);
      expect(project, name).toMatch(new RegExp(`/\\* ${name}\\.caf in Resources \\*/ = \\{isa = PBXBuildFile`));
      expect(project, name).toMatch(
        new RegExp(`/\\* ${name}\\.caf \\*/ = \\{isa = PBXFileReference; lastKnownFileType = audio\\.caf`),
      );
    }
  });

  it('npm run sounds:check agrees', () => {
    const output = execFileSync(process.execPath, ['scripts/sounds.mjs', 'check'], { encoding: 'utf8' });
    expect(output).toContain('The three reminder sounds are in the web app');
  });

  it('are copied into the projects before every build for the apps', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['cap:sync']).toMatch(/^npm run sounds:sync && /);
    expect(scripts['sounds:generate']).toBeDefined();
    expect(scripts['sounds:check']).toBeDefined();
  });

  it('the server names the same .caf files the iOS project bundles', () => {
    const fcm = read('server/src/services/fcmProvider.ts', REPO);
    expect(fcm).toContain('`${sound}.caf`');
    for (const name of SOUND_NAMES) expect(existsSync(path.join(CLIENT, `ios/App/App/${name}.caf`)), name).toBe(true);
  });
});

describe('npm run sounds:sync', () => {
  let temp: string | undefined;
  afterEach(() => {
    if (temp) rmSync(temp, { recursive: true, force: true });
    temp = undefined;
  });

  /** A scratch copy of just what the script reads and writes. */
  function scratch() {
    temp = mkdtempSync(path.join(os.tmpdir(), 'cook-first-sounds-'));
    cpSync(path.join(CLIENT, SOUND_DIR), path.join(temp, SOUND_DIR), { recursive: true });
    mkdirSync(path.join(temp, 'ios/App/App.xcodeproj'), { recursive: true });
    mkdirSync(path.join(temp, 'ios/App/App'), { recursive: true });
    cpSync(
      path.join(CLIENT, 'ios/App/App.xcodeproj/project.pbxproj'),
      path.join(temp, 'ios/App/App.xcodeproj/project.pbxproj'),
    );
    mkdirSync(path.join(temp, RAW), { recursive: true });
    return temp;
  }
  const run = (root: string, command: string) => {
    try {
      return {
        code: 0,
        output: execFileSync(process.execPath, ['scripts/sounds.mjs', command, '--root', root], {
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, output: failure.stdout + failure.stderr };
    }
  };

  it('uses the placeholders, and registers each .caf in the Xcode project exactly once, however often it runs', () => {
    const dir = scratch();
    // Start from a project with none of the sounds in it.
    const projectFile = path.join(dir, 'ios/App/App.xcodeproj/project.pbxproj');
    writeFileSync(
      projectFile,
      readFileSync(projectFile, 'utf8')
        .split('\n')
        .filter((line) => !line.includes('.caf'))
        .join('\n'),
    );
    expect(run(dir, 'sync').code).toBe(0);
    const once = readFileSync(projectFile, 'utf8');
    expect(run(dir, 'sync').code).toBe(0);
    expect(readFileSync(projectFile, 'utf8')).toBe(once);
    for (const name of SOUND_NAMES) {
      expect(once.match(new RegExp(`${name}\\.caf in Resources`, 'g')), name).toHaveLength(2); // its own line, and the Resources step
      expect(once.match(new RegExp(`path = ${name}\\.caf;`, 'g')), name).toHaveLength(1);
    }
    expect(run(dir, 'check').code).toBe(0);
  });

  it('prefers a licensed file to the placeholder, for the web, Android and iOS', () => {
    const dir = scratch();
    const licensed = silentWav(2);
    writeFileSync(path.join(dir, SOUND_DIR, 'gentle.wav'), licensed);
    const result = run(dir, 'sync');
    expect(result.code).toBe(0);
    expect(result.output).toContain('gentle: gentle.wav for web and Android, gentle.wav (converted) for iOS');
    expect(result.output).toContain('strong: PLACEHOLDER');
    expect(readFileSync(path.join(dir, RAW, 'reminder_gentle.wav'))).toEqual(licensed);
    expect(cafSeconds(readFileSync(path.join(dir, 'ios/App/App/gentle.caf')))).toBeCloseTo(2, 2);
  });

  it('keeps one raw file per sound when a licensed file has another format', () => {
    const dir = scratch();
    expect(run(dir, 'sync').code).toBe(0);
    writeFileSync(path.join(dir, SOUND_DIR, 'meal.ogg'), Buffer.from('OggS fake'));
    expect(run(dir, 'sync').code).toBe(0);
    expect(readdirSync(path.join(dir, RAW)).filter((file) => file.startsWith('reminder_meal.'))).toEqual([
      'reminder_meal.ogg',
    ]);
  });

  it('refuses an iOS sound of 30 seconds or more', () => {
    const dir = scratch();
    writeFileSync(path.join(dir, SOUND_DIR, 'meal.wav'), silentWav(31));
    const result = run(dir, 'sync');
    expect(result.code).toBe(1);
    expect(result.output).toContain('under 30 seconds');
  });

  it('says what to do about a licensed WAV it cannot convert', () => {
    const dir = scratch();
    const wav = silentWav(1);
    wav.writeUInt16LE(3, 20); // 32-bit float, not 16-bit PCM
    writeFileSync(path.join(dir, SOUND_DIR, 'strong.wav'), wav);
    const result = run(dir, 'sync');
    expect(result.code).toBe(1);
    expect(result.output).toContain('afconvert');
  });

  it('check fails when the projects do not have the sounds', () => {
    const dir = scratch();
    const result = run(dir, 'check');
    expect(result.code).toBe(1);
    expect(result.output).toContain('reminder_gentle');
  });
});

describe('the Android notification channels', () => {
  /** The rows of ReminderChannels.java's table. */
  const javaRows = () =>
    [
      ...read('android/app/src/main/java/com/example/cookfirst/ReminderChannels.java').matchAll(
        /\{ "([a-z-]+)", "([^"]+)", "([^"]+)", (\d), (null|"[a-z_]+"), (true|false) \},/g,
      ),
    ].map((m) => ({
      id: m[1],
      name: m[2],
      description: m[3],
      importance: Number(m[4]),
      sound: m[5] === 'null' ? null : m[5]!.replaceAll('"', ''),
      vibration: m[6] === 'true',
    }));

  it('are the six the server can name', () => {
    expect(ANDROID_CHANNELS.map((channel) => channel.id)).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it('are defined the same way in the app’s JavaScript and in Java', () => {
    expect(javaRows()).toEqual(ANDROID_CHANNELS);
  });

  it('give the gentle, urgent and meal channels the specified importance, sound and vibration', () => {
    const channel = (id: string) => ANDROID_CHANNELS.find((spec) => spec.id === id)!;
    expect(channel('food-soon')).toMatchObject({ importance: 3, sound: 'reminder_gentle', vibration: false });
    expect(channel('food-urgent')).toMatchObject({ importance: 4, sound: 'reminder_strong', vibration: true });
    expect(channel('meal-reminders')).toMatchObject({ importance: 3, sound: 'reminder_meal', vibration: false });
    // Silent: no sound, no vibration, low importance.
    expect(channel('reminders-silent')).toMatchObject({ importance: 2, sound: null, vibration: false });
  });

  it('only use sound files that are in the Android project', () => {
    const raw = readdirSync(path.join(CLIENT, RAW)).map((file) => file.replace(/\.[^.]+$/, ''));
    for (const channel of ANDROID_CHANNELS.filter((spec) => spec.sound))
      expect(raw, channel.id).toContain(channel.sound);
  });

  it('every channel the server can choose, for any reminder and any settings, exists', () => {
    const ids = new Set(ANDROID_CHANNELS.map((channel) => channel.id));
    const settings: AlertSettings[] = [true, false].flatMap((sound) =>
      [true, false].map((vibration) => ({ ...DEFAULT_ALERTS, sound, vibration })),
    );
    for (const kind of PUSH_KINDS) {
      for (const quiet of [true, false]) {
        for (const setting of settings)
          expect(ids.has(alertFor(kind, setting, quiet).channel), `${kind} ${quiet}`).toBe(true);
      }
    }
  });

  it('the messaging service uses the channel the server names, and is silent while the app is open', () => {
    const service = read('android/app/src/main/java/com/example/cookfirst/ActionMessagingService.java');
    expect(service).toContain('data.get("channelId")');
    expect(service).toMatch(/if \(MainActivity\.isVisible\(\)\) channelId = ReminderChannels\.SILENT;/);
    expect(service).toContain('ReminderChannels.ensure(context, channelId)');
    const activity = read('android/app/src/main/java/com/example/cookfirst/MainActivity.java');
    expect(activity).toContain('ReminderChannels.ensureSoundless(this)');
    expect(activity).toMatch(/onResume\(\) \{\s*super\.onResume\(\);\s*visible = true;/);
    expect(activity).toMatch(/onPause\(\) \{\s*visible = false;/);
  });

  it('a button that opens a page opens it; the others call the server', () => {
    const service = read('android/app/src/main/java/com/example/cookfirst/ActionMessagingService.java');
    expect(service).toContain('item.optString("url", null)');
    expect(service).toMatch(/button = openPage\(context, buttonPage/);
    expect(service).toContain('PendingIntent.getBroadcast');
  });

  it('start with the gentle channel as the default', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(
      /default_notification_channel_id"\s+android:value="food-soon"/,
    );
  });
});

describe('iOS notification sounds and meal buttons', () => {
  it('registers a meal category whose buttons match what the server sends', () => {
    const delegate = read('ios/App/App/AppDelegate.swift');
    const fcm = read('server/src/services/fcmProvider.ts', REPO);
    const copy = read('server/src/copy.ts', REPO);
    const category = fcm.match(/IOS_MEAL_CATEGORY = '([^']+)'/)![1];
    expect(delegate).toContain(`mealCategory = "${category}"`);
    const titles = copy.match(/actions: \{ COOKED: '([^']+)', RECIPE: '([^']+)', SNOOZE_MEAL: '([^']+)' \}/)!;
    expect(delegate).toContain(`identifier: "COOKED", title: "${titles[1]}"`);
    expect(delegate).toContain(`identifier: "RECIPE", title: "${titles[2]}"`);
    expect(delegate).toContain(`identifier: "SNOOZE_MEAL", title: "${titles[3]}"`);
    expect(delegate).toMatch(/setNotificationCategories\(\[category, meal\]\)/);
  });

  it('plays no system sound while the app is open: the app’s own chime does', () => {
    const config = read('capacitor.config.ts');
    expect(config).toMatch(/presentationOptions: \['badge', 'alert'\]/);
    expect(config).not.toMatch(/presentationOptions:[^\]]*sound/);
  });
});

describe('what reminders never do', () => {
  /** Every hand-written source file that could ask for it, without comments. */
  function sources(): { file: string; text: string }[] {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
          return entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'test' ? [] : walk(full);
        return /\.(ts|tsx|java|swift|plist|xml|js)$/.test(entry.name) ? [full] : [];
      });
    const roots = [
      path.join(CLIENT, 'src'),
      path.join(CLIENT, 'public'),
      path.join(CLIENT, 'android/app/src/main'),
      path.join(CLIENT, 'ios/App/App'),
      path.join(REPO, 'server/src'),
      path.join(REPO, 'shared/src'),
    ];
    return roots
      .flatMap(walk)
      .filter((file) => !/\.test\./.test(file) && !file.includes(`${path.sep}public${path.sep}assets`))
      .map((file) => ({
        file: path.relative(REPO, file),
        text: readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1'),
      }));
  }

  it('use a full-screen alarm, ring until dismissed, or send an iOS critical alert', () => {
    const forbidden = [
      /setFullScreenIntent/,
      /USE_FULL_SCREEN_INTENT/,
      /CATEGORY_ALARM/,
      /setOngoing/,
      /FLAG_INSISTENT/,
      /\bcriticalAlert\b/,
      /UNNotificationSound\.defaultCritical/,
      /defaultCriticalSound/,
      /'critical'/,
      /"critical"/,
      /com\.apple\.developer\.usernotifications\.critical-alerts/,
      /time-sensitive/,
    ];
    expect(sources().length).toBeGreaterThan(60); // a real set of files was scanned
    const found = sources().flatMap(({ file, text }) =>
      forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`),
    );
    expect(found).toEqual([]);
  });
});

describe('the service worker', () => {
  const worker = () => read('public/sw.js');

  it('vibrates with the server’s pattern, keeps due and overdue on screen, and replaces repeats by tag', () => {
    const text = worker();
    expect(text).toContain('vibrate: !silent && Array.isArray(data.vibrate)');
    expect(text).toContain('requireInteraction: data.requireInteraction === true');
    expect(text).toContain('tag: data.tag');
    expect(text).toContain('silent,');
  });

  it('is quiet when a page is open to play its own chime, and tells that page which kind arrived', () => {
    const text = worker();
    expect(text).toContain("client.visibilityState === 'visible'");
    expect(text).toContain("type: 'cook-first:reminder'");
    expect(text).toContain('data.silent === true || visible.length > 0');
  });

  it('never combines a vibration pattern with silent, which a browser rejects', () => {
    expect(worker()).toMatch(/vibrate: !silent &&/);
  });

  it('opens a page for the buttons that have one, and calls the server for the others', () => {
    const text = worker();
    expect(text).toContain('if (button.url) actionUrls[button.action] = button.url');
    expect(text).toMatch(/if \(action && actionUrls\[action\]\) \{\s*await openPage\(actionUrls\[action\]\);/);
    expect(text).toContain('/push/actions');
  });
});
