# Changelog

Alle nennenswerten Änderungen an FlashRead.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

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

[1.1.1]: https://github.com/Subsample/flashread/releases/tag/v1.1.1
[1.1.0]: https://github.com/Subsample/flashread/releases/tag/v1.1.0
[1.0.0]: https://github.com/Subsample/flashread/releases/tag/v1.0.0
