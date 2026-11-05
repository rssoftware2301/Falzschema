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
