/* Wissensarchiv – Parser-Web-Worker
 * Extrahiert Text aus DOCX/XLSX/CSV/TXT/MD im Hintergrund, damit die UI waehrend
 * des Imports bedienbar bleibt.
 * (PDF wird bewusst im Main-Thread von PDF.js verarbeitet – PDF.js nutzt dort
 *  seinen eigenen dedizierten Worker fuer die schwere Textextraktion; im
 *  Worker-Kontext liesse sich sein Worker-Pfad nicht aufloesen.)
 *
 * Ergebnis je Dokument: { kind, scanned, units:[{ref, text}] }
 *   ref bei Excel : { sheet, row }   (eine Fundstelle je Tabellenzeile)
 *   ref bei Text  : { section }
 */
/* global importScripts, mammoth, XLSX */

importScripts(
  'vendor/mammoth.browser.min.js',
  'vendor/xlsx.full.min.js'
);

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

async function parseDocx(buffer) {
  const res = await mammoth.extractRawText({ arrayBuffer: buffer });
  const paras = (res.value || '')
    .split(/\r?\n/)
    .map((s) => norm(s))
    .filter(Boolean);
  const units = paras.map((t, i) => ({ ref: { section: i + 1 }, text: t }));
  return { kind: 'docx', scanned: false, units };
}

function parseSheet(buffer, ext) {
  let wb;
  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    wb = XLSX.read(text, { type: 'string' });
  } else {
    wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  }
  // ZEILENBASIERT: je Tabellenzeile eine Fundstelle (Text = alle nicht-leeren
  // Zellen der Zeile). Das liefert lesbare, listenartige Suchtreffer statt
  // isolierter Einzelzellen. ref = { sheet, row } (1-basiert).
  const units = [];
  const CAP = 200000;       // max. erfasste (nicht-leere) Zeilen
  const SCAN_CAP = 5000000; // max. besuchte Zellen – begrenzt aufgeblaehte !ref-Bereiche
  let scanned = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cells = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        // Auch die reine Iteration deckeln: eine kaputte/boesartige Datei kann
        // ein riesiges !ref (z.B. A1:XFD1048576) deklarieren und wuerde sonst
        // den Worker praktisch endlos blockieren.
        if (++scanned > SCAN_CAP) return { kind: 'sheet', scanned: false, units, truncated: true };
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        const val = cell.w != null ? cell.w : cell.v;
        if (val === undefined || val === null || val === '') continue;
        cells.push(norm(val));
      }
      if (!cells.length) continue;
      units.push({ ref: { sheet: sheetName, row: R + 1 }, text: cells.join('  ·  ') });
      if (units.length >= CAP) return { kind: 'sheet', scanned: false, units, truncated: true };
    }
  }
  return { kind: 'sheet', scanned: false, units };
}

function parseText(buffer) {
  const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
  const blocks = text.split(/\n{2,}/).map((s) => norm(s)).filter(Boolean);
  const units = blocks.map((t, i) => ({ ref: { section: i + 1 }, text: t }));
  return { kind: 'text', scanned: false, units };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'parse') return;
  const { id, ext, buffer } = msg;
  try {
    let result;
    switch (ext) {
      case 'docx': result = await parseDocx(buffer); break;
      case 'xlsx': case 'xls': result = parseSheet(buffer, ext); break;
      case 'csv': result = parseSheet(buffer, 'csv'); break;
      case 'txt': case 'md': case 'markdown': result = parseText(buffer); break;
      default: throw new Error('Nicht unterstuetztes Format: .' + ext);
    }
    postMessage({ type: 'done', id, result });
  } catch (err) {
    postMessage({ type: 'error', id, message: (err && err.message) || String(err) });
  }
};
