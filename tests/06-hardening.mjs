// Audit-Regressionen: XSS über Restore (id/type), API-Key-Schutz & Limits beim
// Restore, Import-Reentrancy, Duplikat-„Ersetzen" verliert bei Parse-Fehler nichts,
// Phrasensuche mit Mehrfach-Leerzeichen, Entity-sicheres Highlighting.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('06-hardening');
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.WA', { timeout: 15000 });

  // --- XSS über manipuliertes Restore-Index-JSON (id/type) ---
  await page.evaluate(async () => {
    const index = window.WA.state.dirs.index;
    const w = await (await index.getFileHandle('evil.json', { create: true })).createWritable();
    // boesartige id UND type im JSON-Inhalt; Dateiname (evil) ist die sichere Quelle
    await w.write(JSON.stringify({ id: '"><img src=x onerror=window.__XSS=1>', name: 'Böse', type: 'a"><img src=x onerror=window.__XSS2=1>', importedAt: '2020-01-01', units: [] }));
    await w.close();
    await window.WA.rebuildCatalog();          // liest Index-Ordner neu, rendert Library
    window.WA.switchView('lib');
  });
  await page.waitForTimeout(400);
  const xssResult = await page.evaluate(() => ({
    xss: window.__XSS === 1 || window.__XSS2 === 1,
    catId: (window.WA.state.catalog.find(c => c.name === 'Böse') || {}).id,
    type: (window.WA.state.catalog.find(c => c.name === 'Böse') || {}).type,
  }));
  t.check('XSS über Restore-id/type wird NICHT ausgeführt', xssResult.xss === false);
  t.check('id wird aus sicherem Dateinamen abgeleitet', xssResult.catId === 'evil', 'id='+xssResult.catId);
  t.check('type wird auf Whitelist begrenzt', xssResult.type === 'txt', 'type='+xssResult.type);

  // --- Import-Reentrancy: zweiter Aufruf während laufendem Import hängt nichts auf ---
  const reentry = await page.evaluate(async () => {
    const before = window.WA.state.catalog.length;
    const mk = async (n) => new File([await (await fetch('_testfiles/' + n)).blob()], n);
    // ersten Import (mehrere Dateien) starten, NICHT awaiten, sofort zweiten nachschieben
    const p1 = window.WA.importFiles([await mk('mietvertrag.pdf'), await mk('budget.xlsx')]);
    const p2 = window.WA.importFiles([await mk('projektkonzept.docx'), await mk('readme.md')]);
    await Promise.all([p1, p2]);
    return window.WA.state.catalog.length - before;
  });
  t.check('Reentrante Importe verarbeiten alle 4 Dateien', reentry === 4, 'delta='+reentry);

  // --- Phrasensuche mit doppeltem Leerzeichen findet trotzdem ---
  const phrase = await page.evaluate(async () => {
    document.querySelector('#search-input').value = '"drei  Monate"'; // zwei Leerzeichen
    await window.WA.runSearch();
    return window.WA.state.lastHits.map(h => h.name);
  });
  t.check('Phrase mit Mehrfach-Leerzeichen trifft (Whitespace-Faltung)', phrase.includes('mietvertrag.pdf'), JSON.stringify(phrase));

  // --- Entity-sicheres Highlighting: Doc mit & im Text, Suche nach "amp" darf Entity nicht zerschneiden ---
  const ent = await page.evaluate(async () => {
    await window.WA.importFiles([new File(['Preis & Leistung amperemeter test'], 'amp.txt')]);
    document.querySelector('#search-input').value = 'amp';
    await window.WA.runSearch();
    const html = document.querySelector('#search-results .snippet')?.innerHTML || '';
    return html;
  });
  const entityOk = ent.includes('&amp;') && !/&amp<mark>|<mark>amp<\/mark>;/.test(ent);
  t.check('Highlighting zerschneidet keine HTML-Entity', entityOk, ent.slice(0, 120));

  t.check('Keine Konsolenfehler (Teil 1)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // Frischer Kontext für Duplikat-/Restore-Tests (keine Vorbelastung durch obige Importe)
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx2.addInitScript(MOCK);
  const page2 = await ctx2.newPage();
  const errors2 = [];
  collectErrors(page2, errors2);
  await page2.goto(base, { waitUntil: 'networkidle' });
  await page2.waitForFunction('!!window.WA', { timeout: 15000 });

  // --- Duplikat „Ersetzen" mit fehlschlagendem Parse verliert das Original nicht ---
  const before = await page2.evaluate(async () => {
    const good = new File([await (await fetch('_testfiles/projektkonzept.docx')).blob()], 'safe.docx');
    await window.WA.importFiles([good]);
    return (await window.WA.getIndex(window.WA.state.catalog.find(c => c.name === 'safe.docx').id)).units.length;
  });
  // gleicher Name, kaputter DOCX-Inhalt -> mammoth wirft; Dialog auf Playwright-Ebene bedienen
  await page2.evaluate(async () => { window.__badP = window.WA.importFiles([new File([new Uint8Array([1,2,3,4,5,6,7,8,9,10])], 'safe.docx')]); });
  await page2.waitForSelector('#dlg-dup.show', { timeout: 5000 });
  await page2.click('#dup-replace');
  const dupSafe = await page2.evaluate(async () => {
    await window.__badP;
    const still = window.WA.state.catalog.filter(c => c.name === 'safe.docx');
    const after = still.length === 1 ? await window.WA.getIndex(still[0].id) : null;
    return { count: still.length, unitsAfter: after ? after.units.length : -1 };
  });
  t.check('Duplikat-„Ersetzen" bei Parse-Fehler behält genau 1 (Original)', dupSafe.count === 1, JSON.stringify(dupSafe));
  t.check('Original bleibt inhaltlich unversehrt (nicht ersetzt)', dupSafe.unitsAfter === before && dupSafe.unitsAfter > 0, JSON.stringify({before, ...dupSafe}));

  // --- Restore überschreibt weder API-Key noch schleust fremde meta-Dateien ein ---
  const restore = await page2.evaluate(async () => {
    // echten Key setzen
    const meta = window.WA.state.dirs.meta;
    let w = await (await meta.getFileHandle('apikey.txt', { create: true })).createWritable(); await w.write('sk-ant-ECHT'); await w.close();
    // manipuliertes ZIP bauen (JSZip ist geladen)
    const zip = new window.JSZip();
    zip.file('meta/apikey.txt', 'sk-ant-ANGREIFER');
    zip.file('meta/evil.json', '{"x":1}');
    zip.file('index/../../escape.json', '{"id":"escape","name":"x","type":"txt","units":[]}');
    zip.file('index/legit.json', JSON.stringify({ id: 'legit', name: 'Legit', type: 'txt', importedAt: '2021', units: [{ ref: { section: 1 }, text: 'hallo' }] }));
    const blob = await zip.generateAsync({ type: 'blob' });
    await window.WA.importBackup(new File([blob], 'backup.zip'));
    await new Promise(r => setTimeout(r, 400));
    const read = async (n) => { try { return await (await (await meta.getFileHandle(n)).getFile()).text(); } catch (e) { return null; } };
    const hasEscape = window.WA.state.catalog.some(c => c.id === 'escape');
    const hasLegit = window.WA.state.catalog.some(c => c.id === 'legit');
    return { key: await read('apikey.txt'), evil: await read('evil.json'), hasEscape, hasLegit };
  });
  t.check('Restore überschreibt API-Key NICHT', restore.key === 'sk-ant-ECHT', 'key='+restore.key);
  t.check('Restore schleust keine fremden meta-Dateien ein', restore.evil === null);
  t.check('Restore blockt Traversal-Pfad', restore.hasEscape === false);
  t.check('Restore übernimmt legitime Index-Datei', restore.hasLegit === true);

  // Der bewusst kaputte DOCX loest in mammoth/JSZip eine erwartete Fehlermeldung
  // aus ("not a zip file") – die App faengt sie sauber ab; hier herausfiltern.
  const realErrors2 = errors2.filter((e) => !/central directory|is this a zip/i.test(e));
  t.check('Keine unerwarteten Konsolenfehler (Teil 2)', realErrors2.length === 0, realErrors2.join(' | '));
  await ctx2.close();

  // --- Sync-Datenverlust-Schutz für Originale (getrennter Blob-Sync) ---
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx3.addInitScript(MOCK);
  const page3 = await ctx3.newPage();
  const errors3 = [];
  collectErrors(page3, errors3);
  await page3.goto(base, { waitUntil: 'networkidle' });
  await page3.waitForFunction('!!window.WA', { timeout: 15000 });

  const sync = await page3.evaluate(async () => {
    await window.WA.importFiles([new File(['xdata'], 'guard_me.txt')]);
    if (!window.JSZip) await window.WA.buildBackupBlob({ folders: ['index'] });   // JSZip laden
    const id = window.WA.state.catalog.find(c => c.name === 'guard_me.txt').id;
    const doc = await window.WA.getIndex(id);
    const storedAs = doc.storedAs;
    const has = async () => { try { await window.WA.state.dirs.originals.getFileHandle(storedAs); return true; } catch (e) { return false; } };

    // originalsComplete spiegelt „alle Originale lokal vorhanden".
    const completeFull = await window.WA.originalsComplete();
    await window.WA.state.dirs.originals.removeEntry(storedAs);
    const completeMissing = await window.WA.originalsComplete();
    // Original für die Spiegel-Tests wiederherstellen.
    let w = await (await window.WA.state.dirs.originals.getFileHandle(storedAs, { create: true })).createWritable(); await w.write('xdata'); await w.close();

    const snap = { originals: new Set([storedAs]), index: new Set([id + '.json']), forum: new Set() };
    // (1) Ein unvollständiger Cloud-Blob (kennt das Original NICHT), aber der Index kennt es
    //     weiter → Original MUSS erhalten bleiben (kein Wegspiegeln).
    await window.WA.applyBackupZip(new window.JSZip(), { clearFirst: true, folders: ['originals', 'forum'], syncedSnapshot: snap });
    const keptWhileIndexed = await has();
    // (2) Dokument wirklich gelöscht (Index-Datei weg) → Original wird nun gespiegelt gelöscht.
    await window.WA.state.dirs.index.removeEntry(id + '.json');
    await window.WA.applyBackupZip(new window.JSZip(), { clearFirst: true, folders: ['originals', 'forum'], syncedSnapshot: snap });
    const removedWhenGone = !(await has());

    return { completeFull, completeMissing, keptWhileIndexed, removedWhenGone };
  });
  t.check('originalsComplete: true wenn alle Originale da', sync.completeFull === true);
  t.check('originalsComplete: false wenn ein Original fehlt', sync.completeMissing === false);
  t.check('Sync: unvollständiger Cloud-Blob löscht KEIN indiziertes Original (kein Datenverlust)', sync.keptWhileIndexed === true);
  t.check('Sync: echte Löschung (Index weg) spiegelt das Original korrekt weg', sync.removedWhenGone === true);
  t.check('Keine Konsolenfehler (Teil 3)', errors3.length === 0, errors3.join(' | '));
  await ctx3.close();

  await browser.close();
  return t.fails();
}
