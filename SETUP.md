# Wissensarchiv – Repo startklar machen

Dieses Paket ist ein **eigenständiges, startklares Projekt** (Version 1.0).
Alle Dateien liegen bereits im Wurzelverzeichnis – du kannst den Inhalt direkt
als neues Git-Repository verwenden.

## 1. Neues Repository anlegen

```bash
# in diesem entpackten Ordner:
git init
git add .
git commit -m "Wissensarchiv 1.0"
git branch -M main
git remote add origin https://github.com/<DEIN-NAME>/<REPO-NAME>.git
git push -u origin main
```

> Der GitHub-Actions-Workflow unter `.github/workflows/tests.yml` läuft danach
> bei jedem Push automatisch und prüft die App mit der kompletten E2E-Testsuite.

## 2. App ausprobieren

Die App muss über `http(s)` laufen (nicht per Doppelklick als Datei).

**Lokal:**
```bash
python start.py          # öffnet http://localhost:8000
```
(Windows: Doppelklick auf `start.bat` · macOS: `start.command`)

**Über GitHub Pages (öffentliche URL, auch für iPhone/iPad):**
Repo → **Settings → Pages** → Source „Deploy from a branch" → Branch `main`,
Ordner `/ (root)` → **Save**. Nach ein paar Minuten ist die App unter
`https://<DEIN-NAME>.github.io/<REPO-NAME>/` erreichbar.

Zielbrowser: **Chrome/Edge (Desktop)** für echten Ordnerzugriff, **Safari auf
iPhone/iPad (iOS 18.4+)** nutzt automatisch den App-Speicher. Details in `README.md`.

## 3. Tests lokal ausführen (optional)

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

## Was ist enthalten?

```
index.html          – die komplette App (HTML + CSS + JS in einer Datei)
parse-worker.js     – Web Worker (DOCX/XLSX/CSV/TXT/MD)
service-worker.js   – Offline-Cache (PWA)
manifest.json       – PWA-Manifest
icons/              – App-Icons
vendor/             – alle Bibliotheken lokal (PDF.js, mammoth, SheetJS, JSZip,
                      docx, jsPDF) inkl. vendor/tesseract/ (OCR, DE/EN, offline)
tests/              – End-to-End-Testsuite (Playwright), 66 Checks
.github/workflows/  – CI (führt die Tests bei jedem Push aus)
start.py/.bat/.command – lokaler Start
```

Kein Konto, kein Server, keine Cloud – alle Daten bleiben lokal beim Nutzer.
