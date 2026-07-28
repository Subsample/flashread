/*
 * FlashRead - pdf-viewer.js
 * ---------------------------------------------------------------------------
 * Eigene Erweiterungsseite, die ein PDF einliest und an den RSVP-Reader
 * uebergibt.
 *
 * Warum eine eigene Seite und nicht der offene PDF-Tab?
 * Der eingebaute PDF-Viewer von Firefox gilt als privilegierte
 * Browser-Oberflaeche - Content-Scripts duerfen dort grundsaetzlich nicht
 * laufen, unabhaengig von jeder Berechtigung (seit Firefox 60, Bugzilla
 * 1454760 und 1462300). Chrome hat dasselbe Problem ueber seinen internen
 * Plugin-Prozess. Ein eigener Tab ist deshalb nicht Notloesung, sondern der
 * einzige gangbare Weg.
 *
 * Drei Wege, an die Datei zu kommen:
 *   1. ?src=<URL>  - vom Hintergrundskript uebergeben, per fetch geladen.
 *                    Braucht Leserecht fuer die Herkunft; wird bei Bedarf
 *                    ueber permissions.request() nachgefragt.
 *   2. Dateiauswahl - braucht keinerlei Berechtigung.
 *   3. Hineinziehen - dito.
 * ---------------------------------------------------------------------------
 */
import { extractPdfText } from './lib/pdftext.js';

// (ES-Module laufen ohnehin im strict mode - kein 'use strict' noetig.)

const api = globalThis.FRAPI || globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);

const ui = {
  drop: $('drop'), dropHint: $('dropHint'), pick: $('pick'), file: $('file'),
  busy: $('busy'), busyTitle: $('busyTitle'), busyFill: $('busyFill'), busyText: $('busyText'),
  done: $('done'), doneTitle: $('doneTitle'), doneMeta: $('doneMeta'),
  preview: $('preview'), start: $('start'), again: $('again'),
  error: $('error'), errorText: $('errorText'),
  grant: $('grant'), retry: $('retry'), fallback: $('fallback')
};

let ergebnis = null;   // { text, numPages, title }
let quelle = null;     // URL aus ?src=, falls vorhanden

// --- Ansichten --------------------------------------------------------------

function zeige(welche) {
  for (const name of ['drop', 'busy', 'done', 'error']) ui[name].hidden = (name !== welche);
}

function fehler(text, { grant = false, retry = false } = {}) {
  ui.errorText.textContent = text;
  ui.grant.hidden = !grant;
  ui.retry.hidden = !retry;
  zeige('error');
}

// --- PDF verarbeiten --------------------------------------------------------

async function verarbeite(data, herkunft) {
  zeige('busy');
  ui.busyTitle.textContent = 'PDF wird gelesen';
  ui.busyFill.style.width = '0%';
  ui.busyText.textContent = 'Seite 0 von ?';

  try {
    ergebnis = await extractPdfText(data, (seite, gesamt) => {
      ui.busyFill.style.width = (seite / gesamt * 100).toFixed(1) + '%';
      ui.busyText.textContent = `Seite ${seite} von ${gesamt}`;
    });
  } catch (err) {
    console.error('[FlashRead] PDF konnte nicht gelesen werden:', err);
    fehler('Die Datei liess sich nicht als PDF lesen. Moeglicherweise ist sie '
      + 'beschaedigt oder mit einem Passwort geschuetzt. (' + (err && err.message) + ')');
    return;
  }

  const woerter = ergebnis.text ? ergebnis.text.split(/\s+/).filter(Boolean).length : 0;
  const proSeite = ergebnis.numPages ? woerter / ergebnis.numPages : woerter;

  /*
   * Plausibilitaetspruefung statt bloss "null Woerter".
   *
   * Es gibt PDFs, in denen der Text in Vektorpfade umgewandelt wurde: jeder
   * Buchstabe ist dann eine gefuellte Kurve, kein Zeichen. Typisch, wenn ein
   * Dokument ueber einen Druckertreiber "gedruckt" statt exportiert wurde.
   * Uebrig bleiben dann oft nur automatisch erzeugte Listennummern oder
   * Seitenzahlen - formal Text, aber nichts, was man lesen will.
   *
   * Eine bedruckte Seite traegt gut 300 Woerter. Unter 25 im Schnitt ist das
   * kein Fliesstext mehr, sondern ein Rest.
   */
  if (!woerter || (proSeite < 25 && ergebnis.numPages >= 3)) {
    const grund = woerter
      ? `Gefunden wurden nur ${woerter} Woerter auf ${ergebnis.numPages} Seiten `
        + `(${proSeite.toFixed(0)} je Seite) - das sind Reste wie Listennummern `
        + 'oder Seitenzahlen, kein Fliesstext.'
      : 'In diesem PDF steckt ueberhaupt kein auslesbarer Text.';

    fehler(grund + ' Die Seiten enthalten den Text vermutlich als Bild oder als '
      + 'Vektorzeichnung statt als Zeichen. Gegenprobe: Wenn du das PDF im '
      + 'Browser oeffnest und einen Satz nicht mit der Maus markieren kannst, '
      + 'ist genau das der Fall. Abhilfe: das Dokument aus dem Ursprungsprogramm '
      + 'erneut als PDF exportieren statt es zu drucken - oder eine '
      + 'Texterkennung darueber laufen lassen. FlashRead bringt keine mit.');
    return;
  }

  // Titel aus den PDF-Metadaten, sonst Dateiname bzw. Adresse. Viele PDFs
  // tragen dort Muell ("Microsoft Word - Dokument1"), deshalb wird ein
  // offensichtlich nutzloser Titel verworfen.
  const metaTitel = /^(untitled|dokument\d*|microsoft word)/i.test(ergebnis.title || '')
    ? '' : (ergebnis.title || '');
  ergebnis.anzeige = metaTitel || herkunft || 'PDF';
  ui.doneTitle.textContent = ergebnis.anzeige;
  const minuten = Math.round(woerter / 350);
  ui.doneMeta.textContent =
    `${ergebnis.numPages} Seiten · ${woerter.toLocaleString('de')} Woerter · `
    + `etwa ${minuten} Minuten bei 350 wpm`;
  ui.preview.textContent = ergebnis.text.slice(0, 600) + (ergebnis.text.length > 600 ? ' …' : '');
  zeige('done');
}

// --- Quellen ----------------------------------------------------------------

async function ausDatei(datei) {
  if (!datei) return;
  if (datei.size > 200 * 1024 * 1024) {
    fehler('Die Datei ist groesser als 200 MB. Das laesst sich nicht sinnvoll im Speicher halten.');
    return;
  }
  await verarbeite(await datei.arrayBuffer(), datei.name);
}

/** Muster fuer permissions.request(), z. B. "https://example.com/*". */
function herkunftsMuster(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? 'file:///*' : u.origin + '/*';
  } catch (_) {
    return null;
  }
}

async function ausUrl(url) {
  zeige('busy');
  ui.busyTitle.textContent = 'PDF wird geladen';
  ui.busyText.textContent = new URL(url).hostname || url;
  ui.busyFill.style.width = '10%';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await verarbeite(await res.arrayBuffer(), url);
  } catch (err) {
    console.warn('[FlashRead] Direktes Laden fehlgeschlagen:', err);

    const istDatei = url.startsWith('file:');
    const muster = herkunftsMuster(url);

    if (istDatei) {
      // file:// laesst sich per permissions.request() nicht nachfragen.
      // Chrome verlangt den Haken in chrome://extensions, Firefox eine
      // Host-Berechtigung im Manifest. Die Dateiauswahl geht immer.
      fehler('Auf lokale Dateien darf die Erweiterung nicht ohne Weiteres '
        + 'zugreifen. In Chrome laesst sich das unter chrome://extensions bei '
        + 'FlashRead mit "Zugriff auf Datei-URLs zulassen" freischalten. '
        + 'Schneller geht es, wenn du die Datei unten einfach auswaehlst.');
      return;
    }

    fehler('Das PDF liess sich nicht von ' + (muster || url) + ' laden. '
      + 'Entweder fehlt die Leseberechtigung fuer diese Seite, oder der Link '
      + 'ist bereits abgelaufen - viele Verlage vergeben PDF-Links, die nur '
      + 'wenige Minuten gueltig sind. In dem Fall hilft nur, die Datei '
      + 'herunterzuladen und hier auszuwaehlen.',
      { grant: !!muster, retry: true });
  }
}

// --- Reader starten ---------------------------------------------------------

async function starteReader() {
  if (!ergebnis || !ergebnis.text) return;

  const settings = await globalThis.FRSettings.load();
  const words = globalThis.FRTokenize(ergebnis.text);
  if (words.length < 5) {
    fehler('Zu wenig Text zum Lesen gefunden.');
    return;
  }

  globalThis.FlashReadReader.open({
    words,
    settings,
    title: ergebnis.anzeige || 'PDF',
    source: 'PDF',
    resume: null,
    onProgress() {},
    onFinished() {},
    onOpenOptions() { api.runtime.openOptionsPage(); },
    onSaveSettings(patch) { return globalThis.FRSettings.save(patch); }
  });
}

// --- Verdrahtung ------------------------------------------------------------

ui.pick.addEventListener('click', () => ui.file.click());
ui.fallback.addEventListener('click', () => { zeige('drop'); ui.file.click(); });
ui.file.addEventListener('change', () => ausDatei(ui.file.files[0]));
ui.again.addEventListener('click', () => { ergebnis = null; zeige('drop'); });
ui.start.addEventListener('click', starteReader);
ui.retry.addEventListener('click', () => quelle && ausUrl(quelle));

ui.grant.addEventListener('click', async () => {
  const muster = quelle && herkunftsMuster(quelle);
  if (!muster) return;
  try {
    // Muss aus einer Nutzeraktion heraus aufgerufen werden - deshalb hier.
    const ok = await api.permissions.request({ origins: [muster] });
    if (ok) ausUrl(quelle);
    else fehler('Der Zugriff wurde nicht erteilt. Du kannst die Datei '
      + 'stattdessen herunterladen und hier auswaehlen.');
  } catch (err) {
    fehler('Die Berechtigung liess sich nicht anfragen: ' + (err && err.message));
  }
});

// Hineinziehen
for (const typ of ['dragenter', 'dragover']) {
  document.addEventListener(typ, (ev) => {
    ev.preventDefault();
    ui.drop.classList.add('is-over');
  });
}
for (const typ of ['dragleave', 'drop']) {
  document.addEventListener(typ, (ev) => {
    ev.preventDefault();
    ui.drop.classList.remove('is-over');
  });
}
document.addEventListener('drop', (ev) => {
  const datei = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (datei) ausDatei(datei);
});

// --- Start ------------------------------------------------------------------

(function init() {
  const params = new URLSearchParams(location.search);
  quelle = params.get('src');

  if (quelle) {
    ausUrl(quelle);
  } else {
    zeige('drop');
    ui.dropHint.textContent = 'Tastenkuerzel im Reader: Leertaste pausiert, '
      + 'Pfeiltasten springen und regeln das Tempo, Esc schliesst.';
  }
})();
