# Changelog

Alle nennenswerten Änderungen an FlashRead.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

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

[1.1.0]: https://github.com/DEIN-BENUTZERNAME/flashread/releases/tag/v1.1.0
[1.0.0]: https://github.com/DEIN-BENUTZERNAME/flashread/releases/tag/v1.0.0
