/**
 * Falzschema – Rechenkern (ohne Grafik, auch unter Node.js lauffähig).
 *
 * Grundlage sind die Falzschemata des CIP4 "Pagination Catalog" (JDF Fold
 * Catalog, z. B. F16-7). Jedes Schema beschreibt einen Bogen als Raster aus
 * Spalten × Zeilen gleich großer Felder und eine Falzfolge. Jeder Falz:
 *   - orientation: 'vertical'   = Falz von links nach rechts (senkrechte Falzlinie)
 *                  'horizontal' = Falz von unten nach oben (waagrechte Falzlinie)
 *   - fraction:    Größe des gefalzten (linken bzw. unteren) Teils als Bruchteil
 *                  des ungefalzten Bogens, gemessen ab der aktuellen linken bzw.
 *                  unteren Kante des Falzpakets
 *   - direction:   'over'  = der Teil wird darüber (zum Betrachter) geklappt,
 *                  'under' = darunter (vom Betrachter weg)
 *
 * Der Bogen wird als Raster starrer Felder modelliert; ein Falz ist eine Drehung
 * um 180° um die Falzlinie. Aus der Lage der Felder nach dem letzten Falz ergibt
 * sich die Paginierung: Das Feld in Lage L (vom Leser aus oben, ab 0) trägt auf
 * der dem Leser zugewandten Seite die Seitenzahl 2L+1, auf der Rückseite 2L+2.
 *
 * Leserichtung nach CIP4: Der letzte Falz ist die Bindekante (Bund), sie liegt
 * nach dem Falzen links oder unten. Die dazu senkrechte Kante an der Ecke unten
 * links ist die Jog-Kante (geschlossener Kopf). Für die Paginierung wird das
 * Produkt so gedreht, dass der Bund links und die Jog-Kante oben liegt
 * (BindingOrientation "Rotate0"); bei einreihigen Rastern (ohne geschlossenen
 * Kopf) gilt "Flip0": die Jog-Kante liegt bereits oben.
 *
 * Für Darstellung und Zusammentragen werden alle gefalzten Bogen in ein
 * gemeinsames Lese-Koordinatensystem gebracht ("kanonisch"): Bund bei x = 0,
 * Seite im Bereich x 0..Breite, y 0..Höhe, Leser blickt von +z, oberstes Blatt
 * bei z = 0.
 */

import { CIP4_CATALOG } from './cip4-catalog.js';

export { CIP4_CATALOG };

// ---------------------------------------------------------------------------
// Kleine 4x4-Matrix-Bibliothek (spaltenweise wie in WebGL/Three.js)
// ---------------------------------------------------------------------------

export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
  }
  return r;
}

export function translation(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** Drehung um die x-Achse (axis = 'x') oder y-Achse (axis = 'y'). */
export function rotation(axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 'x') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  if (axis === 'y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  throw new Error(`Unbekannte Drehachse: ${axis}`);
}

export function transformPoint(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function transformVector(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

/** Transponierte Rotation angewendet (= Inverse für reine Drehungen). */
function inverseRotateVector(m, [x, y, z]) {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[4] * x + m[5] * y + m[6] * z,
    m[8] * x + m[9] * y + m[10] * z,
  ];
}

const round = (v) => Math.round(v * 1e6) / 1e6;


const EPS = 1e-6;

function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

const CATALOG_BY_ID = new Map(CIP4_CATALOG.map((e) => [e.id, e]));

export function catalogEntry(id) {
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) throw new Error(`Unbekanntes Falzschema: ${id}`);
  return entry;
}

/** Ist das Schema verwendbar (im CIP4-Katalog nicht als "unsupported" markiert)? */
export const isSupported = (entry) => !entry.unsupported;

const FRACTION_GLYPHS = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '4/5': '⅘', '1/6': '⅙', '1/8': '⅛' };
export const fractionText = ([n, d]) => FRACTION_GLYPHS[`${n}/${d}`] ?? `${n}/${d}`;

/** Falzfolge in CIP4/JDF-Notation, z. B. "↑½ + ↑½ + ↓¼". */
export function sequenceText(entry) {
  if (!entry.folds.length) return 'kein Falz';
  let prev = 'vertical';
  return entry.folds
    .map((f) => {
      const sep = f.orientation !== prev ? '+ ' : '';
      prev = f.orientation;
      return `${sep}${f.direction === 'over' ? '↑' : '↓'}${fractionText(f.fraction)}`;
    })
    .join(' ');
}

/** Falzart nach deutscher Fachsprache (aus der Falzfolge abgeleitet). */
export function foldType(entry) {
  const folds = entry.folds;
  if (!folds.length) return 'ohne Falz';
  if (folds.length === 1) return 'Einbruchfalz';
  const orientations = folds.map((f) => f.orientation);
  const changes = orientations.slice(1).filter((o, i) => o !== orientations[i]).length;
  if (changes === 0) {
    const fr = folds.map((f) => f.fraction[0] / f.fraction[1]);
    const halving = fr.every((v, i) => i === 0 || Math.abs(v - fr[i - 1] / 2) < EPS);
    if (halving && fr[0] === 0.5) return 'Mittenparallelfalz';
    const equal = fr.every((v) => Math.abs(v - fr[0]) < EPS);
    const alternating = folds.every((f, i) => i === 0 || f.direction !== folds[i - 1].direction);
    const same = folds.every((f) => f.direction === folds[0].direction);
    if (equal && alternating) return 'Zickzackfalz (Leporello)';
    if (equal && same) return 'Wickelfalz';
    return 'Parallelfalz';
  }
  if (changes === folds.length - 1) return 'Kreuzbruchfalz';
  return 'Kombinationsfalz (Parallel- und Kreuzbruch)';
}

/** Beschreibung eines Falzes im Klartext. */
export function foldText(fold) {
  const vertical = fold.orientation === 'vertical';
  const line = vertical ? 'senkrechter Falz' : 'waagrechter Falz';
  const part = vertical ? 'linker Teil' : 'unterer Teil';
  const size = `${fractionText(fold.fraction)} der Bogen${vertical ? 'breite' : 'höhe'}`;
  const dir = fold.direction === 'over' ? 'nach vorne darüber' : 'nach hinten darunter';
  return `${line}: ${part} (${size}) ${dir}`;
}

/** Normierter Name und Langtext, z. B. "F16-7" / "16 Seiten, 4×2, 3 Falze, Kreuzbruchfalz (↑½ + ↑½ + ↓¼)". */
export function describeEntry(entry) {
  const n = entry.folds.length;
  return {
    id: entry.id,
    type: foldType(entry),
    sequence: sequenceText(entry),
    longText: `${entry.pages} Seiten, ${entry.cols}×${entry.rows}, ${n === 0 ? 'ohne Falz' : `${n} ${n === 1 ? 'Falz' : 'Falze'}`}, ${foldType(entry)} (${sequenceText(entry)})`,
  };
}

/** Standard-Schema je Seitenzahl (für Vorschläge). */
export const DEFAULT_SCHEMES = { 2: 'F2-1', 4: 'F4-1', 6: 'F6-1', 8: 'F8-7', 10: 'F10-1', 12: 'F12-14', 14: 'F14-1', 16: 'F16-7', 18: 'F18-5', 20: 'F20-1', 24: 'F24-8', 28: 'F28-1', 32: 'F32-6', 36: 'F36-2', 40: 'F40-1', 48: 'F48-1', 64: 'F64-1' };

/** Seitenzahlen, für die es (verwendbare) Schemata gibt. */
export const SHEET_PAGE_COUNTS = [...new Set(CIP4_CATALOG.filter(isSupported).map((e) => e.pages))].sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Falzsimulation eines Bogens
// ---------------------------------------------------------------------------

const signatureCache = new Map();

/**
 * Simuliert das Falzen eines Bogens nach einem CIP4-Schema und berechnet die
 * Paginierung (Seiten 1..pages des Bogens) sowie die Lage aller Felder.
 *
 * @param {object|string} entryOrId  Katalogeintrag oder Name (z. B. "F16-7")
 * @param {object} [opts]
 * @param {number} [opts.pageWidth=70]   Breite der Endformatseite (Leseansicht)
 * @param {number} [opts.pageHeight=99]  Höhe der Endformatseite (Leseansicht)
 * @param {number} [opts.thickness=0.6]  Papierstärke (nur Darstellung)
 */
export function computeSignature(entryOrId, opts = {}) {
  const entry = typeof entryOrId === 'string' ? catalogEntry(entryOrId) : entryOrId;
  const pageWidth = opts.pageWidth ?? 70;
  const pageHeight = opts.pageHeight ?? 99;
  const thickness = opts.thickness ?? 0.6;
  const key = `${entry.id}|${pageWidth}|${pageHeight}|${thickness}`;
  if (signatureCache.has(key)) return signatureCache.get(key);
  if (entry.unsupported) throw new Error(`${entry.id} ist im CIP4-Katalog nicht unterstützt (${entry.unsupported})`);

  const { cols, rows } = entry;
  const lastFold = entry.folds[entry.folds.length - 1];
  // Liegt der Bund waagrecht (letzter Falz von unten nach oben), steht die Seite im
  // Feld um 90° gedreht: das Feld ist dann quer (Breite = Seitenhöhe).
  const bindingBottom = lastFold?.orientation === 'horizontal';
  const cellW = bindingBottom ? pageHeight : pageWidth;
  const cellH = bindingBottom ? pageWidth : pageHeight;
  const sheetW = cols * cellW;
  const sheetH = rows * cellH;

  // Felder; Zeile 0 = oben, Spalte 0 = links (Blick auf die Vorderseite), Ursprung Bogenmitte
  const panels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = (col - (cols - 1) / 2) * cellW;
      const cy = ((rows - 1) / 2 - row) * cellH;
      panels.push({ id: panels.length, row, col, cx, cy });
    }
  }

  const corners = [
    [-cellW / 2, -cellH / 2],
    [cellW / 2, -cellH / 2],
    [cellW / 2, cellH / 2],
    [-cellW / 2, cellH / 2],
  ];
  const extent = (m, coord) => {
    const vals = corners.map(([x, y]) => transformPoint(m, [x, y, 0])[coord]);
    return [Math.min(...vals), Math.max(...vals)];
  };

  const matrices = [panels.map((p) => translation(p.cx, p.cy, 0))];
  const folds = [];
  entry.folds.forEach((fold, k) => {
    const current = matrices[k];
    const vertical = fold.orientation === 'vertical';
    const coord = vertical ? 0 : 1;
    const axis = vertical ? 'y' : 'x';
    const packetMin = Math.min(...current.map((m) => extent(m, coord)[0]));
    const linePos = packetMin + (fold.fraction[0] / fold.fraction[1]) * (vertical ? sheetW : sheetH);
    const moving = current.map((m) => {
      const [lo, hi] = extent(m, coord);
      if (hi <= linePos + EPS) return true;
      if (lo >= linePos - EPS) return false;
      throw new Error(`${entry.id}: Falz ${k + 1} liegt nicht auf einer Feldgrenze`);
    });
    if (!moving.some(Boolean) || moving.every(Boolean)) {
      throw new Error(`${entry.id}: Falz ${k + 1} bewegt keine bzw. alle Felder`);
    }
    const zs = current.map((m) => m[14]);
    const over = fold.direction === 'over';
    // Falzachse knapp über bzw. unter dem Stapel, damit die Lagen sauber aufeinander liegen
    const h = over ? Math.max(...zs) + thickness / 2 : Math.min(...zs) - thickness / 2;
    // Drehsinn: der linke/untere Teil hebt sich zum Betrachter (darüber) bzw. senkt sich (darunter)
    let sign = vertical ? 1 : -1;
    if (!over) sign = -sign;
    const pivot = vertical ? [linePos, 0, h] : [0, linePos, h];
    const matrixAt = (progress) =>
      multiply(
        translation(pivot[0], pivot[1], pivot[2]),
        multiply(rotation(axis, sign * Math.PI * progress), translation(-pivot[0], -pivot[1], -pivot[2])),
      );
    const full = matrixAt(1);
    matrices.push(current.map((m, i) => (moving[i] ? multiply(full, m) : m)));
    folds.push({ ...fold, index: k, axis, linePos, pivot, moving, matrixAt });
  });

  const final = matrices[matrices.length - 1];
  if (final.some((m) => Math.abs(m[12] - final[0][12]) > EPS || Math.abs(m[13] - final[0][13]) > EPS)) {
    throw new Error(`${entry.id}: Nach dem letzten Falz liegen die Felder nicht übereinander`);
  }

  // Leseansicht (CIP4-Standard): Bund links, Jog-Kante (geschlossener Kopf) oben
  let readerRotation;
  if (!lastFold || rows === 1) readerRotation = identity(); // Flip0: Jog bereits oben
  else if (!bindingBottom) readerRotation = rotation('x', Math.PI); // Bund links, Jog unten -> wenden
  else readerRotation = rotationZ(-Math.PI / 2); // Bund unten, Jog links -> 90° im Uhrzeigersinn

  // Verschiebung ins kanonische System (Bund bei x = 0, Seite ab y = 0, oberstes Blatt bei z = 0)
  const rotated = final.map((m) => multiply(readerRotation, m));
  let minX = Infinity;
  let minY = Infinity;
  let maxZ = -Infinity;
  for (const m of rotated) {
    for (const [x, y] of corners) {
      const p = transformPoint(m, [x, y, 0]);
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
    }
    maxZ = Math.max(maxZ, m[14]);
  }
  const canonicalTransform = multiply(translation(-minX, -minY, -maxZ), readerRotation);
  const canonical = final.map((m) => multiply(canonicalTransform, m));

  // Lagen vom Leser aus oben nach unten; Seitenzahlen
  const order = panels.map((p, i) => ({ i, z: canonical[i][14] })).sort((a, b) => b.z - a.z);
  const result = panels.map((p) => ({ ...p }));
  order.forEach(({ i }, layer) => {
    const m = canonical[i];
    const frontUp = transformVector(m, [0, 0, 1])[2] > 0;
    // Kopfrichtung der Seite in Feldkoordinaten (für beide Seiten des Blattes gleich,
    // weil ein Blatt um den senkrechten Bund gewendet wird)
    const up = inverseRotateVector(m, [0, 1, 0]).map(round);
    result[i].layer = layer;
    result[i].front = { page: frontUp ? 2 * layer + 1 : 2 * layer + 2, up: [up[0], up[1]] };
    result[i].back = { page: frontUp ? 2 * layer + 2 : 2 * layer + 1, up: [up[0], up[1]] };
  });

  // Für Sammelheftung geeignet: Blatt L und Blatt N-1-L hängen über den letzten Falz
  // (Bund) zusammen und bilden ein Doppelblatt.
  const leaves = panels.length;
  const layers = order.map(({ i }) => i);
  let saddleCompatible = leaves % 2 === 0 && !!lastFold;
  if (saddleCompatible) {
    const last = folds[folds.length - 1];
    for (let L = 0; L < leaves / 2 && saddleCompatible; L++) {
      const a = panels[layers[L]];
      const b = panels[layers[leaves - 1 - L]];
      const adjacent =
        (a.row === b.row && Math.abs(a.col - b.col) === 1) || (a.col === b.col && Math.abs(a.row - b.row) === 1);
      saddleCompatible = adjacent && last.moving[a.id] !== last.moving[b.id];
    }
  }

  const sig = {
    entry,
    id: entry.id,
    cols,
    rows,
    cellW,
    cellH,
    pageWidth,
    pageHeight,
    thickness,
    bindingBottom,
    panels: result,
    folds,
    matrices,
    layers,
    leaves,
    readerRotation,
    canonicalTransform,
    canonical,
    saddleCompatible,
  };
  signatureCache.set(key, sig);
  return sig;
}

/**
 * Drehwinkel (Grad, im Uhrzeigersinn) einer Seitenzahl beim Blick auf die
 * angegebene Bogenseite. Rückseite: Bogen um die senkrechte Achse gewendet
 * ("umschlagen"), d. h. x-Richtung gespiegelt.
 */
export function pageRotation(up, side = 'front') {
  const [ux, uy] = side === 'front' ? up : [-up[0], up[1]];
  if (uy > 0.5) return 0;
  if (uy < -0.5) return 180;
  if (ux > 0.5) return 90;
  return 270;
}

/** Ausschuss-Raster einer Bogenseite als Zeilen von { page, rotation, panel }. */
export function sheetLayout(sig, side = 'front', panels = sig.panels) {
  const grid = [];
  for (let row = 0; row < sig.rows; row++) {
    const line = [];
    for (let viewCol = 0; viewCol < sig.cols; viewCol++) {
      const col = side === 'front' ? viewCol : sig.cols - 1 - viewCol;
      const p = panels.find((q) => q.row === row && q.col === col);
      const face = side === 'front' ? p.front : p.back;
      line.push({ page: face.page, rotation: pageRotation(face.up, side), panel: p.id });
    }
    grid.push(line);
  }
  return grid;
}

/** Matrix eines Feldes während der Falzanimation (step = laufender Falz, progress 0..1). */
export function panelMatrixAt(sig, panelIndex, step, progress) {
  const n = sig.folds.length;
  if (step >= n) return sig.matrices[n][panelIndex];
  const base = sig.matrices[step][panelIndex];
  const fold = sig.folds[step];
  if (!fold.moving[panelIndex] || progress <= 0) return base;
  return multiply(fold.matrixAt(Math.min(progress, 1)), base);
}

/**
 * Blättern im kanonischen System: dreht ein Blatt um den Bund (senkrechte Achse
 * bei x = 0 in Höhe axisZ). turned = 0: liegt rechts, 1: ganz umgeblättert.
 */
export function turnCanonical(matrix, turned, axisZ) {
  if (turned <= 0) return matrix;
  const angle = -Math.PI * Math.min(turned, 1);
  return multiply(
    translation(0, 0, axisZ),
    multiply(rotation('y', angle), multiply(translation(0, 0, -axisZ), matrix)),
  );
}

/** Höhe der Bund-Drehachse eines einzelnen Bogens (Stapelmitte, kanonisch). */
export function signatureAxisZ(sig) {
  return (-(sig.leaves - 1) * sig.thickness) / 2;
}

export function openPages(turned, leaves) {
  const k = Math.max(0, Math.min(leaves, Math.round(turned)));
  return { left: k > 0 ? 2 * k : null, right: k < leaves ? 2 * k + 1 : null };
}

/**
 * Falzlinien auf dem flachen Bogen, je Falz eine Liste von Strecken
 * [[x1, y1], [x2, y2]] (Blick auf die Vorderseite, Ursprung Bogenmitte, y nach oben).
 */
export function creases(sig) {
  const { panels, cellW: w, cellH: h } = sig;
  return sig.folds.map((fold) => {
    const segs = [];
    for (const a of panels) {
      for (const b of panels) {
        if (b.id <= a.id || fold.moving[a.id] === fold.moving[b.id]) continue;
        if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
          const x = (a.cx + b.cx) / 2;
          segs.push([[x, a.cy - h / 2], [x, a.cy + h / 2]]);
        } else if (a.col === b.col && Math.abs(a.row - b.row) === 1) {
          const y = (a.cy + b.cy) / 2;
          segs.push([[a.cx - w / 2, y], [a.cx + w / 2, y]]);
        }
      }
    }
    return mergeSegments(segs);
  });
}

function mergeSegments(segs) {
  const key = (s) => (s[0][0] === s[1][0] ? `v${round(s[0][0])}` : `h${round(s[0][1])}`);
  const groups = new Map();
  for (const s of segs) {
    const k = key(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const out = [];
  for (const [k, list] of groups) {
    const vertical = k[0] === 'v';
    const idx = vertical ? 1 : 0;
    const spans = list
      .map((s) => [Math.min(s[0][idx], s[1][idx]), Math.max(s[0][idx], s[1][idx])])
      .sort((a, b) => a[0] - b[0]);
    const fixed = vertical ? list[0][0][0] : list[0][0][1];
    let [lo, hi] = spans[0];
    const flush = () =>
      out.push(vertical ? [[fixed, lo], [fixed, hi]] : [[lo, fixed], [hi, fixed]]);
    for (const [a, b] of spans.slice(1)) {
      if (a <= hi + 1e-6) hi = Math.max(hi, b);
      else {
        flush();
        [lo, hi] = [a, b];
      }
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Produktion: mehrere (auch unterschiedliche) Bogen, Sammelheftung / Klebebindung
// ---------------------------------------------------------------------------

export const BINDINGS = {
  saddle: 'Sammelheftung',
  perfect: 'Klebebindung',
};

/**
 * Schlägt eine Aufteilung einer Seitenzahl auf Falzbogen vor (möglichst große
 * Bogen aus 16, 8, 4 Seiten), z. B. 76 -> 4×16 + 1×8 + 1×4.
 */
export function suggestGroups(pages, sizes = [16, 8, 4]) {
  const groups = [];
  let rest = pages;
  for (const size of sizes) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      groups.push({ count, scheme: DEFAULT_SCHEMES[size] });
      rest -= count * size;
    }
  }
  return groups;
}

/**
 * Verteilt die Seiten eines Produkts auf die Bogen.
 *
 * @param {Array<{count:number, scheme:string}>} groups  Bogengruppen in Produktreihenfolge
 * @param {object} opts
 * @param {'saddle'|'perfect'} opts.binding
 * @param {number} opts.caliper  Papierstärke in mm (für die Verdrängung)
 * @param {number} [opts.pages]  erwartete Gesamtseitenzahl (Prüfung)
 *
 * Klebebindung: Bogen nacheinander. Sammelheftung: Bogen ineinandergesteckt,
 * Bogen 1 außen; die vordere Hälfte jedes Bogens liegt vor, die hintere hinter
 * den inneren Bogen. Verdrängung je Bogen (Sammelheftung) = Anzahl Blätter der
 * umschließenden Bogen auf einer Seite des Rückens × Papierstärke.
 */
export function computeProduction(groups, { binding = 'perfect', caliper = 0.1, pages, ...sigOpts } = {}) {
  if (!BINDINGS[binding]) throw new Error(`Unbekannte Bindeart: ${binding}`);
  const errors = [];
  const sigs = [];
  for (const g of groups) {
    const entry = CATALOG_BY_ID.get(g.scheme);
    if (!entry) {
      errors.push(`Unbekanntes Falzschema ${g.scheme}`);
      continue;
    }
    if (entry.unsupported) {
      errors.push(`${g.scheme} ist im CIP4-Katalog nicht unterstützt`);
      continue;
    }
    const sig = computeSignature(entry, sigOpts);
    if (binding === 'saddle' && !sig.saddleCompatible) {
      errors.push(`${g.scheme} eignet sich nicht für Sammelheftung (Blätter hängen nicht paarweise am Bund zusammen)`);
    }
    for (let i = 0; i < g.count; i++) sigs.push(sig);
  }
  const total = sigs.reduce((sum, s) => sum + s.entry.pages, 0);
  if (pages !== undefined && total !== pages) errors.push(`Die Bogen ergeben ${total} statt ${pages} Seiten`);
  if (!sigs.length) errors.push('Keine Bogen definiert');
  if (errors.length) return { errors, sheets: [], leaves: [], totalLeaves: 0, pages: total, n: 0, binding, caliper };

  const totalLeaves = total / 2;
  const leaves = new Array(totalLeaves);
  const sheets = [];
  let before = 0; // Klebebindung: Blätter vor diesem Bogen; Sammelheftung: Blätter je Seite außen herum
  sigs.forEach((sig, s) => {
    const N = sig.leaves;
    const globalLeaf = (L) => {
      if (binding === 'perfect') return before + L;
      return L < N / 2 ? before + L : totalLeaves - before - N + L;
    };
    const panels = sig.panels.map((p) => {
      const g = globalLeaf(p.layer);
      const offset = 2 * (g - p.layer);
      leaves[g] = { g, sheet: s, panel: p.id, layer: p.layer };
      return { ...p, leaf: g, front: { ...p.front, page: p.front.page + offset }, back: { ...p.back, page: p.back.page + offset } };
    });
    const sheetPages = panels.flatMap((p) => [p.front.page, p.back.page]).sort((a, b) => a - b);
    sheets.push({
      index: s,
      sig,
      scheme: sig.id,
      panels,
      pages: sheetPages,
      pageRanges: pageRanges(sheetPages),
      creep: binding === 'saddle' ? round(before * caliper) : 0,
    });
    before += binding === 'perfect' ? N : N / 2;
  });

  return { errors, n: sheets.length, pages: total, binding, caliper, totalLeaves, sheets, leaves, thickness: sigs[0].thickness };
}

/** Fasst Seitenzahlen zu Bereichen zusammen: [1,2,3,7,8] -> "1–3, 7–8". */
export function pageRanges(pages) {
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let start = sorted[0];
  let prev = start;
  for (const p of sorted.slice(1).concat([Infinity])) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = p;
  }
  return out.join(', ');
}


/**
 * Lage eines Blattes im fertig zusammengetragenen, geschlossenen Produkt
 * (kanonisches System; Blatt g liegt in Tiefe -g × Papierstärke).
 */
export function bookLeafMatrix(production, leaf) {
  const sig = production.sheets[leaf.sheet].sig;
  const m = sig.canonical[leaf.panel];
  return multiply(translation(0, 0, -leaf.g * sig.thickness - m[14]), m);
}

/** Höhe der Bund-Drehachse für das Blättern im Gesamtprodukt (Stapelmitte). */
export function bookAxisZ(production) {
  return (-(production.totalLeaves - 1) * production.thickness) / 2;
}
