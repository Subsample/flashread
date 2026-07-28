/*
 * FlashRead - lib/tokenize.js
 * ---------------------------------------------------------------------------
 * Zerlegt Fliesstext in Woerter und merkt sich die Absatzgrenzen.
 * Wird von content.js (Webseiten) und pdf-viewer.js (PDFs) benutzt.
 *
 * `globalThis`, nicht `window` - siehe Hinweis in lib/settings.js.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /*
   * Obergrenze fuer die Wortzahl. Schuetzt vor Quellen, die faktisch ein
   * ganzes Buch enthalten (Gesetzestexte, API-Referenzen, dicke PDFs): die
   * Wortliste und die Chunk-Liste liegen komplett im Speicher.
   * 120.000 Woerter sind bei 350 wpm knapp sechs Stunden Lesezeit.
   */
  const MAX_WORDS = 120000;

  /**
   * @param {string} text   Absaetze durch Leerzeile oder Zeilenumbruch getrennt
   * @returns {Array<{w:string, endPara:boolean}>}
   */
  function tokenize(text) {
    const words = [];
    const paragraphs = String(text)
      .replace(/­/g, '')     // weiche Trennstriche entfernen
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

  global.FRTokenize = tokenize;
  global.FR_MAX_WORDS = MAX_WORDS;
})(globalThis);
