/*
 * FlashRead - lib/pdftext.js
 * ---------------------------------------------------------------------------
 * Holt lesbaren Fliesstext aus einem PDF.
 *
 * Das ist mehr Arbeit als es klingt: PDF kennt keine Absaetze und keine
 * Zeilen, sondern nur Textfragmente mit Koordinaten. Wer die einfach
 * aneinanderhaengt, bekommt Buchstabensalat mit zerrissenen Woertern. Deshalb
 * in drei Stufen:
 *
 *   1. Fragmente nach Y-Koordinate zu Zeilen gruppieren
 *   2. Wiederkehrende Kopf- und Fusszeilen erkennen und entfernen
 *   3. Zeilen anhand von Zeilenabstand, Zeilenlaenge und Einrueckung zu
 *      Absaetzen zusammenfassen, dabei Silbentrennung aufloesen
 *
 * ES-Modul, weil PDF.js ab Version 4 als Modul ausgeliefert wird.
 * ---------------------------------------------------------------------------
 */
'use strict';

/**
 * Adresse des PDF.js-Workers.
 *
 * Bewusst erst beim Aufruf aufgeloest und nicht beim Laden des Moduls: so
 * funktioniert die Datei auch dann, wenn `runtime.getURL` fehlt - etwa in
 * einem Testlauf ausserhalb der Erweiterung. Dann greift der relative Pfad.
 */
function workerUrl() {
  const api = globalThis.FRAPI || globalThis.browser || globalThis.chrome;
  const pfad = 'lib/pdfjs/pdf.worker.mjs';
  try {
    if (api && api.runtime && typeof api.runtime.getURL === 'function') {
      return api.runtime.getURL(pfad);
    }
  } catch (_) { /* faellt unten durch */ }
  return new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;
}

/** Median eines Zahlenfelds, 0 bei leerer Eingabe. */
function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Stufe 1: Textfragmente einer Seite zu Zeilen gruppieren.
 *
 * PDF.js liefert je Fragment eine Transformationsmatrix; Index 4 und 5 sind
 * die Position, Index 3 die Schrifthoehe. Fragmente auf gleicher Hoehe
 * gehoeren zur selben Zeile - mit Toleranz, weil Hoch- und Tiefstellungen
 * leicht abweichen.
 */
function itemsToLines(items) {
  const fragments = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const height = Math.abs(item.transform[3]) || item.height || 10;
    fragments.push({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height
    });
  }

  // von oben nach unten, innerhalb der Zeile von links nach rechts
  fragments.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  let current = null;

  for (const f of fragments) {
    const toleranz = Math.max(2, f.height * 0.5);

    const luecke = current ? f.x - current.right : 0;

    /*
     * Gleiche Hoehe allein genuegt nicht - in beide Richtungen:
     *
     * Nach LINKS: Faengt das Fragment deutlich vor dem rechten Rand der
     * laufenden Zeile an, gehoert es zu einem anderen Block. Sonst klebt eine
     * Fusszeile, die zufaellig auf Textzeilenhoehe sitzt, mitten im Satz.
     *
     * Nach RECHTS: Eine sehr grosse Luecke ist keine Wortgrenze, sondern ein
     * Spaltenzwischenraum. Ohne diese Pruefung verschmelzen die Zeilen zweier
     * Spalten zu einer einzigen ("Die Sakkade ist eine ruckartige Rapid
     * Serial Visual Presentation Blickbewegung, ...") und die spaetere
     * Spaltenerkennung findet gar keine Spalten mehr vor. Zweieinhalb
     * Schrifthoehen liegen weit ueber jedem Wortabstand, auch bei Blocksatz,
     * aber unter jedem ueblichen Spaltenzwischenraum.
     */
    const gleicheZeile = current
      && Math.abs(current.y - f.y) <= toleranz
      && luecke > -f.height * 0.5
      && luecke < f.height * 2.5;

    if (gleicheZeile) {
      // Grosse Luecke zwischen zwei Fragmenten = Wortgrenze, sonst direkt
      // anhaengen (PDF zerlegt Woerter oft mitten drin, etwa bei Kerning).
      current.text += (luecke > f.height * 0.25 ? ' ' : '') + f.str;
      current.right = Math.max(current.right, f.x + f.width);
      current.height = Math.max(current.height, f.height);
    } else {
      if (current) lines.push(current);
      current = {
        y: f.y, x: f.x, right: f.x + f.width,
        text: f.str, height: f.height
      };
    }
  }
  if (current) lines.push(current);

  for (const line of lines) line.text = line.text.replace(/\s+/g, ' ').trim();
  return lines.filter((line) => line.text);
}

/**
 * Sucht den Zwischenraum zwischen zwei Textspalten.
 *
 * Verfahren: die Seitenbreite in hundert Streifen zerlegen und zaehlen, wie
 * viele Zeilen jeden Streifen beruehren. Ein Spaltenzwischenraum ist eine
 * zusammenhaengende Folge voellig unberuehrter Streifen im mittleren Bereich
 * der Seite. Raender zaehlen nicht mit, deshalb wird nur zwischen 20 % und
 * 80 % gesucht.
 *
 * @returns {number|null} X-Koordinate der Spaltengrenze
 */
function findeSpaltengrenze(lines) {
  if (lines.length < 6) return null;

  const minX = Math.min(...lines.map((l) => l.x));
  const maxX = Math.max(...lines.map((l) => l.right));
  const breite = maxX - minX;
  if (breite <= 0) return null;

  const N = 100;
  const belegt = new Array(N).fill(0);
  for (const l of lines) {
    const von = Math.max(0, Math.floor((l.x - minX) / breite * N));
    const bis = Math.min(N - 1, Math.ceil((l.right - minX) / breite * N) - 1);
    for (let i = von; i <= bis; i++) belegt[i]++;
  }

  const links = Math.floor(N * 0.2);
  const rechts = Math.ceil(N * 0.8);
  let beste = null;
  let start = -1;

  for (let i = links; i <= rechts; i++) {
    if (belegt[i] === 0) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const laenge = i - start;
      if (!beste || laenge > beste.laenge) beste = { start, laenge };
      start = -1;
    }
  }
  if (start >= 0) {
    const laenge = rechts - start + 1;
    if (!beste || laenge > beste.laenge) beste = { start, laenge };
  }

  // Unter drei Prozent Seitenbreite ist es eher eine Satzluecke als eine Spalte
  if (!beste || beste.laenge < N * 0.03) return null;
  return minX + ((beste.start + beste.laenge / 2) / N) * breite;
}

/**
 * Bringt zweispaltigen Satz in Lesereihenfolge.
 *
 * Ohne diesen Schritt werden die Spalten zeilenweise verschraenkt, weil die
 * Sortierung nur die Hoehe kennt: "Die Sakkade ist eine ruckartige Rapid
 * Serial Visual Presentation Blickbewegung, ...". Vollbreite Zeilen
 * (Ueberschriften, Bildunterschriften) trennen die Seite dabei in Baender -
 * innerhalb eines Bandes wird erst die linke, dann die rechte Spalte
 * ausgegeben, das Band selbst bleibt an seiner Stelle.
 *
 * Jede Zeile bekommt eine Spaltennummer, damit die Absatzerkennung weiss,
 * wann ein Sprung stattgefunden hat - Y-Koordinaten sind ueber einen
 * Spaltenwechsel hinweg nicht vergleichbar.
 */
function orderColumns(lines) {
  const grenze = findeSpaltengrenze(lines);
  if (grenze == null) {
    for (const l of lines) l.col = 0;
    return lines;
  }

  const baender = [];
  let aktuell = [];

  for (const l of lines) {
    if (l.x < grenze && l.right > grenze) {          // vollbreit
      if (aktuell.length) { baender.push(aktuell); aktuell = []; }
      baender.push([l]);
    } else {
      aktuell.push(l);
    }
  }
  if (aktuell.length) baender.push(aktuell);

  const out = [];
  let spalte = 0;
  for (const band of baender) {
    const linkeSpalte = band.filter((l) => l.right <= grenze);
    const rechteSpalte = band.filter((l) => l.x >= grenze);

    if (!linkeSpalte.length || !rechteSpalte.length) {
      for (const l of band) l.col = spalte;
      out.push(...band);
      continue;
    }
    for (const l of linkeSpalte) l.col = spalte;
    spalte++;
    for (const l of rechteSpalte) l.col = spalte;
    spalte++;
    out.push(...linkeSpalte, ...rechteSpalte);
  }
  return out;
}

/**
 * Stufe 2: Kopf- und Fusszeilen entfernen.
 *
 * In Abschlussarbeiten und Papern wiederholen sich Kolumnentitel und
 * Seitenzahlen auf fast jeder Seite. Im Lesefluss sind sie reine Stoerung.
 * Erkannt werden sie daran, dass die erste bzw. letzte Zeile auf mindestens
 * der Haelfte der Seiten gleich lautet - Ziffern werden dabei zu '#'
 * normalisiert, damit "Seite 12" und "Seite 13" als dasselbe zaehlen.
 */
function stripRunningHeads(pages) {
  if (pages.length < 4) return pages;

  const normalize = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const ersteZeilen = new Map();
  const letzteZeilen = new Map();

  for (const lines of pages) {
    if (!lines.length) continue;
    const first = normalize(lines[0].text);
    const last = normalize(lines[lines.length - 1].text);
    ersteZeilen.set(first, (ersteZeilen.get(first) || 0) + 1);
    letzteZeilen.set(last, (letzteZeilen.get(last) || 0) + 1);
  }

  const schwelle = Math.max(3, Math.floor(pages.length * 0.5));

  return pages.map((lines) => {
    if (!lines.length) return lines;
    let out = lines;
    if (ersteZeilen.get(normalize(out[0].text)) >= schwelle) out = out.slice(1);
    if (out.length && letzteZeilen.get(normalize(out[out.length - 1].text)) >= schwelle) {
      out = out.slice(0, -1);
    }
    // uebrig gebliebene reine Seitenzahlen wegwerfen
    return out.filter((line) => !/^[\s\-–—]*\d{1,4}[\s\-–—]*$/.test(line.text));
  });
}

/**
 * Stufe 3: Zeilen zu Absaetzen zusammenfassen.
 *
 * Ein Absatzwechsel wird an drei Signalen erkannt:
 *   - deutlich groesserer Zeilenabstand als ueblich
 *   - die vorige Zeile endet deutlich vor dem rechten Rand UND mit
 *     Satzzeichen (klassisches Absatzende)
 *   - die neue Zeile ist eingerueckt
 *
 * Der Puffer laeuft ueber Seitengrenzen weiter, damit ein Satz, der unten
 * anfaengt und oben weitergeht, zusammenbleibt.
 */
function linesToParagraphs(pages) {
  const absaetze = [];
  let puffer = '';

  const schliessen = () => {
    const fertig = puffer.trim();
    if (fertig) absaetze.push(fertig);
    puffer = '';
  };

  /*
   * Die letzte Zeile der Vorseite wird mitgenommen, damit ein Absatz, der
   * oben auf einer neuen Seite beginnt, ueberhaupt erkannt werden kann.
   * Y-Koordinaten sind ueber Seitengrenzen hinweg nicht vergleichbar - die
   * Einrueckung und das Satzende der Vorzeile aber schon. Genau diese zwei
   * Signale gelten deshalb auch am Seitenanfang, das Abstandssignal nicht.
   */
  let letzteZeile = null;

  for (const lines of pages) {
    if (!lines.length) continue;

    const abstaende = [];
    for (let i = 1; i < lines.length; i++) abstaende.push(lines[i - 1].y - lines[i].y);
    const medAbstand = median(abstaende.filter((g) => g > 0));
    const medBreite = median(lines.map((l) => l.right - l.x));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : letzteZeile;
      // Das Abstandssignal gilt nur innerhalb derselben Seite UND derselben
      // Spalte - ueber einen Spalten- oder Seitenwechsel hinweg sind die
      // Y-Koordinaten bedeutungslos.
      const vergleichbar = i > 0 && prev && prev.col === line.col;
      let neuerAbsatz = false;

      if (prev) {
        if (vergleichbar && medAbstand && (prev.y - line.y) > medAbstand * 1.6) neuerAbsatz = true;
        if (!neuerAbsatz && medBreite
            && (prev.right - prev.x) < medBreite * 0.72
            && /[.!?:;»"'“”)]$/.test(prev.text)) neuerAbsatz = true;
        if (!neuerAbsatz && line.x > prev.x + line.height * 0.8) neuerAbsatz = true;
      }

      if (neuerAbsatz) schliessen();

      // Silbentrennung aufloesen: "Lese-" + "geschwindigkeit"
      if (/\p{L}-$/u.test(puffer) && /^\p{Ll}/u.test(line.text)) {
        puffer = puffer.slice(0, -1) + line.text;
      } else {
        puffer += (puffer ? ' ' : '') + line.text;
      }

      letzteZeile = line;
    }
  }

  schliessen();
  return absaetze.join('\n\n');
}

/**
 * Liest ein PDF und liefert Fliesstext.
 *
 * @param {ArrayBuffer} data
 * @param {(seite:number, gesamt:number) => void} [onProgress]
 * @returns {Promise<{text:string, numPages:number, title:string}>}
 */
export async function extractPdfText(data, onProgress) {
  const pdfjs = await import('./pdfjs/pdf.mjs');

  // Der Worker macht das Parsen in einem eigenen Thread - ohne ihn friert
  // die Seite bei grossen Dokumenten ein.
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl();

  // Den Ladevorgang festhalten: aufgeraeumt wird ueber ihn, nicht ueber das
  // Dokument (PDFDocumentProxy hat seit PDF.js 6 kein destroy() mehr).
  const ladevorgang = pdfjs.getDocument({
    data,
    // Wir rendern nichts, wir lesen nur Text - das spart Speicher.
    disableAutoFetch: true,
    disableStream: true
  });
  const doc = await ladevorgang.promise;

  const pages = [];
  for (let nr = 1; nr <= doc.numPages; nr++) {
    const page = await doc.getPage(nr);
    const content = await page.getTextContent();
    pages.push(orderColumns(itemsToLines(content.items)));
    page.cleanup();
    if (onProgress) onProgress(nr, doc.numPages);
  }

  let titel = '';
  try {
    const meta = await doc.getMetadata();
    titel = (meta && meta.info && meta.info.Title) ? String(meta.info.Title).trim() : '';
  } catch (_) { /* Metadaten sind optional */ }

  const text = linesToParagraphs(stripRunningHeads(pages));
  const numPages = doc.numPages;

  // Worker und Speicher freigeben - sonst bleibt bei mehreren PDFs
  // hintereinander jedes Dokument im Speicher liegen.
  try { await ladevorgang.destroy(); } catch (_) { /* nicht kritisch */ }

  return { text, numPages, title: titel };
}

// Fuer Tests einzeln nutzbar
export const _intern = {
  itemsToLines, orderColumns, findeSpaltengrenze,
  stripRunningHeads, linesToParagraphs, median
};
