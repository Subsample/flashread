/*
 * FlashRead - background.js
 * ---------------------------------------------------------------------------
 * Laeuft in Chrome als Service Worker, in Firefox als Event Page
 * (siehe manifest.json: background.service_worker + background.scripts).
 *
 * Aufgaben:
 *   - Kontextmenue anlegen ("Mit FlashRead lesen")
 *   - Auf Toolbar-Klick, Kontextmenue-Klick und Alt+R reagieren
 *   - Content-Scripts bei Bedarf einmalig in den Tab injizieren
 *   - Den Reader per Nachricht starten
 *
 * Keine externen Requests, keine Telemetrie.
 * ---------------------------------------------------------------------------
 */
'use strict';

importScriptsSafe('lib/browser-polyfill.js');

/**
 * Laedt den Polyfill in beiden Welten:
 *  - Chrome Service Worker: importScripts()
 *  - Firefox Event Page: die Datei wird gar nicht gebraucht, weil `browser`
 *    global existiert; wir bauen FRAPI dann direkt hier.
 */
function importScriptsSafe(path) {
  try {
    if (typeof importScripts === 'function') {
      importScripts(path);
      return;
    }
  } catch (err) {
    console.warn('[FlashRead] importScripts fehlgeschlagen, nutze Fallback.', err);
  }
  // Fallback (Firefox Event Page / falls importScripts nicht verfuegbar ist)
  self.FRAPI = self.browser && self.browser.runtime ? self.browser : self.chrome;
}

const api = self.FRAPI || self.browser || self.chrome;

const MENU_ID = 'flashread-read';

// Dateien, die in die Seite injiziert werden - Reihenfolge ist wichtig.
const INJECT_FILES = [
  'lib/browser-polyfill.js',
  'lib/settings.js',
  'lib/readability.js',
  'reader.js',
  'content.js'
];

// --- Kontextmenue -----------------------------------------------------------

function addMenu() {
  try {
    api.contextMenus.create({
      id: MENU_ID,
      title: 'Mit FlashRead lesen',
      contexts: ['page', 'selection', 'link', 'image']
    });
  } catch (err) {
    // "duplicate id" ist harmlos - das Menue existiert dann bereits.
    console.debug('[FlashRead] contextMenus.create:', err);
  }
  void api.runtime.lastError;
}

function createMenu() {
  // removeAll verhindert doppelte Eintraege nach Reload/Update der Extension.
  // Chrome (MV3) und Firefox liefern hier beide ein Promise zurueck.
  try {
    const pending = api.contextMenus.removeAll();
    if (pending && typeof pending.then === 'function') pending.then(addMenu, addMenu);
    else setTimeout(addMenu, 0);
  } catch (err) {
    addMenu();
  }
}

api.runtime.onInstalled.addListener(createMenu);
if (api.runtime.onStartup) api.runtime.onStartup.addListener(createMenu);

// --- Ausloeser --------------------------------------------------------------

api.action.onClicked.addListener((tab) => start(tab));

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // Hinweis: info.selectionText waere in Chrome auf ~150 Zeichen gekuerzt.
  // Deshalb liest das Content-Script die Auswahl selbst aus dem DOM.
  start(tab);
});

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    if (command !== 'flashread-start') return;
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab) start(tab);
  });
}

// Options-Seite oeffnen, wenn das Content-Script darum bittet
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'FLASHREAD_OPEN_OPTIONS') {
    api.runtime.openOptionsPage();
  }
});

// --- Injektion --------------------------------------------------------------

/**
 * Seiten, auf denen Content-Scripts grundsaetzlich gesperrt sind.
 *
 * WICHTIG: Das ist nur eine Vorab-Hoeflichkeit fuer eine bessere Meldung.
 * Es darf NICHT als Gate benutzt werden, denn in Firefox ist `tab.url` mit
 * blossem `activeTab` haeufig `undefined` - ein Gate darauf wuerde jeden
 * Start blockieren. Ist die URL unbekannt, versuchen wir es einfach.
 */
function isBlockedUrl(url) {
  if (!url) return false;                     // unbekannt -> nicht blockieren
  if (!/^(https?|file):/i.test(url)) return true;
  return /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org)/i.test(url);
}

/** Injiziert die Scripts genau einmal pro Tab-Ladevorgang. */
async function ensureInjected(tabId) {
  let already = false;
  try {
    const res = await api.scripting.executeScript({
      target: { tabId },
      // globalThis, damit die Probe denselben Global sieht wie content.js
      // (in Firefox ist `window` im Content-Script ein anderes Objekt).
      func: () => !!globalThis.__FLASHREAD_READY__
    });
    already = !!(res && res[0] && res[0].result);
  } catch (err) {
    // Probe fehlgeschlagen -> einfach injizieren. Die Scripts sind gegen
    // Doppelausfuehrung abgesichert.
    console.debug('[FlashRead] Probe nicht moeglich:', err);
  }
  if (already) return;

  // Nacheinander und einzeln injizieren: Chrome akzeptiert mehrere Dateien
  // pro Aufruf, Firefox verhaelt sich hier nicht zuverlaessig gleich.
  // Sequenziell ist die Reihenfolge ausserdem garantiert.
  for (const file of INJECT_FILES) {
    await api.scripting.executeScript({ target: { tabId }, files: [file] });
  }
}

async function start(tab) {
  // Firefox liefert bei manchen Ausloesern kein Tab-Objekt mit.
  if (!tab || tab.id == null) {
    const [active] = await api.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  if (!tab || tab.id == null) {
    console.warn('[FlashRead] Kein aktiver Tab gefunden.');
    return;
  }

  if (isBlockedUrl(tab.url)) {
    notifyError(tab.id, 'Diese Seite erlaubt keine Erweiterungen: ' + tab.url);
    return;
  }

  try {
    await ensureInjected(tab.id);
    await api.tabs.sendMessage(tab.id, { type: 'FLASHREAD_START' });
  } catch (err) {
    notifyError(tab.id, (err && err.message) || String(err));
  }
}

/**
 * Fehler sichtbar machen: rotes "!" am Icon plus die konkrete Ursache als
 * Tooltip - sonst weiss man nicht, warum nichts passiert. Zusaetzlich in der
 * Konsole des Hintergrundskripts (about:debugging -> Untersuchen).
 */
function notifyError(tabId, message) {
  console.error('[FlashRead] Start fehlgeschlagen:', message);
  try {
    api.action.setBadgeBackgroundColor({ color: '#c0392b' });
    api.action.setBadgeText({ tabId, text: '!' });
    api.action.setTitle({ tabId, title: 'FlashRead: ' + message });
    setTimeout(() => {
      api.action.setBadgeText({ tabId, text: '' });
      api.action.setTitle({ tabId, title: 'Mit FlashRead lesen (Alt+R)' });
    }, 8000);
  } catch (_) { /* Badge/Tooltip sind optional */ }
}
