// Kern-Pipeline: Import aller Formate, Suche (inkl. Umlaut/Phrase/UND),
// Fundstelle (PDF-Rendering), Zusammenfassung, Exporte, Backup.
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

  // Zusammenfassung (extraktiv, gesamtes Archiv) mit Quellenverzeichnis
  const sum = await page.evaluate(async () => {
    window.WA.switchView('summary');
    document.querySelector('input[name=sumsrc][value=all]').checked = true;
    window.WA.setMode('extractive');
    await window.WA.generateSummary();
    await new Promise(r => setTimeout(r, 300));
    return { text: document.querySelector('#sum-output').innerText.length, sources: !!document.querySelector('.sourcelist') };
  });
  t.check('Zusammenfassung erzeugt', sum.text > 100);
  t.check('Quellenverzeichnis vorhanden', sum.sources);

  // Exporte in allen drei Formaten + Backup-ZIP
  const exp = await page.evaluate(async () => {
    const res = {};
    for (const fmt of ['xlsx','docx','pdf']) { try { await window.WA.exportReport(fmt, 'summary'); res[fmt] = 'ok'; } catch (e) { res[fmt] = e.message; } }
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

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
