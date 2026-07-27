/*
 * FlashRead - lib/settings.js
 * ---------------------------------------------------------------------------
 * Gemeinsame Definition der Einstellungen fuer Content-Script und
 * Options-Seite. Wird in beiden Kontexten geladen (siehe background.js ->
 * INJECT_FILES und options.html).
 *
 *   FR_DEFAULTS      - Standardwerte
 *   FRSettings.load()          -> Promise<settings>
 *   FRSettings.save(patch)     -> Promise<settings>
 *   FRSettings.getPosition(url)-> Promise<{index,total,title,ts}|null>
 *   FRSettings.setPosition(...)-> Promise<void>
 *   FRSettings.clearPositions()-> Promise<void>
 *
 * Einstellungen liegen in storage.sync (geraetuebergreifend, klein).
 * Lesepositionen liegen in storage.local, weil sync nur ~100 KB fasst und
 * Positionen sonst das Kontingent sprengen wuerden.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const api = global.FRAPI || global.browser || global.chrome;

  const FR_DEFAULTS = {
    wpm: 350,                 // Zieltempo in Woertern pro Minute
    fontSize: 64,             // Schriftgroesse des Wortes in px
    fontFamily: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    theme: 'dark',            // 'dark' | 'light' | 'sepia'
    pivotColor: '#ff4b4b',    // Farbe des ORP-Buchstabens
    chunkSize: 1,             // 1-3 Woerter gleichzeitig
    smartPauses: true,        // laengere Woerter + Satzzeichen bremsen
    warmup: true,             // sanfter Start ueber die ersten 5 Woerter
    rememberPosition: true,   // letzte Position pro URL merken
    fullscreen: true          // Overlay automatisch in den Vollbildmodus
  };

  const MAX_POSITIONS = 60;   // aeltere Eintraege werden verworfen

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** Sorgt dafuer, dass gespeicherte Werte im gueltigen Bereich liegen. */
  function sanitize(raw) {
    const s = Object.assign({}, FR_DEFAULTS, raw || {});
    s.wpm = Math.round(clamp(s.wpm, 100, 1000, FR_DEFAULTS.wpm) / 25) * 25;
    s.fontSize = Math.round(clamp(s.fontSize, 24, 160, FR_DEFAULTS.fontSize));
    s.chunkSize = Math.round(clamp(s.chunkSize, 1, 3, FR_DEFAULTS.chunkSize));
    if (!['dark', 'light', 'sepia'].includes(s.theme)) s.theme = FR_DEFAULTS.theme;
    if (!/^#[0-9a-f]{3,8}$/i.test(String(s.pivotColor))) s.pivotColor = FR_DEFAULTS.pivotColor;
    if (typeof s.fontFamily !== 'string' || !s.fontFamily.trim()) s.fontFamily = FR_DEFAULTS.fontFamily;
    s.smartPauses = !!s.smartPauses;
    s.warmup = !!s.warmup;
    s.rememberPosition = !!s.rememberPosition;
    s.fullscreen = !!s.fullscreen;
    return s;
  }

  /** Normalisiert die URL als Schluessel (ohne Hash, ohne Tracking-Rest). */
  function urlKey(href) {
    try {
      const u = new URL(href);
      u.hash = '';
      return u.origin + u.pathname + u.search;
    } catch (_) {
      return String(href).split('#')[0];
    }
  }

  const FRSettings = {
    DEFAULTS: FR_DEFAULTS,
    sanitize,
    urlKey,

    async load() {
      try {
        const stored = await api.storage.sync.get('settings');
        return sanitize(stored && stored.settings);
      } catch (_) {
        // z. B. wenn sync deaktiviert ist -> lokal versuchen
        try {
          const local = await api.storage.local.get('settings');
          return sanitize(local && local.settings);
        } catch (__) {
          return sanitize(null);
        }
      }
    },

    async save(patch) {
      const current = await FRSettings.load();
      const next = sanitize(Object.assign({}, current, patch));
      try {
        await api.storage.sync.set({ settings: next });
      } catch (_) {
        await api.storage.local.set({ settings: next });
      }
      return next;
    },

    async reset() {
      try { await api.storage.sync.remove('settings'); } catch (_) { /* egal */ }
      try { await api.storage.local.remove('settings'); } catch (_) { /* egal */ }
      return sanitize(null);
    },

    async getPosition(href) {
      try {
        const { positions } = await api.storage.local.get('positions');
        return (positions && positions[urlKey(href)]) || null;
      } catch (_) {
        return null;
      }
    },

    async setPosition(href, index, total, title) {
      try {
        const { positions } = await api.storage.local.get('positions');
        const map = positions || {};
        map[urlKey(href)] = { index, total, title: title || '', ts: Date.now() };

        // aelteste Eintraege abschneiden (einfache LRU)
        const keys = Object.keys(map);
        if (keys.length > MAX_POSITIONS) {
          keys.sort((a, b) => map[a].ts - map[b].ts)
              .slice(0, keys.length - MAX_POSITIONS)
              .forEach((k) => delete map[k]);
        }
        await api.storage.local.set({ positions: map });
      } catch (err) {
        console.debug('[FlashRead] Position konnte nicht gespeichert werden:', err);
      }
    },

    async clearPosition(href) {
      try {
        const { positions } = await api.storage.local.get('positions');
        if (!positions) return;
        delete positions[urlKey(href)];
        await api.storage.local.set({ positions });
      } catch (_) { /* egal */ }
    },

    async clearPositions() {
      try { await api.storage.local.remove('positions'); } catch (_) { /* egal */ }
    },

    async countPositions() {
      try {
        const { positions } = await api.storage.local.get('positions');
        return positions ? Object.keys(positions).length : 0;
      } catch (_) {
        return 0;
      }
    }
  };

  global.FR_DEFAULTS = FR_DEFAULTS;
  global.FRSettings = FRSettings;

// WICHTIG: `globalThis`, nicht `window`.
// In Firefox-Content-Scripts sind das zwei verschiedene Objekte: `globalThis`
// ist der Sandbox-Global der Erweiterung, `window` eine Xray-gekapselte Sicht
// auf das Seitenfenster. Alle injizierten Dateien muessen denselben Global
// benutzen, sonst finden sie sich gegenseitig nicht. In Chrome und auf normalen
// Erweiterungsseiten sind beide identisch, dort aendert es nichts.
})(globalThis);
