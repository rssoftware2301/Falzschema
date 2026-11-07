import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CIP4_CATALOG,
  computeSignature,
  sheetLayout,
  panelMatrixAt,
  transformPoint,
  transformVector,
  creases,
  describeEntry,
  computeProduction,
  suggestGroups,
  bookLeafMatrix,
  turnCanonical,
  signatureAxisZ,
  openPages,
  pageRanges,
  validPageTotal,
} from '../src/falzschema.js';

// Rotation der Seitenzahl: '' aufrecht, 'v' kopfstehend, '>' 90° im Uhrzeigersinn, '<' 90° gegen
const ROT = { 0: '', 180: 'v', 90: '>', 270: '<' };
const fmt = (grid) => grid.map((row) => row.map((c) => `${c.page}${ROT[c.rotation]}`).join(' '));

// Aus den Diagrammen des CIP4 Pagination Catalog 1.4.3 abgelesen (Vorderseite / Rückseite)
const CIP4_DIAGRAMS = {
  'F2-1': [['1'], ['2']],
  'F10-1': [['9 8 5 4 1'], ['2 3 6 7 10']],
  'F10-2': [['2 9 4 7 6'], ['5 8 3 10 1']],
  'F10-3': [['2 9 8 3 6'], ['5 4 7 10 1']],
  'F8-7': [['6> 7<', '3> 2<'], ['8> 5<', '1> 4<']],
  'F12-10': [['8> 11< 10>', '5> 2< 3>'], ['9< 12> 7<', '4< 1> 6<']],
  'F12-11': [['10v 11v 2v', '7 6 3'], ['1v 12v 9v', '4 5 8']],
  'F12-12': [['7> 6<', '10> 11<', '3> 2<'], ['5> 8<', '12> 9<', '1> 4<']],
  'F16-6': [['3v 14v 15v 2v', '6 11 10 7'], ['1v 16v 13v 4v', '8 9 12 5']],
  'F16-7': [['11v 6v 7v 10v', '14 3 2 15'], ['9v 8v 5v 12v', '16 1 4 13']],
  'F16-8': [['15v 2v 3v 14v', '10 7 6 11'], ['13v 4v 1v 16v', '12 5 8 9']],
  'F32-3': [
    ['23v 10v 15v 18v 19v 14v 11v 22v', '26 7 2 31 30 3 6 27'],
    ['21v 12v 13v 20v 17v 16v 9v 24v', '28 5 4 29 32 1 8 25'],
  ],
  'F32-4': [
    ['30> 19< 18> 31<', '3> 14< 15> 2<', '6> 11< 10> 7<', '27> 22< 23> 26<'],
    ['32> 17< 20> 29<', '1> 16< 13> 4<', '8> 9< 12> 5<', '25> 24< 21> 28<'],
  ],
  'F64-1': [
    [
      '35v 30v 3v 62v 63v 2v 31v 34v',
      '38 27 6 59 58 7 26 39',
      '43v 22v 11v 54v 55v 10v 23v 42v',
      '46 19 14 51 50 15 18 47',
    ],
    [
      '33v 32v 1v 64v 61v 4v 29v 36v',
      '40 25 8 57 60 5 28 37',
      '41v 24v 9v 56v 53v 12v 21v 44v',
      '48 17 16 49 52 13 20 45',
    ],
  ],
};

test('Katalog: 89 Einträge, 3 davon im CIP4-Katalog nicht unterstützt', () => {
  assert.equal(CIP4_CATALOG.length, 89);
  assert.deepEqual(
    CIP4_CATALOG.filter((e) => e.unsupported).map((e) => e.id),
    ['F6-3', 'F6-6', 'F6-7'],
  );
});

for (const [id, [front, back]] of Object.entries(CIP4_DIAGRAMS)) {
  test(`${id}: berechneter Ausschuss entspricht dem CIP4-Diagramm`, () => {
    const sig = computeSignature(id);
    assert.deepEqual(fmt(sheetLayout(sig, 'front')), front);
    assert.deepEqual(fmt(sheetLayout(sig, 'back')), back);
  });
}

test('alle unterstützten Schemata lassen sich falzen und paginieren', () => {
  for (const entry of CIP4_CATALOG) {
    if (entry.unsupported) continue;
    const sig = computeSignature(entry);
    assert.equal(sig.cols * sig.rows * 2, entry.pages, entry.id);
    const pages = sig.panels.flatMap((p) => [p.front.page, p.back.page]).sort((a, b) => a - b);
    assert.deepEqual(pages, Array.from({ length: entry.pages }, (_, i) => i + 1), entry.id);
    // Vorder- und Rückseite eines Blattes sind Nachbarseiten (ungerade/gerade)
    for (const p of sig.panels) {
      const [a, b] = [p.front.page, p.back.page].sort((x, y) => x - y);
      assert.equal(b - a, 1, entry.id);
      assert.equal(a % 2, 1, entry.id);
    }
    // Kanonisch: Bund bei x = 0, Seite 0..Breite, oberstes Blatt bei z = 0
    const c = sig.canonical[sig.layers[0]];
    assert.ok(Math.abs(c[12] - sig.pageWidth / 2) < 1e-6, entry.id);
    assert.ok(Math.abs(c[13] - sig.pageHeight / 2) < 1e-6, entry.id);
    assert.ok(Math.abs(c[14]) < 1e-6, entry.id);
    assert.ok(describeEntry(entry).longText.startsWith(`${entry.pages} Seiten`));
  }
});

test('Animation: Zwischenstände sind stetig an den Falzgrenzen', () => {
  const sig = computeSignature('F16-7');
  for (let step = 0; step < sig.folds.length; step++) {
    for (let i = 0; i < sig.panels.length; i++) {
      const end = panelMatrixAt(sig, i, step, 1);
      const next = panelMatrixAt(sig, i, step + 1, 0);
      end.forEach((v, k) => assert.ok(Math.abs(v - next[k]) < 1e-9));
    }
  }
});

test('Falzlinien von F16-7 auf dem flachen Bogen', () => {
  const sig = computeSignature('F16-7', { pageWidth: 70, pageHeight: 99 });
  const [f1, f2, f3] = creases(sig);
  assert.deepEqual(f1, [[[0, -99], [0, 99]]]);
  assert.deepEqual(f2, [[[-140, 0], [140, 0]]]);
  assert.deepEqual(f3.map((s) => s[0][0]).sort((a, b) => a - b), [-70, 70]);
});

test('Blättern: nach k Blättern liegen links Seite 2k und rechts 2k+1', () => {
  for (const id of ['F16-7', 'F8-7', 'F12-11', 'F32-4']) {
    const sig = computeSignature(id);
    const axis = signatureAxisZ(sig);
    const faceUp = (m, p) => (transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page);
    for (let k = 1; k < sig.leaves; k++) {
      const left = sig.panels[sig.layers[k - 1]];
      const right = sig.panels[sig.layers[k]];
      const mL = turnCanonical(sig.canonical[left.id], 1, axis);
      const mR = sig.canonical[right.id];
      assert.equal(faceUp(mL, left), 2 * k, id);
      assert.equal(faceUp(mR, right), 2 * k + 1, id);
      assert.ok(transformPoint(mL, [0, 0, 0])[0] < 0 && transformPoint(mR, [0, 0, 0])[0] > 0, id);
      assert.deepEqual(openPages(k, sig.leaves), { left: 2 * k, right: 2 * k + 1 });
    }
  }
});

test('Vorschlag für die Bogenaufteilung', () => {
  assert.deepEqual(suggestGroups(76), [
    { count: 4, scheme: 'F16-7' },
    { count: 1, scheme: 'F8-7' },
    { count: 1, scheme: 'F4-1' },
  ]);
  assert.deepEqual(suggestGroups(16), [{ count: 1, scheme: 'F16-7' }]);
  // Klebebindung: Rest von 2 Seiten als Einzelblatt F2-1
  assert.deepEqual(suggestGroups(78, 'perfect'), [
    { count: 4, scheme: 'F16-7' },
    { count: 1, scheme: 'F8-7' },
    { count: 1, scheme: 'F4-1' },
    { count: 1, scheme: 'F2-1' },
  ]);
});

test('Produktion 76 Seiten = 4×F16-6 + 1×F8-7 + 1×F4-1, beide Bindearten', () => {
  const groups = [
    { count: 4, scheme: 'F16-6' },
    { count: 1, scheme: 'F8-7' },
    { count: 1, scheme: 'F4-1' },
  ];
  for (const binding of ['perfect', 'saddle']) {
    const prod = computeProduction(groups, { binding, caliper: 0.1, pages: 76 });
    assert.deepEqual(prod.errors, []);
    assert.equal(prod.n, 6);
    const all = prod.sheets.flatMap((s) => s.pages).sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: 76 }, (_, i) => i + 1));
    // im geschlossenen Produkt liegen die Blätter in der Reihenfolge g, oben jeweils Seite 2g+1
    let prevZ = Infinity;
    for (const leaf of prod.leaves) {
      const m = bookLeafMatrix(prod, leaf);
      const z = transformPoint(m, [0, 0, 0])[2];
      assert.ok(z < prevZ);
      prevZ = z;
      const p = prod.sheets[leaf.sheet].panels[leaf.panel];
      assert.equal(transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page, 2 * leaf.g + 1);
    }
  }
  const perfect = computeProduction(groups, { binding: 'perfect' });
  assert.deepEqual(perfect.sheets.map((s) => s.pageRanges), ['1–16', '17–32', '33–48', '49–64', '65–72', '73–76']);
  const saddle = computeProduction(groups, { binding: 'saddle', caliper: 0.1 });
  assert.deepEqual(saddle.sheets.map((s) => s.pageRanges), [
    '1–8, 69–76',
    '9–16, 61–68',
    '17–24, 53–60',
    '25–32, 45–52',
    '33–36, 41–44',
    '37–40',
  ]);
  assert.deepEqual(saddle.sheets.map((s) => s.creep), [0, 0.4, 0.8, 1.2, 1.6, 1.8]);
});

test('Produktion: Fehlermeldungen', () => {
  assert.match(computeProduction([{ count: 1, scheme: 'F16-7' }], { pages: 20 }).errors[0], /16 statt 20/);
  assert.match(computeProduction([{ count: 1, scheme: 'F6-1' }], { binding: 'saddle' }).errors[0], /Sammelheftung/);
  assert.match(computeProduction([{ count: 1, scheme: 'F6-3' }], {}).errors[0], /nicht unterstützt/);
});

test('pageRanges', () => {
  assert.equal(pageRanges([1, 2, 3, 7, 8, 10]), '1–3, 7–8, 10');
});

test('Seitenumfang: Sammelheftung Vielfaches von 4, Klebebindung Vielfaches von 2', () => {
  assert.ok(validPageTotal(76, 'saddle'));
  assert.ok(!validPageTotal(78, 'saddle'));
  assert.ok(validPageTotal(78, 'perfect'));
  assert.ok(validPageTotal(2, 'perfect'));
  assert.ok(!validPageTotal(77, 'perfect'));
  assert.ok(!validPageTotal(2002, 'perfect'));
  assert.ok(validPageTotal(572, 'perfect'));
});

test('Klebebindung mit Einzelblättern (F2-1)', () => {
  const prod = computeProduction(
    [
      { count: 1, scheme: 'F16-7' },
      { count: 3, scheme: 'F2-1' },
    ],
    { binding: 'perfect', pages: 22 },
  );
  assert.deepEqual(prod.errors, []);
  assert.deepEqual(prod.sheets.map((s) => s.pageRanges), ['1–16', '17–18', '19–20', '21–22']);
  for (const leaf of prod.leaves) {
    const m = bookLeafMatrix(prod, leaf);
    const p = prod.sheets[leaf.sheet].panels[leaf.panel];
    assert.equal(transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page, 2 * leaf.g + 1);
  }
  // Sammelheftung mit Einzelblatt geht nicht
  assert.match(
    computeProduction([{ count: 1, scheme: 'F2-1' }], { binding: 'saddle' }).errors[0],
    /Sammelheftung/,
  );
});

test('572 Seiten als 286 Einzelblätter (F2-1) in Klebebindung', () => {
  assert.ok(validPageTotal(572, 'perfect'));
  const prod = computeProduction([{ count: 286, scheme: 'F2-1' }], { binding: 'perfect', pages: 572 });
  assert.deepEqual(prod.errors, []);
  assert.equal(prod.n, 286);
  assert.equal(prod.totalLeaves, 286);
  assert.equal(prod.sheets[285].pageRanges, '571–572');
});

test('Rückenstärke und Umschlagmaße', async () => {
  const { computeCover, blockThickness } = await import('../src/falzschema.js');
  assert.equal(blockThickness(286, 0.1), 28.6);
  const c = computeCover(286, 0.1, { caliper: 0.3, flapLeft: 80, flapRight: 100 });
  assert.equal(c.blockMm, 28.6);
  assert.equal(c.spineMm, 29.2);
  assert.deepEqual(
    c.parts.map((p) => [p.key, p.x, p.width]),
    [
      ['flapLeft', 0, 80],
      ['back', 80, 148],
      ['spine', 228, 29.2],
      ['front', 257.2, 148],
      ['flapRight', 405.2, 100],
    ],
  );
  assert.equal(c.totalWidth, 505.2);
  assert.equal(c.height, 210);
  // ohne Klappen
  const d = computeCover(8, 0.1, { caliper: 0.25, flapLeft: 0, flapRight: 0 });
  assert.deepEqual(d.parts.map((p) => p.key), ['back', 'spine', 'front']);
  assert.equal(d.spineMm, 1.3);
});
