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
  if (window.__FLASHREAD_READY__) return;
  window.__FLASHREAD_READY__ = true;

  const api = window.FRAPI || window.browser || window.chrome;

  // --- 1. Textquelle -------------------------------------------------------

  /** Markierter Text, falls vorhanden (mehr als ein paar Zeichen). */
  function getSelectionText() {
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
      const density = window.Readability ? window.Readability.linkDensity(node) : 0;
      const adjusted = value * (1 - Math.min(density, 0.9));
      // Bei Gleichstand den *spezifischeren* (tieferen) Knoten bevorzugen
      if (adjusted > bestValue * 1.02) { bestValue = adjusted; best = node; }
    }

    if (!best) return '';
    // cleanTextFrom raeumt auf einer Kopie auf (Werbung, Kommentare, ...) -
    // im lebenden DOM duerfen wir nichts entfernen.
    if (window.Readability && window.Readability.cleanTextFrom) {
      return window.Readability.cleanTextFrom(best);
    }
    return (best.innerText || best.textContent || '').trim();
  }

  /** Liefert { text, title, source } fuer die aktuelle Seite. */
  function extract() {
    const selection = getSelectionText();
    if (selection) {
      return { text: selection, title: document.title, source: 'Auswahl' };
    }

    if (window.Readability) {
      try {
        const article = new window.Readability(document.cloneNode(true)).parse();
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
    }

    if (words.length) words[words.length - 1].endPara = true;
    return words;
  }

  // --- 3. Ablauf -----------------------------------------------------------

  let busy = false;

  async function start() {
    if (busy) return;
    if (window.FlashReadReader && window.FlashReadReader.isOpen()) {
      window.FlashReadReader.close();
      return;
    }
    busy = true;

    try {
      const settings = await window.FRSettings.load();
      const { text, title, source } = extract();
      const words = tokenize(text);

      if (words.length < 5) {
        window.FlashReadReader.toast('FlashRead: Auf dieser Seite wurde kein lesbarer Text gefunden.');
        return;
      }

      const isSelection = source === 'Auswahl';
      let resume = null;
      if (settings.rememberPosition && !isSelection) {
        const saved = await window.FRSettings.getPosition(location.href);
        // Nur anbieten, wenn der Text noch ungefaehr derselbe ist.
        if (saved && saved.index > 5 && Math.abs(saved.total - words.length) <= words.length * 0.1) {
          resume = saved;
        }
      }

      window.FlashReadReader.open({
        words,
        settings,
        title: title || document.location.hostname,
        source,
        resume,
        // Fortschritt regelmaessig sichern
        onProgress: (index) => {
          if (!settings.rememberPosition || isSelection) return;
          window.FRSettings.setPosition(location.href, index, words.length, title);
        },
        // Am Ende die Position loeschen, damit nicht "fortsetzen" angeboten wird
        onFinished: () => {
          if (!isSelection) window.FRSettings.clearPosition(location.href);
        },
        onOpenOptions: () => {
          api.runtime.sendMessage({ type: 'FLASHREAD_OPEN_OPTIONS' });
        },
        onSaveSettings: (patch) => window.FRSettings.save(patch)
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
