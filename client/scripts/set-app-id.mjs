/* global process, console */
// Changes the app ID (Android applicationId / iOS bundle identifier) everywhere it is set.
//
//   npm run native:set-app-id -w client -- com.yourcompany.cookfirst
//   npm run native:set-app-id -w client -- --check        (shows where it is set, and whether they agree)
//
// "com.example.cookfirst" is only a placeholder. Choose the real ID before the first release: once an app is
// published to the Play Store or the App Store its ID can't be changed.
//
// The Android *namespace* (the folder the Java files live in) is deliberately left alone: it only has to be
// consistent inside the project, and keeping it means no files have to move.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root =
  rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = args.includes('--check');
// The ID is the first argument that isn't an option or the value of --root.
const id = args.filter((arg, i) => !arg.startsWith('--') && !(rootIndex >= 0 && i === rootIndex + 1))[0];

/** Where the ID lives, and how to read and write it there. */
const PLACES = [
  {
    file: 'capacitor.config.ts',
    label: 'Capacitor (appId)',
    pattern: /(appId:\s*')([^']+)(')/g,
  },
  {
    file: 'android/app/build.gradle',
    label: 'Android (applicationId)',
    pattern: /(applicationId\s+")([^"]+)(")/g,
  },
  {
    file: 'android/app/src/main/res/values/strings.xml',
    label: 'Android (package_name, custom_url_scheme)',
    pattern: /(<string name="(?:package_name|custom_url_scheme)">)([^<]+)(<\/string>)/g,
  },
  {
    file: 'ios/App/App.xcodeproj/project.pbxproj',
    label: 'iOS (PRODUCT_BUNDLE_IDENTIFIER)',
    pattern: /(PRODUCT_BUNDLE_IDENTIFIER = )([^;]+)(;)/g,
  },
];

/** At least two parts, each starting with a letter: letters, digits and underscores (Android's package rules). */
const VALID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function read(place) {
  const file = path.join(root, place.file);
  if (!existsSync(file)) return { file, text: null, values: [] };
  const text = readFileSync(file, 'utf8');
  return { file, text, values: [...text.matchAll(place.pattern)].map((match) => match[2]) };
}

if (check || !id) {
  const found = PLACES.map((place) => ({ place, ...read(place) }));
  for (const { place, text, values } of found) {
    console.log(`${text === null ? 'missing' : values.length ? values.join(', ') : 'not found'}  ${place.label}`);
  }
  const all = new Set(found.flatMap(({ values }) => values));
  if (all.size === 1) {
    console.log(`\nAll places use ${[...all][0]}.`);
    process.exit(0);
  }
  console.log(all.size === 0 ? '\nNothing found.' : `\nThe places DISAGREE: ${[...all].join(', ')}`);
  if (!check && !id) console.log('\nUsage: npm run native:set-app-id -w client -- com.yourcompany.cookfirst');
  process.exit(check ? 1 : 2);
}

if (!VALID.test(id)) {
  console.error(
    `"${id}" is not a valid app ID. Use lower-case parts separated by dots, like com.yourcompany.cookfirst.`,
  );
  process.exit(2);
}

// Read everything first, so nothing is changed if any place can't be found.
const plan = PLACES.map((place) => ({ place, ...read(place) }));
for (const { place, text, values } of plan) {
  if (text === null) {
    console.error(`Can't find ${place.file}. Nothing was changed.`);
    process.exit(1);
  }
  if (values.length === 0) {
    console.error(`Can't find the app ID in ${place.file}. Nothing was changed.`);
    process.exit(1);
  }
}
for (const { place, file, text } of plan) {
  writeFileSync(
    file,
    text.replace(place.pattern, (_all, before, _old, after) => `${before}${id}${after}`),
  );
  console.log(`set ${id}  ${place.label}`);
}
console.log(`
Also do these (they belong to the ID):
  - Firebase: add an Android app and an iOS app with this ID in the Firebase console, and put the new
    google-services.json (client/android/app/) and GoogleService-Info.plist (client/ios/App/App/) in place.
  - Server: set APNS_BUNDLE_ID to ${id}.
  - Then: npm run cap:sync -w client`);
