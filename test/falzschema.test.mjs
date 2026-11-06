import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KREUZBRUCH_3_16,
  computeScheme,
  sheetLayout,
  panelMatrixAt,
  transformPoint,
  transformVector,
  creases,
  leafMatrixAt,
  openPages,
} from '../src/falzschema.js';

const fmt = (grid) => grid.map((row) => row.map((c) => `${c.page}${c.rotation ? 'v' : ''}`).join(' '));

test('Vorderseite entspricht dem Standard-Ausschuss 16 Seiten Kreuzbruch', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  assert.deepEqual(fmt(sheetLayout(c, 'front')), ['5v 12v 9v 8v', '4 13 16 1']);
});

test('Rückseite (umgeschlagen) entspricht dem Standard-Ausschuss', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  assert.deepEqual(fmt(sheetLayout(c, 'back')), ['7v 10v 11v 6v', '2 15 14 3']);
});

test('alle 16 Seiten kommen genau einmal vor; Vorder-/Rückseite eines Blattes sind Nachbarseiten', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  const pages = c.panels.flatMap((p) => [p.front.page, p.back.page]).sort((a, b) => a - b);
  assert.deepEqual(pages, Array.from({ length: 16 }, (_, i) => i + 1));
  for (const p of c.panels) {
    const [a, b] = [p.front.page, p.back.page].sort((x, y) => x - y);
    assert.equal(b - a, 1);
    assert.equal(a % 2, 1);
  }
});

test('nach dem Falzen liegen alle Felder deckungsgleich in 8 Lagen', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  const final = c.matrices.at(-1);
  const centers = final.map((m) => transformPoint(m, [0, 0, 0]));
  for (const ctr of centers) {
    assert.ok(Math.abs(ctr[0] - centers[0][0]) < 1e-6);
    assert.ok(Math.abs(ctr[1] - centers[0][1]) < 1e-6);
  }
  const zs = new Set(centers.map((ctr) => ctr[2].toFixed(4)));
  assert.equal(zs.size, 8);
  // Seite 1 liegt obenauf und zeigt zum Betrachter (Vorderseite bleibt außen)
  const top = c.panels[c.layers[0]];
  assert.equal(top.front.page, 1);
  assert.ok(transformVector(final[top.id], [0, 0, 1])[2] > 0);
});

test('Animation: Zwischenstände sind stetig an den Falzgrenzen', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  for (let step = 0; step < c.folds.length; step++) {
    for (let i = 0; i < c.panels.length; i++) {
      const end = panelMatrixAt(c, i, step, 1);
      const next = panelMatrixAt(c, i, step + 1, 0);
      end.forEach((v, k) => assert.ok(Math.abs(v - next[k]) < 1e-9));
    }
  }
});

test('Falzlinien auf dem flachen Bogen', () => {
  const c = computeScheme(KREUZBRUCH_3_16, { pageWidth: 70, pageHeight: 99 });
  const [f1, f2, f3] = creases(c);
  assert.deepEqual(f1, [[[0, -99], [0, 99]]]);
  assert.deepEqual(f2, [[[-140, 0], [140, 0]]]);
  assert.deepEqual(
    f3.map((s) => s[0][0]).sort((a, b) => a - b),
    [-70, 70],
  );
  for (const s of f3) assert.deepEqual([s[0][1], s[1][1]], [-99, 99]);
});

test('Blättern: umgeblätterte Blätter liegen links vom Bund, richtige Seite oben', () => {
  const c = computeScheme(KREUZBRUCH_3_16);
  const { spineX } = c.book;
  // Nach dem Umblättern von k Blättern: linke Seite oben = 2k, rechte Seite oben = 2k+1
  for (let k = 1; k < 8; k++) {
    const leftLeaf = c.panels[c.layers[k - 1]];
    const rightLeaf = c.panels[c.layers[k]];
    const mL = leafMatrixAt(c, leftLeaf.id, 1);
    const mR = leafMatrixAt(c, rightLeaf.id, 0);
    assert.ok(transformPoint(mL, [0, 0, 0])[0] < spineX);
    assert.ok(transformPoint(mR, [0, 0, 0])[0] > spineX);
    const faceUp = (m, p) => (transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page);
    assert.equal(faceUp(mL, leftLeaf), 2 * k);
    assert.equal(faceUp(mR, rightLeaf), 2 * k + 1);
    assert.deepEqual(openPages(c, k), { left: 2 * k, right: 2 * k + 1 });
    // Kopf bleibt oben (Drehung um die senkrechte Achse)
    for (const [m, p] of [[mL, leftLeaf], [mR, rightLeaf]]) {
      assert.ok(transformVector(m, [...p.front.up, 0])[1] > 0.99);
    }
  }
  // Oberstes umgeblättertes Blatt liegt auch links oben auf dem Stapel
  const z = (k) => transformPoint(leafMatrixAt(c, c.layers[k], 1), [0, 0, 0])[2];
  for (let k = 1; k < 8; k++) assert.ok(z(k) > z(k - 1));
  assert.deepEqual(openPages(c, 0), { left: null, right: 1 });
  assert.deepEqual(openPages(c, 8), { left: 16, right: null });
});

test('alle 32 Kombinationen von Falzrichtungen ergeben eine gültige Paginierung', async () => {
  const { kreuzbruch16 } = await import('../src/falzschema.js');
  const sides = ['positive', 'negative'];
  const dirs = ['up', 'down'];
  const layouts = new Set();
  for (const m1 of sides) for (const m2 of sides) for (const m3 of sides)
    for (const d1 of dirs) for (const d2 of dirs) for (const d3 of dirs) {
      const settings = [
        { moving: m1, direction: d1 },
        { moving: m2, direction: d2 },
        { moving: m3, direction: d3 },
      ];
      const c = computeScheme(kreuzbruch16(settings));
      const pages = c.panels.flatMap((p) => [p.front.page, p.back.page]).sort((a, b) => a - b);
      assert.deepEqual(pages, Array.from({ length: 16 }, (_, i) => i + 1));
      layouts.add(fmt(sheetLayout(c, 'front')).join('/'));

      // Blättern: nach k Blättern liegt links Seite 2k, rechts 2k+1 – vom Leser aus gesehen
      const v = c.viewSign;
      const faceUp = (m, p) => (v * transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page);
      for (let k = 1; k < 8; k++) {
        const leftLeaf = c.panels[c.layers[k - 1]];
        const rightLeaf = c.panels[c.layers[k]];
        const mL = leafMatrixAt(c, leftLeaf.id, 1);
        const mR = leafMatrixAt(c, rightLeaf.id, 0);
        assert.equal(faceUp(mL, leftLeaf), 2 * k);
        assert.equal(faceUp(mR, rightLeaf), 2 * k + 1);
        // Leser blickt von v·z: "links" ist bei v = -1 die +x-Seite
        const xL = v * transformPoint(mL, [0, 0, 0])[0];
        const xR = v * transformPoint(mR, [0, 0, 0])[0];
        assert.ok(xL < xR);
      }
    }
  assert.ok(layouts.size > 1);
});

test('Produktion: Klebebindung und Sammelheftung paginieren alle Seiten', async () => {
  const { computeProduction, PAGE_COUNTS, bookLeafMatrix } = await import('../src/falzschema.js');
  const model = computeScheme(KREUZBRUCH_3_16);
  for (const pages of PAGE_COUNTS) {
    for (const binding of ['perfect', 'saddle']) {
      const prod = computeProduction(model, { pages, binding, caliper: 0.1 });
      assert.equal(prod.n, pages / 16);
      const all = prod.sheets.flatMap((s) => s.pages).sort((a, b) => a - b);
      assert.deepEqual(all, Array.from({ length: pages }, (_, i) => i + 1));
      // Blätter liegen im geschlossenen Produkt in der Reihenfolge g übereinander
      const zs = prod.leaves.map((l) => model.viewSign * transformPoint(bookLeafMatrix(model, l), [0, 0, 0])[2]);
      for (let g = 1; g < zs.length; g++) assert.ok(zs[g] < zs[g - 1]);
      // Oben liegende Seite jedes Blattes = 2g+1
      for (const leaf of prod.leaves) {
        const p = prod.sheets[leaf.sheet].panels[leaf.panel];
        const m = bookLeafMatrix(model, leaf);
        const up = model.viewSign * transformVector(m, [0, 0, 1])[2] > 0 ? p.front.page : p.back.page;
        assert.equal(up, 2 * leaf.g + 1);
      }
    }
  }
});

test('Produktion: Seitenverteilung je Bogen und Verdrängung', async () => {
  const { computeProduction } = await import('../src/falzschema.js');
  const model = computeScheme(KREUZBRUCH_3_16);
  const perfect = computeProduction(model, { pages: 32, binding: 'perfect' });
  assert.deepEqual(perfect.sheets.map((s) => s.pageRanges), ['1–16', '17–32']);
  assert.deepEqual(perfect.sheets.map((s) => s.creep), [0, 0]);
  assert.deepEqual(
    fmt(sheetLayout({ ...model, panels: perfect.sheets[1].panels }, 'front')),
    ['21v 28v 25v 24v', '20 29 32 17'],
  );

  const saddle = computeProduction(model, { pages: 128, binding: 'saddle', caliper: 0.1 });
  assert.equal(saddle.sheets[0].pageRanges, '1–8, 121–128');
  assert.equal(saddle.sheets[7].pageRanges, '57–72');
  assert.deepEqual(saddle.sheets.map((s) => s.creep), [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8]);
  // Bogen 1 der Sammelheftung: vorne 1..8, hinten 121..128 auf denselben Feldern wie 1..16
  assert.deepEqual(
    fmt(sheetLayout({ ...model, panels: saddle.sheets[0].panels }, 'front')),
    ['5v 124v 121v 8v', '4 125 128 1'],
  );
});
