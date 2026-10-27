/* global process, console, fetch, URL, AbortSignal */
// Checks a deployed FridgeStock (staging or production) from the outside, the way a phone would see it.
//
//   npm run check:staging -- --api https://fridgestock-api.onrender.com --client https://fridgestock.vercel.app
//
// It needs no login and changes nothing. Exit code 0 means every check passed (warnings don't fail it).

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const api = (option('api') ?? process.env.STAGING_API_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const client = (option('client') ?? process.env.STAGING_CLIENT_URL ?? '').replace(/\/+$/, '');

if (!api || !client) {
  console.error('Usage: npm run check:staging -- --api https://<api-host> --client https://<web-host>');
  process.exit(2);
}

let failures = 0;
const pass = (message) => console.log(`  ok    ${message}`);
const warn = (message) => console.log(`  warn  ${message}`);
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const section = (title) => console.log(`\n${title}`);

const isLocal = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

async function get(url, init) {
  const started = Date.now();
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(90_000), ...init });
  return { res, ms: Date.now() - started };
}

section('HTTPS (the camera, barcode scanning, push and installing all need it)');
for (const [label, url] of [
  ['API', api],
  ['Web app', client],
]) {
  if (new URL(url).protocol === 'https:') pass(`${label} is served over https`);
  else if (isLocal(url)) warn(`${label} is on localhost over http: fine on this computer, but a phone needs https`);
  else fail(`${label} is not https: ${url}`);
}

section('API');
try {
  const { res, ms } = await get(`${api}/api/health`);
  if (res.status === 200 && (await res.json()).ok === true)
    pass(`GET /api/health is ok (${ms} ms${ms > 5000 ? ', slow: a free host may have been asleep' : ''})`);
  else fail(`GET /api/health returned ${res.status}`);
  const hsts = res.headers.get('strict-transport-security');
  if (hsts) pass('Strict-Transport-Security is set');
  else if (new URL(api).protocol === 'https:') warn('Strict-Transport-Security is missing');
  if (res.headers.get('x-content-type-options') === 'nosniff') pass('X-Content-Type-Options is nosniff');
  else fail('X-Content-Type-Options: nosniff is missing');
} catch (error) {
  fail(`the API can't be reached: ${error.message}`);
}

section('CORS (the web app must be allowed to call the API, and a stranger must not)');
const preflight = (origin) =>
  get(`${api}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });
try {
  const clientOrigin = new URL(client).origin;
  const allowed = (await preflight(clientOrigin)).res.headers.get('access-control-allow-origin');
  if (allowed === clientOrigin) pass(`${clientOrigin} is allowed`);
  else
    fail(
      `${clientOrigin} is NOT allowed (got "${allowed ?? 'nothing'}"): set CLIENT_ORIGIN on the API host to exactly this address, with no trailing slash`,
    );
  const stranger = (await preflight('https://not-allowed.example')).res.headers.get('access-control-allow-origin');
  if (!stranger) pass('another website is refused');
  else fail(`another website is allowed ("${stranger}")`);
  for (const native of ['capacitor://localhost', 'https://localhost']) {
    const ok = (await preflight(native)).res.headers.get('access-control-allow-origin') === native;
    if (ok) pass(`the native app origin ${native} is allowed`);
    else warn(`the native app origin ${native} is not allowed (only needed for the Capacitor apps)`);
  }
} catch (error) {
  fail(`the CORS check could not run: ${error.message}`);
}

section('Push and AI (informational)');
try {
  const { res } = await get(`${api}/api/push/config`);
  const body = res.ok ? await res.json() : null;
  if (body?.publicKey) pass('Web Push is set up (a VAPID public key is served)');
  else warn('Web Push is not set up: reminders stay in the app. Set the VAPID_* variables to turn it on.');
  if (body?.native === true) pass('native push (Firebase) is set up');
  else warn('native push (Firebase) is not set up (only needed for the Capacitor apps)');
  const status = await get(`${api}/api/ai/status`);
  if (status.res.status === 401) pass('GET /api/ai/status asks for a login, as it should');
  else warn(`GET /api/ai/status returned ${status.res.status} without a login`);
} catch (error) {
  warn(`could not read the push settings: ${error.message}`);
}

section('Web app (installable on a phone)');
try {
  const home = await get(`${client}/`);
  if (home.res.status === 200 && (home.res.headers.get('content-type') ?? '').includes('text/html'))
    pass(`the web app loads (${home.ms} ms)`);
  else fail(`the web app returned ${home.res.status} ${home.res.headers.get('content-type')}`);

  const manifest = await get(`${client}/manifest.webmanifest`);
  const manifestBody = manifest.res.ok ? await manifest.res.json().catch(() => null) : null;
  if (manifestBody?.name && manifestBody.display === 'standalone')
    pass('the manifest is served, so it can be installed to the Home Screen');
  else fail('the manifest.webmanifest is missing or invalid');

  const worker = await get(`${client}/sw.js`);
  if (worker.res.status === 200 && (worker.res.headers.get('content-type') ?? '').includes('javascript'))
    pass('the service worker is served as JavaScript');
  else fail(`/sw.js returned ${worker.res.status} ${worker.res.headers.get('content-type')}`);
  const cache = worker.res.headers.get('cache-control') ?? '';
  if (/no-cache|max-age=0|no-store/.test(cache)) pass('the service worker is not cached, so updates arrive');
  else warn('the service worker may be cached; add "Cache-Control: no-cache" for /sw.js');

  for (const icon of ['/icons/icon-192.png', '/icons/apple-touch-icon.png']) {
    const res = (await get(`${client}${icon}`)).res;
    if (res.status === 200) pass(`${icon} is served`);
    else fail(`${icon} returned ${res.status}`);
  }

  // A deep link must open the app (not a 404), because the app handles its own routes.
  const deep = await get(`${client}/fridgestock`);
  if (deep.res.status === 200) pass('a deep link such as /fridgestock opens the app');
  else fail(`a deep link returned ${deep.res.status}: add the rewrite to /index.html`);
} catch (error) {
  fail(`the web app can't be checked: ${error.message}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check${failures === 1 ? '' : 's'} failed.`);
process.exit(failures === 0 ? 0 : 1);
