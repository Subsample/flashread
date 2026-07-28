# Changelog

Alle nennenswerten Änderungen an FlashRead.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [1.2.1] – 2026-07-28

### Neu
- **PDF-Dateien lesen.** Auf einem PDF öffnet FlashRead einen neuen Tab mit
  einer eigenen Seite; dort lässt sich die Datei auch hineinziehen oder
  auswählen. Gelesen wird mit **PDF.js 6.1.200** von Mozilla, das lokal im
  Paket liegt — es wird nichts nachgeladen.

  Der neue Tab ist keine Bequemlichkeit: Firefox' eingebauter PDF-Viewer gilt
  als privilegierte Browser-Oberfläche, in der Erweiterungen seit Firefox 60
  grundsätzlich nicht laufen dürfen — unabhängig von jeder Berechtigung
  ([Bugzilla 1454760](https://bugzilla.mozilla.org/show_bug.cgi?id=1454760)).
  Chrome sperrt seinen Plugin-Prozess genauso ab.

- **Textgewinnung in vier Stufen.** PDF kennt weder Zeilen noch Absätze,
  sondern nur Textfragmente mit Koordinaten. Daraus werden Zeilen gruppiert,
  Spalten erkannt und nacheinander ausgegeben, wiederkehrende Kolumnentitel
  und Seitenzahlen entfernt, und schließlich Absätze anhand von Zeilenabstand,
  Zeilenlänge und Einrückung gebildet — samt Auflösen der Silbentrennung.

- **Zweiter Kontextmenü-Eintrag** „PDF mit FlashRead lesen" als Notausgang für
  Stellen, an denen kein Content-Script laufen darf.

- **Erkennung fehlender Textebene.** Bei eingescannten PDFs oder solchen, deren
  Schrift in Vektorpfade umgewandelt wurde, gibt es keine Zeichen zu lesen.
  FlashRead prüft auf unter 25 Wörter je Seite und erklärt dann konkret, was
  los ist — mit Gegenprobe und beiden Auswegen, statt eine Handvoll
  Listennummern als Text auszugeben.

### Geändert
- Die Tokenisierung liegt jetzt in `lib/tokenize.js`, weil Webseiten-Reader und
  PDF-Viewer dieselbe brauchen.
- `optional_host_permissions` statt fester Host-Rechte: Im
  Installationsdialog erscheint nichts Zusätzliches. Erst wenn ein PDF direkt
  von einer Adresse geladen werden soll, fragt FlashRead per Knopfdruck — und
  dann nur für diese eine Herkunft.

### Hinweis zur Paketgröße
45 KB → 3,1 MB. Das ist PDF.js. Immerhin in der **unminifizierten** Fassung,
also lesbarer Quelltext — eine separate Quellcode-Einreichung bei AMO entfällt
dadurch.

## [1.1.4] – 2026-07-27

### Einstellungen
- **Die Vorschau bleibt beim Scrollen oben stehen.** So sieht man die Wirkung
  von Schriftgröße, Farbschema und Pivot-Farbe, während man die Regler weiter
  unten bedient. Auf Fenstern unter 520 px Höhe scrollt sie normal mit, sonst
  bliebe zu wenig Platz für die Einstellungen selbst.

## [1.1.3] – 2026-07-27

Robustheit gegenüber echten Webseiten, dazu Aufräumen. Keine neuen Funktionen,
keine Verhaltensänderung im Normalfall.

### Robuster
- **Overlay überlebt DOM-Umbauten.** Seiten mit clientseitigem Routing oder
  Lazy-Loading bauen ihren Body während des Lesens neu auf und entfernten den
  Reader dabei mit. Er hängt sich jetzt selbstständig wieder ein, statt
  unsichtbar weiterzulaufen.
- **Tempo-Treue.** `setTimeout` feuert nie exakt; die Verspätungen summierten
  sich über tausende Wörter. Bei 10 ms Verzug pro Wort lief der Reader 5,8 %
  zu langsam, jetzt 0,0 %. Nach einer größeren Lücke (Tab im Hintergrund) wird
  bewusst **nicht** aufgeholt.
- **Obergrenze von 120.000 Wörtern.** Schützt vor Seiten, die faktisch ein
  ganzes Buch enthalten — Wort- und Chunk-Liste liegen komplett im Speicher.
- **Markierungen in Eingabefeldern.** Text in `<input>` und `<textarea>`
  erscheint nicht zuverlässig in `window.getSelection()`; das aktive Element
  wird jetzt zuerst geprüft.
- **Vollbild beenden** nur noch, wenn der Reader selbst das Vollbild-Element
  ist. War vorher etwas anderes im Vollbild, bleibt das unangetastet.

### Schlanker
- `lib/browser-polyfill.js` von 58 auf 27 Zeilen: `promisify` und `isFirefox`
  wurden nie benutzt. Beide Engines sind in Manifest V3 Promise-basiert, ein
  Alias genügt.
- Toter Code entfernt: `RX.byline`, `Readability.toPlainText`,
  `Reader.startedAt`, `Reader._ownsFullscreen`.
- `reader.css` wird einmal pro Seite geholt statt bei jedem Öffnen.
- `article.content` ist ein Getter. Die HTML-Serialisierung des ganzen Artikels
  fällt nur an, wenn jemand sie abruft — FlashRead selbst braucht sie nie.
- Textmessung pro Knoten zwischengespeichert; rund 10 % schneller
  (6000 Absätze: 229 ms → 207 ms).

Gesamt 2889 → 2540 Zeilen.

## [1.1.2] – 2026-07-27

Behebt alle vier Warnungen der AMO-Validierung, soweit ohne Aufgabe der
Chrome-Kompatibilität möglich.

### Behoben
- **„Unsafe assignment to innerHTML"** (`reader.js`). Das Overlay wird jetzt
  Knoten für Knoten über `createElement`/`textContent` aufgebaut statt über
  eine `innerHTML`-Zuweisung. Mozillas Linter beanstandet jede solche
  Zuweisung, auch bei konstanten Zeichenketten — und dieser Punkt stand in der
  Einreichungs-Checkliste unter „könnte zur Ablehnung führen".
  Gleiches gilt für `FlashReadReader.toast()`.
- **`strict_min_version` auf 140.0 angehoben.** `data_collection_permissions`
  gibt es erst ab Firefox 140 (Android 142); die Kombination mit 109 erzeugte
  zwei Warnungen.

### Bekannt und beabsichtigt
- Die Warnung zu `background.service_worker` bleibt. Der Schlüssel wird von
  Firefox ignoriert, ist aber für Chrome zwingend — er ist der Grund, warum
  dasselbe Paket in beiden Browsern läuft. Entfernen ließe er sich nur mit
  einem separaten Firefox-Manifest.

## [1.1.1] – 2026-07-27

### Behoben
- **Firefox startete den Reader nicht.** Chrome und Firefox behandeln den
  globalen Namensraum in Content-Scripts unterschiedlich: in Chrome ist
  `window` dasselbe Objekt wie `globalThis`, in Firefox ist `window` eine
  Xray-gekapselte Sicht auf das *Seiten*fenster und damit ein anderes Objekt
  als der Sandbox-Global der Erweiterung.

  `lib/browser-polyfill.js` legte die API auf `globalThis` ab, `content.js`
  las sie aus `window` — in Firefox also `undefined`. Dadurch warf
  `api.runtime.onMessage.addListener()`, der Listener wurde nie registriert
  und `tabs.sendMessage` scheiterte mit *"Could not establish connection.
  Receiving end does not exist."*

  Alle injizierten Dateien benutzen jetzt konsistent `globalThis`. Echte
  DOM-Zugriffe (`window.addEventListener`, `window.getSelection`, `document`)
  bleiben bewusst auf `window`.

### Geändert
- `content.js` prüft beim Start, ob alle Abhängigkeiten im gemeinsamen Global
  liegen, und meldet das Fehlende im Klartext statt mit einem TypeError. Das
  `__FLASHREAD_READY__`-Flag wird erst *nach* dieser Prüfung gesetzt, damit ein
  fehlgeschlagener Versuch nicht als "fertig injiziert" gilt.
- README von 17,4 KB auf 6,7 KB gekürzt, Abschnitt zum Signieren und zur
  AMO-Einreichung ergänzt.

## [1.1.0] – 2026-07-26

### Neu
- **Automatischer Vollbildmodus.** Das Overlay fordert beim Öffnen Vollbild an.
  Lehnt der Browser mangels Nutzeraktivierung ab, wird der Wunsch vorgemerkt und
  bei der ersten Interaktion im Overlay eingelöst.
- Vollbild jederzeit mit `F` oder dem Knopf in der Kopfzeile umschaltbar.
- Neue Einstellung *Automatisch in den Vollbildmodus* (Standard: an).

### Geändert
- `strict_min_version` für Firefox von `115.0` auf `109.0` gesenkt — das ist die
  tatsächliche Untergrenze für Manifest V3 in Firefox.
- `color-mix()` im Fortsetzen-Dialog hat jetzt einen `rgba()`-Fallback davor,
  damit Engines vor Chrome 111 / Firefox 113 nicht auf transparentem Grund landen.
- `requestFullscreen()` / `exitFullscreen()` prüfen, ob ein Promise zurückkommt.
  Ältere Firefox-Versionen liefern `undefined` und melden Fehler ausschließlich
  über das `fullscreenerror`-Event, das jetzt ebenfalls ausgewertet wird.

## [1.0.0] – 2026-07-26

Erste Fassung.

### Enthalten
- RSVP-Reader als Overlay im Shadow DOM, gekapselt gegen Seiten-CSS.
- Optimal Recognition Point: Pivot-Buchstabe bei ~30 % der Wortlänge, rot
  eingefärbt und pixelgenau auf einer festen Mittelachse, mit Führungslinien
  und Markierung ober- und unterhalb.
- Textextraktion über Readability-Scoring, Fallback über Absatzdichte.
- Start per Toolbar-Button, Kontextmenü und `Alt`+`R`; markierter Text hat Vorrang.
- Tempo 100–1000 wpm (Standard 350, Schritt 25), Pause/Weiter, ±10 Wörter.
- Adaptive Anzeigedauern: lange Wörter, Komma ×1,3, Satzende ×2,0, Absatz ×1,6.
- Sanfter Start über die ersten fünf Einheiten.
- Wiedereinstiegshilfe: bei Pause erscheinen die letzten ~5 Wörter als Satz.
- Einstellungen in `storage.sync`, Lesepositionen pro URL in `storage.local`.
- Ein Paket für Chrome und Firefox (Manifest V3), keine Build-Tools,
  keine externen Requests, keine Telemetrie.

[1.2.1]: https://github.com/Subsample/flashread/releases/tag/v1.2.1
[1.1.4]: https://github.com/Subsample/flashread/releases/tag/v1.1.4
[1.1.3]: https://github.com/Subsample/flashread/releases/tag/v1.1.3
[1.1.1]: https://github.com/Subsample/flashread/releases/tag/v1.1.1
[1.1.0]: https://github.com/Subsample/flashread/releases/tag/v1.1.0
[1.0.0]: https://github.com/Subsample/flashread/releases/tag/v1.0.0
