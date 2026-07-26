# FlashRead

RSVP-Schnellleser (Rapid Serial Visual Presentation) als Browser-Erweiterung für
**Firefox** und **Chrome** aus einem einzigen Paket. FlashRead extrahiert den
Artikeltext der aktuellen Seite und blendet ihn Wort für Wort an einer festen
Blickachse ein — dadurch entfallen die Augensprünge (Sakkaden) des normalen
Lesens.

Manifest V3 · keine Build-Tools · keine externen Requests · keine Telemetrie.

---

## Inhalt

- [Funktionen](#funktionen)
- [Installation in Chrome](#installation-in-chrome)
- [Installation in Firefox](#installation-in-firefox)
- [Bedienung](#bedienung)
- [Dateien](#dateien)
- [Dauerhafte Installation in Firefox (Signierung)](#dauerhafte-installation-in-firefox-signierung)
- [Anpassen](#anpassen)
- [Readability austauschen](#readability-austauschen)
- [Fehlersuche](#fehlersuche)

---

## Funktionen

| Bereich | Details |
|---|---|
| **Start** | Toolbar-Button, Kontextmenü „Mit FlashRead lesen", Tastenkürzel `Alt`+`R` |
| **Textquelle** | Markierter Text hat Vorrang; ohne Markierung wird der Hauptinhalt automatisch extrahiert (Readability-Scoring, Fallback: Absatzdichte-Heuristik) |
| **Blickachse** | Der Pivot-Buchstabe (≈ 30 % der Wortlänge, *Optimal Recognition Point*) wird rot eingefärbt und liegt pixelgenau auf der Bildmitte, mit Führungslinie und Markierung ober- und unterhalb |
| **Tempo** | 100–1000 wpm, Standard 350, Schrittweite 25 |
| **Adaptive Pausen** | Wörter über 8 Zeichen länger (bis +60 %), Komma/Semikolon ×1,3, Punkt/Frage/Ausruf ×2,0, Absatzende ×1,6 |
| **Sanfter Start** | Die ersten fünf Einheiten laufen mit ×2,2 an und fahren auf Zieltempo hoch |
| **Wiedereinstieg** | Bei Pause werden die letzten ~5 Wörter als normaler Satz eingeblendet |
| **Anzeige** | Tempo in wpm, Fortschrittsbalken, verbleibende Zeit, Wortposition (z. B. `340 / 1250`) |
| **Einstellungen** | Tempo, Schriftgröße, Schriftart, Farbschema (dunkel/hell/sepia), Pivot-Farbe, Chunk-Größe 1–3, adaptive Pausen an/aus — persistiert über `storage.sync` |
| **Leseposition** | Wird pro URL gemerkt; beim erneuten Öffnen wird das Fortsetzen angeboten |
| **Vollbild** | Das Overlay geht automatisch in den Vollbildmodus (abschaltbar), jederzeit mit `F` umschaltbar |
| **Isolation** | Das Overlay lebt in einem Shadow DOM, Seiten-CSS kann nicht hineinwirken |

Berechtigungen: ausschließlich `activeTab`, `contextMenus`, `storage`, `scripting`.
FlashRead stellt **keine** Netzwerkverbindungen her.

---

## Installation in Chrome

Auch gültig für Edge, Brave, Vivaldi und andere Chromium-Browser.

1. `chrome://extensions` öffnen.
2. Oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken.
4. Den Ordner `FlashRead` auswählen (den Ordner selbst, nicht die
   `manifest.json`).
5. Fertig. Das Icon erscheint in der Toolbar — evtl. hinter dem
   Puzzle-Symbol, dort anpinnen.

**Tastenkürzel prüfen:** `chrome://extensions/shortcuts`. Falls `Alt`+`R`
bereits belegt ist, hier ein anderes setzen.

Das Laden im Entwicklermodus ist dauerhaft — die Erweiterung bleibt nach einem
Neustart installiert. Chrome zeigt beim Start ggf. einen Hinweis auf
Entwicklermodus-Erweiterungen; das ist normal.

---

## Installation in Firefox

### Variante A — zum Testen (bis zum nächsten Browser-Neustart)

1. `about:debugging#/runtime/this-firefox` öffnen.
2. **Temporäres Add-on laden** klicken.
3. Die Datei `FlashRead/manifest.json` auswählen.
4. Fertig. Das Icon erscheint in der Toolbar.

> Temporär geladene Add-ons verschwinden beim Beenden von Firefox. Für eine
> dauerhafte Installation siehe [Signierung](#dauerhafte-installation-in-firefox-signierung).

**Tastenkürzel prüfen:** `about:addons` → Zahnrad oben rechts →
*Verknüpfungen verwalten*.

### Variante B — dauerhaft ohne Signierung

Nur mit **Firefox Developer Edition**, **Nightly** oder **ESR** möglich:

1. `about:config` öffnen und die Warnung bestätigen.
2. `xpinstall.signatures.required` auf `false` setzen.
3. Die Erweiterung als ZIP verpacken und in `.xpi` umbenennen (siehe unten),
   dann in `about:addons` über das Zahnrad → *Add-on aus Datei installieren*.

Im normalen Firefox Release und Beta lässt sich diese Einstellung **nicht**
umgehen — dort ist Signierung Pflicht.

---

## Bedienung

| Taste | Wirkung |
|---|---|
| `Alt`+`R` | Reader starten (erneut drücken schließt ihn) |
| `Leertaste` | Pause / Weiter |
| `←` `→` | 10 Wörter zurück / vor |
| `↑` `↓` | Tempo ±25 wpm |
| `F` | Vollbild ein/aus |
| `Esc` | Overlay schließen (beendet auch das Vollbild) |
| Klick auf die Bühne | Pause / Weiter |

### Zum Vollbild

Das Overlay fordert den Vollbildmodus direkt beim Öffnen an. Browser verlangen
dafür allerdings eine **Nutzeraktivierung in der Seite** — ein Klick auf das
Toolbar-Icon oder `Alt`+`R` passiert in der Browser-Oberfläche und zählt dafür
nicht. Wird die Anforderung deshalb abgelehnt, merkt FlashRead sich den Wunsch
und löst ihn bei der ersten Interaktion im Overlay ein, also beim ersten
Tastendruck oder Klick — in der Praxis sofort, weil man ohnehin `Leertaste`
drückt.

Abschaltbar in den Einstellungen unter *Automatisch in den Vollbildmodus*.

Einstellungen: Zahnrad-Symbol oben rechts im Overlay, oder Rechtsklick auf das
Toolbar-Icon → *Optionen* / *Einstellungen*.

Änderungen am Tempo per Slider oder Pfeiltasten werden als neues
Standardtempo gespeichert.

---

## Dateien

```
FlashRead/
├── manifest.json          Manifest V3, für Chrome und Firefox gleichzeitig
├── background.js          Service Worker (Chrome) / Event Page (Firefox):
│                          Kontextmenü, Toolbar-Klick, Alt+R, Script-Injektion
├── content.js             Textquelle wählen, tokenisieren, Reader starten
├── reader.js              RSVP-Engine + Overlay im Shadow DOM
├── reader.css             Overlay-Styles (wird in den Shadow Root geladen)
├── options.html           Einstellungsseite
├── options.css            Styles der Einstellungsseite
├── options.js             Formular ↔ storage.sync
├── lib/
│   ├── browser-polyfill.js  chrome/browser-Namespace abstrahieren
│   ├── settings.js          Defaults, Validierung, Positionsspeicher
│   └── readability.js       Textextraktion (Readability-kompatible API)
├── icons/
│   ├── icon.svg             Quell-Icon
│   └── icon-16/32/48/128.png  von Chrome zwingend benötigt
└── README.md
```

### Wie die Cross-Browser-Kompatibilität funktioniert

* **Namespace:** `lib/browser-polyfill.js` setzt `globalThis.FRAPI` auf
  `browser` (Firefox) bzw. `chrome` (Chromium). Chrome MV3 liefert bei den hier
  verwendeten APIs ebenfalls Promises, deshalb genügt dieses schmale Alias.
* **Background:** Das Manifest enthält **beide** Schlüssel —
  `background.service_worker` (Chrome) und `background.scripts` (Firefox, das
  `service_worker` in MV3 nicht unterstützt). Jeder Browser nimmt den Schlüssel,
  den er kennt, und meldet für den anderen nur eine harmlose Warnung.
* **Icons:** Firefox könnte SVG verwenden, Chrome **verweigert** das Laden der
  Erweiterung bei SVG-Icons. Deshalb liegen PNGs bei; `icons/icon.svg` ist die
  Quelle zum Nachbearbeiten.
* **Auswahltext:** Statt `info.selectionText` (in Chrome auf ~150 Zeichen
  gekürzt) liest `content.js` die Markierung selbst per `getSelection()`.

---

## Dauerhafte Installation in Firefox (Signierung)

Firefox Release und Beta installieren dauerhaft nur signierte Add-ons. Diese
Stellen musst du dafür anpassen:

### 1. Eigene Erweiterungs-ID setzen — `manifest.json`

```json
"browser_specific_settings": {
  "gecko": {
    "id": "flashread@localhost",
    "strict_min_version": "115.0"
  }
}
```

`id` durch eine eigene, eindeutige Kennung ersetzen. Zwei zulässige Formen:

* E-Mail-Stil: `flashread@deine-domain.de`
* GUID: `{d1e2f3a4-5b6c-7d8e-9f01-234567890abc}`

Die ID muss dir gehören und darf sich später **nie** ändern — sie ist die
Identität des Add-ons für Updates und für den gespeicherten `storage.sync`-Inhalt.

### 2. Versionsnummer — `manifest.json`

```json
"version": "1.0.0"
```

Jeder Upload zu addons.mozilla.org (AMO) braucht eine **höhere** Version als
der vorige. Erlaubt sind nur Ziffern und Punkte.

### 3. Name und Beschreibung — `manifest.json`

`name` und `description` werden im AMO-Listing angezeigt. AMO lehnt Namen ab,
die auf „Firefox" oder „Mozilla" anspielen.

### 4. Paket erstellen

Das ZIP muss die `manifest.json` **auf oberster Ebene** enthalten — also den
Inhalt des Ordners zippen, nicht den Ordner selbst.

PowerShell:

```bash
Compress-Archive -Path "C:\Users\Felix\Desktop\Claude\FlashRead\*" -DestinationPath "$env:USERPROFILE\Desktop\flashread-1.0.0.zip" -Force
```

Vorher aufräumen: `harness.html` (Testseite) und `README.md` müssen nicht mit
ins Paket.

### 5. Signieren lassen

Bei [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
anmelden und **Submit a New Add-on**. Dann eine der beiden Wege:

* **„On this site"** — öffentliches Listing im Add-on-Verzeichnis. Vollständige
  Redaktions-Prüfung, dauert je nach Warteschlange Tage.
* **„On your own"** (Self-distribution) — **das ist der Weg für dich, wenn du
  es nur selbst nutzen willst.** Nur eine automatische Prüfung, meist in
  Minuten fertig. Du erhältst eine signierte `.xpi` zum Download, die sich in
  jedem Firefox dauerhaft per `about:addons` → Zahnrad →
  *Add-on aus Datei installieren* einrichten lässt.

Alternativ per Kommandozeile mit API-Schlüsseln aus deinem AMO-Konto:

```bash
npx --yes web-ext sign --source-dir . --channel unlisted --api-key JWT_ISSUER --api-secret JWT_SECRET
```

### 6. Was der Prüfung auffallen könnte

Die automatische Validierung ist bei FlashRead unkritisch, weil es keine
externen Requests, kein `eval`, kein Remote-Code und nur vier schmale
Berechtigungen gibt. Zwei Hinweise wirst du dennoch sehen:

* Warnung zu `background.service_worker` — der Chrome-Schlüssel, den Firefox
  nicht kennt. Harmlos, das Add-on funktioniert über `background.scripts`.
* Bei einer Prüfung durch Menschen (nur bei „On this site") kann eine
  Quellcode-Angabe verlangt werden. Da hier nichts minifiziert oder
  transpiliert ist, genügt das eingereichte Paket selbst.

### Kein AMO? — Firefox ESR/Developer/Nightly

Wenn du gar nicht signieren willst, bleibt nur
`xpinstall.signatures.required = false` in einer Firefox-Variante, die das
zulässt (ESR, Developer Edition, Nightly). Im normalen Release wird die
Einstellung ignoriert.

---

## Anpassen

Häufige Wünsche und die Stelle dafür:

| Wunsch | Stelle |
|---|---|
| Andere Standardwerte (Tempo, Theme, Schrift …) | `lib/settings.js` → `FR_DEFAULTS` |
| Pivot-Position ≠ 30 % | `reader.js` → `pivotIndex()` |
| Pausen-Faktoren (Komma 1,3 / Punkt 2,0 / Absatz 1,6 / Länge +60 %) | `reader.js` → `durationFor()` |
| Länge und Stärke des sanften Starts | `reader.js` → `durationFor()` → `2.2 - i * 0.3` |
| Sprungweite der Pfeiltasten (10 Wörter) | `reader.js` → `_onKeyDown()` → `this.seek(±10)` |
| Anzahl Wörter im Wiedereinstieg (5) | `reader.js` → `showContext()` → `end - 5` |
| Vollbild-Verhalten | `reader.js` → `enterFullscreen()` / `_consumePendingFullscreen()` |
| Overlay-Aussehen, Farbschemata | `reader.css` (Variablen ganz oben) |
| Tastenkürzel `Alt`+`R` | `manifest.json` → `commands.flashread-start.suggested_key` |
| Wie viele Lesepositionen gespeichert werden (60) | `lib/settings.js` → `MAX_POSITIONS` |
| Weitere Container immer ausschließen | `lib/readability.js` → `RX.unlikely` |

Nach jeder Änderung neu laden: Chrome `chrome://extensions` → Reload-Symbol;
Firefox `about:debugging` → *Neu laden*. Bereits geöffnete Tabs müssen
zusätzlich neu geladen werden, weil die Content-Scripts dort noch die alte
Version halten.

---

## Readability austauschen

`lib/readability.js` ist eine eigenständige, abhängigkeitsfreie Umsetzung des
Readability-Scorings mit **absichtlich identischer API** zu Mozillas Original:

```js
const article = new Readability(document.cloneNode(true)).parse();
// -> { title, byline, length, excerpt, content, textContent } | null
```

Wenn du stattdessen Mozillas Original verwenden willst:

1. `Readability.js` aus [github.com/mozilla/readability](https://github.com/mozilla/readability)
   herunterladen (Apache-2.0).
2. Als `lib/readability.js` ablegen und die vorhandene Datei ersetzen.
3. Am Ende der Datei sicherstellen, dass die Klasse global verfügbar ist —
   das Original nutzt UMD und exportiert bei fehlendem `module` automatisch
   nach `window.Readability`. Falls nicht, eine Zeile anhängen:
   ```js
   window.Readability = Readability;
   ```
4. **Eine Anpassung ist nötig:** `content.js` benutzt für die
   Fallback-Heuristik zusätzlich drei statische Helfer, die es im Original
   nicht gibt:

   | Helfer | verwendet in |
   |---|---|
   | `Readability.linkDensity(el)` | Abwertung linklastiger Container |
   | `Readability.cleanTextFrom(el)` | Text aus einem Live-DOM-Knoten holen und dabei Werbung/Kommentare entfernen |
   | `Readability.toPlainText(el)` | reine Textkonvertierung ohne Aufräumen |

   Zwei Möglichkeiten:
   * **Empfohlen:** den Block `--- Zusatzhelfer für die Fallback-Heuristik ---`
     vom Ende der mitgelieferten `lib/readability.js` in die neue Datei
     kopieren. Er hängt nur an den internen Regexes und Tag-Listen, die im
     Original ähnlich heißen.
   * **Oder nichts tun:** `content.js` prüft die Helfer vor der Benutzung und
     fällt sonst auf `innerText` zurück. Der Fallback filtert dann Werbung und
     Kommentare nicht mehr — was nur greift, wenn Readability *gar nichts*
     gefunden hat.

Beide Varianten liefern ohne Netzwerkzugriff aus; Mozillas Datei ist deutlich
umfangreicher und behandelt mehr Sonderfälle (Tabellen-Layouts, `<noscript>`-
Bilder, Sprachattribute).

---

## Fehlersuche

**Klick auf das Icon tut nichts, kurz erscheint ein rotes `!`**
Der Start ist fehlgeschlagen. **Fahr mit der Maus über das Icon** — der Tooltip
zeigt acht Sekunden lang die konkrete Ursache. Den vollen Fehler mit Stacktrace
gibt es in der Konsole des Hintergrundskripts (Firefox: `about:debugging` →
*Untersuchen*; Chrome: `chrome://extensions` → *Service Worker*).

Der häufigste Grund ist eine Seite, auf der Erweiterungen grundsätzlich
gesperrt sind: `about:`-, `chrome://`- und `moz-extension://`-Seiten, der
Chrome Web Store und addons.mozilla.org.

> **Hinweis zu Firefox:** Mit nur `activeTab` ist `tab.url` im
> Hintergrundskript oft `undefined`. `background.js` filtert deshalb bewusst
> **nicht** vorab nach der URL, sondern versucht die Injektion und meldet erst
> den echten Fehler — eine Prüfung auf `tab.url` würde in Firefox sonst jeden
> Start blockieren.

**„Auf dieser Seite wurde kein lesbarer Text gefunden"**
Die Seite hat weniger als fünf erkennbare Wörter im Hauptinhalt — z. B. eine
reine Bild- oder App-Seite. Abhilfe: Text markieren und über das Kontextmenü
starten, dann wird genau die Markierung gelesen.

**Falscher Textausschnitt wird gelesen**
Die Heuristik hat den falschen Container gewählt. Kurzfristig: Text markieren.
Dauerhaft: den störenden Container in `lib/readability.js` → `RX.unlikely`
ergänzen.

**`Alt`+`R` reagiert nicht**
Kürzel ist von Browser oder Betriebssystem belegt. Neu setzen unter
`chrome://extensions/shortcuts` bzw. `about:addons` → Zahnrad →
*Verknüpfungen verwalten*.

**Overlay bleibt leer / unformatiert**
Dann konnte `reader.css` nicht geladen werden. Prüfen, dass
`web_accessible_resources` in `manifest.json` `reader.css` enthält und die
Erweiterung nach der Änderung neu geladen wurde. Der Reader fällt in diesem
Fall auf ein Minimal-Stylesheet zurück, bleibt also benutzbar.

**Vollbild springt nicht sofort an**
Erwartetes Verhalten — siehe [Zum Vollbild](#zum-vollbild). Drück einmal
`Leertaste` oder klick ins Overlay, dann schaltet es um. Wer es gar nicht will,
schaltet es in den Einstellungen ab.

**Einstellungen werden nicht übernommen**
`storage.sync` ist in Firefox nur mit angemeldetem Konto aktiv. `lib/settings.js`
weicht dann automatisch auf `storage.local` aus — die Werte gelten dann nur
lokal.

**Logs ansehen**
Background: Chrome `chrome://extensions` → *Service Worker*; Firefox
`about:debugging` → *Untersuchen*. Content-Script und Reader loggen in die
normale Seitenkonsole (F12).

---

## Lizenz

Zur freien Verwendung. `lib/readability.js` ist eine Eigenimplementierung des
Algorithmus; falls du sie durch Mozillas `Readability.js` ersetzt, gilt für
diese Datei Apache-2.0 und der Lizenztext gehört mit ins Paket.
