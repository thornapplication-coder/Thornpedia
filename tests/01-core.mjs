// Kern-Pipeline: Import aller Formate, Suche (inkl. Umlaut/Phrase/UND),
// Fundstelle (PDF-Rendering), Forum, Exporte, Backup.
import { MOCK, launchBrowser, collectErrors, makeChecker } from './helper.mjs';

export async function run(base) {
  const t = makeChecker('01-core');
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.WA', { timeout: 15000 });

  // Import aller Formate
  const imp = await page.evaluate(async () => {
    const names = ['mietvertrag.pdf','scan_ohne_text.pdf','projektkonzept.docx','budget.xlsx','kunden.csv','notizen.txt','readme.md'];
    const files = await Promise.all(names.map(async n => new File([await (await fetch('_testfiles/'+n)).blob()], n)));
    await window.WA.importFiles(files);
    const cat = window.WA.state.catalog;
    return { count: cat.length, scan: cat.find(c=>c.name==='scan_ohne_text.pdf'), pdf: cat.find(c=>c.name==='mietvertrag.pdf') };
  });
  t.check('7 Dokumente importiert', imp.count === 7, 'count='+imp.count);
  t.check('Gescanntes PDF erkannt', imp.scan && imp.scan.scanned === true);
  t.check('Text-PDF mit 2 Seiten', imp.pdf && imp.pdf.pageCount === 2 && !imp.pdf.scanned);

  // Suche: Basisbegriff
  const s1 = await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'Kuendigungsfrist';
    await window.WA.runSearch();
    return window.WA.state.lastHits.map(h => ({ name: h.name, ref: h.ref }));
  });
  t.check('Suche findet 5 Treffer', s1.length === 5, 'hits='+s1.length);
  t.check('Excel-Treffer mit Blatt+Zeile (zeilenbasiert)', s1.some(h => h.ref && h.ref.sheet === 'Fixkosten' && h.ref.row === 2));

  // Suche: Umlaut-Toleranz (kündigungsfrist == Kuendigungsfrist)
  const s2 = await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'kündigungsfrist';
    await window.WA.runSearch();
    return window.WA.state.lastHits.length;
  });
  t.check('Umlaut-Suche (kündigungsfrist) findet dieselben 5 Treffer', s2 === 5, 'hits='+s2);

  // Suche: Phrase
  const s3 = await page.evaluate(async () => {
    document.querySelector('#search-input').value = '"drei Monate"';
    await window.WA.runSearch();
    return window.WA.state.lastHits.map(h => h.name);
  });
  t.check('Phrasensuche "drei Monate" trifft nur mietvertrag.pdf', s3.length === 1 && s3[0] === 'mietvertrag.pdf', JSON.stringify(s3));

  // Suche: UND-Verknüpfung
  const s4 = await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'Kuendigungsfrist Quartalsende';
    await window.WA.runSearch();
    return window.WA.state.lastHits.map(h => h.name);
  });
  t.check('UND-Suche trifft nur Dokument mit beiden Begriffen', s4.length === 1 && s4[0] === 'mietvertrag.pdf', JSON.stringify(s4));

  // Forum: Eintrag mit Status/Tags/Markdown → fließt in die Suche ein, rendert sauber
  const fo = await page.evaluate(async () => {
    const id = 'forumtest-1';
    await window.WA.foSaveEntry({ id, name: 'Checkliste Vorflugkontrolle', body: '## Ablauf\n- **Zwlfkontrolle** vor jedem Flug\n- Papiere pruefen', type: 'forum', ext: 'forum', importedAt: new Date().toISOString(), tags: ['checkliste'], status: 'important', forum: { gid: 'g1', sid: null }, comments: [], attachments: [] });
    window.WA.state.search.q = 'Zwlfkontrolle';
    document.querySelector('#search-input').value = 'Zwlfkontrolle';
    await window.WA.runSearch();
    const h = window.WA.state.lastHits;
    // Detailansicht rendern (Markdown/Status)
    window.WA.state.forumEntryId = id; window.WA.state.forumView = 'entry';
    window.WA.switchView('forum');
    await new Promise(r => setTimeout(r, 350));
    const html = document.querySelector('#forum-content').innerHTML;
    return { count: h.length, type: h[0] && h[0].type, name: h[0] && h[0].name, inCatalog: window.WA.state.catalog.some(c => c.type === 'forum'), byTag: (window.WA.state.catalog.find(c => c.id === id) || {}).tags, md: html.includes('<strong>Zwlfkontrolle</strong>') && /<h4/.test(html), status: html.includes('⭐') };
  });
  t.check('Forum-Eintrag ist durchsuchbar', fo.count === 1 && fo.type === 'forum' && fo.name === 'Checkliste Vorflugkontrolle', JSON.stringify(fo));
  t.check('Forum-Eintrag steht im Katalog (Typ forum, mit Tags)', fo.inCatalog === true && Array.isArray(fo.byTag) && fo.byTag.includes('checkliste'));
  t.check('Forum-Detail rendert Markdown + Status', fo.md === true && fo.status === true, JSON.stringify({ md: fo.md, status: fo.status }));

  // Forum: Querverweis auf ein Dokument + Themen-Export
  const fx = await page.evaluate(async () => {
    // Thema anlegen, damit exportForumTopic die Gruppe findet
    window.WA.state.forum = { groups: [{ id: 'g1', name: 'Checklisten', subs: [] }] };
    await window.WA.saveForum();
    const e = await window.WA.getIndex('forumtest-1');
    const docId = window.WA.state.catalog.find(c => c.name === 'mietvertrag.pdf').id;
    e.refs = [{ kind: 'doc', id: docId, name: 'mietvertrag.pdf' }];
    await window.WA.foSaveEntry(e);
    const before = []; for await (const [n] of window.WA.state.dirs.exports.entries()) before.push(n);
    let err = null; try { await window.WA.exportForumTopic('g1', 'docx'); await window.WA.exportForumTopic('g1', 'pdf'); } catch (x) { err = x.message; }
    const after = []; for await (const [n] of window.WA.state.dirs.exports.entries()) after.push(n);
    const saved = await window.WA.getIndex('forumtest-1');
    return { err, refSaved: (saved.refs || []).some(r => r.name === 'mietvertrag.pdf'), topicFiles: after.filter(f => /^thornpedia_thema_/.test(f)).length };
  });
  t.check('Querverweis wird gespeichert', fx.refSaved === true);
  t.check('Themen-Export erzeugt Dateien ohne Fehler', fx.err === null && fx.topicFiles >= 2, JSON.stringify(fx));

  // Forum: Bild-Anhang an einem Kommentar
  const cc = await page.evaluate(async () => {
    const e = await window.WA.getIndex('forumtest-1');
    const img = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'kommentarbild.png', { type: 'image/png' });
    await window.WA.foAddComment(e, 'Kommentar mit Bild', [img]);
    const saved = await window.WA.getIndex('forumtest-1');
    const last = saved.comments[saved.comments.length - 1];
    let fileOk = false; try { await window.WA.state.dirs.forum.getFileHandle(last.attachments[0].storedAs); fileOk = true; } catch (_) {}
    return { hasAtt: !!(last.attachments && last.attachments.length === 1 && last.attachments[0].kind === 'image'), text: last.text, fileOk };
  });
  t.check('Forum: Kommentar mit Bild-Anhang gespeichert', cc.hasAtt && cc.fileOk && cc.text === 'Kommentar mit Bild', JSON.stringify(cc));

  // Der Bild-Anhang oben lädt seinen Blob asynchron; das nächste renderForum (im
  // PDF-Block) widerruft alle Anhang-Blob-URLs. Erst abwarten, bis der Ladeversuch
  // abgeschlossen ist (complete=true, auch bei ungültigem Bild) – sonst Revoke-
  // während-Ladevorgang → net::ERR_FILE_NOT_FOUND im Konsolen-Check.
  await page.waitForFunction(() => { const im = [...document.querySelectorAll('#forum-content img')]; return im.length > 0 && im.every(x => x.complete); }, { timeout: 4000 }).catch(() => {});

  // Forum: Dokument-Anhang (PDF) – eigener Eintrag (ohne Bild → keine Blob-Bild-Race),
  // Nachweis: kind 'file' und Darstellung als Download-Link (kein <img>/<video>).
  const docAtt = await page.evaluate(async () => {
    const id = 'forumtest-pdf';
    await window.WA.foSaveEntry({ id, name: 'Dokument-Anhang', body: '', type: 'forum', ext: 'forum', importedAt: new Date().toISOString(), tags: [], status: '', forum: { gid: 'g1', sid: null }, comments: [], attachments: [] });
    // Erst auf den (bildlosen) PDF-Eintrag umschalten, DANN den Anhang hinzufügen,
    // damit kein renderForum mehr einen Bild-Blob des anderen Eintrags anfasst.
    window.WA.state.forumEntryId = id; window.WA.state.forumView = 'entry'; window.WA.switchView('forum');
    const e = await window.WA.getIndex(id);
    const pdf = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], 'handbuch.pdf', { type: 'application/pdf' });
    await window.WA.foAddComment(e, 'Kommentar mit PDF', [pdf]);
    const saved = await window.WA.getIndex(id);
    const last = saved.comments[saved.comments.length - 1];
    const att = last.attachments && last.attachments[0];
    let fileOk = false; try { if (att) { await window.WA.state.dirs.forum.getFileHandle(att.storedAs); fileOk = true; } } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
    const html = document.querySelector('#forum-content').innerHTML;
    return { kind: att && att.kind, fileOk, asLink: html.includes('handbuch.pdf') && /⬇/.test(html) };
  });
  t.check('Forum: PDF-Anhang gespeichert (kind file)', docAtt.kind === 'file' && docAtt.fileOk, JSON.stringify(docAtt));
  t.check('Forum: Datei-Anhang als Download-Link', docAtt.asLink === true, JSON.stringify(docAtt));

  // Regression (FORUM_EXT): Dokument-Anhänge müssen einen Backup-Restore überleben –
  // Datei aus /forum löschen, Backup-ZIP wieder einspielen, Datei muss zurück sein.
  const rt = await page.evaluate(async () => {
    const saved = await window.WA.getIndex('forumtest-pdf');
    const att = saved.comments[saved.comments.length - 1].attachments[0];
    const blob = await window.WA.buildBackupBlob();
    await window.WA.state.dirs.forum.removeEntry(att.storedAs);
    const zip = await window.JSZip.loadAsync(blob);
    await window.WA.applyBackupZip(zip, { clearFirst: false, allowKey: false });
    let restored = false; try { await window.WA.state.dirs.forum.getFileHandle(att.storedAs); restored = true; } catch (_) {}
    return { restored };
  });
  t.check('Forum: Datei-Anhang übersteht Backup-Restore', rt.restored === true, JSON.stringify(rt));

  // Forum-Seitenleiste: Themen fett, Themen + Untergruppen alphabetisch, Untergruppen ein-/ausklappbar.
  const side = await page.evaluate(async () => {
    const WA = window.WA;
    WA.state.forum = { groups: [
      { id: 'gz', name: 'Zulu', subs: [{ id: 's2', name: 'Yankee' }, { id: 's1', name: 'Alpha' }] },
      { id: 'ga', name: 'Alpha-Thema', subs: [] },
      { id: 'g1', name: 'Checklisten', subs: [] },
    ] };
    await WA.saveForum();
    WA.state.forumSel = { gid: null, sid: null }; WA.state.forumView = 'list';
    WA.switchView('forum');
    await new Promise(r => setTimeout(r, 150));
    const topics = [...document.querySelectorAll('#forum-content .forum-topic')];
    const nameOf = (el) => el.querySelector('span[style]').textContent.trim().replace(/^\S+\s+/, '');
    const topicNames = topics.map(nameOf);
    const bold = topics.length > 0 && topics.every(t => { const fw = getComputedStyle(t).fontWeight; return fw === 'bold' || +fw >= 600; });
    const subsBefore = [...document.querySelectorAll('#forum-content .forum-sub')].map(nameOf);
    let zuluChev = null;
    for (const t of topics) { const c = t.querySelector('.fo-chev'); if (c) { zuluChev = c; break; } }
    if (zuluChev) zuluChev.click();
    await new Promise(r => setTimeout(r, 120));
    const subsAfter = document.querySelectorAll('#forum-content .forum-sub').length;
    return { topicNames, bold, subsBefore, subsAfter };
  });
  t.check('Forum: Themen sind fett', side.bold === true, JSON.stringify(side));
  t.check('Forum: Themen alphabetisch geordnet', JSON.stringify(side.topicNames) === JSON.stringify(['Alpha-Thema', 'Checklisten', 'Zulu']), JSON.stringify(side.topicNames));
  t.check('Forum: Untergruppen alphabetisch geordnet', JSON.stringify(side.subsBefore) === JSON.stringify(['Alpha', 'Yankee']), JSON.stringify(side.subsBefore));
  t.check('Forum: Untergruppen ein-/ausklappbar', side.subsBefore.length === 2 && side.subsAfter === 0, JSON.stringify(side));

  // Such-Frische: NEU hochgeladene Dokumente und NEUE Forum-Einträge/Kommentare
  // müssen sofort (ohne Reload) in der Suche auftauchen – der indexCache darf nicht veralten.
  const fresh = await page.evaluate(async () => {
    const WA = window.WA;
    WA.state.forumView = 'list';   // kein Eintrags-Render mit Anhang-Blobs während foAddComment
    // 1) frisch importiertes Dokument mit eindeutigem Begriff
    const uniqDoc = 'Zebrastreifenkontrolle';
    await WA.importFiles([new File([uniqDoc + ' Testinhalt'], 'frisch.txt', { type: 'text/plain' })]);
    document.querySelector('#search-input').value = uniqDoc; WA.state.search.q = uniqDoc;
    await WA.runSearch();
    const docHit = WA.state.lastHits.some(h => h.name === 'frisch.txt');
    // 2) frischer Forum-Eintrag mit eindeutigem Begriff im Titel
    const uniqFo = 'Quastenflossergruppe';
    await WA.foSaveEntry({ id: 'fresh-fo', name: uniqFo, body: 'Rumpftext', type: 'forum', ext: 'forum', importedAt: new Date().toISOString(), tags: [], status: '', forum: { gid: 'g1', sid: null }, comments: [], attachments: [] });
    document.querySelector('#search-input').value = uniqFo; WA.state.search.q = uniqFo;
    await WA.runSearch();
    const foHit = WA.state.lastHits.some(h => h.type === 'forum' && h.name === uniqFo);
    // 3) frischer Kommentar mit eindeutigem Begriff
    const uniqCmt = 'Nashornkaefertreffen';
    const e = await WA.getIndex('fresh-fo');
    await WA.foAddComment(e, uniqCmt + ' im Kommentar', []);
    document.querySelector('#search-input').value = uniqCmt; WA.state.search.q = uniqCmt;
    await WA.runSearch();
    const cmtHit = WA.state.lastHits.some(h => h.type === 'forum');
    return { docHit, foHit, cmtHit };
  });
  t.check('Suche findet frisch importiertes Dokument sofort', fresh.docHit === true, JSON.stringify(fresh));
  t.check('Suche findet frischen Forum-Eintrag sofort', fresh.foHit === true, JSON.stringify(fresh));
  t.check('Suche findet frischen Forum-Kommentar sofort', fresh.cmtHit === true, JSON.stringify(fresh));

  // Aufräumen, damit die Trefferzahlen der Folgeprüfungen stabil bleiben.
  await page.evaluate(async () => {
    for (const id of ['fresh-fo']) { try { await window.WA.state.dirs.index.removeEntry(id + '.json'); } catch (_) {} }
    const f = window.WA.state.catalog.find(c => c.name === 'frisch.txt');
    if (f) { try { await window.WA.state.dirs.index.removeEntry(f.id + '.json'); } catch (_) {} }
    await window.WA.rebuildCatalog();
  });

  await page.evaluate(() => { window.WA.state.forumView = 'list'; window.WA.switchView('search'); });
  // Zurück zur Basissuche, damit die folgenden Prüfungen unbeeinflusst bleiben
  await page.evaluate(async () => { document.querySelector('#search-input').value = 'Kuendigungsfrist'; window.WA.state.search.q = 'Kuendigungsfrist'; await window.WA.runSearch(); });

  // Fundstelle: PDF-Seite rendern (zurück zur Basissuche für Terms)
  await page.evaluate(async () => { document.querySelector('#search-input').value = 'Kuendigungsfrist'; await window.WA.runSearch(); });
  const doc = await page.evaluate(async () => {
    const i = window.WA.state.lastHits.findIndex(h => h.type === 'pdf');
    await window.WA.openHit(i);
    await new Promise(r => setTimeout(r, 700));
    const cv = document.querySelector('#pdf-canvas');
    return { rendered: !!cv && cv.width > 0 && cv.height > 0 };
  });
  t.check('PDF-Fundstelle als Canvas gerendert', doc.rendered);

  // Exporte (Suchbericht) in allen drei Formaten + Backup-ZIP
  const exp = await page.evaluate(async () => {
    document.querySelector('#search-input').value = 'Kuendigungsfrist'; window.WA.state.search.q = 'Kuendigungsfrist'; await window.WA.runSearch();
    const res = {};
    for (const fmt of ['xlsx','docx','pdf']) { try { await window.WA.exportReport(fmt); res[fmt] = 'ok'; } catch (e) { res[fmt] = e.message; } }
    await window.WA.exportBackup();
    await new Promise(r => setTimeout(r, 500));
    const files = []; for await (const [n] of window.WA.state.dirs.exports.entries()) files.push(n);
    return { res, files };
  });
  t.check('Export XLSX/DOCX/PDF ohne Fehler', exp.res.xlsx === 'ok' && exp.res.docx === 'ok' && exp.res.pdf === 'ok', JSON.stringify(exp.res));
  t.check('Backup-ZIP in /exports', exp.files.some(f => /^wissensarchiv_backup_.*\.zip$/.test(f)), exp.files.join(','));

  // Backup enthält keinen API-Key
  const keyLeak = await page.evaluate(async () => {
    // API-Key setzen, neues Backup bauen, Inhalt pruefen
    const w = await (await window.WA.state.dirs.meta.getFileHandle('apikey.txt', { create: true })).createWritable();
    await w.write('sk-ant-GEHEIM'); await w.close();
    await window.WA.exportBackup();
    await new Promise(r => setTimeout(r, 500));
    const files = []; for await (const [n] of window.WA.state.dirs.exports.entries()) files.push(n);
    const last = files.filter(f => /^wissensarchiv_backup_/.test(f)).sort().pop();
    const zf = await (await window.WA.state.dirs.exports.getFileHandle(last)).getFile();
    const zip = await window.JSZip.loadAsync(await zf.arrayBuffer());
    return Object.keys(zip.files).some(p => p.includes('apikey'));
  });
  t.check('API-Key ist NICHT im Backup-ZIP', keyLeak === false);

  // Opt-in: API-Key wandert nur mit includeKey/allowKey durch die (Cloud-)Sync
  const ks = await page.evaluate(async () => {
    const w = await (await window.WA.state.dirs.meta.getFileHandle('apikey.txt', { create: true })).createWritable();
    await w.write('sk-ant-SYNCTEST'); await w.close();
    const zipNo = await window.JSZip.loadAsync(await (await window.WA.buildBackupBlob()).arrayBuffer());
    const inDefault = Object.keys(zipNo.files).some(p => p.includes('apikey'));
    const zipYes = await window.JSZip.loadAsync(await (await window.WA.buildBackupBlob({ includeKey: true })).arrayBuffer());
    const inOptIn = Object.keys(zipYes.files).some(p => p.includes('apikey'));
    try { await window.WA.state.dirs.meta.removeEntry('apikey.txt'); } catch (_) {}
    await window.WA.applyBackupZip(zipYes, { clearFirst: false, allowKey: true });
    let restored = ''; try { restored = await (await (await window.WA.state.dirs.meta.getFileHandle('apikey.txt')).getFile()).text(); } catch (_) {}
    try { await window.WA.state.dirs.meta.removeEntry('apikey.txt'); } catch (_) {}
    await window.WA.applyBackupZip(zipYes, { clearFirst: false, allowKey: false });
    let blocked = false; try { await window.WA.state.dirs.meta.getFileHandle('apikey.txt'); } catch (_) { blocked = true; }
    return { inDefault, inOptIn, restored, blocked };
  });
  t.check('API-Key: Standard-Sync ohne Key, Opt-in mit Key', ks.inDefault === false && ks.inOptIn === true, JSON.stringify(ks));
  t.check('API-Key: allowKey übernimmt Key, ohne allowKey blockiert', ks.restored === 'sk-ant-SYNCTEST' && ks.blocked === true, JSON.stringify(ks));

  // OneDrive-Kernmechanik (offline testbar): PKCE + Redirect-URI und der
  // Spiegel-Restore, auf dem der automatische Cloud-Pull aufsetzt.
  const cl = await page.evaluate(async () => {
    const uri = window.WA.odRedirectUri();
    const p = await window.WA.odPkce();
    const before = window.WA.state.catalog.filter(c => c.type !== 'forum').length;
    const zipBlobA = await window.WA.buildBackupBlob();          // Stand OHNE das gleich importierte Dokument
    const extra = new File(['# Spiegeltest\nEinzigartiger Inhalt fuer den Spiegel-Restore.'], 'spiegeltest.md');
    await window.WA.importFiles([extra]);
    const mid = window.WA.state.catalog.filter(c => c.type !== 'forum').length;
    const zipA = await window.JSZip.loadAsync(await zipBlobA.arrayBuffer());
    await window.WA.applyBackupZip(zipA, { clearFirst: true });  // Spiegeln -> spiegeltest.md muss verschwinden
    await window.WA.reloadArchiveViews();
    const after = window.WA.state.catalog.filter(c => c.type !== 'forum').length;
    return { uri, hasPkce: !!(p.verifier && p.challenge && p.challenge.length > 20), before, mid, after };
  });
  t.check('OneDrive: Redirect-URI + PKCE erzeugt', /^https?:\/\//.test(cl.uri) && cl.hasPkce, JSON.stringify(cl));
  t.check('OneDrive: Spiegel-Restore entfernt gelöschtes Dokument', cl.mid === cl.before + 1 && cl.after === cl.before, JSON.stringify(cl));

  // Getrennter Sync: DATA (index+meta) und BLOBS (originals+forum) werden separat gebaut;
  // ein reines DATA-Restore mit clearFirst darf die lokalen Originale NICHT anfassen.
  const split = await page.evaluate(async () => {
    const WA = window.WA;
    const load = async (blob) => window.JSZip.loadAsync(await blob.arrayBuffer());
    const folders = (zip) => [...new Set(Object.keys(zip.files).filter(p => !zip.files[p].dir).map(p => p.split('/')[0]))].sort();
    const dataFolders = folders(await load(await WA.buildBackupBlob({ folders: ['index', 'meta'] })));
    const blobFolders = folders(await load(await WA.buildBackupBlob({ folders: ['originals', 'forum'] })));
    const dataZip = await load(await WA.buildBackupBlob({ folders: ['index', 'meta'] }));
    const listOrig = async () => { const a = []; for await (const [n, h] of WA.state.dirs.originals.entries()) { if (h.kind === 'file') a.push(n); } return a; };
    const origBefore = (await listOrig()).length;
    await WA.applyBackupZip(dataZip, { clearFirst: true, folders: ['index', 'meta'] });
    const origAfter = (await listOrig()).length;
    await WA.reloadArchiveViews();
    return { dataFolders, blobFolders, origBefore, origAfter };
  });
  t.check('Split: DATA-ZIP enthält nur index+meta', split.dataFolders.includes('index') && split.dataFolders.every(f => ['index', 'meta'].includes(f)), JSON.stringify(split.dataFolders));
  t.check('Split: BLOB-ZIP enthält nur originals+forum', split.blobFolders.includes('originals') && split.blobFolders.every(f => ['originals', 'forum'].includes(f)), JSON.stringify(split.blobFolders));
  t.check('Split: DATA-Restore lässt Originale unangetastet', split.origBefore > 0 && split.origAfter === split.origBefore, JSON.stringify(split));

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
