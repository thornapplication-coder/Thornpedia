// Bibliothek: Tabelle, Sortierung, Duplikat-Dialog.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('02-library');
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.WA', { timeout: 15000 });

  await page.evaluate(async () => {
    const names = ['mietvertrag.pdf','budget.xlsx','projektkonzept.docx'];
    const files = await Promise.all(names.map(async n => new File([await (await fetch('_testfiles/'+n)).blob()], n)));
    await window.WA.importFiles(files);
    window.WA.switchView('lib');
  });
  await page.waitForTimeout(300);

  const lib = await page.evaluate(() => ({
    rows: document.querySelectorAll('#lib-content tbody tr').length,
    hasTable: !!document.querySelector('#lib-content table'),
  }));
  t.check('Bibliothek zeigt 3 Zeilen', lib.hasTable && lib.rows === 3, JSON.stringify(lib));

  await page.click('#lib-content th[data-sort="name"]');
  await page.waitForTimeout(150);
  const first = await page.evaluate(() => document.querySelector('#lib-content tbody tr .fname')?.textContent);
  t.check('Sortierung nach Name (A-Z)', first === 'budget.xlsx', first);

  // Duplikat -> Dialog -> Überspringen
  await page.evaluate(async () => {
    const f = new File([await (await fetch('_testfiles/mietvertrag.pdf')).blob()], 'mietvertrag.pdf');
    window.WA.importFiles([f]);
  });
  await page.waitForSelector('#dlg-dup.show', { timeout: 5000 });
  t.check('Duplikat-Dialog erscheint', true);
  await page.click('#dup-skip');
  await page.waitForTimeout(400);
  const count = await page.evaluate(() => window.WA.state.catalog.length);
  t.check('Überspringen behält 3 Dokumente', count === 3, 'count='+count);

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
