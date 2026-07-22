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
    rendered: document.querySelectorAll('#doc-main .sheet-table tbody tr').length,
    hit: !!document.querySelector('#doc-main .sheet-hit'),
    aligned: !!document.querySelector('#doc-main .sheet-table'),
  }));
  t.check('Cap-Hinweis bei großer Tabelle', cap.notice);
  t.check('Nur Fenster um Treffer gerendert (300)', cap.rendered === 300, 'rendered='+cap.rendered);
  t.check('Treffer im Fenster sichtbar', cap.hit);
  t.check('CSV als ausgerichtete Tabelle gerendert', cap.aligned);

  // Tabellen werden AUSGERICHTET dargestellt – auch mit Lücken: eine leere Mittelzelle
  // (a1,,c1) behält ihre Spaltenposition, statt zu verrutschen.
  const sheetView = await page.evaluate(async () => {
    const csv = 'Kopf A,Kopf B,Kopf C\na1,,c1\na2,b2,c2\n';
    await window.WA.importFiles([new File([csv], 'ausricht.csv')]);
    const id = window.WA.state.catalog.find(c => c.name === 'ausricht.csv').id;
    await window.WA.openDoc(id);
    await new Promise(r => setTimeout(r, 250));
    const rows = [...document.querySelectorAll('#doc-main .sheet-table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
    const gapRow = rows.find(r => r[0] === 'a1');
    return { cols: rows.map(r => r.length), gapRow, title: document.querySelector('#doc-main .sheet-title')?.textContent || '' };
  });
  t.check('Tabelle: ausgerichtet, konstante Spaltenzahl (3)', sheetView.cols.length === 3 && sheetView.cols.every(n => n === 3), JSON.stringify(sheetView.cols));
  t.check('Tabelle: leere Zelle behält Spaltenposition (a1,·,c1)', JSON.stringify(sheetView.gapRow) === JSON.stringify(['a1', '', 'c1']), JSON.stringify(sheetView.gapRow));
  t.check('Tabelle: Blatt-Überschrift sichtbar', /Blatt/.test(sheetView.title), sheetView.title);

  // Export-Guard bei leerer Trefferliste
  const guard = await page.evaluate(async () => {
    window.WA.state.lastHits = []; window.WA.state.search.q = 'x'; window.WA.state.search.selected.clear();
    try { await window.WA.exportReport('xlsx'); return true; } catch (e) { return e.message; }
  });
  t.check('Leer-Export wirft nicht', guard === true, guard);

  // „KI fragen" ist ein echter Chat: Verlauf bleibt stehen (überlebt Ansichts-Wechsel)
  // und der GESAMTE Verlauf wird gesendet, damit Rückfragen im Kontext beantwortet werden.
  const chat = await page.evaluate(async () => {
    // Anthropic-API mocken – jede Antwort nummeriert; Request-Bodies mitschneiden.
    window.__aiCalls = [];
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        window.__aiCalls.push(JSON.parse(opts.body));
        const n = window.__aiCalls.length;
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Antwort ' + n }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(url, opts);
    };
    window.WA.state.apiKey = 'test-key';
    window.WA.switchView('search');
    window.WA.setFindMode('ask');

    // Gesendet wird über das Chat-Feld UNTEN (#chat-input/#chat-send) – NICHT über das
    // Suchfeld oben. Auf Abschluss der gemockten Anfrage warten.
    const send = async (q) => {
      const before = window.WA.state.chat.messages.filter(m => m.role === 'assistant').length;
      document.querySelector('#chat-input').value = q;
      document.querySelector('#chat-send').click();
      for (let k = 0; k < 100; k++) {
        if (!window.WA.state.chat.pending && window.WA.state.chat.messages.filter(m => m.role === 'assistant').length > before) break;
        await new Promise(r => setTimeout(r, 20));
      }
    };
    await send('Erste Frage');
    await send('Zweite Frage');   // Rückfrage im selben Chat

    const bubbles = () => ({
      users: [...document.querySelectorAll('#search-results .chat-user .chat-bubble')].map(b => b.textContent.trim()),
      ais: [...document.querySelectorAll('#search-results .chat-ai .chat-bubble')].map(b => b.textContent.trim()),
    });
    const afterTwo = bubbles();

    // Layout: Eingabefeld liegt UNTERHALB des Verlaufs, und das obere Suchfeld ist im Chat aus.
    const thread = document.querySelector('#search-results .chat-thread');
    const composer = document.querySelector('#search-results .chat-composer');
    const composerBelowThread = !!(thread && composer && (thread.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING));
    const topSearchHidden = getComputedStyle(document.querySelector('#find-inputrow')).display === 'none';

    // Kontext der 2. Anfrage: enthält den kompletten bisherigen Verlauf (user/assistant/user).
    const secondCall = window.__aiCalls[1];

    // Ansichts-Wechsel weg und zurück → Antwort darf NICHT verschwinden.
    window.WA.switchView('lib');
    window.WA.switchView('search');
    const afterNav = bubbles();

    // Zum „Suchen"-Tab und zurück → Chat bleibt ebenfalls erhalten.
    window.WA.setFindMode('search');
    const actionbarHiddenInAsk = (() => { window.WA.setFindMode('ask'); return getComputedStyle(document.querySelector('#find-actionbar')).display === 'none'; })();
    const afterTabToggle = bubbles();

    // Neuer Chat leert den Verlauf.
    document.querySelector('#chat-clear')?.click();
    const afterClear = bubbles();

    return { afterTwo, composerBelowThread, topSearchHidden, secondCallRoles: (secondCall.messages || []).map(m => m.role), secondCallHasSystem: !!secondCall.system, afterNav, afterTabToggle, actionbarHiddenInAsk, afterClear };
  });
  t.check('KI-Chat: Frage + Antwort erscheinen als Bubbles', chat.afterTwo.users.length === 2 && chat.afterTwo.ais.length === 2 && chat.afterTwo.ais[0] === 'Antwort 1', JSON.stringify(chat.afterTwo));
  t.check('KI-Chat: Eingabefeld liegt UNTER dem Verlauf', chat.composerBelowThread === true);
  t.check('KI-Chat: oberes Suchfeld im Chat ausgeblendet', chat.topSearchHidden === true);
  t.check('KI-Chat: Rückfrage sendet GESAMTEN Verlauf (Multi-Turn)', JSON.stringify(chat.secondCallRoles) === JSON.stringify(['user', 'assistant', 'user']) && chat.secondCallHasSystem, JSON.stringify(chat.secondCallRoles));
  t.check('KI-Chat: Antwort überlebt Ansichts-Wechsel (nicht mehr „weg")', chat.afterNav.ais.length === 2 && chat.afterNav.users.length === 2, JSON.stringify(chat.afterNav));
  t.check('KI-Chat: Antwort überlebt Tab-Wechsel Suchen↔KI', chat.afterTabToggle.ais.length === 2, JSON.stringify(chat.afterTabToggle));
  t.check('KI-Chat: keine Treffer-Aktionsleiste im Chat', chat.actionbarHiddenInAsk === true);
  t.check('KI-Chat: „Neuer Chat" leert den Verlauf', chat.afterClear.users.length === 0 && chat.afterClear.ais.length === 0, JSON.stringify(chat.afterClear));

  // Download: Index vorhanden, Original fehlt (getrennter Cloud-Sync) → hilfreiche
  // Meldung statt sackgassigem „Originaldatei nicht gefunden."; odFetchBlobs ohne Cloud
  // ist ein gefahrloser No-Op (false).
  const dl = await page.evaluate(async () => {
    await window.WA.importFiles([new File(['hallo welt'], 'download_me.txt')]);
    const id = window.WA.state.catalog.find(c => c.name === 'download_me.txt').id;
    const doc = await window.WA.getIndex(id);
    // Original aus dem App-Speicher entfernen → simuliert „Status indexiert, Original fehlt".
    await window.WA.state.dirs.originals.removeEntry(doc.storedAs);
    await window.WA.docAction('download', id);   // keine Cloud verbunden
    const toasts = [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent);
    const fetchFalse = await window.WA.odFetchBlobs();   // ohne Cloud → false, kein Fehler
    return { toast: toasts[toasts.length - 1] || '', fetchFalse };
  });
  t.check('Download fehlendes Original: hilfreiche Meldung mit Handlungshinweis', /nicht vorhanden/.test(dl.toast) && /(importier|synchronisier)/i.test(dl.toast), dl.toast);
  t.check('odFetchBlobs ohne Cloud: false (gefahrloser No-Op)', dl.fetchFalse === false);

  t.check('Keine Konsolenfehler', errors.length === 0, errors.join(' | '));
  await browser.close();
  return t.fails();
}
