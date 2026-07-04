# Wissensarchiv

Persönliche, **offline-fähige Wissensdatenbank** für einen einzelnen Nutzer – ohne
Backend, ohne Login. Alle Daten (Originaldateien, Suchindex, Metadaten,
Einstellungen) werden über die **File System Access API** als echte Dateien in
einem von dir gewählten Ordner auf der Festplatte gespeichert. Das übersteht auch
das Löschen von Browser-Cache, Verlauf und Websitedaten.

## Unterstützte Geräte

| Gerät | Speicher-Modus | Hinweise |
|---|---|---|
| **Desktop** Chrome/Edge | Echter Ordner auf der Festplatte (File System Access API) | Voller Funktionsumfang; Daten überstehen das Löschen von Browser-Daten |
| **iPhone / iPad** (Safari, iOS 18.4+) | App-Speicher (OPFS) – iOS erlaubt keinen direkten Ordnerzugriff | Automatischer Fallback; regelmäßige Backup-ZIPs empfohlen; „Teilen → Zum Home-Bildschirm" installiert die App |
| Andere Browser (Firefox, Safari macOS) | App-Speicher (OPFS) | wie iPhone/iPad |

Die App erkennt den Modus automatisch. Daten zwischen Geräten überträgst du per
**Backup-ZIP** (Backup → exportieren, am anderen Gerät wiederherstellen).

Dieses Projekt ist **eigenständig** – alle Dateien liegen im Wurzelverzeichnis.
Eine Schritt-für-Schritt-Anleitung zum Anlegen des Repositories, zum lokalen Start
und zu GitHub Pages findest du in **`SETUP.md`**.

---

## Wichtig: die App muss über `http(s)` laufen

Chrome/Edge erlauben die File System Access API **und** Service Worker nur in einem
*sicheren Kontext* – also über `https://` oder `http://localhost`.
Per Doppelklick als `file://…/index.html` geöffnet funktioniert die App **nicht**.

Es gibt zwei einfache Wege:

### Variante A – Ohne Installation: GitHub Pages (empfohlen)

1. Dieses Repository nach GitHub pushen.
2. Im Repo → **Settings → Pages** → Branch wählen und Ordner `/wissensarchiv`
   (bzw. Repo-Root, falls du die Dateien dorthin verschiebst) als Quelle setzen.
3. Nach ein paar Minuten die angezeigte `https://…`-Adresse in Chrome/Edge öffnen.

Deine Dokumente bleiben dabei **lokal auf deiner Festplatte** – die Seite lädt und
speichert nichts auf einen Server.

### Variante B – Lokal starten (kleiner Webserver)

Benötigt Python 3 (auf den meisten Systemen vorinstalliert).

```bash
# in diesem Ordner:
python start.py
# oder eigener Port:
python start.py 8080
```

- **Windows:** Doppelklick auf `start.bat`
- **macOS:** Doppelklick auf `start.command` (ggf. vorher `chmod +x start.command`)

Der Browser öffnet automatisch `http://localhost:8000/index.html`.
Beenden mit `Strg+C`.

---

## Als App installieren (PWA)

Läuft die Seite über `https`/`localhost`, zeigt Chrome/Edge in der Adressleiste ein
**Installieren**-Symbol. Danach startet das Wissensarchiv wie eine eigenständige
Desktop-App und funktioniert nach dem ersten Start vollständig offline.

---

## Ordnerstruktur der Daten

Beim ersten Start wählst du einen Ordner. Die App legt darin an:

```
Dein-Ordner/
├─ originals/   – Originaldateien (PDF, DOCX, XLSX, CSV, TXT, MD)
├─ index/       – ein JSON-Suchindex pro Dokument
├─ meta/        – Tags, Notizen, Einstellungen, API-Key
└─ exports/     – Berichte & Backups
```

Das Ordner-Handle wird zusätzlich in IndexedDB zwischengespeichert, damit die App
den Ordner beim nächsten Start automatisch wiederfindet. Fehlt die Berechtigung
(z. B. nach dem Löschen von Websitedaten), erscheint ein freundlicher
**„Ordner erneut verbinden"**-Dialog – deine Dateien bleiben unangetastet.

---

## Projektdateien

```
(Repo-Wurzel)/
├─ index.html          – die komplette App (HTML + CSS + JS in einer Datei)
├─ parse-worker.js     – Web Worker für DOCX/XLSX/CSV/TXT/MD (PDF läuft mit eigenem PDF.js-Worker)
├─ service-worker.js   – Offline-Cache der App-Shell und der Bibliotheken
├─ manifest.json       – PWA-Manifest (Installierbarkeit)
├─ icons/              – App-Icons
├─ vendor/             – lokal mitgelieferte Bibliotheken (PDF.js, mammoth, SheetJS,
│                        JSZip, docx, jsPDF) inkl. vendor/tesseract/ (OCR + Sprachdaten DE/EN)
├─ tests/              – End-to-End-Testsuite (Playwright); siehe Abschnitt „Tests"
├─ start.py / .bat / .command – lokaler Start
└─ README.md
```

## Funktionsumfang

- **Speicherung:** File System Access API – Originale, Suchindex und Metadaten
  liegen als echte Dateien im gewählten Ordner (`/originals`, `/index`, `/meta`,
  `/exports`). Ordner-Handle wird zwischengespeichert; Reconnect-Dialog bei
  fehlender Berechtigung. Übersteht das Löschen von Browser-Daten.
- **Import:** Drag & Drop, Dateiauswahl oder ganzer Ordner. Formate PDF, DOCX,
  XLSX, CSV, TXT, MD. Parsing im Web Worker (UI bleibt bedienbar); PDF seitenweise
  mit Fortschrittsanzeige „Seite x von y". Gescannte PDFs ohne Textebene werden
  erkannt und markiert. Duplikate (Name/Inhalt) → Überspringen/Ersetzen.
- **OCR (lokal):** Gescannte PDFs lassen sich per „Text erkennen (OCR)" durchsuchbar
  machen – tesseract.js läuft komplett auf deinem Gerät (Deutsch + Englisch,
  aus `vendor/` mitgeliefert, funktioniert offline; nichts wird hochgeladen).
- **Suche:** Volltext über alle Index-JSONs (Originale werden nie geladen).
  Mehrere Wörter = UND-Suche; `"in Anführungszeichen"` = Phrasensuche;
  Umlaut-tolerant (Kündigung findet auch „Kuendigung" und umgekehrt). Filter
  nach Dateityp, Importzeitraum und Tags. Treffer mit Kontext-Snippet,
  hervorgehobenem Begriff und präziser Quelle (Seite / Blatt + Zelle / Abschnitt).
  Klick öffnet die Fundstelle – bei PDF wird nur die betroffene Seite gerendert
  und die Suchbegriffe werden direkt auf der Seite markiert.
- **Bibliothek:** Sortierung (Name/Datum/Größe), Filter, Bestandssuche; pro Datei
  Umbenennen, Tags, Notizen, Löschen, Original öffnen/herunterladen, Neu-Indexieren;
  Mehrfachauswahl für Batch-Aktionen (Taggen/Löschen).
- **Backup:** Komplett-Export des Archivs als eine ZIP (Originale + Index + Meta,
  bewusst **ohne API-Key**) und ZIP-Import zur vollständigen Wiederherstellung
  inkl. Tags und Notizen. Zusätzlich **automatische Backups** (täglich/wöchentlich,
  abschaltbar) – die letzten 5 werden in `/exports` aufbewahrt.
- **Mehrfach-Tab-Schutz:** Die App läuft nur in einem Tab gleichzeitig, damit sich
  parallele Schreibvorgänge nicht gegenseitig überschreiben können.
- **Zusammenfassung:** extraktiv (offline, Satz-Ranking) oder per Claude API
  (`claude-sonnet-4-6`, API-Key lokal in `/meta/apikey.txt`, sauberes Fehler-
  handling offline). Jede Zusammenfassung endet mit vollständigem Quellenverzeichnis.
- **Export:** Suchtreffer und Zusammenfassungen als DOCX (docx.js), PDF (jsPDF)
  oder XLSX (SheetJS) – gespeichert in `/exports` und als Download.
- **Live-Exporte:** Jeder Export wird registriert und bei jeder Änderung am
  Archiv (Import, Löschen, Tags, Umbenennen, Wiederherstellung) automatisch neu
  erzeugt – die Dateien in `/exports` sind dadurch **immer aktuell**. Verwaltung
  unter *Backup → Live-Exporte* (herunterladen, manuell aktualisieren, entfernen,
  Automatik abschaltbar). Exporte einzelner ausgewählter Treffer sind bewusste
  Schnappschüsse und werden nicht automatisch aktualisiert.
- **Oberfläche:** Seitenleiste + Hauptbereich, Farbwelt exakt nach Vorgabe, Arial,
  Dark/Light/Auto-Theme, Sprache Deutsch/Englisch umschaltbar.

---

## Tests

Unter `tests/` liegt eine End-to-End-Suite (Playwright/Chromium), die Import,
Suche, Fundstelle, Exporte, Backup, Duplikate, XSS-Härtung, Live-Exporte,
OPFS-Modus, iPhone-Layout, Tab-Lock und OCR abdeckt:

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

Der GitHub-Actions-Workflow `.github/workflows/tests.yml` führt die Suite bei
jedem Push automatisch aus.

---

*Kein Konto, kein Server, keine Cloud – deine Daten bleiben bei dir.*
