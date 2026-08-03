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

    // blobComplete spiegelt „alle Blob-Dateien lokal vorhanden".
    const completeFull = await window.WA.blobComplete();
    await window.WA.state.dirs.originals.removeEntry(storedAs);
    const completeMissing = await window.WA.blobComplete();
    // Original für die Spiegel-Tests wiederherstellen.
    let w = await (await window.WA.state.dirs.originals.getFileHandle(storedAs, { create: true })).createWritable(); await w.write('xdata'); await w.close();

    // blobComplete deckt AUCH Forum-Anhänge ab – inkl. Anhängen an KOMMENTAREN.
    const foId = 'fo-guard-1';
    const foDoc = { id: foId, name: 'Forumeintrag', type: 'forum', importedAt: '2026', units: [],
      attachments: [{ name: 'a.png', storedAs: 'foX__a.png' }],
      comments: [{ text: 'k', attachments: [{ name: 'c.png', storedAs: 'foX__c.png' }] }] };
    let fw = await (await window.WA.state.dirs.index.getFileHandle(foId + '.json', { create: true })).createWritable();
    await fw.write(JSON.stringify(foDoc)); await fw.close();
    window.WA.state.catalog.push({ id: foId, name: 'Forumeintrag', type: 'forum' });
    const completeForumMissing = await window.WA.blobComplete();   // beide Anhänge fehlen → false
    let aw = await (await window.WA.state.dirs.forum.getFileHandle('foX__a.png', { create: true })).createWritable(); await aw.write('img'); await aw.close();
    const completeCommentAttMissing = await window.WA.blobComplete();   // Kommentar-Anhang fehlt noch → false
    let cw = await (await window.WA.state.dirs.forum.getFileHandle('foX__c.png', { create: true })).createWritable(); await cw.write('img'); await cw.close();
    const completeForumPresent = await window.WA.blobComplete();   // jetzt beide da → true

    // Verwaister Anhang: von KEINEM Eintrag referenziert, war aber im letzten Sync dabei.
    let ow = await (await window.WA.state.dirs.forum.getFileHandle('foX__orphan.png', { create: true })).createWritable(); await ow.write('img'); await ow.close();

    const foHas = async (n) => { try { await window.WA.state.dirs.forum.getFileHandle(n); return true; } catch (e) { return false; } };
    const snap = { originals: new Set([storedAs]), index: new Set([id + '.json']),
      forum: new Set(['foX__a.png', 'foX__c.png', 'foX__orphan.png']) };
    // (1) Ein unvollständiger Cloud-Blob (kennt die Dateien NICHT), aber Index/Eintrag kennen
    //     sie weiter → MÜSSEN erhalten bleiben. Der verwaiste Anhang MUSS dagegen weg.
    await window.WA.applyBackupZip(new window.JSZip(), { clearFirst: true, folders: ['originals', 'forum'], syncedSnapshot: snap });
    const keptWhileIndexed = await has();
    const foKeptWhileReferenced = await foHas('foX__a.png');
    const foCommentKept = await foHas('foX__c.png');
    const foOrphanRemoved = !(await foHas('foX__orphan.png'));
    // (2) Dokument wirklich gelöscht (Index-Datei weg) → Original wird nun gespiegelt gelöscht.
    await window.WA.state.dirs.index.removeEntry(id + '.json');
    await window.WA.applyBackupZip(new window.JSZip(), { clearFirst: true, folders: ['originals', 'forum'], syncedSnapshot: snap });
    const removedWhenGone = !(await has());

    // Fixture wieder abräumen, damit spätere Prüfungen sauberen Zustand sehen.
    await window.WA.state.dirs.index.removeEntry(foId + '.json').catch(() => {});
    window.WA.state.catalog = window.WA.state.catalog.filter(c => c.id !== foId);
    window.WA.state.indexCache.delete(foId);

    return { completeFull, completeMissing, completeForumMissing, completeCommentAttMissing, completeForumPresent,
      keptWhileIndexed, foKeptWhileReferenced, foCommentKept, foOrphanRemoved, removedWhenGone };
  });
  t.check('blobComplete: true wenn alle Originale da', sync.completeFull === true);
  t.check('blobComplete: false wenn ein Original fehlt', sync.completeMissing === false);
  t.check('blobComplete: false wenn ein Forum-Anhang fehlt', sync.completeForumMissing === false);
  t.check('blobComplete: false wenn ein KOMMENTAR-Anhang fehlt', sync.completeCommentAttMissing === false);
  t.check('blobComplete: true wenn alle Forum-Anhänge vorhanden', sync.completeForumPresent === true);
  t.check('Sync: unvollständiger Cloud-Blob löscht KEIN indiziertes Original (kein Datenverlust)', sync.keptWhileIndexed === true);
  t.check('Sync: unvollständiger Cloud-Blob löscht KEINEN referenzierten Forum-Anhang', sync.foKeptWhileReferenced === true);
  t.check('Sync: Kommentar-Anhang bleibt ebenfalls erhalten', sync.foCommentKept === true);
  t.check('Sync: NICHT referenzierter Forum-Anhang wird korrekt weggespiegelt', sync.foOrphanRemoved === true);
  t.check('Sync: echte Löschung (Index weg) spiegelt das Original korrekt weg', sync.removedWhenGone === true);
  // Der AUTOMATISCHE Konfliktpfad (odConflict → odPush{force}) darf den Blob-Vollständigkeits-
  // schutz NICHT umgehen: sonst überschreibt ein unvollständiges Gerät die vollständige
  // Cloud-Fassung, und odBackupRemote sichert nur DATA – die Originale wären unrettbar weg.
  const forceGuard = await page3.evaluate(async () => {
    const WA = window.WA, OD = WA.OD;
    await WA.importFiles([new File(['zdata'], 'force_guard.txt')]);
    const id = WA.state.catalog.find(c => c.name === 'force_guard.txt').id;
    const doc = await WA.getIndex(id);
    await WA.state.dirs.originals.removeEntry(doc.storedAs);   // Gerät ist jetzt UNVOLLSTÄNDIG
    const incomplete = !(await WA.blobComplete());

    // Cloud-Zugriffe abfangen: kein echtes OneDrive. Heilung schlägt fehl (Netzfehler).
    const puts = [];
    const realFetch = window.fetch;
    // Gültiges Token im Speicher → kein Refresh, kein Client-ID-Pfad.
    OD.tokens = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3 };
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('graph.microsoft.com')) {
        if (opts && opts.method === 'PUT') { puts.push(u); return new Response(JSON.stringify({ eTag: 'e2' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
        if (u.includes(':/content')) throw new Error('Netzfehler beim Blob-Download');   // Heilung scheitert
        return new Response(JSON.stringify({ eTag: 'e1', cTag: 'c1', size: 10, lastModifiedDateTime: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    let res = null, err = '';
    try { OD.cfg.blobDirty = true; res = await WA.odPush({ force: true }); }   // = was odConflict tut
    catch (e) { err = e.message; }
    finally { window.fetch = realFetch; OD.tokens = null; }
    const blobPut = puts.some(u => u.includes('blobs'));
    return { incomplete, res, err, blobPut, blobDirtyStill: OD.cfg.blobDirty };
  });
  t.check('Vorbedingung: Gerät ist unvollständig', forceGuard.incomplete === true, JSON.stringify(forceGuard));
  t.check('odPush schreibt die alte Blob-ZIP NIE mehr (auch nicht bei force)', forceGuard.blobPut === false, JSON.stringify(forceGuard));
  t.check('Daten-Push meldet ok (Dateien laufen über den Einzeldatei-Abgleich)', forceGuard.res === 'ok', JSON.stringify(forceGuard));

  // KERN: Ein Cloud-Stand, dem Dokumente fehlen (Gerät war zurück / hatte sie nie), darf die
  // Bibliothek NICHT schrumpfen. Nur eine ausdrückliche Löschung (Marker) entfernt Dokumente.
  const tombs = await page3.evaluate(async () => {
    const WA = window.WA;
    await WA.importFiles([new File(['a'], 'bleibt.txt'), new File(['b'], 'wirklich_geloescht.txt')]);
    const keepId = WA.state.catalog.find(c => c.name === 'bleibt.txt').id;
    const delId = WA.state.catalog.find(c => c.name === 'wirklich_geloescht.txt').id;
    const idxHas = async (id) => { try { await WA.state.dirs.index.getFileHandle(id + '.json'); return true; } catch (e) { return false; } };

    const snap = { originals: new Set(), index: new Set([keepId + '.json', delId + '.json']), forum: new Set() };
    // (1) Cloud-ZIP OHNE beide Dokumente und OHNE Löschmarker → beide MÜSSEN bleiben.
    const bare = new window.JSZip();
    await WA.applyBackupZip(bare, { clearFirst: true, folders: ['index', 'meta'], syncedSnapshot: snap, tombGated: true });
    const keptNoTomb = (await idxHas(keepId)) && (await idxHas(delId));

    // (2) Cloud-ZIP mit Löschmarker für EIN Dokument → nur dieses verschwindet.
    const withTomb = new window.JSZip();
    withTomb.file('meta/tombstones.json', JSON.stringify([delId]));
    await WA.applyBackupZip(withTomb, { clearFirst: true, folders: ['index', 'meta'], syncedSnapshot: snap, tombGated: true });
    const deletedOnlyTombed = !(await idxHas(delId)) && (await idxHas(keepId));

    // (3) Löschmarker werden VEREINIGT, nicht ersetzt (lokale Löschabsicht überlebt).
    const localTomb = 'lokal-geloescht-id';
    WA.state.tombs.add(localTomb);
    const other = new window.JSZip();
    other.file('meta/tombstones.json', JSON.stringify(['fremd-id']));
    await WA.applyBackupZip(other, { clearFirst: false, folders: ['index', 'meta'] });
    const merged = WA.state.tombs.has(localTomb) && WA.state.tombs.has('fremd-id');

    return { keptNoTomb, deletedOnlyTombed, merged };
  });
  t.check('Cloud ohne Löschmarker schrumpft die Bibliothek NICHT (49→42-Fall)', tombs.keptNoTomb === true, JSON.stringify(tombs));
  t.check('Echte Löschung propagiert weiterhin (nur markiertes Dokument verschwindet)', tombs.deletedOnlyTombed === true, JSON.stringify(tombs));
  t.check('Löschmarker werden vereinigt statt ersetzt', tombs.merged === true, JSON.stringify(tombs));

  // Wiederherstellen muss einen Löschmarker AUFHEBEN – sonst entfernt der nächste Abgleich
  // das gerade zurückgeholte Dokument sofort wieder (die Rettung liefe ins Leere).
  const undelete = await page3.evaluate(async () => {
    const WA = window.WA;
    await WA.importFiles([new File(['zurueck'], 'wieder_da.txt')]);
    const id = WA.state.catalog.find(c => c.name === 'wieder_da.txt').id;
    // Sicherung MIT dem Dokument erstellen, dann löschen (setzt den Marker).
    const blob = await WA.buildBackupBlob({ folders: ['index', 'meta'] });
    window.confirm = () => true;
    await WA.deleteDoc(id);
    const tombAfterDelete = WA.state.tombs.has(id);
    // Aus der Sicherung zurückholen.
    await WA.importBackup(new File([blob], 'restore.zip'));
    const back = WA.state.catalog.some(c => c.id === id);
    const tombCleared = !WA.state.tombs.has(id);
    // Gegenprobe: Ein Cloud-Abgleich darf es jetzt NICHT wieder entfernen.
    const snap = { originals: new Set(), index: new Set([id + '.json']), forum: new Set() };
    await WA.applyBackupZip(new window.JSZip(), { clearFirst: true, folders: ['index', 'meta'], syncedSnapshot: snap, tombGated: true });
    let stillThere = false; try { await WA.state.dirs.index.getFileHandle(id + '.json'); stillThere = true; } catch (e) {}
    return { tombAfterDelete, back, tombCleared, stillThere };
  });
  t.check('Löschen setzt den Marker', undelete.tombAfterDelete === true, JSON.stringify(undelete));
  t.check('Wiederherstellen holt das gelöschte Dokument zurück', undelete.back === true, JSON.stringify(undelete));
  t.check('Wiederherstellen hebt den Löschmarker auf', undelete.tombCleared === true, JSON.stringify(undelete));
  t.check('Nächster Abgleich löscht das zurückgeholte Dokument NICHT erneut', undelete.stillThere === true, JSON.stringify(undelete));

  // Beschädigte Index-Datei: darf NICHT stumm verschwinden, sondern muss gemeldet werden.
  const brokenIdx = await page3.evaluate(async () => {
    const WA = window.WA;
    await WA.importFiles([new File(['heil'], 'kaputt_test.txt')]);
    const id = WA.state.catalog.find(c => c.name === 'kaputt_test.txt').id;
    // Abgeschnittene Datei simulieren (so sieht ein abgebrochener Schreibvorgang aus).
    const w = await (await WA.state.dirs.index.getFileHandle(id + '.json', { create: true })).createWritable();
    await w.write('{"id":"' + id + '","name":"kaputt'); await w.close();
    await WA.rebuildCatalog();
    WA.switchView('lib');
    await new Promise(r => setTimeout(r, 200));
    const banner = document.querySelector('#lib-broken');
    const out = { broken: (WA.state.brokenIndex || []).length, visible: !!banner && banner.style.display !== 'none', text: banner ? banner.textContent.slice(0, 60) : '' };
    // Fixture abräumen: Die kaputte Index-Datei würde sonst spätere Prüfungen kippen –
    // der Einzeldatei-Sync verweigert bei unlesbarem Index bewusst JEDE Aktion (fail-safe).
    await WA.state.dirs.index.removeEntry(id + '.json').catch(() => {});
    await WA.rebuildCatalog();
    return out;
  });
  t.check('Beschädigter Index-Eintrag wird erkannt (nicht stumm übersprungen)', brokenIdx.broken === 1, JSON.stringify(brokenIdx));
  t.check('Beschädigte Einträge werden in der Bibliothek gemeldet', brokenIdx.visible === true, JSON.stringify(brokenIdx));

  // Sicher geschriebenes JSON: nach dem Schreiben lesbar (keine halben Dateien).
  const safeWrite = await page3.evaluate(async () => {
    const WA = window.WA;
    await WA.importFiles([new File(['x'], 'safe_write.txt')]);
    const id = WA.state.catalog.find(c => c.name === 'safe_write.txt').id;
    try { JSON.parse(await (await (await WA.state.dirs.index.getFileHandle(id + '.json')).getFile()).text()); return true; } catch (e) { return false; }
  });
  t.check('Index-Datei nach dem Schreiben garantiert lesbar', safeWrite === true);

  // Einzeldatei-Sync (v1.11): Hochladen add-only, Herunterladen gezielt, Löschen NUR
  // deterministisch (Löschmarker bzw. keine Referenz) – und die alte Blob-ZIP bleibt
  // unangetastet. Der ganze Abgleich läuft auch im App-Speicher (iPhone/iPad).
  const filesSync = await page3.evaluate(async () => {
    const WA = window.WA, OD = WA.OD;
    const prevMode = WA.state.storageMode;
    WA.state.storageMode = 'opfs';                       // bewusst: iPhone-Modus
    // Lokal: Doc A (Original vorhanden) + Doc B (nur Index – Original liegt in der Cloud).
    await WA.importFiles([new File(['adata'], 'einzel_a.txt')]);
    const aId = WA.state.catalog.find(c => c.name === 'einzel_a.txt').id;
    const aStored = (await WA.getIndex(aId)).storedAs;
    const bId = 'einzel-b-id', bStored = bId + '__einzel_b.txt';
    let w = await (await WA.state.dirs.index.getFileHandle(bId + '.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ id: bId, name: 'einzel_b.txt', storedAs: bStored, type: 'txt', importedAt: '2026', units: [] })); await w.close();
    WA.state.catalog.push({ id: bId, name: 'einzel_b.txt', type: 'txt' });
    // Löschmarker für ein drittes Dokument, dessen Datei noch in der Cloud liegt.
    const tId = 'einzel-tomb-id', tStored = tId + '__geloescht.txt';
    WA.state.tombs.add(tId);
    // Graph-Mock: Cloud kennt B (zum Herunterladen), T (zu löschen) und einen
    // verwaisten Forum-Anhang; A fehlt in der Cloud (muss hochgeladen werden).
    const realFetch = window.fetch;
    const puts = [], dels = [];
    OD.tokens = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3 };
    window.fetch = async (url, opts) => {
      const u = String(url); const method = (opts && opts.method) || 'GET';
      if (!u.includes('graph.microsoft.com')) return realFetch(url, opts);
      if (method === 'PUT') { puts.push(decodeURIComponent(u)); return new Response(JSON.stringify({ eTag: 'e9' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
      if (method === 'DELETE') { dels.push(decodeURIComponent(u)); return new Response(null, { status: 204 }); }
      if (u.includes('/originals:/children')) return new Response(JSON.stringify({ value: [{ name: bStored, size: 5 }, { name: tStored, size: 5 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/forum:/children')) return new Response(JSON.stringify({ value: [{ name: 'waise__x.png', size: 3 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes(':/content')) return new Response('bdata', { status: 200 });
      return new Response(JSON.stringify({ eTag: 'e1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    let res = null, err = '';
    try { res = await WA.odFilesReconcile(); }
    catch (e) { err = e.message; }
    finally { window.fetch = realFetch; OD.tokens = null; WA.state.storageMode = prevMode; }
    let bLocal = false; try { bLocal = (await (await (await WA.state.dirs.originals.getFileHandle(bStored)).getFile()).text()) === 'bdata'; } catch (e) {}
    // Aufräumen der Fixtures.
    WA.state.tombs.delete(tId);
    await WA.state.dirs.index.removeEntry(bId + '.json').catch(() => {});
    WA.state.catalog = WA.state.catalog.filter(c => c.id !== bId);
    return { err, res,
      aUp: puts.some(u => u.includes('/originals/' + aStored)),
      bDown: bLocal,
      tDel: dels.some(u => u.includes(tStored)),
      orphanDel: dels.some(u => u.includes('waise__x.png')),
      bNotDeleted: !dels.some(u => u.includes(bStored)),
      oldZipUntouched: !puts.concat(dels).some(u => u.includes('thornpedia_blobs.zip')) };
  });
  t.check('Einzeldatei: fehlendes Original wird hochgeladen (auch im App-Speicher)', filesSync.aUp === true, JSON.stringify(filesSync));
  t.check('Einzeldatei: fehlendes Original wird gezielt heruntergeladen', filesSync.bDown === true, JSON.stringify(filesSync));
  t.check('Einzeldatei: Löschmarker löscht die Cloud-Datei', filesSync.tDel === true, JSON.stringify(filesSync));
  t.check('Einzeldatei: verwaister Forum-Anhang wird in der Cloud entfernt', filesSync.orphanDel === true, JSON.stringify(filesSync));
  t.check('Einzeldatei: „fehlt lokal" führt NICHT zur Cloud-Löschung (add-only)', filesSync.bNotDeleted === true, JSON.stringify(filesSync));
  t.check('Einzeldatei: alte Blob-ZIP bleibt unangetastet', filesSync.oldZipUntouched === true, JSON.stringify(filesSync));

  // Kein Dauer-Upload: Der Sync muss KONVERGIEREN. Erster Lauf darf Einzeldateien
  // hochladen (Erst-Migration), aber nie die DATA-ZIP ohne echte Daten-Änderung – und der
  // zweite Lauf (Cloud kennt jetzt alles) darf GAR NICHTS mehr übertragen.
  const noLoop = await page3.evaluate(async () => {
    const WA = window.WA, OD = WA.OD;
    const prevMode = WA.state.storageMode;
    WA.state.storageMode = 'opfs';
    const realFetch = window.fetch;
    const dataPuts = []; const cloud = { originals: [], forum: [] };   // Cloud-Zustand wächst mit den PUTs
    let filePuts1 = 0, filePuts2 = 0, phase = 1;
    OD.tokens = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3 };
    OD.cfg.dirty = false; OD.cfg.blobDirty = true; OD.cfg.etag = 'SAME'; OD.cfg.auto = true;
    window.fetch = async (url, opts) => {
      const u = decodeURIComponent(String(url)); const method = (opts && opts.method) || 'GET';
      if (!u.includes('graph.microsoft.com')) return realFetch(url, opts);
      if (method === 'PUT') {
        if (u.includes('thornpedia_data.zip')) dataPuts.push(u);
        else { const m = u.match(/\/(originals|forum)\/([^:]+):/); if (m) { cloud[m[1]].push(m[2]); if (phase === 1) filePuts1++; else filePuts2++; } }
        return new Response(JSON.stringify({ eTag: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (u.includes('/originals:/children')) return new Response(JSON.stringify({ value: cloud.originals.map(n => ({ name: n, size: 1 })) }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/forum:/children')) return new Response(JSON.stringify({ value: cloud.forum.map(n => ({ name: n, size: 1 })) }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ eTag: 'SAME', size: 10, lastModifiedDateTime: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      await WA.odSync(true);
      phase = 2; OD.cfg.blobDirty = true;               // selbst mit gesetztem Flag: nichts mehr zu tun
      await WA.odSync(true);
    }
    finally { window.fetch = realFetch; OD.tokens = null; WA.state.storageMode = prevMode; OD.cfg.blobDirty = false; }
    return { dataPuts: dataPuts.length, filePuts1, filePuts2 };
  });
  t.check('Ohne Daten-Änderung wird die DATA-ZIP nicht hochgeladen', noLoop.dataPuts === 0, JSON.stringify(noLoop));
  t.check('Zweiter Lauf überträgt NICHTS mehr (Sync konvergiert, kein Dauerlauf)', noLoop.filePuts2 === 0, JSON.stringify(noLoop));

  // Eine gerade entstehende Sicherung ist 0 Byte gross – die Aufräumung darf sie nicht löschen.
  const inFlight = await page3.evaluate(async () => {
    const WA = window.WA;
    const name = 'wissensarchiv_autobackup_2026-03-03_0000.zip';
    const w = await (await WA.state.dirs.exports.getFileHandle(name, { create: true })).createWritable();
    await w.close();                                   // 0 Byte wie während des Packens
    WA.__packingNowAdd(name);                          // als „wird gerade gepackt" markieren
    await WA.renderBackupFiles();
    let survived = true; try { await WA.state.dirs.exports.getFileHandle(name); } catch (e) { survived = false; }
    WA.__packingNowDelete(name);
    await WA.renderBackupFiles();                      // jetzt darf sie entsorgt werden
    let cleaned = false; try { await WA.state.dirs.exports.getFileHandle(name); } catch (e) { cleaned = true; }
    return { survived, cleaned };
  });
  t.check('Entstehende Sicherung wird NICHT gelöscht', inFlight.survived === true, JSON.stringify(inFlight));
  t.check('Nach dem Packen wird ein echter 0-Byte-Rest entsorgt', inFlight.cleaned === true, JSON.stringify(inFlight));

  t.check('Keine Konsolenfehler (Teil 3)', errors3.length === 0, errors3.join(' | '));
  await ctx3.close();

  await browser.close();
  return t.fails();
}
