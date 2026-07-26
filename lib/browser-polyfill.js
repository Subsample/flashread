/*
 * FlashRead - lib/browser-polyfill.js
 * ---------------------------------------------------------------------------
 * Winziges Kompatibilitaets-Layer fuer Firefox (`browser.*`, Promise-basiert)
 * und Chrome (`chrome.*`, in MV3 ebenfalls Promise-basiert ab Chrome 88).
 *
 * Ergebnis: `globalThis.FRAPI` zeigt auf das jeweils vorhandene Namespace-
 * Objekt. Zusaetzlich stellen wir ein paar kleine Helfer bereit, die die
 * verbliebenen Unterschiede zwischen den beiden Engines glaetten.
 *
 * Diese Datei laeuft unveraendert im Service Worker / Event Page, in
 * Content-Scripts und auf der Options-Seite.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // Firefox liefert `browser` mit echten Promises, Chrome nur `chrome`.
  // In Chrome MV3 geben die meisten APIs ebenfalls Promises zurueck, sodass
  // wir mit einem einfachen Alias auskommen.
  const api = global.browser && global.browser.runtime
    ? global.browser
    : global.chrome;

  if (!api) {
    // Sollte nie passieren - aber lieber laut scheitern als still.
    throw new Error('[FlashRead] Keine WebExtension-API gefunden.');
  }

  /**
   * Ruft eine API-Methode auf und liefert immer ein Promise zurueck -
   * egal ob die Engine Promises oder Callbacks verwendet.
   */
  function promisify(fn, thisArg, ...args) {
    try {
      const result = fn.apply(thisArg, args);
      if (result && typeof result.then === 'function') return result;
      // Callback-Stil (sehr alte Chrome-Versionen)
      return new Promise((resolve) => {
        fn.apply(thisArg, [...args, (value) => {
          // lastError abfragen, damit Chrome keine Warnung in die Konsole schreibt
          void api.runtime.lastError;
          resolve(value);
        }]);
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** true, wenn wir in Firefox laufen (fuer die wenigen echten Unterschiede). */
  const isFirefox = typeof global.browser !== 'undefined'
    && !!global.browser.runtime
    && /Firefox|Gecko/.test(global.navigator ? global.navigator.userAgent : '');

  global.FRAPI = api;
  global.FRUtil = { promisify, isFirefox };
})(typeof globalThis !== 'undefined' ? globalThis : self);
