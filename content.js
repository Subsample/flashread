/*
 * FlashRead - content.js
 * ---------------------------------------------------------------------------
 * Laeuft in der Seite (isolierte Welt). Verbindet die drei Bausteine:
 *
 *   1. Text besorgen  -> Auswahl ODER Readability ODER Absatzdichte-Heuristik
 *   2. Text tokenisieren -> Woerter + Absatzgrenzen
 *   3. Reader-Overlay oeffnen (reader.js) und Leseposition persistieren
 *
 * Wird von background.js per scripting.executeScript einmal pro Tab injiziert.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // Doppelte Injektion verhindern (background.js prueft dieses Flag).
  if (globalThis.__FLASHREAD_READY__) return;

  // `globalThis`, nicht `window`: in Firefox-Content-Scripts sind das zwei
  // verschiedene Objekte (Xray). Auf `window` liegt hier weder `FRAPI` noch
  // `browser` - der Zugriff darauf lieferte undefined und liess den Listener
  // nie registrieren ("Receiving end does not exist").
  const api = globalThis.FRAPI || globalThis.browser || globalThis.chrome;

  // Alle injizierten Dateien muessen sich im selben Global wiederfinden.
  // Schlaegt das fehl, wuerde weiter unten ein nichtssagender TypeError
  // fliegen - deshalb hier eine klare Meldung.
  const fehlt = ['FRAPI', 'FRSettings', 'Readability', 'FlashReadReader']
    .filter((name) => !globalThis[name]);
  if (!api || fehlt.length) {
    console.error('[FlashRead] Abhaengigkeiten nicht gefunden:', fehlt.join(', ') || '(keine API)',
      '- Injektionsreihenfolge in background.js pruefen.');
    // Flag NICHT setzen: sonst haelt background.js den Tab fuer fertig
    // injiziert und ein zweiter Versuch wuerde uebersprungen.
    return;
  }

  // Ab hier ist alles da - erst jetzt als bereit markieren.
  globalThis.__FLASHREAD_READY__ = true;

  // --- 1. Textquelle -------------------------------------------------------

  /**
   * Markierter Text, falls vorhanden (mehr als ein paar Zeichen).
   *
   * Markierungen innerhalb von <input> und <textarea> tauchen in
   * window.getSelection() nicht zuverlaessig auf - die haben ihre eigene
   * Auswahl. Deshalb wird das aktive Element zuerst geprueft.
   */
  function getSelectionText() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)
        && typeof active.selectionStart === 'number'
        && active.selectionEnd > active.selectionStart) {
      const raw = String(active.value).slice(active.selectionStart, active.selectionEnd);
      if (raw.trim().length > 20) return raw;
    }

    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    const raw = sel.toString();
    return raw && raw.trim().length > 20 ? raw : '';
  }

  /**
   * Fallback, falls Readability nichts findet: der Container mit der
   * hoechsten "Absatzdichte" - viel <p>-Text, wenig Linktext.
   */
  function densityFallback() {
    const paragraphs = Array.from(document.querySelectorAll('p, article, section > div'))
      .filter((p) => (p.textContent || '').trim().length > 40);
    if (!paragraphs.length) return '';

    // Punkte fuer jeden Vorfahren sammeln: Summe der Absatzlaengen.
    const score = new Map();
    for (const p of paragraphs) {
      const len = p.textContent.trim().length;
      let node = p.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth < 6) {
        score.set(node, (score.get(node) || 0) + len);
        node = node.parentElement;
        depth++;
      }
    }

    let best = null;
    let bestValue = 0;
    for (const [node, value] of score) {
      // Linklastige Container (Navigation, Teaser-Listen) abwerten
      const density = globalThis.Readability ? globalThis.Readability.linkDensity(node) : 0;
      const adjusted = value * (1 - Math.min(density, 0.9));
      // Bei Gleichstand den *spezifischeren* (tieferen) Knoten bevorzugen
      if (adjusted > bestValue * 1.02) { bestValue = adjusted; best = node; }
    }

    if (!best) return '';
    // cleanTextFrom raeumt auf einer Kopie auf (Werbung, Kommentare, ...) -
    // im lebenden DOM duerfen wir nichts entfernen.
    if (globalThis.Readability && globalThis.Readability.cleanTextFrom) {
      return globalThis.Readability.cleanTextFrom(best);
    }
    return (best.innerText || best.textContent || '').trim();
  }

  /** Liefert { text, title, source } fuer die aktuelle Seite. */
  function extract() {
    const selection = getSelectionText();
    if (selection) {
      return { text: selection, title: document.title, source: 'Auswahl' };
    }

    if (globalThis.Readability) {
      try {
        const article = new globalThis.Readability(document.cloneNode(true)).parse();
        if (article && article.textContent && article.textContent.length > 250) {
          return { text: article.textContent, title: article.title || document.title, source: 'Readability' };
        }
      } catch (err) {
        console.warn('[FlashRead] Readability-Fehler:', err);
      }
    }

    const fallback = densityFallback();
    if (fallback && fallback.length > 120) {
      return { text: fallback, title: document.title, source: 'Absatzdichte' };
    }

    // Letzte Rettung: sichtbarer Body-Text
    const body = (document.body && document.body.innerText || '').trim();
    return { text: body, title: document.title, source: 'Seitentext' };
  }

  // --- 2. Tokenisierung ----------------------------------------------------

  /*
   * Obergrenze fuer die Wortzahl. Schuetzt vor Seiten, die faktisch ein ganzes
   * Buch enthalten (Gesetzestexte, API-Referenzen, endlos nachladende Feeds):
   * die Wortliste und die Chunk-Liste liegen komplett im Speicher, und ein
   * Fortschrittsbalken ueber 300.000 Woerter ist ohnehin sinnlos.
   * 120.000 Woerter sind bei 350 wpm knapp sechs Stunden Lesezeit.
   */
  const MAX_WORDS = 120000;

  /**
   * Zerlegt den Text in Woerter und merkt sich, wo ein Absatz endet.
   * @returns {Array<{w:string, endPara:boolean}>}
   */
  function tokenize(text) {
    const words = [];
    const paragraphs = String(text)
      .replace(/­/g, '')          // weiche Trennstriche entfernen
      .replace(/\r/g, '')
      .split(/\n{2,}|\n/);

    for (const paragraph of paragraphs) {
      const parts = paragraph.split(/\s+/).filter(Boolean);
      if (!parts.length) continue;
      for (const part of parts) words.push({ w: part, endPara: false });
      words[words.length - 1].endPara = true;
      if (words.length >= MAX_WORDS) {
        console.warn('[FlashRead] Text bei ' + MAX_WORDS + ' Woertern abgeschnitten.');
        break;
      }
    }

    if (words.length) words[words.length - 1].endPara = true;
    return words;
  }

  // --- 3. Ablauf -----------------------------------------------------------

  let busy = false;

  async function start() {
    if (busy) return;
    if (globalThis.FlashReadReader && globalThis.FlashReadReader.isOpen()) {
      globalThis.FlashReadReader.close();
      return;
    }
    busy = true;

    try {
      const settings = await globalThis.FRSettings.load();
      const { text, title, source } = extract();
      const words = tokenize(text);

      if (words.length < 5) {
        globalThis.FlashReadReader.toast('FlashRead: Auf dieser Seite wurde kein lesbarer Text gefunden.');
        return;
      }

      const isSelection = source === 'Auswahl';
      let resume = null;
      if (settings.rememberPosition && !isSelection) {
        const saved = await globalThis.FRSettings.getPosition(location.href);
        // Nur anbieten, wenn der Text noch ungefaehr derselbe ist.
        if (saved && saved.index > 5 && Math.abs(saved.total - words.length) <= words.length * 0.1) {
          resume = saved;
        }
      }

      globalThis.FlashReadReader.open({
        words,
        settings,
        title: title || document.location.hostname,
        source,
        resume,
        // Fortschritt regelmaessig sichern
        onProgress: (index) => {
          if (!settings.rememberPosition || isSelection) return;
          globalThis.FRSettings.setPosition(location.href, index, words.length, title);
        },
        // Am Ende die Position loeschen, damit nicht "fortsetzen" angeboten wird
        onFinished: () => {
          if (!isSelection) globalThis.FRSettings.clearPosition(location.href);
        },
        onOpenOptions: () => {
          api.runtime.sendMessage({ type: 'FLASHREAD_OPEN_OPTIONS' });
        },
        onSaveSettings: (patch) => globalThis.FRSettings.save(patch)
      });
    } catch (err) {
      console.error('[FlashRead] Fehler beim Start:', err);
    } finally {
      busy = false;
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'FLASHREAD_START') {
      start();
      sendResponse({ ok: true });
    }
    return false;
  });

  // Direkt beim ersten Injizieren loslegen - der Aufruf aus background.js
  // kommt zwar zusaetzlich per Nachricht, wird aber durch `busy` entkoppelt.
  console.debug('[FlashRead] Content-Script bereit.');
})();
