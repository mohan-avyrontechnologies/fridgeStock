# Reminder sounds

Three sounds, one for each kind of reminder:

| Sound    | Used for                                                  |
| -------- | --------------------------------------------------------- |
| `gentle` | food approaching its expected expiry, and the daily summary |
| `strong` | food due or overdue                                       |
| `meal`   | breakfast, lunch and dinner cooking reminders             |

## These are placeholders

The files here named `<sound>.placeholder.wav` and `<sound>.placeholder.caf` are **synthetic stand-in tones**
made by `scripts/sounds.mjs generate`. They are not licensed recordings and are only here so the app works
until real ones are added. They are short (about one to two seconds) on purpose.

## Adding your licensed sounds

Put your files next to the placeholders, named for the sound:

- `gentle.wav`, `strong.wav`, `meal.wav` (`.ogg` or `.mp3` also work for the web and Android). Keep each short, at
  most a few seconds: reminders are one sound, never a ringtone that goes on.
- For iPhone, `gentle.caf`, `strong.caf`, `meal.caf`, **under 30 seconds** (iOS plays longer ones as the default
  sound). If you only have 16-bit PCM `.wav` files, the next step converts them. For other formats, on a Mac:
  `afconvert -f caff -d LEI16 gentle.wav gentle.caf`.

A licensed file always wins over its placeholder, and the placeholder can stay or be deleted. Then:

```bash
npm run sounds:sync -w client     # copies them into the Android and iOS projects (cap:sync does this too)
npm run sounds:check -w client    # checks every project has all three
```

On Android, a channel's sound is fixed when the channel is first created on a phone, so a phone that already
ran the app keeps the old sound until the app is reinstalled (or the channel ids in
`src/platform/native/channels.ts` and `ReminderChannels.java` are changed).
