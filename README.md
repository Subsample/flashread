# FlashRead

RSVP-Schnellleser für Chrome und Firefox. Zeigt den Haupttext einer Seite Wort
für Wort an einer festen Blickachse — das Auge muss nicht mehr über die Zeile
springen.

Der hervorgehobene Buchstabe ist der *Optimal Recognition Point* (etwa 30 % der
Wortlänge). Er liegt pixelgenau immer an derselben Stelle, damit das Auge ruhig
bleibt.

Ein Manifest-V3-Paket, das unverändert in beiden Browsern läuft. Keine
Build-Tools, keine externen Requests, keine Telemetrie.

---

## Installation

### Chrome / Edge

1. `chrome://extensions` öffnen
2. **Entwicklermodus** einschalten (oben rechts)
3. **Entpackte Erweiterung laden** → den Ordner `FlashRead` auswählen

Chrome zeigt eine Warnung zu `background.scripts` — die ist erwartet und
folgenlos (das ist der Firefox-Schlüssel, den Chrome nicht kennt).

### Firefox

1. `about:debugging#/runtime/this-firefox` öffnen
2. **Temporäres Add-on laden** → die Datei `manifest.json` auswählen

Temporäre Add-ons verschwinden beim Beenden von Firefox. Für dauerhaft siehe
[Signieren](#signieren-für-firefox).

---

## Bedienen

Drei Wege zu starten:

| | |
|---|---|
| Toolbar-Icon | liest den automatisch extrahierten Artikeltext |
| `Alt`+`R` | dasselbe per Tastatur |
| Rechtsklick → *Mit FlashRead lesen* | bei markiertem Text nur die Markierung |

Im Overlay:

| Taste | Wirkung |
|---|---|
| `Leertaste` | Pause / Weiter — zeigt die letzten ~5 Wörter als Satz |
| `←` `→` | 10 Wörter zurück / vor |
| `↑` `↓` | Tempo ±25 wpm |
| `F` | Vollbild ein/aus |
| `Esc` | schließen |

**Zum Vollbild:** Browser verlangen für Vollbild eine Nutzeraktivierung *in der
Seite*. Ein Klick auf das Toolbar-Icon passiert in der Browser-Oberfläche und
zählt nicht. Wird die Anforderung abgelehnt, merkt FlashRead sich den Wunsch und
löst ihn beim ersten Tastendruck oder Klick ein — praktisch sofort.

---

## Einstellungen

Zahnrad im Overlay, oder `chrome://extensions` → *Details* → *Optionen*.

Tempo (100–1000 wpm), Chunk-Größe (1–3 Wörter), Schriftgröße und -art,
Farbschema (dunkel/hell/sepia), Pivot-Farbe, intelligente Pausen, sanfter Start,
Leseposition merken, Auto-Vollbild.

Einstellungen liegen in `storage.sync` (geräteübergreifend), Lesepositionen in
`storage.local` (max. 60 Einträge, LRU).

### Anzeigedauer

Grundtakt ist `60000 / wpm` je Wort. Darauf wirken bei aktivierten Pausen:

| Bedingung | Faktor |
|---|---|
| über 8 Buchstaben | bis ×1,6 |
| Komma, Semikolon, Doppelpunkt | ×1,3 |
| Punkt, Frage-, Ausrufezeichen | ×2,0 |
| Absatzende | ×1,6 |
| erste 5 Einheiten (sanfter Start) | ×2,2 → ×1,0 |

---

## Aufbau

| Datei | Zweck |
|---|---|
| `manifest.json` | MV3, für Chrome und Firefox zugleich |
| `background.js` | Service Worker / Event Page: Menü, Auslöser, Injektion |
| `content.js` | Textquelle bestimmen, tokenisieren, Reader starten |
| `reader.js` | RSVP-Engine und Overlay im Shadow DOM |
| `reader.css` | Overlay-Styles (Variablen ganz oben) |
| `lib/browser-polyfill.js` | `browser`/`chrome` unter einem Namen |
| `lib/settings.js` | Einstellungen und Lesepositionen |
| `lib/readability.js` | Artikelextraktion |
| `options.html/.css/.js` | Einstellungsseite |

Das Overlay steckt komplett in einem Shadow DOM, damit Seiten-CSS nicht
hineinwirkt. Die Blickachse entsteht durch ein Grid mit
`minmax(0, 1fr) auto minmax(0, 1fr)` — die Mittelspalte enthält genau den
Pivot-Buchstaben und liegt dadurch immer auf 50 %.

**Berechtigungen:** nur `activeTab`, `contextMenus`, `storage`, `scripting`.
Keine Host-Permissions, kein `eval`, kein Netzwerkzugriff.

---

## Signieren für Firefox

Temporäre Add-ons sind nach dem Neustart weg. Für dauerhaft muss das Paket von
Mozilla signiert werden.

**Das musst du vorher anpassen:**

1. **Version** in `manifest.json`. Jeder Upload braucht eine neue, höhere
   Versionsnummer.
2. **Beschreibung und Name** — was hier steht, erscheint im Add-on-Manager.
3. **Support-Kontakt** im Einreichungsformular. Bei *listed* ist das ein
   Pflichtfeld (Abschnitt 5b des Distribution Agreements). Die Issues-URL des
   Repos taugt nur, wenn das Repo öffentlich ist.

Bereits gesetzt und **nicht mehr änderbar** nach der ersten Einreichung:

- **Add-on-ID** `flashread@subsample.github.io` in
  `browser_specific_settings.gecko.id`. Jedes Update muss exakt diese ID tragen.
- **Datenerhebung** `data_collection_permissions: { required: ["none"] }` —
  seit 3. November 2025 für alle neuen Erweiterungen Pflicht. Firefox zeigt
  daraufhin „keine Datenerhebung" beim Installieren und auf der AMO-Seite an.

**Weg über addons.mozilla.org:**

Ordnerinhalt zippen (die Dateien direkt im ZIP, *nicht* der Ordner selbst):

```powershell
Compress-Archive -Path .\* -DestinationPath ..\flashread.zip -Force
```

Dann auf [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
einloggen → *Neues Add-on einreichen*. Wähle **„Nur ich"** (unlisted), wenn es
nicht im Verzeichnis auftauchen soll — die Prüfung ist dann automatisch und
dauert Minuten. Für *listed* kommt eine manuelle Prüfung dazu.

Danach die signierte `.xpi` herunterladen und über `about:addons` →
Zahnrad → *Add-on aus Datei installieren* dauerhaft einrichten.

**Vorher lokal prüfen** — das ist derselbe Linter, den AMO benutzt:

```powershell
npx addons-linter .
```

**Für Chrome** brauchst du nichts davon; ein Upload im Developer Dashboard
genügt (einmalig 5 USD Registrierungsgebühr).

---

## Fehlersuche

**Rotes `!` am Icon**
Der Start ist fehlgeschlagen. **Mit der Maus über das Icon fahren** — der
Tooltip zeigt 8 Sekunden lang die Ursache. Vollständig mit Stacktrace in der
Konsole des Hintergrundskripts: Firefox `about:debugging` → *Untersuchen*,
Chrome `chrome://extensions` → *Service Worker*.

Häufigster Grund: eine Seite, auf der Erweiterungen gesperrt sind — `about:`,
`chrome://`, `moz-extension://`, Chrome Web Store, addons.mozilla.org.

**Nach Code-Änderungen passiert nichts Neues**
Erweiterung neu laden **und** die offenen Tabs neu laden. In den Tabs steckt
sonst noch das alte Content-Script.

**Falscher Text wird gelesen**
Bei Wikipedia landet die Infobox mit im Text. Die Extraktion nimmt den
Container mit der höchsten Absatzdichte; Tabellen daneben zählen mit. Notlösung:
den gewünschten Absatz markieren und über das Kontextmenü starten.

---

## Lizenz

Bislang **keine Lizenz vergeben** — damit gilt das gesetzliche Urheberrecht,
alle Rechte vorbehalten. Der Code ist einsehbar, darf aber nicht ohne Erlaubnis
genutzt oder weiterverbreitet werden.

Soll das geöffnet werden, genügt eine `LICENSE`-Datei im Wurzelverzeichnis;
GitHub erkennt sie automatisch. MIT wäre für ein Projekt dieser Größe die
naheliegende Wahl.

`lib/readability.js` ist eine Eigenimplementierung des Readability-Algorithmus,
keine Übernahme fremden Codes — es besteht also keine Bindung an eine fremde
Lizenz. Wird sie durch Mozillas `Readability.js` ersetzt, gilt für **diese eine
Datei** Apache-2.0 und deren Lizenztext gehört mit ins Paket.
