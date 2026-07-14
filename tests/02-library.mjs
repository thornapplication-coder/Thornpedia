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

  // Standard-Sortierung ist Name A–Z → budget.xlsx zuerst (ohne Klick).
  const firstDefault = await page.evaluate(() => document.querySelector('#lib-content tbody tr .fname')?.textContent);
  t.check('Standard-Sortierung Name A–Z', firstDefault === 'budget.xlsx', firstDefault);
  // Klick auf die Namensspalte dreht auf Z–A.
  await page.click('#lib-content th[data-sort="name"]');
  await page.waitForTimeout(150);
  const firstDesc = await page.evaluate(() => document.querySelector('#lib-content tbody tr .fname')?.textContent);
  t.check('Namensspalte togglet auf Z–A', firstDesc === 'projektkonzept.docx', firstDesc);

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

  // Tag-Gruppierung: Tags bilden Abschnitts-Überschriften.
  await page.evaluate(async () => {
    const WA = window.WA;
    const idOf = n => WA.state.catalog.find(c => c.name === n).id;
    const setTags = async (name, tags) => {
      const id = idOf(name);
      const doc = await WA.getIndex(id);
      doc.tags = tags;
      // Index-Datei direkt aktualisieren, danach Katalog neu aufbauen (öffentliche API).
      const h = await WA.state.dirs.index.getFileHandle(id + '.json', { create: true });
      const w = await h.createWritable(); await w.write(JSON.stringify(doc)); await w.close();
    };
    await setTags('mietvertrag.pdf', ['Recht']);
    await setTags('budget.xlsx', ['Finanzen']);
    await setTags('projektkonzept.docx', ['Recht', 'Finanzen']);
    await WA.rebuildCatalog();   // liest Indizes neu, aktualisiert Katalog + rendert Bibliothek
    WA.switchView('lib');
  });
  await page.waitForTimeout(200);

  // Standard: ALLE Gruppen zugeklappt (übersichtlicher Start) – keine Zeilen sichtbar.
  const initiallyClosed = await page.evaluate(() => ({
    openHeads: document.querySelectorAll('#lib-content .lib-group-head[aria-expanded="true"]').length,
    visibleRows: document.querySelectorAll('#lib-content tbody tr').length,
    heads: document.querySelectorAll('#lib-content .lib-group-head').length,
  }));
  t.check('Gruppen starten zugeklappt', initiallyClosed.openHeads === 0 && initiallyClosed.visibleRows === 0 && initiallyClosed.heads >= 2, JSON.stringify(initiallyClosed));

  // Alle Gruppen (inkl. Untergruppen) aufklappen – Klick für Klick wie ein Nutzer.
  const expandAll = async () => {
    for (let i = 0; i < 12; i++) {
      const c = await page.evaluate(() => { const h = document.querySelector('#lib-content .lib-group-head[aria-expanded="false"]'); if (h) { h.click(); return true; } return false; });
      if (!c) break;
      await page.waitForTimeout(80);
    }
  };
  await expandAll();

  const grp = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#lib-content .lib-group-head .lib-group-title')].map(e => e.textContent.trim());
    return {
      heads,
      groups: document.querySelectorAll('#lib-content .lib-group').length,
      // projektkonzept.docx hat 2 Tags → erscheint in 2 Gruppen (2 Zeilen)
      pkRows: [...document.querySelectorAll('#lib-content tbody tr .fname')].filter(e => e.textContent === 'projektkonzept.docx').length,
    };
  });
  t.check('Tags bilden Gruppen-Überschriften', grp.heads.some(h => h.includes('Finanzen')) && grp.heads.some(h => h.includes('Recht')), JSON.stringify(grp));
  t.check('Dokument mit 2 Tags in 2 Gruppen', grp.pkRows === 2, JSON.stringify(grp));

  // Spalten aller Gruppen-Tabellen richten sich identisch aus (feste Breiten).
  const align = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('#lib-content table.lib-table')];
    if (tables.length < 2) return { ok: false, reason: 'zu wenige Tabellen', n: tables.length };
    // x-Position der Kopfzellen jeder Tabelle vergleichen (auf 1px gerundet).
    const cols = tables.map(t => [...t.querySelectorAll('thead th')].map(th => Math.round(th.getBoundingClientRect().left)));
    const first = cols[0];
    const ok = cols.every(c => c.length === first.length && c.every((x, i) => Math.abs(x - first[i]) <= 1));
    return { ok, cols };
  });
  t.check('Gruppen-Spalten sind identisch ausgerichtet', align.ok === true, JSON.stringify(align).slice(0, 200));

  // Schnell-Umbenennen: Stift-Button in der Namenszelle öffnet den Umbenennen-Dialog.
  const hasEdit = await page.evaluate(() => !!document.querySelector('#lib-content tbody tr .fname-edit[data-renid]'));
  t.check('Schnell-Umbenennen-Button vorhanden', hasEdit === true);
  await page.click('#lib-content tbody tr .fname-edit');
  await page.waitForTimeout(150);
  const dlgOpen = await page.evaluate(() => {
    const dlg = document.querySelector('#dlg-prompt.show');
    const inp = document.querySelector('#prompt-input');
    return { open: !!dlg, prefilled: inp ? inp.value : null };
  });
  t.check('Stift öffnet Umbenennen-Dialog mit vorausgefülltem Namen', dlgOpen.open === true && !!dlgOpen.prefilled, JSON.stringify(dlgOpen));
  await page.click('#prompt-cancel');
  await page.waitForTimeout(100);

  // Gruppe einklappen blendet ihre Tabelle aus.
  await page.click('#lib-content .lib-group-head');
  await page.waitForTimeout(120);
  const afterCollapse = await page.evaluate(() => document.querySelectorAll('#lib-content .lib-group-head.collapsed').length);
  t.check('Gruppe lässt sich einklappen', afterCollapse === 1, 'collapsed='+afterCollapse);

  // ---- Untertags: „Obertag/Untertag" bildet eine zweite Ebene ----
  await page.evaluate(async () => {
    const WA = window.WA;
    const idOf = n => WA.state.catalog.find(c => c.name === n).id;
    const setTags = async (name, tags) => {
      const doc = await WA.getIndex(idOf(name)); doc.tags = tags;
      const h = await WA.state.dirs.index.getFileHandle(doc.id + '.json', { create: true });
      const w = await h.createWritable(); await w.write(JSON.stringify(doc)); await w.close();
    };
    await setTags('mietvertrag.pdf', ['Recht/Verträge']);
    await setTags('budget.xlsx', ['Finanzen']);
    await setTags('projektkonzept.docx', ['Recht/Verträge', 'Recht/Gutachten']);
    await WA.state.lib.expanded.clear();
    await WA.rebuildCatalog(); WA.switchView('lib');
  });
  await page.waitForTimeout(200);
  const subInit = await page.evaluate(() => ({
    parentHeads: [...document.querySelectorAll('#lib-content .lib-group-head:not(.lib-subgroup-head) .lib-group-title')].map(e => e.textContent.trim()),
    subHeadsVisible: document.querySelectorAll('#lib-content .lib-subgroup-head').length,
  }));
  t.check('Untertags: Obertag-Köpfe (Recht, Finanzen), Untergruppen anfangs verborgen', subInit.parentHeads.some(h => h.includes('Recht')) && subInit.parentHeads.some(h => h.includes('Finanzen')) && subInit.subHeadsVisible === 0, JSON.stringify(subInit));

  await expandAll();
  const sub = await page.evaluate(() => {
    const subHeads = [...document.querySelectorAll('#lib-content .lib-subgroup-head .lib-group-title')].map(e => e.textContent.trim());
    const inVertraege = [...document.querySelectorAll('#lib-content .lib-subgroup')].some(sg => (sg.querySelector('.lib-group-title')?.textContent || '').includes('Verträge') && [...sg.querySelectorAll('.fname')].some(f => f.textContent === 'mietvertrag.pdf'));
    const parentCount = [...document.querySelectorAll('#lib-content .lib-group-head:not(.lib-subgroup-head)')].find(h => h.textContent.includes('Recht'))?.querySelector('.lib-group-count')?.textContent;
    return { subHeads, inVertraege, parentCount };
  });
  t.check('Untertags erscheinen unter dem Obertag (alphabetisch)', JSON.stringify(sub.subHeads) === JSON.stringify(['↳ Gutachten', '↳ Verträge']), JSON.stringify(sub.subHeads));
  t.check('Dokument liegt in seiner Untergruppe', sub.inVertraege === true, JSON.stringify(sub));
  t.check('Obertag-Zähler summiert Untergruppen', sub.parentCount === '3', 'count=' + sub.parentCount);

  // Obertag-Chip filtert inkl. Untertags (flache Liste mit allen Recht/*-Dokumenten).
  await page.evaluate(() => { window.WA.state.lib.tag = 'Recht'; window.WA.switchView('lib'); });
  await page.waitForTimeout(150);
  const parentFilter = await page.evaluate(() => [...document.querySelectorAll('#lib-content tbody tr .fname')].map(e => e.textContent).sort());
  t.check('Obertag-Filter zeigt auch Untertag-Dokumente', JSON.stringify(parentFilter) === JSON.stringify(['mietvertrag.pdf', 'projektkonzept.docx']), JSON.stringify(parentFilter));
  await page.evaluate(() => { window.WA.state.lib.tag = null; });

  // Suche: Obertag-Filter schließt Untertags ein.
  const searchTag = await page.evaluate(async () => {
    window.WA.state.search.tag = 'Recht';
    const { hits } = await window.WA.searchArchive({ q: 'Kuendigungsfrist', tag: 'Recht', types: [] });
    window.WA.state.search.tag = null;
    return hits.map(h => h.name);
  });
  t.check('Suche: Obertag-Filter trifft Untertag-Dokument', searchTag.includes('mietvertrag.pdf'), JSON.stringify(searchTag));

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
