// Plattform & Live-Exporte: automatischer Export-Refresh, OPFS-Modus
// (iPhone/iPad-Ersatz), iPhone-Viewport, Tab-Lock.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('04-platform');
  const browser = await launchBrowser();

  // ---- A) Live-Exporte ----
  {
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
      document.querySelector('#search-input').value = 'Kuendigungsfrist';
      window.WA.state.search.q = 'Kuendigungsfrist';
      await window.WA.runSearch();
      await window.WA.exportReport('xlsx');
    });
    await page.waitForTimeout(400);

    const readRows = () => page.evaluate(async () => {
      const d = window.WA.getExportDefs()[0];
      const f = await (await window.WA.state.dirs.exports.getFileHandle(d.fileBase + '.' + d.fmt)).getFile();
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
      return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).length;
    });
    const before = await readRows();
    t.check('Live-Export registriert (Titelband+Kopf+3 Treffer = 7 Zeilen)', before === 7, 'rows='+before);

    await page.evaluate(async () => {
      const f = new File([await (await fetch('_testfiles/notizen.txt')).blob()], 'notizen.txt');
      await window.WA.importFiles([f]);
    });
    await page.waitForTimeout(2500);
    const after = await readRows();
    t.check('Export nach Import automatisch aktualisiert (Titelband+Kopf+4 Treffer = 8 Zeilen)', after === 8, 'rows='+after);

    await page.evaluate(async () => {
      window.confirm = () => true;
      const id = window.WA.state.catalog.find(c => c.name === 'notizen.txt').id;
      window.WA.state.lib.selected.add(id);
      window.WA.switchView('lib');
    });
    await page.waitForTimeout(200);
    await page.click('#batch-del');
    await page.waitForTimeout(2500);
    const afterDel = await readRows();
    t.check('Export nach Löschen automatisch aktualisiert (Titelband+Kopf+3 Treffer = 7 Zeilen)', afterDel === 7, 'rows='+afterDel);

    // Auto-Backup wurde beim ersten Import angelegt (weekly, noch nie gelaufen)
    const ab = await page.evaluate(async () => {
      const files = []; for await (const [n] of window.WA.state.dirs.exports.entries()) files.push(n);
      return files.filter(f => /^wissensarchiv_autobackup_/.test(f)).length;
    });
    t.check('Auto-Backup wurde erstellt', ab >= 1, 'autobackups='+ab);

    t.check('A: keine Konsolenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- B) OPFS-Modus (kein showDirectoryPicker, wie iPhone/iPad) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(`
      try{ delete Window.prototype.showDirectoryPicker; }catch(e){}
      try{ delete window.showDirectoryPicker; }catch(e){}
      window.__WA_TEST__ = 1;
    `);
    const page = await ctx.newPage();
    const errors = [];
    collectErrors(page, errors);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    t.check('OPFS-Modus erkannt', await page.evaluate(() => window.WA && window.WA.state.storageMode) === 'opfs');
    t.check('OPFS-Onboarding sichtbar', await page.isVisible('#screen-onboard.show'));
    await page.click('#btn-pick');
    await page.waitForSelector('#app.show', { timeout: 8000 });
    t.check('App bootet ohne Ordner-Dialog', true);

    await page.evaluate(async () => {
      const names = ['mietvertrag.pdf','budget.xlsx'];
      const files = await Promise.all(names.map(async n => new File([await (await fetch('_testfiles/'+n)).blob()], n)));
      await window.WA.importFiles(files);
    });
    const imported = await page.evaluate(() => window.WA.state.catalog.length);
    t.check('Import in OPFS funktioniert', imported === 2, 'count='+imported);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#app.show', { timeout: 8000 });
    const persisted = await page.evaluate(() => window.WA.state.catalog.length);
    t.check('Archiv übersteht Reload (OPFS-Persistenz)', persisted === 2, 'count='+persisted);
    t.check('B: keine Konsolenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- C) iPhone-Viewport: kein horizontaler Overflow ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(MOCK);
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction('!!window.WA', { timeout: 15000 });
    await page.evaluate(async () => {
      const files = [new File([await (await fetch('_testfiles/mietvertrag.pdf')).blob()], 'mietvertrag.pdf')];
      await window.WA.importFiles(files);
    });
    let allOk = true; const widths = {};
    for (const view of ['lib','search','backup','settings']) {
      await page.evaluate(v => window.WA.switchView(v), view);
      await page.waitForTimeout(200);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      widths[view] = w;
      if (w > 391) allOk = false;
    }
    t.check('iPhone (390px): kein horizontaler Overflow', allOk, JSON.stringify(widths));

    // Regression: Auf Mobil-Viewports muss das Suchfeld im Suche-Tab und das
    // Bibliotheks-Filterfeld sichtbar sein – nur die Kopfzeilen-Suche wird versteckt.
    const vis = await page.evaluate(() => {
      const visible = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      window.WA.switchView('search');
      const search = visible(document.querySelector('#search-input'));
      const topbar = visible(document.querySelector('#top-search-input'));
      window.WA.switchView('lib');
      const libq = visible(document.querySelector('#lib-q'));
      return { search, topbar, libq };
    });
    t.check('iPhone: Suchfeld im Suche-Tab sichtbar', vis.search === true, JSON.stringify(vis));
    t.check('iPhone: Bibliotheks-Filterfeld sichtbar', vis.libq === true, JSON.stringify(vis));
    t.check('iPhone: Kopfzeilen-Suche bleibt versteckt', vis.topbar === false, JSON.stringify(vis));
    await ctx.close();
  }

  // ---- D) Tab-Lock: zweiter Tab wird gesperrt ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const p1 = await ctx.newPage();
    await p1.goto(base, { waitUntil: 'networkidle' });
    await p1.waitForTimeout(500); // Tab 1 haelt jetzt den Lock
    const p2 = await ctx.newPage();
    await p2.goto(base, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(600);
    t.check('Zweiter Tab zeigt Sperr-Hinweis', await p2.isVisible('#screen-locked.show'));
    t.check('Erster Tab läuft normal weiter', !(await p1.isVisible('#screen-locked.show')));
    await ctx.close();
  }

  await browser.close();
  return t.fails();
}
