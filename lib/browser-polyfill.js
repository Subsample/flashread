/*
 * FlashRead - lib/browser-polyfill.js
 * ---------------------------------------------------------------------------
 * Kompatibilitaets-Layer fuer Firefox (`browser.*`) und Chrome (`chrome.*`).
 * Beide sind in Manifest V3 Promise-basiert, ein Alias genuegt also.
 *
 * Ergebnis: `globalThis.FRAPI`.
 *
 * WICHTIG: `globalThis`, nicht `window`. In Firefox-Content-Scripts sind das
 * zwei verschiedene Objekte - `globalThis` ist der Sandbox-Global der
 * Erweiterung, `window` eine Xray-gekapselte Sicht auf das Seitenfenster.
 * Alle injizierten Dateien muessen denselben Global benutzen, sonst finden sie
 * sich gegenseitig nicht.
 *
 * Laeuft unveraendert im Service Worker, in Content-Scripts und auf der
 * Options-Seite.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const api = global.browser && global.browser.runtime ? global.browser : global.chrome;

  if (!api) throw new Error('[FlashRead] Keine WebExtension-API gefunden.');

  global.FRAPI = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
