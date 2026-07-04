// OCR: Ein PDF, das nur ein BILD von Text enthaelt (keine Textebene),
// wird als gescannt erkannt; nach ocrDoc() ist der Text durchsuchbar.
// Laeuft komplett lokal (tesseract.js aus vendor/), dauert einige Sekunden.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('05-ocr');
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.WA', { timeout: 15000 });

  // Bild-PDF im Browser bauen: Text auf Canvas zeichnen -> PNG -> jsPDF
  const imported = await page.evaluate(async () => {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, 1200, 600);
    c.fillStyle = '#000'; c.font = 'bold 90px Arial';
    c.fillText('KUENDIGUNG', 80, 220);
    c.fillText('DREI MONATE', 80, 420);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: [600, 300], orientation: 'landscape' });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 600, 300);
    const blob = doc.output('blob');
    await window.WA.importFiles([new File([blob], 'scan_brief.pdf')]);
    const c2 = window.WA.state.catalog.find(x => x.name === 'scan_brief.pdf');
    return { scanned: c2 && c2.scanned, units: c2 && c2.unitCount };
  });
  t.check('Bild-PDF als gescannt erkannt (keine Textebene)', imported.scanned === true && imported.units === 0, JSON.stringify(imported));

  // OCR ausfuehren (kann dauern: WASM + Sprachdaten laden + erkennen)
  const ocr = await page.evaluate(async () => {
    const id = window.WA.state.catalog.find(x => x.name === 'scan_brief.pdf').id;
    const doc = await window.WA.getIndex(id);
    await window.WA.ocrDoc(doc);
    const after = await window.WA.getIndex(id);
    return { units: (after.units || []).length, text: (after.units[0] || {}).text || '', ocr: after.ocr, scanned: after.scanned };
  });
  t.check('OCR liefert Text', ocr.units > 0 && ocr.ocr === true && ocr.scanned === false, JSON.stringify({units:ocr.units}));
  const foundWords = /kuendigung/i.test(ocr.text) && /monat/i.test(ocr.text);
  t.check('OCR-Text enthält die Begriffe', foundWords, ocr.text.slice(0, 120));

  // und ist jetzt durchsuchbar (inkl. Umlaut-Faltung: kündigung == KUENDIGUNG)
  const hits = await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'kündigung';
    await window.WA.runSearch();
    return window.WA.state.lastHits.map(h => h.name);
  });
  t.check('OCR-Dokument über Umlaut-Suche auffindbar', hits.includes('scan_brief.pdf'), JSON.stringify(hits));

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
