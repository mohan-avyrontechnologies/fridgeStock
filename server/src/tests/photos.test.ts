import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRODUCT_PHOTO_MAX_BYTES } from '@fridgestock/shared';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { purgeClosedPhotos } from '../services/foodPhotoService.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Product photos: upload, storage in GridFS, privacy, retention. Photos are made on the fly, so no binary fixtures are checked in. */

type Session = Awaited<ReturnType<typeof registerUser>>;

beforeEach(() => setToday('2026-09-29'));
afterEach(() => {
  process.env.AUTH_RATE_LIMIT = 'off';
});

// ---- fixtures ----

/** A phone photo: big, sideways (orientation 6), and carrying a GPS location, a camera make and a note. */
const gpsJpeg = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Make: 'TestCamMake', ImageDescription: 'secret note about home' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '51/1 30/1 26/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '0/1 7/1 39/1',
        },
      },
    })
    .jpeg()
    .toBuffer();

const pixel = (color: { r: number; g: number; b: number }, format: 'png' | 'webp' | 'jpeg' = 'png') => {
  const image = sharp({ create: { width: 40, height: 30, channels: 3, background: color } });
  return image[format]().toBuffer();
};

const png = () => pixel({ r: 10, g: 120, b: 200 });
const otherPng = () => pixel({ r: 240, g: 200, b: 10 });

// ---- helpers ----

const add = async (s: Session, overrides: Record<string, unknown> = {}) =>
  (await s.auth(api().post('/api/foods').send(food(overrides))).expect(201)).body as {
    id: string;
    photoAt: string | null;
  };

const upload = (s: Session, id: string, data: Buffer | string, options: { field?: string; type?: string } = {}) =>
  s.auth(
    api()
      .post(`/api/foods/${id}/photo`)
      .attach(options.field ?? 'photo', Buffer.from(data), {
        filename: 'photo.jpg',
        contentType: options.type ?? 'image/jpeg',
      }),
  );

const fetchPhoto = (s: Session, id: string, size?: string) =>
  s.auth(api().get(`/api/foods/${id}/photo${size ? `?size=${size}` : ''}`));

const gridfsFiles = () => mongoose.connection.db!.collection('foodPhotos.files');
const filesFor = (foodId: string) =>
  gridfsFiles()
    .find({ 'metadata.foodId': new mongoose.Types.ObjectId(foodId) })
    .toArray();
const dimensions = async (bytes: Buffer) => {
  const { width, height, format } = await sharp(bytes).metadata();
  return { width: width!, height: height!, format };
};

/** Two people in one household: the guest joined the host. */
async function pair() {
  const host = await registerUser({ name: 'Alice' });
  const guest = await registerUser({ name: 'Bob' });
  const code = (await host.auth(api().post('/api/household/invites')).expect(201)).body.code;
  await guest.auth(api().post('/api/household/join').send({ code })).expect(200);
  return { host, guest };
}

describe('uploading', () => {
  it('needs a signed-in user for every photo route', async () => {
    const id = '0'.repeat(24);
    await api()
      .post(`/api/foods/${id}/photo`)
      .attach('photo', await png(), 'a.png')
      .expect(401);
    await api().get(`/api/foods/${id}/photo`).expect(401);
    await api().delete(`/api/foods/${id}/photo`).expect(401);
  });

  it('keeps a JPEG, PNG or WebP as a WebP in two sizes, and marks the item as having a photo', async () => {
    const s = await registerUser();
    for (const [kind, data, type] of [
      ['jpeg', await pixel({ r: 1, g: 2, b: 3 }, 'jpeg'), 'image/jpeg'],
      ['png', await png(), 'image/png'],
      ['webp', await pixel({ r: 9, g: 9, b: 9 }, 'webp'), 'image/webp'],
    ] as const) {
      const item = await add(s, { name: `Item ${kind}` });
      expect(item.photoAt).toBeNull();
      const res = await upload(s, item.id, data, { type }).expect(200);
      expect(res.body.photoAt).toEqual(expect.any(String));
      for (const size of ['full', 'thumb']) {
        const photo = await fetchPhoto(s, item.id, size).expect(200);
        expect((await dimensions(photo.body)).format).toBe('webp');
      }
    }
  });

  it('shows photoAt on the food list, so cards know which items have a photo', async () => {
    const s = await registerUser();
    const withPhoto = await add(s, { name: 'Milk' });
    await add(s, { name: 'Bread' });
    await upload(s, withPhoto.id, await png()).expect(200);
    const items = (await s.auth(api().get('/api/foods')).expect(200)).body.items as {
      name: string;
      photoAt: string | null;
    }[];
    expect(items.find((i) => i.name === 'Milk')!.photoAt).toEqual(expect.any(String));
    expect(items.find((i) => i.name === 'Bread')!.photoAt).toBeNull();
  });

  it('scales a big photo to at most 1280 pixels, with a 320 pixel thumbnail, and never enlarges a small one', async () => {
    const s = await registerUser();
    const big = await add(s, { name: 'Big' });
    await upload(
      s,
      big.id,
      await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#336699' } })
        .jpeg()
        .toBuffer(),
    ).expect(200);
    expect(await dimensions((await fetchPhoto(s, big.id, 'full')).body)).toMatchObject({ width: 1280, height: 960 });
    expect(await dimensions((await fetchPhoto(s, big.id, 'thumb')).body)).toMatchObject({ width: 320, height: 240 });
    const small = await add(s, { name: 'Small' });
    await upload(s, small.id, await png()).expect(200); // 40 x 30
    expect(await dimensions((await fetchPhoto(s, small.id, 'full')).body)).toMatchObject({ width: 40, height: 30 });
  });
});

describe('rejected uploads', () => {
  it('refuses a file that is not a JPEG, PNG or WebP, whatever type it claims to be', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    const notImages: [string, Buffer | string, string][] = [
      ['a text file called .jpg', 'just some words', 'image/jpeg'],
      ['a PDF', '%PDF-1.7\n1 0 obj', 'image/png'],
      ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'), 'image/gif'],
      ['an SVG with a script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/webp'],
      ['an HTML page', '<html><body>hi</body></html>', 'image/jpeg'],
      ['a bare RIFF that is not WebP', Buffer.from('RIFF\x04\x00\x00\x00WAVEdata', 'latin1'), 'image/webp'],
    ];
    for (const [label, data, type] of notImages) {
      const res = await upload(s, id, data, { type }).expect(400);
      expect(res.body.error, label).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'photo',
        message: 'Only JPEG, PNG or WebP photos are accepted.',
      });
    }
    expect((await FoodItemModel.findById(id))!.photoAt).toBeNull();
    expect(await gridfsFiles().countDocuments()).toBe(0);
  });

  it('refuses a file that starts like an image but cannot be opened', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    const corrupt = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('this is not really image data at all'),
    ]);
    const res = await upload(s, id, corrupt).expect(400);
    expect(res.body.error.message).toBe('That photo couldn’t be read. Try another.');
    expect(await gridfsFiles().countDocuments()).toBe(0);
  });

  it('refuses a missing file, an empty file, or a file under the wrong field name', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await s.auth(api().post(`/api/foods/${id}/photo`)).expect(400);
    await upload(s, id, '').expect(400);
    const wrong = await upload(s, id, await png(), { field: 'file' }).expect(400);
    expect(wrong.body.error.message).toBe('Choose a photo to upload.');
  });

  it('refuses a file over 5 MB with a 413 and a clear message, and keeps nothing', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    const tooBig = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PRODUCT_PHOTO_MAX_BYTES)]);
    const res = await upload(s, id, tooBig).expect(413);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'That photo is too large (5 MB at most).',
      field: 'photo',
    });
    expect(await gridfsFiles().countDocuments()).toBe(0);
  });

  it('refuses a picture that would open into an enormous image (a decompression bomb)', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    // 12,000 x 12,000 = 144 million pixels, but a plain colour compresses to a tiny file.
    const bomb = await sharp({ create: { width: 12_000, height: 12_000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(PRODUCT_PHOTO_MAX_BYTES);
    await upload(s, id, bomb).expect(400);
    expect(await gridfsFiles().countDocuments()).toBe(0);
  });

  it('refuses a photo for food that is no longer active, and when the setting is off', async () => {
    const s = await registerUser();
    const used = await add(s, { name: 'Milk' });
    await s.auth(api().post(`/api/foods/${used.id}/waste`).send({})).expect(200);
    expect((await upload(s, used.id, await png()).expect(409)).body.error.message).toBe(
      'Photos can only be added to food that is still active.',
    );

    const kept = await add(s, { name: 'Bread' });
    await s.auth(api().put('/api/auth/me').send({ savePhotos: false })).expect(200);
    expect((await upload(s, kept.id, await png()).expect(409)).body.error.message).toBe(
      'Product photos are turned off in Settings.',
    );
    await s.auth(api().put('/api/auth/me').send({ savePhotos: true })).expect(200);
    await upload(s, kept.id, await png()).expect(200);
  });

  it('is limited: the 61st upload in 15 minutes is a 429', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    const tiny = await png();
    process.env.AUTH_RATE_LIMIT = 'on';
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await upload(s, id, tiny)).status;
    expect(last).toBe(429);
  });
});

describe('metadata is removed (including the GPS location)', () => {
  it('starts with a fixture that really has a location, and ends with nothing of it', async () => {
    const original = await gpsJpeg();
    const before = (await sharp(original).metadata()).exif!;
    expect(before.length).toBeGreaterThan(100);
    expect(before.includes(Buffer.from('TestCamMake'))).toBe(true);
    // The GPS IFD pointer (tag 0x8825) is in the original's EXIF block, in either byte order.
    expect(before.includes(Buffer.from([0x25, 0x88])) || before.includes(Buffer.from([0x88, 0x25]))).toBe(true);

    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, original).expect(200);

    for (const size of ['full', 'thumb']) {
      const stored = (await fetchPhoto(s, id, size).expect(200)).body as Buffer;
      const meta = await sharp(stored).metadata();
      expect(meta.exif, `${size} has no EXIF block`).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(stored.includes(Buffer.from('EXIF')), `${size} has no EXIF chunk`).toBe(false);
      for (const secret of ['TestCamMake', 'secret note', 'GPS']) {
        expect(stored.includes(Buffer.from(secret)), `${size} does not contain "${secret}"`).toBe(false);
      }
    }
  });

  it('applies the photo’s rotation first, so it is still the right way up', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, await gpsJpeg()).expect(200); // 2400 x 1800 landscape, orientation 6 (turn 90 degrees)
    expect(await dimensions((await fetchPhoto(s, id, 'full')).body)).toMatchObject({ width: 960, height: 1280 });
  });

  it('keeps nothing of the original file: the stored bytes are new', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    const original = await gpsJpeg();
    await upload(s, id, original).expect(200);
    const stored = (await fetchPhoto(s, id, 'full')).body as Buffer;
    expect(stored.equals(original)).toBe(false);
    expect(stored.subarray(0, 4).toString('latin1')).toBe('RIFF');
  });
});

describe('serving a photo', () => {
  it('sends it only to the signed-in household, privately, with the right type and no sniffing', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, await png()).expect(200);
    const res = await fetchPhoto(s, id, 'thumb').expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).not.toContain('public');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(res.headers['content-length'])).toBe((res.body as Buffer).length);
  });

  it('defaults to the full size, and rejects any other size', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(
      s,
      id,
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#abc' } })
        .png()
        .toBuffer(),
    ).expect(200);
    expect((await dimensions((await fetchPhoto(s, id)).body)).width).toBe(1280);
    const bad = await fetchPhoto(s, id, 'huge').expect(400);
    expect(bad.body.error.message).toBe('Choose a thumbnail or the full photo.');
  });

  it('is a 404 for an item with no photo, an unknown item, or a bad id', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await fetchPhoto(s, id).expect(404);
    await fetchPhoto(s, '0'.repeat(24)).expect(404);
    await fetchPhoto(s, 'not-an-id').expect(404);
  });

  it('is a 404 for another household, for every action, and changes nothing', async () => {
    const owner = await registerUser();
    const outsider = await registerUser();
    const { id } = await add(owner);
    await upload(owner, id, await png()).expect(200);
    const before = (await fetchPhoto(owner, id)).body as Buffer;

    await fetchPhoto(outsider, id, 'thumb').expect(404);
    await fetchPhoto(outsider, id, 'full').expect(404);
    await upload(outsider, id, await otherPng()).expect(404);
    await outsider.auth(api().delete(`/api/foods/${id}/photo`)).expect(404);
    expect(((await fetchPhoto(owner, id)).body as Buffer).equals(before)).toBe(true);
  });

  it('is never a public file: nothing in the server serves a folder, and uploads never touch the disk', () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (file.endsWith('.ts') && !file.includes(`${path.sep}tests${path.sep}`)) sources.push(file);
      }
    };
    walk(path.resolve('src'));
    for (const file of sources) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/express\.static|diskStorage|writeFile|createWriteStream|\/uploads?\b|dest:/);
    }
  });
});

describe('one photo per item', () => {
  it('replaces the old photo when a new one is uploaded, leaving exactly two files', async () => {
    const s = await registerUser();
    const { id, photoAt: none } = await add(s);
    expect(none).toBeNull();
    const first = await upload(s, id, await png()).expect(200);
    const firstBytes = (await fetchPhoto(s, id)).body as Buffer;
    expect(await filesFor(id)).toHaveLength(2);

    setToday('2026-09-30');
    const second = await upload(s, id, await otherPng()).expect(200);
    const files = await filesFor(id);
    expect(files.map((f) => f.metadata.size).sort()).toEqual(['full', 'thumb']);
    expect(second.body.photoAt).not.toBe(first.body.photoAt);
    expect(((await fetchPhoto(s, id)).body as Buffer).equals(firstBytes)).toBe(false);
    // The old files' chunks are gone too, not just their records.
    expect(await mongoose.connection.db!.collection('foodPhotos.chunks').countDocuments()).toBe(2);
  });

  it('is removed on request', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, await png()).expect(200);
    await s.auth(api().delete(`/api/foods/${id}/photo`)).expect(204);
    await fetchPhoto(s, id).expect(404);
    expect(await filesFor(id)).toHaveLength(0);
    expect((await FoodItemModel.findById(id))!.photoAt).toBeNull();
    expect(await mongoose.connection.db!.collection('foodPhotos.chunks').countDocuments()).toBe(0);
  });

  it('is stored with the household, the food and who uploaded it', async () => {
    const { host, guest } = await pair();
    const { id } = await add(host);
    await upload(guest, id, await png()).expect(200);
    const [file] = await filesFor(id);
    const hostDoc = (await mongoose.connection.db!.collection('users').findOne({ email: host.user.email }))!;
    expect(String(file!.metadata.householdId)).toBe(String(hostDoc.householdId));
    expect(String(file!.metadata.foodId)).toBe(id);
    expect(String(file!.metadata.uploadedBy)).toBe(guest.user.id);
  });

  it('lets any member of a household see, replace and remove it', async () => {
    const { host, guest } = await pair();
    const { id } = await add(host);
    await upload(host, id, await png()).expect(200);
    await fetchPhoto(guest, id).expect(200);
    await upload(guest, id, await otherPng()).expect(200);
    await host.auth(api().delete(`/api/foods/${id}/photo`)).expect(204);
    await fetchPhoto(guest, id).expect(404);
  });
});

describe('automatic deletion 30 days after an item is closed', () => {
  const closeAndPhoto = async (s: Session, action: 'waste' | 'use') => {
    const { id } = await add(s);
    await upload(s, id, await png()).expect(200);
    await s
      .auth(
        api()
          .post(`/api/foods/${id}/${action}`)
          .send(action === 'use' ? { quantity: 1 } : {}),
      )
      .expect(200);
    return id;
  };

  it('keeps a closed item’s photo for 30 days, then deletes it and clears the item’s photo marker', async () => {
    const s = await registerUser();
    const id = await closeAndPhoto(s, 'waste'); // closed 29 Sep, midday
    expect(await purgeClosedPhotos(new Date('2026-10-28T12:00:00Z'))).toBe(0); // 29 days on
    expect(await filesFor(id)).toHaveLength(2);
    expect(await purgeClosedPhotos(new Date('2026-10-29T12:00:00Z'))).toBe(0); // exactly 30 days
    expect(await purgeClosedPhotos(new Date('2026-10-30T12:00:00Z'))).toBe(2); // 31 days: both sizes
    expect(await filesFor(id)).toHaveLength(0);
    expect((await FoodItemModel.findById(id))!.photoAt).toBeNull();
    expect(await mongoose.connection.db!.collection('foodPhotos.chunks').countDocuments()).toBe(0);
  });

  it('does the same for food that was used up, or removed', async () => {
    const s = await registerUser();
    const used = await closeAndPhoto(s, 'use');
    const removed = await add(s, { name: 'Jam' });
    await upload(s, removed.id, await png()).expect(200);
    await s.auth(api().delete(`/api/foods/${removed.id}`)).expect(204);
    expect(await purgeClosedPhotos(new Date('2026-11-05T12:00:00Z'))).toBe(4);
    expect(await filesFor(used)).toHaveLength(0);
    expect(await filesFor(removed.id)).toHaveLength(0);
  });

  it('never deletes the photo of food that is still active, however long ago it was added', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, await png()).expect(200);
    expect(await purgeClosedPhotos(new Date('2027-09-29T12:00:00Z'))).toBe(0);
    expect(await filesFor(id)).toHaveLength(2);
  });

  it('keeps the photo when a closed item is brought back with Undo', async () => {
    const s = await registerUser();
    const id = await closeAndPhoto(s, 'waste');
    await s.auth(api().post(`/api/foods/${id}/undo`)).expect(200);
    expect(await purgeClosedPhotos(new Date('2026-12-29T12:00:00Z'))).toBe(0);
    await fetchPhoto(s, id).expect(200);
  });

  it('deletes a photo whose item no longer exists', async () => {
    const s = await registerUser();
    const { id } = await add(s);
    await upload(s, id, await png()).expect(200);
    await FoodItemModel.deleteOne({ _id: id });
    expect(await purgeClosedPhotos()).toBe(2);
    expect(await filesFor(id)).toHaveLength(0);
  });

  it('does nothing when there are no photos', async () => {
    expect(await purgeClosedPhotos()).toBe(0);
  });
});

describe('deleting an account', () => {
  it('deletes every photo of a household of one at once', async () => {
    const s = await registerUser();
    const a = await add(s, { name: 'Milk' });
    const b = await add(s, { name: 'Bread' });
    await upload(s, a.id, await png()).expect(200);
    await upload(s, b.id, await otherPng()).expect(200);
    const bystander = await registerUser();
    const keep = await add(bystander);
    await upload(bystander, keep.id, await png()).expect(200);

    await s.auth(api().delete('/api/account').send({ password: s.password })).expect(204);

    expect(await filesFor(a.id)).toHaveLength(0);
    expect(await filesFor(b.id)).toHaveLength(0);
    expect(await filesFor(keep.id)).toHaveLength(2); // someone else's photo is untouched
    await fetchPhoto(bystander, keep.id).expect(200);
  });

  it('in a shared household deletes the photos of what they added and of what they uploaded, and keeps the rest', async () => {
    const { host, guest } = await pair();
    const hers = await add(host, { name: 'Milk' });
    const his = await add(guest, { name: 'Bread' });
    const hersWithHisPhoto = await add(host, { name: 'Eggs' });
    await upload(host, hers.id, await png()).expect(200);
    await upload(guest, his.id, await png()).expect(200);
    await upload(guest, hersWithHisPhoto.id, await otherPng()).expect(200);

    await guest.auth(api().delete('/api/account').send({ password: guest.password })).expect(204);

    expect(await filesFor(his.id)).toHaveLength(0);
    expect(await filesFor(hersWithHisPhoto.id)).toHaveLength(0); // he took that photo
    expect(await filesFor(hers.id)).toHaveLength(2);
    await fetchPhoto(host, hers.id).expect(200);
  });
});

describe('households and photos', () => {
  it('a new member sees the photos of the household, and food brought along keeps its photo', async () => {
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    const bread = await add(guest, { name: 'Bread' });
    await upload(guest, bread.id, await png()).expect(200);
    const code = (await host.auth(api().post('/api/household/invites')).expect(201)).body.code;
    await fetchPhoto(host, bread.id).expect(404);
    await guest.auth(api().post('/api/household/join').send({ code })).expect(200);
    await fetchPhoto(host, bread.id).expect(200);
    await fetchPhoto(guest, bread.id).expect(200);
  });

  it('leaving takes the photos of the food you added, and leaves the rest', async () => {
    const { host, guest } = await pair();
    const milk = await add(host, { name: 'Milk' });
    const bread = await add(guest, { name: 'Bread' });
    await upload(host, milk.id, await png()).expect(200);
    await upload(host, bread.id, await otherPng()).expect(200);

    await guest.auth(api().post('/api/household/leave')).expect(200);

    await fetchPhoto(guest, bread.id).expect(200);
    await fetchPhoto(host, bread.id).expect(404);
    await fetchPhoto(host, milk.id).expect(200);
    await fetchPhoto(guest, milk.id).expect(404);
  });
});

describe('receipts', () => {
  it('are never stored: reading one writes nothing to the photo store', async () => {
    const s = await registerUser();
    await s.auth(api().post('/api/parse/receipt').send({ mediaType: 'image/jpeg', image: 'QUJD' })).expect(503); // AI is off
    expect(await gridfsFiles().countDocuments()).toBe(0);
  });
});
