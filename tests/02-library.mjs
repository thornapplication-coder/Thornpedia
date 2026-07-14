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
  // projektkonzept hat ZWEI Untertags von „Recht" → zählt als EIN Dokument (eindeutig).
  t.check('Obertag-Zähler zählt eindeutige Dokumente', sub.parentCount === '2', 'count=' + sub.parentCount);

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

  // ---- v1.10.1-Fixes: Review-Funde ----
  const setTags2 = async (name, tags) => page.evaluate(async ({ name, tags }) => {
    const WA = window.WA; const id = WA.state.catalog.find(c => c.name === name).id;
    const doc = await WA.getIndex(id); doc.tags = tags;
    const h = await WA.state.dirs.index.getFileHandle(id + '.json', { create: true });
    const w = await h.createWritable(); await w.write(JSON.stringify(doc)); await w.close();
  }, { name, tags });
  const rebuildLib = () => page.evaluate(async () => { await window.WA.rebuildCatalog(); window.WA.switchView('lib'); });

  // Fix 8 (Dedup): Dokument mit Obertag UND Untertag zählt/erscheint nur einmal in der Gruppe.
  await setTags2('mietvertrag.pdf', ['Recht/Verträge']);
  await setTags2('budget.xlsx', ['Recht']);
  await setTags2('projektkonzept.docx', ['Recht', 'Recht/Verträge']);
  await page.evaluate(() => window.WA.state.lib.expanded.clear());
  await rebuildLib(); await page.waitForTimeout(150); await expandAll();
  const dedup = await page.evaluate(() => ({
    parentCount: [...document.querySelectorAll('#lib-content .lib-group-head:not(.lib-subgroup-head)')].find(h => h.textContent.includes('Recht'))?.querySelector('.lib-group-count')?.textContent,
    pkRows: [...document.querySelectorAll('#lib-content .fname')].filter(e => e.textContent === 'projektkonzept.docx').length,
  }));
  t.check('Dedup: Obertag zählt eindeutige Dokumente (3)', dedup.parentCount === '3', JSON.stringify(dedup));
  t.check('Dedup: Doppel-Tag-Dokument erscheint nur einmal', dedup.pkRows === 1, JSON.stringify(dedup));

  // Fix 1: Schnellsuche (#lib-q) zeigt Treffer als flache Liste – nichts versteckt.
  const qvis = await page.evaluate(() => {
    window.WA.state.lib.q = 'budget'; window.WA.switchView('lib');
    const rows = [...document.querySelectorAll('#lib-content .fname')].map(e => e.textContent);
    const heads = document.querySelectorAll('#lib-content .lib-group-head').length;
    window.WA.state.lib.q = '';
    return { rows, heads };
  });
  t.check('Schnellsuche zeigt Treffer sofort (flach, keine zugeklappten Köpfe)', qvis.rows.includes('budget.xlsx') && qvis.heads === 0, JSON.stringify(qvis));

  // Fix 3 (Alt-Tags mit Leerzeichen um '/'): Filter und Gruppierung stimmen überein.
  await setTags2('budget.xlsx', ['Recht / Verträge']);
  await rebuildLib(); await page.waitForTimeout(120);
  const legacy = await page.evaluate(() => {
    window.WA.state.lib.tag = 'Recht'; window.WA.switchView('lib');
    const rows = [...document.querySelectorAll('#lib-content .fname')].map(e => e.textContent);
    window.WA.state.lib.tag = null;
    return rows;
  });
  t.check('Legacy-Tag „Recht / Verträge": Obertag-Filter trifft ihn', legacy.includes('budget.xlsx'), JSON.stringify(legacy));
  await setTags2('budget.xlsx', ['Recht']); await rebuildLib();

  // Fix 4 (hängender Schrägstrich): Tag-Dialog normalisiert 'Boeing/' → 'Boeing'.
  await page.evaluate(() => { window.WA.state.lib.q = 'budget'; window.WA.switchView('lib'); });
  await page.waitForTimeout(120);
  await page.click('#lib-content [data-menu]');
  await page.waitForTimeout(100);
  await page.click('#lib-content .menu.show [data-act="tag"]');
  await page.waitForTimeout(120);
  await page.evaluate(() => { const i = document.querySelector('#prompt-input'); i.value = ' Boeing/ '; });
  await page.click('#prompt-ok');
  await page.waitForTimeout(200);
  const norm = await page.evaluate(async () => {
    const WA = window.WA; const id = WA.state.catalog.find(c => c.name === 'budget.xlsx').id;
    const doc = await WA.getIndex(id); WA.state.lib.q = '';
    return doc.tags;
  });
  t.check('Normalisierung: „ Boeing/ " wird als „Boeing" gespeichert', norm.includes('Boeing') && !norm.some(t => t.includes('/') && t.startsWith('Boeing')), JSON.stringify(norm));
  await setTags2('budget.xlsx', ['Recht']); await rebuildLib();

  // Fix 1b: Frischer Import ist trotz Gruppierung sofort sichtbar (Ohne-Tags auto-offen).
  await page.evaluate(() => window.WA.state.lib.expanded.clear());
  const imp2 = await page.evaluate(async () => {
    await window.WA.importFiles([new File(['frischer inhalt'], 'frisch2.txt', { type: 'text/plain' })]);
    window.WA.switchView('lib');
    await new Promise(r => setTimeout(r, 150));
    return [...document.querySelectorAll('#lib-content .fname')].map(e => e.textContent);
  });
  t.check('Frischer Import sofort sichtbar (Ohne-Tags aufgeklappt)', imp2.includes('frisch2.txt'), JSON.stringify(imp2));
  await page.evaluate(async () => { const c = window.WA.state.catalog.find(x => x.name === 'frisch2.txt'); if (c) { await window.WA.state.dirs.index.removeEntry(c.id + '.json'); await window.WA.rebuildCatalog(); } });

  // Fix 7 (Forum-Leck): Dokument-Tag-Filter matcht Forum-Tags nur exakt, nicht per Präfix.
  const fleak = await page.evaluate(async () => {
    const WA = window.WA;
    await WA.foSaveEntry({ id: 'fx1', name: 'Xyzzykonzept', body: 'einzigartig', type: 'forum', ext: 'forum', importedAt: new Date().toISOString(), tags: ['Recht/Frage'], status: '', forum: { gid: 'g1', sid: null }, comments: [], attachments: [] });
    const viaParent = (await WA.searchArchive({ q: 'Xyzzykonzept', tag: 'Recht' })).hits.length;
    const viaExact = (await WA.searchArchive({ q: 'Xyzzykonzept', tag: 'Recht/Frage' })).hits.length;
    await WA.state.dirs.index.removeEntry('fx1.json'); await WA.rebuildCatalog();
    return { viaParent, viaExact };
  });
  t.check('Forum-Tags: kein Präfix-Leck (Obertag-Filter 0, exakt 1)', fleak.viaParent === 0 && fleak.viaExact === 1, JSON.stringify(fleak));

  // Fix 2 (Alt-Export-Migration): Definitionen ohne hier-Flag bekommen tagExact.
  const mig = await page.evaluate(async () => {
    const WA = window.WA;
    const h = await WA.state.dirs.meta.getFileHandle('exports.json', { create: true });
    const w = await h.createWritable(); await w.write(JSON.stringify([{ id: 'old1', kind: 'hits', fmt: 'xlsx', fileBase: 'alt', search: { q: 'x', tag: 'AC' } }])); await w.close();
    await WA.reloadArchiveViews();
    const defs = WA.getExportDefs();
    const exact = defs[0] && defs[0].search && defs[0].search.tagExact === true;
    // exakter Filter matcht 'AC/DC' NICHT
    const hit = (await WA.searchArchive({ q: 'irrelevantxyz', tag: 'AC', tagExact: true })).hits.length;
    const w2 = await (await WA.state.dirs.meta.getFileHandle('exports.json', { create: true })).createWritable(); await w2.write('[]'); await w2.close();
    await WA.reloadArchiveViews();
    return { exact, hit };
  });
  t.check('Alt-Export-Definitionen bleiben exakt (tagExact migriert)', mig.exact === true, JSON.stringify(mig));

  // Fix 5 (Kaskade): Obertag-Umbenennen zieht Untertags mit; Löschen entfernt den Baum.
  await setTags2('mietvertrag.pdf', ['Recht/Verträge']);
  await setTags2('budget.xlsx', ['Recht']);
  await setTags2('projektkonzept.docx', ['Finanzen']);
  await rebuildLib(); await page.waitForTimeout(120);
  await page.evaluate(() => window.WA.switchView('settings'));
  await page.waitForTimeout(200);
  await page.click('[data-tren="Recht"]');
  await page.waitForTimeout(120);
  await page.evaluate(() => { document.querySelector('#prompt-input').value = 'Legal'; });
  await page.click('#prompt-ok');
  await page.waitForTimeout(300);
  const casc = await page.evaluate(async () => {
    const WA = window.WA; const tagsOf = async (n) => (await WA.getIndex(WA.state.catalog.find(c => c.name === n).id)).tags;
    return { miet: await tagsOf('mietvertrag.pdf'), budget: await tagsOf('budget.xlsx') };
  });
  t.check('Kaskade: „Recht"→„Legal" benennt auch „Recht/Verträge" um', casc.budget.includes('Legal') && casc.miet.includes('Legal/Verträge'), JSON.stringify(casc));

  page.once('dialog', d => d.accept());
  await page.click('[data-tdel="Legal"]');
  await page.waitForTimeout(300);
  const afterDel = await page.evaluate(() => window.WA.state.catalog.flatMap(c => c.tags || []).filter(t => t === 'Legal' || t.startsWith('Legal/')));
  t.check('Kaskade: Obertag-Löschen entfernt auch Untertags', afterDel.length === 0, JSON.stringify(afterDel));

  // ---- v1.10.3: Zwei-Ebenen-Tag-Auswahl (aufklappbare Obertag-/Untertag-Chips) ----
  await setTags2('mietvertrag.pdf', ['B737/Max Manuals']);
  await setTags2('budget.xlsx', ['B737']);
  await setTags2('projektkonzept.docx', ['EASA']);
  await page.evaluate(() => { window.WA.state.lib.tag = null; });
  await rebuildLib(); await page.waitForTimeout(150);
  const chooserInit = await page.evaluate(() => ({
    parents: [...document.querySelectorAll('#lib-content .tag-toolbar .chip.tag-parent')].map(e => e.textContent),
    children: document.querySelectorAll('#lib-content .tag-toolbar .chip.tag-child').length,
    hasToolbar: !!document.querySelector('#lib-content .tag-toolbar'),
  }));
  t.check('Tag-Auswahl: nur Obertag-Chips, Untertags anfangs zugeklappt',
    chooserInit.hasToolbar && chooserInit.parents.some(p => p.includes('B737')) && chooserInit.parents.some(p => p.includes('EASA')) && chooserInit.children === 0, JSON.stringify(chooserInit));

  await page.click('#lib-content .tag-toolbar [data-libtag="B737"]');
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => ({
    subs: [...document.querySelectorAll('#lib-content .tag-toolbar .chip.tag-child')].map(e => e.textContent.trim()),
    rows: [...document.querySelectorAll('#lib-content tbody tr .fname')].map(e => e.textContent).sort(),
  }));
  t.check('Tag-Auswahl: Obertag-Klick klappt Untertags auf & filtert inkl. Untertags',
    opened.subs.some(s => s.includes('Max Manuals')) && JSON.stringify(opened.rows) === JSON.stringify(['budget.xlsx', 'mietvertrag.pdf']), JSON.stringify(opened));

  await page.click('#lib-content .tag-toolbar [data-libtag="B737/Max Manuals"]');
  await page.waitForTimeout(150);
  const narrowed = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#lib-content tbody tr .fname')].map(e => e.textContent).sort(),
    childOn: !!document.querySelector('#lib-content .tag-toolbar .chip.tag-child.on'),
  }));
  t.check('Tag-Auswahl: Untertag-Klick filtert exakt auf den Untertag',
    JSON.stringify(narrowed.rows) === JSON.stringify(['mietvertrag.pdf']) && narrowed.childOn === true, JSON.stringify(narrowed));
  await page.evaluate(() => { window.WA.state.lib.tag = null; window.WA.switchView('lib'); });

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
