import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { registerServiceWorker } from './lib/push';
import { platform } from './platform';
// Fonts are bundled (not fetched from a CDN) so they work offline, including in the native apps.
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/figtree/latin-400.css';
import '@fontsource/figtree/latin-500.css';
import '@fontsource/figtree/latin-600.css';
import './index.css';
import './stores/themeStore';

// Installable app + push reminders. Registering never asks for permission.
// (The apps have no service worker: they get push from Firebase, started below.)
if (!platform.native) void registerServiceWorker();
platform.push.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
