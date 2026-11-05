/**
 * Falzschema – Rechenkern (ohne Grafik, auch unter Node.js lauffähig).
 *
 * Der Druckbogen wird als Raster aus starren Feldern ("Blättern") modelliert.
 * Jedes Feld trägt auf der Vorderseite (Schöndruck) und auf der Rückseite
 * (Widerdruck) je eine Endformatseite. Ein Falz ist eine Drehung um 180° um
 * eine Gerade in der Bogenebene; die Felder auf der "beweglichen" Seite der
 * Falzlinie werden dabei auf die liegenbleibende Hälfte geklappt.
 *
 * Aus der Lage der Felder nach dem letzten Falz ergibt sich die Paginierung:
 * Liegt ein Feld in Lage L (von oben gezählt, beginnend bei 0), so trägt die
 * nach oben zeigende Seite die Seitenzahl 2L+1 und die nach unten zeigende
 * Seite die Seitenzahl 2L+2. Die Stand-Richtung (Kopf) jeder Seite auf dem
 * Bogen erhält man, indem man die Richtung "oben" des fertigen Produkts in
 * das Koordinatensystem des flachen Bogens zurückrechnet.
 */

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

// ---------------------------------------------------------------------------
// Falzschemata
// ---------------------------------------------------------------------------

/**
 * 16-Seiter, 3-Bruch-Kreuzbruch.
 *
 * Bogen: 4 Felder nebeneinander, 2 Felder übereinander, Blick auf die
 * Vorderseite (Schöndruck).
 *   1. Falz: vertikal in der Bogenmitte (Bogen wird halbiert)
 *   2. Falz: horizontal, rechtwinklig zum 1. Falz
 *   3. Falz: vertikal, rechtwinklig zum 2. Falz – bildet den Bund (Rücken)
 *
 * Für jeden Falz ist einstellbar, welche Hälfte bewegt wird
 * (moving: 'positive' = rechts bzw. oben, 'negative' = links bzw. unten) und
 * in welche Richtung sie klappt (direction: 'down' = nach hinten, vom
 * Betrachter weg; 'up' = nach vorne, zum Betrachter hin). Die Richtungen
 * beziehen sich immer auf den Blick auf die Vorderseite des Bogens.
 *
 * Standard: alle Falze nach hinten, linke / obere / linke Hälfte bewegt –
 * die Vorderseite bleibt außen, Seite 1 liegt am Ende obenauf.
 */
export const DEFAULT_FOLD_SETTINGS = Object.freeze([
  Object.freeze({ moving: 'negative', direction: 'down' }),
  Object.freeze({ moving: 'positive', direction: 'down' }),
  Object.freeze({ moving: 'negative', direction: 'down' }),
]);

const FOLD_BASE = [
  { name: '1. Falz', orientation: 'vertical', where: 'vertikal in der Bogenmitte' },
  { name: '2. Falz', orientation: 'horizontal', where: 'horizontal, rechtwinklig zum 1. Falz' },
  { name: '3. Falz', orientation: 'vertical', where: 'vertikal, rechtwinklig zum 2. Falz (Bund)' },
];

/** Name der bewegten Hälfte, z. B. "linke Hälfte". */
export function halfName(orientation, moving) {
  if (orientation === 'vertical') return moving === 'positive' ? 'rechte Hälfte' : 'linke Hälfte';
  return moving === 'positive' ? 'obere Hälfte' : 'untere Hälfte';
}

export function directionName(direction) {
  return direction === 'up' ? 'nach vorne' : 'nach hinten';
}

/** Erzeugt das Schema "16 Seiten, 3-Bruch-Kreuzbruch" mit den gewählten Falzrichtungen. */
export function kreuzbruch16(settings = DEFAULT_FOLD_SETTINGS) {
  return {
    id: 'kreuzbruch-3-16',
    name: '16 Seiten, 3-Bruch-Kreuzbruch',
    cols: 4,
    rows: 2,
    folds: FOLD_BASE.map((base, k) => {
      const { moving, direction } = { ...DEFAULT_FOLD_SETTINGS[k], ...(settings[k] || {}) };
      return {
        name: base.name,
        orientation: base.orientation,
        moving,
        direction,
        label: `${base.where} – ${halfName(base.orientation, moving)} ${directionName(direction)}`,
      };
    }),
    // Lage des fertigen Produkts: Bund links, Kopf oben.
    reading: { spine: 'left', head: 'top' },
  };
}

export const KREUZBRUCH_3_16 = kreuzbruch16();

// ---------------------------------------------------------------------------
// Berechnung
// ---------------------------------------------------------------------------

/**
 * Berechnet alle Zwischenzustände und die Paginierung eines Falzschemas.
 *
 * @param {object} scheme   Falzschema (z. B. KREUZBRUCH_3_16)
 * @param {object} [opts]
 * @param {number} [opts.pageWidth=70]   Breite einer Endformatseite
 * @param {number} [opts.pageHeight=99]  Höhe einer Endformatseite
 * @param {number} [opts.thickness=0.6]  Papierstärke (nur für die Darstellung)
 */
export function computeScheme(scheme, opts = {}) {
  const pageWidth = opts.pageWidth ?? 70;
  const pageHeight = opts.pageHeight ?? 99;
  const thickness = opts.thickness ?? 0.6;
  const { cols, rows } = scheme;

  // Felder anlegen; Zeile 0 = obere Reihe, Spalte 0 = links (Blick auf die Vorderseite).
  const panels = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = (col - (cols - 1) / 2) * pageWidth;
      const cy = ((rows - 1) / 2 - row) * pageHeight;
      panels.push({ id: panels.length, row, col, cx, cy });
    }
  }

  // matrices[k][i] = Lage von Feld i nach k Falzen
  const matrices = [panels.map((p) => translation(p.cx, p.cy, 0))];
  const folds = [];

  scheme.folds.forEach((fold, k) => {
    const current = matrices[k];
    const centers = current.map((m) => transformPoint(m, [0, 0, 0]));
    const xs = centers.map((c) => c[0]);
    const ys = centers.map((c) => c[1]);
    const zs = centers.map((c) => c[2]);
    const up = (fold.direction ?? 'up') === 'up';
    // Falzachse knapp über (bzw. unter) dem Stapel, damit die Lagen sauber aufeinander liegen
    const h = up ? Math.max(...zs) + thickness / 2 : Math.min(...zs) - thickness / 2;

    let axis, linePos, coord;
    if (fold.orientation === 'vertical') {
      axis = 'y';
      coord = 0;
      linePos = (Math.min(...xs) + Math.max(...xs)) / 2;
    } else {
      axis = 'x';
      coord = 1;
      linePos = (Math.min(...ys) + Math.max(...ys)) / 2;
    }

    const moving = centers.map((c) =>
      fold.moving === 'positive' ? c[coord] > linePos + 1e-9 : c[coord] < linePos - 1e-9,
    );

    // Drehsinn so wählen, dass die bewegte Hälfte nach oben (+z, zum Betrachter hin)
    // bzw. nach unten (-z, hinter den Bogen) klappt.
    let sign;
    if (axis === 'y') sign = fold.moving === 'positive' ? -1 : 1;
    else sign = fold.moving === 'positive' ? 1 : -1;
    if (!up) sign = -sign;

    const pivot = axis === 'y' ? [linePos, 0, h] : [0, linePos, h];
    const matrixAt = (progress) => {
      const angle = sign * Math.PI * progress;
      return multiply(
        translation(pivot[0], pivot[1], pivot[2]),
        multiply(rotation(axis, angle), translation(-pivot[0], -pivot[1], -pivot[2])),
      );
    };

    const full = matrixAt(1);
    matrices.push(current.map((m, i) => (moving[i] ? multiply(full, m) : m)));
    folds.push({ ...fold, index: k, axis, linePos, pivot, moving, matrixAt });
  });

  const final = matrices[matrices.length - 1];

  // Leserichtung: Das fertige Produkt wird so betrachtet, dass der Bund (letzter Falz)
  // links liegt. Liegt er bei Blick von +z rechts, wird das Produkt um die senkrechte
  // Achse gewendet, d. h. von -z betrachtet.
  const lastFold = folds[folds.length - 1];
  const finalCenters = final.map((m) => transformPoint(m, [0, 0, 0]));
  const finalXs = finalCenters.map((c) => c[0]);
  // Feldkanten (nicht Mittelpunkte) vergleichen; die Felder liegen nach dem Falzen deckungsgleich.
  const leftEdge = Math.min(...finalXs) - pageWidth / 2;
  const rightEdge = Math.max(...finalXs) + pageWidth / 2;
  const spineLeftFromTop = Math.abs(lastFold.linePos - leftEdge) < Math.abs(lastFold.linePos - rightEdge);
  const viewSign = spineLeftFromTop === (scheme.reading.spine === 'left') ? 1 : -1;

  // Lagen bestimmen (vom Betrachter aus von oben nach unten)
  const order = panels
    .map((p, i) => ({ i, z: viewSign * finalCenters[i][2] }))
    .sort((a, b) => b.z - a.z);

  const headVec = { top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] }[
    scheme.reading.head
  ];

  const result = panels.map((p) => ({ ...p, front: null, back: null }));
  order.forEach(({ i }, layer) => {
    const m = final[i];
    const normal = transformVector(m, [0, 0, 1]);
    const frontUp = viewSign * normal[2] > 0;
    // Kopf-Richtung der Seite in Feld-Koordinaten (gilt für beide Seiten des Blattes,
    // weil ein Blatt um den senkrechten Bund gewendet wird).
    const up = inverseRotateVector(m, headVec).map(round);
    const upPage = 2 * layer + 1;
    const downPage = 2 * layer + 2;
    result[i].layer = layer;
    result[i].front = { page: frontUp ? upPage : downPage, up: [up[0], up[1]] };
    result[i].back = { page: frontUp ? downPage : upPage, up: [up[0], up[1]] };
  });

  // Blättern im fertigen Produkt (gedanklich beschnitten): Jedes Feld ist ein Blatt,
  // das um den Bund gewendet wird. Drehachse senkrecht am Bund, auf halber Stapelhöhe,
  // damit die gewendeten Blätter auf der anderen Seite in umgekehrter Folge liegen.
  const zs = finalCenters.map((c) => c[2]);
  const book = {
    spineX: lastFold.linePos,
    axisZ: (Math.min(...zs) + Math.max(...zs)) / 2,
    // Blätter liegen auf der Seite des Bundes, die nicht der Rand ist
    leavesSide: spineLeftFromTop ? 'positive' : 'negative',
  };

  return {
    scheme,
    viewSign,
    book,
    pageWidth,
    pageHeight,
    thickness,
    panels: result,
    folds,
    matrices,
    layers: order.map(({ i }) => i),
  };
}

/**
 * Drehwinkel (Grad, im Uhrzeigersinn) einer Seitenzahl, wenn man den Bogen
 * von der angegebenen Seite betrachtet.
 *  - Vorderseite: Feld-Koordinaten direkt.
 *  - Rückseite: Bogen um die senkrechte Achse gewendet ("umschlagen"),
 *    d. h. x-Richtung gespiegelt.
 */
export function pageRotation(up, side = 'front') {
  const [ux, uy] = side === 'front' ? up : [-up[0], up[1]];
  if (uy > 0.5) return 0;
  if (uy < -0.5) return 180;
  if (ux > 0.5) return 90;
  return 270;
}

/**
 * Liefert das Ausschuss-Raster einer Bogenseite als Zeilen von
 * { page, rotation } – so wie man den Bogen von dieser Seite aus sieht.
 */
export function sheetLayout(computed, side = 'front') {
  const { cols, rows } = computed.scheme;
  const grid = [];
  for (let row = 0; row < rows; row++) {
    const line = [];
    for (let viewCol = 0; viewCol < cols; viewCol++) {
      const col = side === 'front' ? viewCol : cols - 1 - viewCol;
      const p = computed.panels.find((q) => q.row === row && q.col === col);
      const face = side === 'front' ? p.front : p.back;
      line.push({ page: face.page, rotation: pageRotation(face.up, side), panel: p.id });
    }
    grid.push(line);
  }
  return grid;
}

/** Interpolierte Matrix eines Feldes während der Animation. */
export function panelMatrixAt(computed, panelIndex, step, progress) {
  // step = Index des gerade laufenden Falzes (0..n-1), progress 0..1
  // step >= n  => fertig gefalzt
  const n = computed.folds.length;
  if (step >= n) return computed.matrices[n][panelIndex];
  const base = computed.matrices[step][panelIndex];
  const fold = computed.folds[step];
  if (!fold.moving[panelIndex] || progress <= 0) return base;
  return multiply(fold.matrixAt(Math.min(progress, 1)), base);
}

/**
 * Matrix eines Blattes beim Blättern im fertigen Produkt.
 * @param {number} turned  0 = Blatt liegt rechts vom Bund, 1 = ganz umgeblättert
 */
export function leafMatrixAt(computed, panelIndex, turned) {
  const base = computed.matrices[computed.folds.length][panelIndex];
  if (turned <= 0) return base;
  const { spineX, axisZ, leavesSide } = computed.book;
  // Blatt hebt sich zum Betrachter hin und legt sich auf die andere Seite des Bundes.
  const sign = (leavesSide === 'positive' ? -1 : 1) * computed.viewSign;
  const angle = sign * Math.PI * Math.min(turned, 1);
  const turn = multiply(
    translation(spineX, 0, axisZ),
    multiply(rotation('y', angle), translation(-spineX, 0, -axisZ)),
  );
  return multiply(turn, base);
}

/**
 * Welche Seiten sind sichtbar, wenn `turned` Blätter umgeblättert sind?
 * Liefert { left, right } (null, wenn auf der Seite nichts liegt).
 */
export function openPages(computed, turned) {
  const leaves = computed.panels.length;
  const k = Math.max(0, Math.min(leaves, Math.round(turned)));
  return { left: k > 0 ? 2 * k : null, right: k < leaves ? 2 * k + 1 : null };
}

/**
 * Falzlinien (Brüche) auf dem flachen Bogen, je Falz eine Liste von Strecken
 * [[x1, y1], [x2, y2]] in Bogenkoordinaten (Blick auf die Vorderseite,
 * Ursprung in der Bogenmitte, y nach oben).
 *
 * Ein Bruch des Falzes k liegt zwischen zwei benachbarten Feldern, von denen
 * genau eines bei diesem Falz bewegt wird.
 */
export function creases(computed) {
  const { panels, pageWidth: w, pageHeight: h } = computed;
  return computed.folds.map((fold) => {
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
