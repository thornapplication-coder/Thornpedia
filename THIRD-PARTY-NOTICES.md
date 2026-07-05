# Third-Party Notices

Thornpedia / Wissensarchiv bundles the following third-party open-source
libraries in `vendor/`. They run entirely in the browser; no code is fetched
from external servers at runtime. Each library is used unmodified and retains
its original license header. The full license texts are linked below.

| Library | Version | License | Copyright / Project |
|---|---|---|---|
| PDF.js (`pdf.min.js`, `pdf.worker.min.js`) | 2023 build | Apache-2.0 | © Mozilla Foundation — https://github.com/mozilla/pdf.js |
| Tesseract.js + core/lang (`vendor/tesseract/`) | — | Apache-2.0 | © Tesseract.js authors — https://github.com/naptha/tesseract.js ; the underlying Tesseract OCR engine and `*.traineddata` models are Apache-2.0 (© Google) |
| SheetJS "xlsx" Community Edition (`xlsx.full.min.js`) | 1.15.0 codepage build | Apache-2.0 | © 2013-present SheetJS LLC — https://sheetjs.com ; https://github.com/SheetJS/sheetjs |
| Mammoth.js (`mammoth.browser.min.js`) | — | BSD-2-Clause | © Michael Williamson — https://github.com/mwilliamson/mammoth.js |
| docx (`docx.umd.js`) | — | MIT | © Dolan Miu — https://github.com/dolanmiu/docx |
| jsPDF (`jspdf.umd.min.js`) | 2.5.1 | MIT | © 2010-2021 James Hall / yWorks GmbH — https://github.com/parallax/jsPDF |
| JSZip (`jszip.min.js`) | 3.10.1 | MIT (dual MIT / GPLv3) | © 2009-2016 Stuart Knightley — https://github.com/Stuk/jszip ; bundles pako (MIT, © Vitaly Puzrin, Andrey Tupitsin) |

## License texts

- **Apache-2.0** — https://www.apache.org/licenses/LICENSE-2.0
  Applies to PDF.js, Tesseract.js (and the Tesseract engine + language models),
  and SheetJS Community Edition. The `NOTICE` requirement is satisfied by
  retaining each project's copyright header and this file.
- **BSD-2-Clause** — https://opensource.org/license/bsd-2-clause (Mammoth.js)
- **MIT** — https://opensource.org/license/mit (docx, jsPDF, JSZip, pako)
- **GPLv3** (JSZip alternative) — https://www.gnu.org/licenses/gpl-3.0.html
  JSZip is dual-licensed; this project uses it under the MIT option.

Each minified file in `vendor/` keeps the original license banner at the top of
the file. This document aggregates those notices to satisfy the attribution
requirements of the Apache-2.0, BSD, and MIT licenses.
