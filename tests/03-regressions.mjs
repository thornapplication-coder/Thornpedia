// Regressionen: XSS, Duplikat-Dialog-Robustheit, PDF-Paging-Race,
// Cleanup nach Löschen, Fundstellen-Cap, Export-Guard.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('03-regressions');
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.WA', { timeout: 15000 });

  await page.evaluate(async () => {
    const names = ['mietvertrag.pdf','scan_ohne_text.pdf','projektkonzept.docx','budget.xlsx','kunden.csv','notizen.txt','readme.md','xss_test.xlsx'];
    const files = await Promise.all(names.map(async n => new File([await (await fetch('_testfiles/'+n)).blob()], n)));
    await window.WA.importFiles(files);
  });

  // XSS: boesartiger Blattname darf nicht ausgefuehrt werden
  await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'Kuendigungsfrist';
    await window.WA.runSearch();
  });
  await page.waitForTimeout(400);
  const xss = await page.evaluate(() => ({
    triggered: window.__XSS === 1,
    visibleAsText: Array.from(document.querySelectorAll('.result .src')).some(e => e.textContent.includes('<img')),
  }));
  t.check('XSS-Blattname wird NICHT ausgeführt', !xss.triggered);
  t.check('Blattname erscheint als harmloser Text', xss.visibleAsText);

  // Duplikat-Dialog übersteht Overlay-Klick + Escape, Import läuft weiter
  await page.evaluate(async () => {
    const f = new File([await (await fetch('_testfiles/mietvertrag.pdf')).blob()], 'mietvertrag.pdf');
    window.__importDone = false;
    window.WA.importFiles([f]).then(() => { window.__importDone = true; });
  });
  await page.waitForSelector('#dlg-dup.show', { timeout: 5000 });
  await page.click('#dlg-dup', { position: { x: 8, y: 8 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  t.check('Duplikat-Dialog bleibt offen (Overlay/Escape)', await page.isVisible('#dlg-dup.show'));
  await page.click('#dup-skip');
  await page.waitForFunction('window.__importDone === true', { timeout: 5000 });
  t.check('Import läuft nach Überspringen weiter', true);

  // PDF: schnelles Blättern ohne Render-Race
  await page.evaluate(async () => {
    const i = window.WA.state.lastHits.findIndex(h => h.type === 'pdf');
    await window.WA.openHit(i);
  });
  await page.waitForTimeout(500);
  for (let k = 0; k < 6; k++) { await page.click('#pg-next').catch(()=>{}); await page.click('#pg-prev').catch(()=>{}); }
  await page.waitForTimeout(800);
  const pdf = await page.evaluate(() => ({
    canvas: (() => { const c = document.querySelector('#pdf-canvas'); return !!c && c.width > 0; })(),
    cached: window.WA.state.pdfView.pdf !== null,
  }));
  t.check('PDF nach schnellem Blättern gerendert', pdf.canvas);
  t.check('PDF-Dokument gecacht (kein Neu-Einlesen)', pdf.cached);

  // Löschen des geöffneten Dokuments räumt auf
  const openId = await page.evaluate(() => window.WA.state.curDoc.doc.id);
  await page.evaluate((id) => { window.confirm = () => true; window.WA.state.lib.selected.add(id); window.WA.switchView('lib'); }, openId);
  await page.waitForTimeout(250);
  await page.click('#batch-del');
  await page.waitForTimeout(500);
  const cleanup = await page.evaluate(() => ({
    navHidden: document.querySelector('#nav-doc').style.display === 'none',
    pdfCleared: window.WA.state.pdfView.pdf === null,
  }));
  t.check('Fundstellen-Navigation ausgeblendet', cleanup.navHidden);
  t.check('PDF-Cache geleert', cleanup.pdfCleared);

  // Grosse CSV: Fenster-Rendering statt DOM-Freeze
  await page.evaluate(async () => {
    let csv = 'Spalte\n';
    for (let i = 0; i < 2000; i++) csv += 'Zeile ' + i + (i === 1500 ? ' Nadel-im-Heuhaufen' : '') + '\n';
    await window.WA.importFiles([new File([csv], 'gross.csv')]);
    document.querySelector('#search-input').value = 'Nadel-im-Heuhaufen';
    await window.WA.runSearch();
    await window.WA.openHit(0);
  });
  await page.waitForTimeout(400);
  const cap = await page.evaluate(() => ({
    notice: !!document.querySelector('#doc-main .notice.info'),
    rendered: document.querySelectorAll('#doc-main .section-text > div').length,
    hit: !!document.querySelector('#doc-main [style*="surface-accent"]'),
  }));
  t.check('Cap-Hinweis bei großer Tabelle', cap.notice);
  t.check('Nur Fenster um Treffer gerendert (300)', cap.rendered === 300, 'rendered='+cap.rendered);
  t.check('Treffer im Fenster sichtbar', cap.hit);

  // Export-Guard bei leerer Trefferliste
  const guard = await page.evaluate(async () => {
    window.WA.state.lastHits = []; window.WA.state.search.q = 'x'; window.WA.state.search.selected.clear();
    try { await window.WA.exportReport('xlsx'); return true; } catch (e) { return e.message; }
  });
  t.check('Leer-Export wirft nicht', guard === true, guard);

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
