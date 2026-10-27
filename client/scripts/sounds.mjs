/* global process, console */
// The three reminder sounds: gentle (approaching expiry, the daily summary), strong (due, overdue) and meal.
//
//   node scripts/sounds.mjs generate [--force]   write PLACEHOLDER tones into assets/sounds (if missing)
//   node scripts/sounds.mjs sync                 copy the sounds into the Android and iOS projects
//   node scripts/sounds.mjs check                check the projects have them (exit 1 if not)
//
// Until you have licensed files, assets/sounds holds synthetic placeholders named <sound>.placeholder.wav and
// <sound>.placeholder.caf. To use your own, add <sound>.wav (or .ogg or .mp3) next to them, and for iOS
// <sound>.caf (or a 16-bit PCM <sound>.wav, which `sync` converts). A licensed file always wins over the
// placeholder. Then run `npm run sounds:sync -w client`.
//
// Where they go:
//   web (in-app chime)  imported from assets/sounds by src/lib/chime.ts
//   Android             android/app/src/main/res/raw/reminder_<sound>.<ext>  (the notification channels use them)
//   iOS                 ios/App/App/<sound>.caf, registered in the Xcode project (aps.sound names the file)
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith('--')) ?? 'check';
const force = args.includes('--force');
const rootIndex = args.indexOf('--root');
const ROOT =
  rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SOUNDS = ['gentle', 'strong', 'meal'];
const SOUND_DIR = path.join(ROOT, 'assets/sounds');
const RAW_DIR = path.join(ROOT, 'android/app/src/main/res/raw');
const IOS_DIR = path.join(ROOT, 'ios/App/App');
const PBXPROJ = path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');
const LICENSED_EXTENSIONS = ['wav', 'ogg', 'mp3'];
/** iOS plays custom notification sounds of up to 30 seconds; longer ones fall back to the default sound. */
const IOS_MAX_SECONDS = 30;
const RATE = 22050;

// ---------- placeholder tones ----------

/** One decaying bell-like note (a fundamental and a soft overtone) as samples between -1 and 1. */
function note(frequency, seconds, volume) {
  const samples = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.01);
    const decay = Math.exp(-t * (4 / seconds));
    const tone = Math.sin(2 * Math.PI * frequency * t) + 0.35 * Math.sin(2 * Math.PI * frequency * 2 * t);
    samples[i] = (tone / 1.35) * attack * decay * volume;
  }
  return samples;
}

const silence = (seconds) => new Float32Array(Math.floor(seconds * RATE));

function join(parts) {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The three placeholder sounds. */
const TONES = {
  // Two soft notes: quiet and short.
  gentle: () => join([note(659.25, 0.5, 0.45), note(783.99, 0.7, 0.4)]),
  // Three firm pulses of a higher, louder tone: hard to miss, but over in about 1.6 seconds (never an alarm that rings on).
  strong: () =>
    join([note(880, 0.35, 0.9), silence(0.08), note(880, 0.35, 0.9), silence(0.08), note(1174.66, 0.6, 0.9)]),
  // A rising three-note arpeggio, its own sound.
  meal: () => join([note(523.25, 0.3, 0.5), note(659.25, 0.3, 0.5), note(783.99, 0.7, 0.5)]),
};

const toPcm16 = (samples) => {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2));
  return buffer;
};

function wavFile(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A CAF file (Apple's container) holding 16-bit little-endian linear PCM: what iOS notification sounds need. */
function cafFile(pcm, rate = RATE, channels = 1) {
  const header = Buffer.alloc(8);
  header.write('caff', 0);
  header.writeUInt16BE(1, 4); // version
  header.writeUInt16BE(0, 6); // flags
  const desc = Buffer.alloc(12 + 32);
  desc.write('desc', 0);
  desc.writeBigInt64BE(32n, 4);
  desc.writeDoubleBE(rate, 12);
  desc.write('lpcm', 20);
  desc.writeUInt32BE(2, 24); // kCAFLinearPCMFormatFlagIsLittleEndian
  desc.writeUInt32BE(2 * channels, 28); // bytes per packet
  desc.writeUInt32BE(1, 32); // frames per packet
  desc.writeUInt32BE(channels, 36);
  desc.writeUInt32BE(16, 40); // bits per channel
  const data = Buffer.alloc(12 + 4);
  data.write('data', 0);
  data.writeBigInt64BE(BigInt(4 + pcm.length), 4);
  data.writeUInt32BE(0, 12); // edit count
  return Buffer.concat([header, desc, data, pcm]);
}

/** Reads a 16-bit PCM WAV: its samples, rate and channels, or null for any other kind of WAV. */
export function readPcmWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        tag: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format || format.tag !== 1 || format.bits !== 16) return null;
      return { pcm: buffer.subarray(body, body + size), rate: format.rate, channels: format.channels };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** How long a CAF of linear PCM plays, in seconds, or null if it isn't one this script understands. */
export function cafSeconds(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'caff') return null;
  let offset = 8;
  let rate = 0;
  let bytesPerFrame = 0;
  while (offset + 12 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = Number(buffer.readBigInt64BE(offset + 4));
    const body = offset + 12;
    if (id === 'desc') {
      rate = buffer.readDoubleBE(body);
      bytesPerFrame = buffer.readUInt32BE(body + 16);
    } else if (id === 'data') {
      const bytes = size < 0 ? buffer.length - body - 4 : size - 4;
      return rate && bytesPerFrame ? bytes / bytesPerFrame / rate : null;
    }
    offset = body + size;
  }
  return null;
}

// ---------- finding the files ----------

const placeholder = (name, extension) => path.join(SOUND_DIR, `${name}.placeholder.${extension}`);

/** The licensed web/Android file for a sound, if one was added. */
function licensed(name) {
  for (const extension of LICENSED_EXTENSIONS) {
    const file = path.join(SOUND_DIR, `${name}.${extension}`);
    if (existsSync(file)) return { file, extension };
  }
  return null;
}

/** The file used for web and Android: licensed if there is one, else the placeholder. */
export function webSource(name) {
  const own = licensed(name);
  return own ?? { file: placeholder(name, 'wav'), extension: 'wav', placeholder: true };
}

/** The buffer for iOS (a CAF): licensed .caf, or converted from a licensed 16-bit PCM .wav, or the placeholder. */
function iosSource(name) {
  const caf = path.join(SOUND_DIR, `${name}.caf`);
  if (existsSync(caf)) return { buffer: readFileSync(caf), from: `${name}.caf` };
  const wav = path.join(SOUND_DIR, `${name}.wav`);
  if (existsSync(wav)) {
    const pcm = readPcmWav(readFileSync(wav));
    if (!pcm) {
      throw new Error(
        `${name}.wav isn't 16-bit PCM, so it can't be converted here. On a Mac run: afconvert -f caff -d LEI16 ${name}.wav ${name}.caf (in assets/sounds), then sync again.`,
      );
    }
    return { buffer: cafFile(pcm.pcm, pcm.rate, pcm.channels), from: `${name}.wav (converted)` };
  }
  return { buffer: readFileSync(placeholder(name, 'caf')), from: `${name}.placeholder.caf`, placeholder: true };
}

// ---------- commands ----------

function generate() {
  mkdirSync(SOUND_DIR, { recursive: true });
  for (const name of SOUNDS) {
    const pcm = toPcm16(TONES[name]());
    for (const [extension, bytes] of [
      ['wav', wavFile(pcm)],
      ['caf', cafFile(pcm)],
    ]) {
      const file = placeholder(name, extension);
      if (existsSync(file) && !force) continue;
      writeFileSync(file, bytes);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
}

const idFor = (name, kind) =>
  createHash('md5').update(`fridgestock-sound-${name}-${kind}`).digest('hex').slice(0, 24).toUpperCase();

/** Adds the .caf files to the Xcode project's App group and its Resources step. Safe to run again. */
function registerInXcode() {
  if (!existsSync(PBXPROJ)) throw new Error('Can not find the Xcode project.');
  let project = readFileSync(PBXPROJ, 'utf8');
  const before = project;
  const insertAfter = (anchor, line) => {
    if (project.includes(line.trim())) return;
    if (!project.includes(anchor)) throw new Error(`The Xcode project has changed: can not find ${anchor.trim()}`);
    project = project.replace(anchor, `${anchor}${line}\n`);
  };
  for (const name of SOUNDS) {
    const file = idFor(name, 'file');
    const build = idFor(name, 'build');
    insertAfter(
      '/* Begin PBXBuildFile section */\n',
      `\t\t${build} /* ${name}.caf in Resources */ = {isa = PBXBuildFile; fileRef = ${file} /* ${name}.caf */; };`,
    );
    insertAfter(
      '/* Begin PBXFileReference section */\n',
      `\t\t${file} /* ${name}.caf */ = {isa = PBXFileReference; lastKnownFileType = audio.caf; path = ${name}.caf; sourceTree = "<group>"; };`,
    );
    insertAfter('\t\t\t\t504EC3131FED79650016851F /* Info.plist */,\n', `\t\t\t\t${file} /* ${name}.caf */,`);
    insertAfter(
      '\t\t\t\t2FAD9763203C412B000D30F8 /* config.xml in Resources */,\n',
      `\t\t\t\t${build} /* ${name}.caf in Resources */,`,
    );
  }
  if (project !== before) writeFileSync(PBXPROJ, project);
}

function sync() {
  mkdirSync(RAW_DIR, { recursive: true });
  // Remove what an earlier sync left, so a licensed file in another format doesn't sit next to an old placeholder.
  for (const file of existsSync(RAW_DIR) ? readdirSync(RAW_DIR) : []) {
    if (SOUNDS.some((name) => file.startsWith(`reminder_${name}.`))) rmSync(path.join(RAW_DIR, file));
  }
  for (const name of SOUNDS) {
    const source = webSource(name);
    if (!existsSync(source.file))
      throw new Error(`Missing ${path.relative(ROOT, source.file)}. Run: node scripts/sounds.mjs generate`);
    copyFileSync(source.file, path.join(RAW_DIR, `reminder_${name}.${source.extension}`));
    const ios = iosSource(name);
    const seconds = cafSeconds(ios.buffer);
    if (seconds !== null && seconds >= IOS_MAX_SECONDS) {
      throw new Error(
        `${name} is ${seconds.toFixed(1)} seconds long: iOS plays notification sounds under ${IOS_MAX_SECONDS} seconds.`,
      );
    }
    writeFileSync(path.join(IOS_DIR, `${name}.caf`), ios.buffer);
    console.log(
      `${name}: ${source.placeholder ? 'PLACEHOLDER' : path.basename(source.file)} for web and Android, ${ios.from} for iOS`,
    );
  }
  registerInXcode();
}

function check() {
  const problems = [];
  for (const name of SOUNDS) {
    const raw = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((file) => file.startsWith(`reminder_${name}.`)) : [];
    if (raw.length !== 1)
      problems.push(`android/app/src/main/res/raw needs exactly one reminder_${name}.* (found ${raw.length})`);
    const caf = path.join(IOS_DIR, `${name}.caf`);
    if (!existsSync(caf)) problems.push(`ios/App/App/${name}.caf is missing`);
    else {
      const seconds = cafSeconds(readFileSync(caf));
      if (seconds !== null && seconds >= IOS_MAX_SECONDS)
        problems.push(`${name}.caf is ${seconds.toFixed(1)} s: iOS needs under ${IOS_MAX_SECONDS}`);
    }
    const project = existsSync(PBXPROJ) ? readFileSync(PBXPROJ, 'utf8') : '';
    if (!project.includes(`${idFor(name, 'build')} /* ${name}.caf in Resources */,`))
      problems.push(`${name}.caf isn't in the Xcode project's Resources step`);
    if (!existsSync(webSource(name).file)) problems.push(`assets/sounds has no ${name} sound`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('The three reminder sounds are in the web app, the Android project and the iOS project.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (command === 'generate') generate();
    else if (command === 'sync') sync();
    else if (command === 'check') check();
    else {
      console.error('Usage: node scripts/sounds.mjs generate|sync|check');
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
