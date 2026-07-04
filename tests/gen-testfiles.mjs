// Erzeugt echte Testdateien (PDF/DOCX/XLSX/CSV/TXT/MD) in ../_testfiles/.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import XLSX from 'xlsx';

export async function generate() {
  const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_testfiles');
  fs.mkdirSync(OUT, { recursive: true });

  // PDF mit Textebene (2 Seiten)
  {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text('Mietvertrag – Zusammenfassung', 20, 20);
    doc.setFontSize(11);
    doc.text('Die Kuendigungsfrist des Mietvertrages betraegt drei Monate zum', 20, 35);
    doc.text('Quartalsende. Eine ausserordentliche Kuendigung bleibt unberuehrt.', 20, 42);
    doc.addPage();
    doc.text('Seite 2: Nebenkosten werden jaehrlich abgerechnet. Die Miete', 20, 20);
    doc.text('betraegt 2400 Euro pro Monat inklusive Stellplatz.', 20, 27);
    fs.writeFileSync(path.join(OUT, 'mietvertrag.pdf'), Buffer.from(doc.output('arraybuffer')));
  }
  // "Gescanntes" PDF ohne Textebene (nur Grafik)
  {
    const doc = new jsPDF();
    doc.setFillColor(200, 200, 200); doc.rect(20, 20, 160, 240, 'F');
    fs.writeFileSync(path.join(OUT, 'scan_ohne_text.pdf'), Buffer.from(doc.output('arraybuffer')));
  }
  // DOCX
  {
    const d = new Document({ sections: [{ children: [
      new Paragraph({ text: 'Projektkonzept Nord', heading: HeadingLevel.HEADING_1 }),
      new Paragraph('Als Grundlage dient der bestehende Mietvertrag; die Kuendigungsfrist ist bei Standortwechsel zu beruecksichtigen.'),
      new Paragraph('Das Budget wird quartalsweise geprueft.'),
    ] }] });
    fs.writeFileSync(path.join(OUT, 'projektkonzept.docx'), await Packer.toBuffer(d));
  }
  // XLSX
  {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Posten', 'Betrag', 'Notiz'],
      ['Miete Buero', 2400, 'Mietvertrag laeuft bis 2027, Kuendigungsfrist 3 Monate'],
      ['Strom', 180, 'monatlich'],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fixkosten');
    fs.writeFileSync(path.join(OUT, 'budget.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  // XLSX mit boesartigem Blattnamen (XSS-Regressionstest)
  {
    const ws = XLSX.utils.aoa_to_sheet([['Kuendigungsfrist testinhalt']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'a<img src=x onerror=x>');
    fs.writeFileSync(path.join(OUT, 'xss_test.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  // CSV / TXT / MD
  fs.writeFileSync(path.join(OUT, 'kunden.csv'), 'Name,Ort,Notiz\nMueller,Berlin,Mietvertrag verlaengert\nSchmidt,Hamburg,neu\n');
  fs.writeFileSync(path.join(OUT, 'notizen.txt'), 'Erste Notiz zum Mietvertrag.\n\nZweiter Abschnitt: Kuendigungsfrist pruefen bis Q3.\n');
  fs.writeFileSync(path.join(OUT, 'readme.md'), '# Recherche\n\nDie Kuendigungsfrist ist wichtig.\n\n## Quellen\n\nMietvertrag, Seite 3.\n');
  return OUT;
}
