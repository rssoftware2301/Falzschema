import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import {
  DEFAULT_FOLD_SETTINGS,
  PAGE_COUNTS,
  BINDINGS,
  kreuzbruch16,
  halfName,
  directionName,
  computeScheme,
  computeProduction,
  productionSheetLayout,
  bookLeafMatrix,
  bookAxisZ,
  foreEdgeDirection,
  turnAboutSpine,
  panelMatrixAt,
  leafMatrixAt,
  openPages,
  pageRotation,
  transformPoint,
  multiply,
  translation,
  creases,
} from './falzschema.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const PAGE_W = 70; // Endformat in Darstellungseinheiten (Verhältnis DIN A)
const PAGE_H = 99;
// Papierstärke in der Darstellung (überzeichnet; bei vielen Bogen dünner, damit der Block nicht zum Würfel wird)
const displayThickness = (pages) => (pages <= 32 ? 1.2 : pages <= 64 ? 0.75 : 0.5);
const MM_PER_UNIT = 148 / PAGE_W; // Endformat DIN A5 (148 × 210 mm)
const CREEP_EXAG = 4; // Verdrängung in der Darstellung 4-fach überhöht (sonst kaum sichtbar)
const MAX_CREEP_UNITS = 8;

const COLORS = {
  front: '#ffffff',
  back: '#dbe7f7',
  ink: '#1d2430',
  border: '#8a95a5',
  head: '#c58a1a',
  fold: 0xe5484d,
};
// Kantenfarbe je Bogen (zur Unterscheidung im zusammengetragenen Produkt)
const SHEET_COLORS = ['#e5484d', '#f5a524', '#2da44e', '#1f6feb', '#8250df', '#d6409f', '#12a594', '#6b7684'];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmtMm = (v) => `${v.toFixed(2).replace('.', ',')} mm`;

// ---------------------------------------------------------------------------
// Modell
// ---------------------------------------------------------------------------

const product = { pages: 16, binding: 'saddle', caliper: 0.1 };
let foldSettings = DEFAULT_FOLD_SETTINGS.map((f) => ({ ...f }));
let scheme;
let model;
let production;
let CREASES;
let BOOK_AXIS_Z = 0;

function computeAll() {
  scheme = kreuzbruch16(foldSettings);
  model = computeScheme(scheme, { pageWidth: PAGE_W, pageHeight: PAGE_H, thickness: displayThickness(product.pages) });
  CREASES = creases(model);
  production = computeProduction(model, product);
  BOOK_AXIS_Z = bookAxisZ(model, production);
}
computeAll();

const FOLDS = model.folds.length;
const LEAVES_PER_SHEET = model.panels.length;

/** Verdrängung eines Bogens in Darstellungseinheiten (überhöht). */
const creepUnits = (s) => Math.min(MAX_CREEP_UNITS, (production.sheets[s].creep / MM_PER_UNIT) * CREEP_EXAG);

/** Seitenzahl sieht kopfstehend wie eine andere Zahl aus (z. B. 6/9, 16/91)? */
function needsUnderline(n) {
  const map = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' };
  const s = String(n);
  if (![...s].every((c) => c in map)) return false;
  const rotated = [...s].reverse().map((c) => map[c]).join('');
  return rotated !== s && rotated[0] !== '0';
}

// Ansicht: ein einzelner Bogen ('sheet') oder das Endprodukt ('book')
const view = { mode: 'sheet', sheet: 0 };

// ---------------------------------------------------------------------------
// Ausschuss-Schema (2D, SVG)
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}, parent) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
};

function renderSchema(svg, side) {
  const { cols, rows } = scheme;
  const W = cols * PAGE_W;
  const H = rows * PAGE_H;
  const m = 20;
  svg.setAttribute('viewBox', `0 0 ${W + 2 * m} ${H + 2 * m}`);
  svg.replaceChildren();

  // Bogenkoordinaten (Ursprung Mitte, y nach oben) -> SVG
  const mirror = side === 'back' ? -1 : 1;
  const sx = (x) => mirror * x + W / 2 + m;
  const sy = (y) => H / 2 - y + m;

  const sheet = production.sheets[view.sheet];
  const shift = creepUnits(view.sheet);
  const layout = productionSheetLayout(model, sheet, side);
  layout.forEach((line, row) => {
    line.forEach((cell, col) => {
      const x = m + col * PAGE_W;
      const y = m + row * PAGE_H;
      const cx = x + PAGE_W / 2;
      const cy = y + PAGE_H / 2;
      svgEl('rect', { x, y, width: PAGE_W, height: PAGE_H, class: `sheet-cell ${side}` }, svg);
      // Inhalt im Seitenkoordinatensystem (aufrecht) zeichnen, dann drehen.
      const g = svgEl('g', { transform: `rotate(${cell.rotation} ${cx} ${cy})` }, svg);
      // Bund: ungerade Seiten (rechte Seiten) haben den Bund links, gerade rechts.
      const spineLeft = cell.page % 2 === 1;
      svgEl('rect', { x: spineLeft ? x : x + PAGE_W - 2.5, y, width: 2.5, height: PAGE_H, class: 'spine-mark' }, g);
      // Verdrängungsausgleich: Inhalt zum Bund hin verschieben
      const content = svgEl('g', { transform: `translate(${spineLeft ? -shift : shift} 0)` }, g);
      svgEl('rect', { x: x + 7, y: y + 13, width: PAGE_W - 14, height: PAGE_H - 22, class: 'satzspiegel' }, content);
      svgEl('rect', { x: cx - 18, y: y + 5, width: 36, height: 4, rx: 1.5, class: 'page-head' }, content);
      const fontSize = cell.page >= 100 ? 24 : 30;
      const t = svgEl('text', { x: cx, y: cy, class: 'page-no', style: `font-size:${fontSize}px` }, content);
      t.textContent = cell.page;
      if (needsUnderline(cell.page)) {
        const w = String(cell.page).length * fontSize * 0.55;
        svgEl('rect', { x: cx - w / 2, y: cy + fontSize / 2, width: w, height: 2, class: 'page-underline' }, content);
      }
      const title = svgEl('title', {}, g);
      title.textContent = `Seite ${cell.page}${cell.rotation === 180 ? ' (kopfstehend)' : ''}`;
    });
  });

  svgEl('rect', { x: m, y: m, width: W, height: H, class: 'sheet-outline' }, svg);

  CREASES.forEach((segs, k) => {
    segs.forEach(([[x1, y1], [x2, y2]], j) => {
      svgEl('line', { x1: sx(x1), y1: sy(y1), x2: sx(x2), y2: sy(y2), class: 'crease', 'data-fold': k }, svg);
      if (j > 0 && k !== 2) return;
      // Nummer am Rand außerhalb des Bogens
      const vertical = x1 === x2;
      const lx = vertical ? sx(x1) : m / 2;
      const ly = vertical ? m / 2 : sy(y1);
      const g = svgEl('g', { class: 'crease-label', 'data-fold': k }, svg);
      svgEl('circle', { cx: lx, cy: ly, r: 7 }, g);
      const t = svgEl('text', { x: lx, y: ly }, g);
      t.textContent = k + 1;
    });
  });
}

const schemaFront = document.getElementById('schema-front');
const schemaBack = document.getElementById('schema-back');

// ---------------------------------------------------------------------------
// 3D-Szene
// ---------------------------------------------------------------------------

const container = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true; // für den Beschnitt
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 8000);
const DEFAULT_CAMERA = new THREE.Vector3(250, -230, 470);
const READING_CAMERA = new THREE.Vector3(0, -260, 430); // Leseansicht beim Blättern
camera.position.copy(DEFAULT_CAMERA);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2d0, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(200, 150, 400);
scene.add(sun);
const sunBack = new THREE.DirectionalLight(0xffffff, 0.9);
sunBack.position.set(-200, -150, -400);
scene.add(sunBack);

// flipGroup: Wenden (Vorder-/Rückseite); sheetGroup: hält das Objekt in der Bildmitte
const flipGroup = new THREE.Group();
const sheetGroup = new THREE.Group();
flipGroup.add(sheetGroup);
scene.add(flipGroup);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

function pageTexture({ page, rotation, side, shift, sheetNo, scale }) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * scale;
  canvas.height = PAGE_H * scale;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = side === 'front' ? COLORS.front : COLORS.back;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const pw = rotation % 180 === 0 ? w : h;
  const ph = rotation % 180 === 0 ? h : w;

  // Verdrängungsausgleich: Inhalt zum Bund hin verschieben (ungerade Seite: Bund links)
  const spineLeft = page % 2 === 1;
  ctx.translate((spineLeft ? -1 : 1) * shift * scale, 0);

  // Satzspiegel
  ctx.strokeStyle = '#b5bdc8';
  ctx.lineWidth = Math.max(1, scale * 0.25);
  ctx.setLineDash([scale * 1.5, scale * 1.5]);
  ctx.strokeRect(-pw / 2 + pw * 0.1, -ph / 2 + ph * 0.13, pw * 0.8, ph * 0.78);
  ctx.setLineDash([]);

  // Kopfmarke
  ctx.fillStyle = COLORS.head;
  ctx.fillRect(-pw * 0.26, -ph / 2 + ph * 0.05, pw * 0.52, ph * 0.035);
  ctx.font = `600 ${Math.round(ph * 0.04)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Kopf', 0, -ph / 2 + ph * 0.1);

  // Seitenzahl
  ctx.fillStyle = COLORS.ink;
  const size = page >= 100 ? 0.24 : 0.3;
  ctx.font = `700 ${Math.round(ph * size)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(page), 0, ph * 0.02);
  if (needsUnderline(page)) {
    const tw = ctx.measureText(String(page)).width;
    ctx.fillRect(-tw / 2, ph * (0.02 + size / 2 + 0.01), tw, ph * 0.018);
  }
  ctx.font = `500 ${Math.round(ph * 0.042)}px system-ui, sans-serif`;
  ctx.fillStyle = '#5d6878';
  ctx.fillText(`Bogen ${sheetNo} · ${side === 'front' ? 'Schöndruck' : 'Widerdruck'}`, 0, ph * 0.36);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

const plane = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
const edges = new THREE.EdgesGeometry(plane);
const FACE_OFFSET = 0.12; // Abstand Vorder-/Rückseite eines Blattes (kleiner als jede Lagenstärke)
const spineStripGeometry = new THREE.PlaneGeometry(1, PAGE_H);
const spineStripMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f4f8, roughness: 0.92, side: THREE.DoubleSide });

// leafObjects[g] = 3D-Blatt mit globaler Position g; sheetObjects[s][panelId] = dasselbe Objekt
let leafObjects = [];
let sheetObjects = [];

function disposeLeaves() {
  for (const g of leafObjects) {
    for (const child of g.children) {
      if (child === g.userData.strip) continue; // gemeinsames Material
      child.material.map?.dispose();
      child.material.dispose();
    }
    sheetGroup.remove(g);
  }
  leafObjects = [];
  sheetObjects = [];
}

function buildLeaves() {
  disposeLeaves();
  const scale = production.n <= 2 ? 6 : 4; // Texturgröße begrenzen bei vielen Bogen
  const foreDir = foreEdgeDirection(model);
  const final = model.matrices[FOLDS];
  production.sheets.forEach((sheet, s) => {
    const shift = creepUnits(s);
    sheetObjects[s] = sheet.panels.map((p) => {
      // Beschnitt-Ebene in Blattkoordinaten: Richtung Vorderschnitt
      const m = final[p.id];
      const foreLocal = new THREE.Vector3(m[0], m[4], m[8]).multiplyScalar(foreDir).normalize();
      const clipPlane = new THREE.Plane();
      const material = (map) =>
        new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, clippingPlanes: [clipPlane] });

      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const front = new THREE.Mesh(
        plane,
        material(
          pageTexture({ page: p.front.page, rotation: pageRotation(p.front.up, 'front'), side: 'front', shift, sheetNo: s + 1, scale }),
        ),
      );
      front.position.z = FACE_OFFSET;
      // Rückseite: Ebene um die y-Achse gewendet -> Texturkoordinate u zeigt nach -x,
      // das entspricht der Blickrichtung auf die umgeschlagene Rückseite.
      const back = new THREE.Mesh(
        plane,
        material(
          pageTexture({ page: p.back.page, rotation: pageRotation(p.back.up, 'back'), side: 'back', shift, sheetNo: s + 1, scale }),
        ),
      );
      back.rotation.y = Math.PI;
      back.position.z = -FACE_OFFSET;
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: SHEET_COLORS[s % SHEET_COLORS.length], clippingPlanes: [clipPlane] }),
      );
      // Papierstreifen am Bund: füllt bei der Verdrängung (Blatt nach außen versetzt) die Lücke zum Rücken
      const strip = new THREE.Mesh(spineStripGeometry, spineStripMaterial);
      strip.visible = false;
      g.add(front, back, outline, strip);
      g.userData = { sheet: s, panel: p.id, leaf: p.leaf, foreLocal, clipPlane, localPlane: new THREE.Plane(), strip };
      sheetGroup.add(g);
      leafObjects[p.leaf] = g;
      return g;
    });
  });
}

// Falzlinie des nächsten / laufenden Falzes (auf beiden Bogenseiten)
const foldLineMaterial = new THREE.MeshBasicMaterial({
  color: COLORS.fold,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const foldLines = [0, 1].map(() => {
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), foldLineMaterial);
  sheetGroup.add(strip);
  return strip;
});

// Drahtklammern (Sammelheftung) und Klebstoff am Rücken (Klebebindung)
const stapleMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.3 });
const staples = [0, 1].map(() => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 16, 1), stapleMaterial);
  sheetGroup.add(mesh);
  return mesh;
});
const glue = new THREE.Mesh(
  new THREE.BoxGeometry(2.2, PAGE_H, 1),
  new THREE.MeshStandardMaterial({ color: 0xe9d9a8, roughness: 0.6 }),
);
sheetGroup.add(glue);

const tmpMatrix = new THREE.Matrix4();

function stateBounds(matrices) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const m of matrices) {
    for (const [x, y] of [
      [-PAGE_W / 2, -PAGE_H / 2],
      [PAGE_W / 2, -PAGE_H / 2],
      [PAGE_W / 2, PAGE_H / 2],
      [-PAGE_W / 2, PAGE_H / 2],
    ]) {
      const [px, py, pz] = transformPoint(m, [x, y, 0]);
      box.minX = Math.min(box.minX, px);
      box.maxX = Math.max(box.maxX, px);
      box.minY = Math.min(box.minY, py);
      box.maxY = Math.max(box.maxY, py);
      box.minZ = Math.min(box.minZ, pz);
      box.maxZ = Math.max(box.maxZ, pz);
    }
  }
  return box;
}

function updateFoldLines(t) {
  const k = Math.floor(t);
  if (view.mode !== 'sheet' || k >= FOLDS) {
    foldLines.forEach((l) => (l.visible = false));
    return;
  }
  const fold = model.folds[k];
  const box = stateBounds(model.matrices[k]);
  const zs = [box.maxZ + model.thickness, box.minZ - model.thickness];
  const width = 1.6;
  foldLines.forEach((strip, i) => {
    if (fold.orientation === 'vertical') {
      strip.position.set(fold.linePos, (box.minY + box.maxY) / 2, zs[i]);
      strip.scale.set(width, box.maxY - box.minY + 16, 1);
    } else {
      strip.position.set((box.minX + box.maxX) / 2, fold.linePos, zs[i]);
      strip.scale.set(box.maxX - box.minX + 16, width, 1);
    }
    strip.visible = true;
  });
}

// ---------------------------------------------------------------------------
// Animationszustand
// ---------------------------------------------------------------------------

const state = {
  // Bogenansicht: t läuft von 0 (flach) bis FOLDS (gefalzt)
  t: 0,
  target: 0,
  playingAll: false,
  // Endprodukt: a läuft von 0 (Bogen liegen bereit) bis n (alle zusammengetragen) bis n+1 (fertig)
  a: 0,
  aTarget: 0,
  speed: 1,
  flip: 0, // 0 = Vorderseite, Math.PI = Rückseite
  flipTarget: 0,
  center: new THREE.Vector3(),
  zoom: 1,
  // Blättern: book = Anzahl umgeblätterter Blätter (stetig für die Animation)
  book: 0,
  bookTarget: 0,
  cameraTarget: null, // laufende Kamerafahrt (Vector3) oder null
};

const assemblyEnd = () => production.n + 1;

/** Lage aller Blätter in der Bogenansicht. */
function sheetPose(t, book) {
  const step = Math.min(Math.floor(t), FOLDS);
  const progress = ease(t - step);
  return model.panels.map((p, i) =>
    step >= FOLDS && book > 0
      ? leafMatrixAt(model, i, ease(clamp01(book - p.layer)))
      : panelMatrixAt(model, i, step, progress),
  );
}

/**
 * Lage aller Blätter im Endprodukt in Abhängigkeit vom Fortschritt a des
 * Zusammentragens und vom Blättern. Liefert auch Heft-/Klebe- und Beschnitt-Fortschritt.
 */
function bookPose(a, book) {
  const n = production.n;
  const saddle = production.binding === 'saddle';
  const foreDir = foreEdgeDirection(model);
  const half = LEAVES_PER_SHEET / 2;
  const f = clamp01(a - n); // Abschluss: Schließen / Heften / Kleben / Beschnitt
  // Sammelheftung: eingesteckte Bogen liegen aufgeschlagen (vordere Hälfte umgelegt),
  // am Ende wird das Produkt geschlossen.
  const openTurn = saddle ? 1 - ease(clamp01(f / 0.4)) : 0;
  const fasten = saddle ? ease(clamp01((f - 0.4) / 0.2)) : ease(clamp01(f / 0.6));
  const trim = saddle ? ease(clamp01((f - 0.6) / 0.4)) : 0;
  const slotX = (i) => foreDir * (2 * PAGE_W + 30 + i * (PAGE_W + 14));

  const matrices = [];
  const trims = [];
  const protrusions = [];
  for (const leaf of production.leaves) {
    const s = leaf.sheet;
    const i = n - 1 - s; // Reihenfolge: innerster bzw. unterster Bogen zuerst
    const q = clamp01(a - i);
    const base = model.matrices[FOLDS][leaf.panel];
    const dzBook = model.viewSign * model.thickness * (leaf.layer - leaf.g);
    const front = leaf.layer < half;
    let m;
    if (saddle) {
      // Verdrängung: innere Bogen stehen nach dem Schließen am Vorderschnitt über
      const protrusion = creepUnits(s) * (f > 0 ? 1 - openTurn : 0);
      protrusions[leaf.g] = protrusion;
      const local = multiply(translation(foreDir * protrusion, 0, 0), base);
      if (q >= 1) {
        m = multiply(translation(0, 0, dzBook), local);
        if (front) m = turnAboutSpine(model, m, openTurn, BOOK_AXIS_Z);
      } else {
        // Bogen aufschlagen (in der Bereitstellung), dann unter die eingesteckten Bogen schieben
        const qOpen = ease(clamp01(q / 0.3));
        const qMove = ease(clamp01((q - 0.3) / 0.7));
        m = multiply(translation(0, 0, dzBook * qOpen), local);
        if (front) m = turnAboutSpine(model, m, qOpen, BOOK_AXIS_Z);
        const dip = -model.viewSign * 8 * Math.sin(Math.PI * qMove);
        m = multiply(translation(slotX(i) * (1 - qMove), 0, dip), m);
      }
    } else if (q >= 1) {
      m = multiply(translation(0, 0, dzBook), base);
    } else {
      // Klebebindung: Bogen wird angehoben und auf den Stapel gelegt
      const e = ease(q);
      const lift = model.viewSign * (20 + model.thickness * production.totalLeaves) * Math.sin(Math.PI * q);
      m = multiply(translation(slotX(i) * (1 - e), 0, dzBook * e + lift), base);
    }
    if (book > 0) m = turnAboutSpine(model, m, ease(clamp01(book - leaf.g)), BOOK_AXIS_Z);
    matrices[leaf.g] = m;
    trims[leaf.g] = saddle ? creepUnits(s) * trim : 0;
  }
  return { matrices, trims, protrusions, fasten, f };
}

function applyMatrices(objects, matrices) {
  objects.forEach((obj, i) => {
    tmpMatrix.fromArray(matrices[i]);
    obj.matrix.copy(tmpMatrix);
    obj.matrixWorldNeedsUpdate = true;
  });
}

function updateFastening(pose) {
  const saddle = production.binding === 'saddle';
  const show = view.mode === 'book' && pose && pose.fasten > 0;
  const depth = model.thickness * production.totalLeaves + 2;
  const finalBox = stateBounds(model.matrices[FOLDS]);
  const yC = (finalBox.minY + finalBox.maxY) / 2;
  const spineX = model.book.spineX;
  staples.forEach((st, i) => {
    st.visible = show && saddle;
    st.position.set(spineX, yC + (i === 0 ? 1 : -1) * PAGE_H * 0.28, BOOK_AXIS_Z);
    st.scale.set(1, Math.max(0.001, pose?.fasten ?? 0), depth);
  });
  glue.visible = show && !saddle;
  glue.position.set(spineX - foreEdgeDirection(model) * 1.1, yC, BOOK_AXIS_Z);
  glue.scale.set(1, 1, Math.max(0.001, depth * (pose?.fasten ?? 0)));
}

function updateSpineStrips(protrusions) {
  for (const obj of leafObjects) {
    const { strip, foreLocal, leaf } = obj.userData;
    const w = protrusions ? protrusions[leaf] || 0 : 0;
    strip.visible = w > 0.05;
    if (!strip.visible) continue;
    // Streifen liegt in Blattebene an der Bundkante, Breite = Versatz
    const along = PAGE_W / 2 + w / 2;
    strip.position.set(-foreLocal.x * along, -foreLocal.y * along, 0);
    strip.rotation.z = Math.abs(foreLocal.y) > 0.5 ? Math.PI / 2 : 0;
    strip.scale.set(w, Math.abs(foreLocal.y) > 0.5 ? PAGE_W / PAGE_H : 1, 1);
  }
}

function updateClipping(trims) {
  for (const obj of leafObjects) {
    const { foreLocal, clipPlane, localPlane, leaf } = obj.userData;
    const trim = trims ? trims[leaf] : 0;
    // Behalten wird, was höchstens (Halbe Breite - Beschnitt) Richtung Vorderschnitt liegt
    localPlane.set(foreLocal.clone().negate(), PAGE_W / 2 - trim + (trim > 0 ? 0 : 1000));
    clipPlane.copy(localPlane).applyMatrix4(obj.matrixWorld);
  }
}

function centerOf(b) {
  return new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
}

// ---------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

// --- Produkt -------------------------------------------------------------------

$('page-count').innerHTML = PAGE_COUNTS.map(
  (p) => `<option value="${p}">${p} Seiten (${p / 16} ${p === 16 ? 'Bogen' : 'Bogen'})</option>`,
).join('');
$('page-count').value = String(product.pages);
$('binding').value = product.binding;
$('caliper').value = product.caliper.toFixed(2);

$('page-count').addEventListener('change', (e) => {
  product.pages = Number(e.target.value);
  applyProduct();
});
$('binding').addEventListener('change', (e) => {
  product.binding = e.target.value;
  applyProduct();
});
$('caliper').addEventListener('change', (e) => {
  const v = Number(String(e.target.value).replace(',', '.'));
  product.caliper = Number.isFinite(v) ? Math.min(0.5, Math.max(0.03, v)) : 0.1;
  e.target.value = product.caliper.toFixed(2);
  applyProduct();
});

/** Alles neu berechnen und darstellen (nach Änderung von Produkt oder Falzrichtung). */
function applyProduct() {
  closeBookNow();
  state.a = state.aTarget = 0;
  computeAll();
  view.sheet = Math.min(view.sheet, production.n - 1);
  buildLeaves();
  renderViewChips();
  renderOverview();
  renderSteps();
  renderSchemaAll();
  renderProductTexts();
  const isDefault = foldSettings.every(
    (f, k) => f.moving === DEFAULT_FOLD_SETTINGS[k].moving && f.direction === DEFAULT_FOLD_SETTINGS[k].direction,
  );
  $('btn-fold-default').disabled = isDefault;
}

function renderProductTexts() {
  const { n, pages, binding } = production;
  const bindingName = BINDINGS[binding];
  $('subtitle').textContent = `${pages} Seiten · ${n} ${n === 1 ? 'Druckbogen' : 'Druckbogen'} à 16 Seiten · ${bindingName} · 3-Bruch-Kreuzbruch`;
  $('caliper-field').hidden = binding !== 'saddle';
  const maxCreep = production.sheets[n - 1].creep;
  $('product-info').textContent =
    binding === 'saddle'
      ? `${n} Bogen werden ineinandergesteckt und am Rücken geheftet. Verdrängung: 0 bis ${fmtMm(maxCreep)} (innerster Bogen).`
      : `${n} Bogen werden nacheinander zusammengetragen und am Rücken verklebt. Keine Verdrängung.`;
  $('assembly-intro').textContent =
    binding === 'saddle'
      ? 'Sammelheftung: Die gefalzten Bogen werden aufgeschlagen und ineinandergesteckt – der innerste Bogen zuerst, Bogen 1 zuletzt außen. Dann wird geschlossen, geheftet und am Vorderschnitt beschnitten.'
      : 'Klebebindung: Die gefalzten Bogen werden nacheinander aufeinandergelegt (Bogen 1 oben) und am Rücken verklebt.';
  $('asm-scrub').max = String(assemblyEnd());
  $('legend-sheets').hidden = n === 1;
}

// --- Ansicht: Bogen / Endprodukt ------------------------------------------------

function renderViewChips() {
  const chips = $('view-chips');
  chips.replaceChildren();
  production.sheets.forEach((sheet, s) => {
    const b = document.createElement('button');
    b.innerHTML = `<i class="dot" style="background:${SHEET_COLORS[s % SHEET_COLORS.length]}"></i>Bogen ${s + 1}`;
    b.title = `Bogen ${s + 1}: Seiten ${sheet.pageRanges}`;
    b.classList.toggle('active', view.mode === 'sheet' && view.sheet === s);
    b.addEventListener('click', () => selectView('sheet', s));
    chips.appendChild(b);
  });
  const b = document.createElement('button');
  b.className = 'product';
  b.textContent = production.n > 1 ? 'Endprodukt (zusammentragen)' : 'Endprodukt';
  b.classList.toggle('active', view.mode === 'book');
  b.addEventListener('click', () => selectView('book'));
  chips.appendChild(b);
}

function selectView(mode, sheet = view.sheet) {
  const changed = mode !== view.mode || sheet !== view.sheet;
  view.mode = mode;
  view.sheet = sheet;
  if (changed) closeBookNow();
  $('sheet-controls').hidden = mode !== 'sheet';
  $('book-controls').hidden = mode !== 'book';
  $('sheet-label').textContent = `Bogen ${sheet + 1}`;
  renderViewChips();
  renderOverview();
  renderSchemaAll();
}

function renderSchemaAll() {
  renderSchema(schemaFront, 'front');
  renderSchema(schemaBack, 'back');
  const sheet = production.sheets[view.sheet];
  $('schema-title').textContent = `Ausschuss Bogen ${view.sheet + 1} von ${production.n} – Seiten ${sheet.pageRanges}`;
  const note = $('schema-creep');
  if (production.binding === 'saddle' && production.n > 1) {
    note.hidden = false;
    note.innerHTML =
      sheet.creep > 0
        ? `Verdrängung: Seiteninhalt um <strong>${fmtMm(sheet.creep)}</strong> zum Bund verschoben (Darstellung ${CREEP_EXAG}-fach überhöht). Der violette Streifen markiert den Bund jeder Seite.`
        : 'Verdrängung: 0 mm – Bogen 1 liegt außen. Innere Bogen werden zum Bund hin verschoben. Der violette Streifen markiert den Bund jeder Seite.';
  } else {
    note.hidden = true;
  }
}

function renderOverview() {
  const tbody = $('sheet-overview');
  tbody.replaceChildren();
  const saddle = production.binding === 'saddle';
  production.sheets.forEach((sheet, s) => {
    const tr = document.createElement('tr');
    const position = saddle
      ? s === 0
        ? production.n === 1
          ? 'einziger Bogen'
          : 'außen'
        : s === production.n - 1
          ? 'innen (Mitte)'
          : `${s + 1}. von außen`
      : `${s + 1}. im Stapel`;
    tr.innerHTML = `<td><i class="dot" style="background:${SHEET_COLORS[s % SHEET_COLORS.length]}"></i>Bogen ${s + 1}</td>
      <td>${sheet.pageRanges}</td><td>${position}</td><td>${saddle ? fmtMm(sheet.creep) : '–'}</td>`;
    tr.classList.toggle('active', view.sheet === s);
    tr.title = 'Bogen anzeigen';
    tr.addEventListener('click', () => selectView('sheet', s));
    tbody.appendChild(tr);
  });
}

// --- Falzschritte ---------------------------------------------------------------

const stepsEl = $('steps');

function optionsHtml(options, selected) {
  return options
    .map(([value, text]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${text}</option>`)
    .join('');
}

function renderSteps() {
  stepsEl.replaceChildren();
  // scheme.folds: Einstellungen (model.folds[k].moving ist dagegen die Liste der bewegten Felder)
  scheme.folds.forEach((fold, k) => {
    const li = document.createElement('li');
    li.title = `Bis einschließlich ${fold.name} falzen`;
    const halves = ['negative', 'positive'].map((m) => [m, halfName(fold.orientation, m)]);
    const dirs = ['down', 'up'].map((d) => [d, directionName(d)]);
    li.innerHTML = `<strong>${fold.name}</strong><span>${fold.label}</span>
      <div class="fold-opts">
        <select data-field="moving" aria-label="${fold.name}: bewegte Hälfte">${optionsHtml(halves, fold.moving)}</select>
        <select data-field="direction" aria-label="${fold.name}: Richtung">${optionsHtml(dirs, fold.direction)}</select>
      </div>`;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.fold-opts')) return;
      goTo(k + 1);
    });
    li.querySelectorAll('select').forEach((sel) =>
      sel.addEventListener('change', () => {
        foldSettings[k] = { ...foldSettings[k], [sel.dataset.field]: sel.value };
        applyProduct();
      }),
    );
    stepsEl.appendChild(li);
  });
}

$('btn-fold-default').addEventListener('click', () => {
  foldSettings = DEFAULT_FOLD_SETTINGS.map((f) => ({ ...f }));
  applyProduct();
});

// --- Falzanimation --------------------------------------------------------------

function goTo(target) {
  state.playingAll = false;
  state.target = Math.max(0, Math.min(FOLDS, target));
}

$('btn-next').addEventListener('click', () => goTo(Math.floor(state.target + 1e-6) + 1));
$('btn-prev').addEventListener('click', () => goTo(Math.ceil(state.target - 1e-6) - 1));
$('btn-reset').addEventListener('click', () => {
  goTo(0);
  state.t = 0;
  closeBookNow();
});
$('btn-play').addEventListener('click', () => {
  if (state.playingAll) {
    state.playingAll = false;
    state.target = state.t;
    return;
  }
  if (state.t >= FOLDS - 1e-6) {
    state.t = 0;
    closeBookNow();
  }
  state.target = FOLDS;
  state.playingAll = true;
});
$('scrub').addEventListener('input', (e) => {
  state.playingAll = false;
  state.t = state.target = Number(e.target.value);
  closeBookNow();
});
$('speed').addEventListener('change', (e) => (state.speed = Number(e.target.value)));

// --- Zusammentragen -------------------------------------------------------------

$('btn-asm-play').addEventListener('click', () => {
  const end = assemblyEnd();
  if (Math.abs(state.aTarget - state.a) > 1e-6 && state.aTarget === end) {
    state.aTarget = state.a; // anhalten
    return;
  }
  if (state.a >= end - 1e-6) {
    closeBookNow();
    state.a = 0;
  }
  state.aTarget = end;
});
$('btn-asm-reset').addEventListener('click', () => {
  closeBookNow();
  state.a = state.aTarget = 0;
});
$('asm-scrub').addEventListener('input', (e) => {
  closeBookNow();
  state.a = state.aTarget = Number(e.target.value);
});

// --- Seite / Kamera -------------------------------------------------------------

function setSide(side) {
  state.flipTarget = side === 'back' ? Math.PI : 0;
  $('btn-front').classList.toggle('active', side === 'front');
  $('btn-back').classList.toggle('active', side === 'back');
  $('btn-front').setAttribute('aria-pressed', side === 'front');
  $('btn-back').setAttribute('aria-pressed', side === 'back');
}
$('btn-front').addEventListener('click', () => setSide('front'));
$('btn-back').addEventListener('click', () => setSide('back'));

$('btn-camera').addEventListener('click', () => {
  state.cameraTarget = null;
  camera.position.copy(isBrowsing() ? READING_CAMERA : DEFAULT_CAMERA);
  controls.target.set(0, 0, 0);
});
// Sobald der Benutzer die Kamera selbst bewegt, keine automatische Kamerafahrt mehr
controls.addEventListener('start', () => (state.cameraTarget = null));

// --- Blättern ---------------------------------------------------------------

const leafCount = () => (view.mode === 'book' ? production.totalLeaves : LEAVES_PER_SHEET);

/** Kann geblättert werden? (Bogen fertig gefalzt bzw. Produkt fertig) */
function canBrowse() {
  if (view.mode === 'book') {
    const end = assemblyEnd();
    return state.a >= end - 1e-6 && state.aTarget >= end - 1e-6;
  }
  return state.t >= FOLDS - 1e-6 && state.target >= FOLDS - 1e-6;
}
const isBrowsing = () => canBrowse() && (state.book > 1e-6 || state.bookTarget > 0);

function closeBookNow() {
  state.book = state.bookTarget = 0;
}

function turnTo(target) {
  if (!canBrowse()) return;
  const k = Math.max(0, Math.min(leafCount(), target));
  if (k > 0 && !isBrowsing()) {
    // Beim Aufschlagen in die Leseansicht wechseln (Seite 1 zum Betrachter)
    setSide(model.viewSign > 0 ? 'front' : 'back');
    state.cameraTarget = READING_CAMERA.clone();
    controls.target.set(0, 0, 0);
  }
  state.bookTarget = k;
}
const currentLeaf = () => Math.round(state.bookTarget);

/** Aufgeschlagene Seiten nach k umgeblätterten Blättern (globale Seitenzahlen). */
function visiblePages(k) {
  if (view.mode === 'book') return openPages(model, k, production.totalLeaves);
  // Einzelner Bogen: Blatt in Lage L hat die globale Position leaf
  const sheet = production.sheets[view.sheet];
  const leafOfLayer = (L) => sheet.panels.find((p) => p.layer === L).leaf;
  return {
    left: k > 0 ? 2 * leafOfLayer(k - 1) + 2 : null,
    right: k < LEAVES_PER_SHEET ? 2 * leafOfLayer(k) + 1 : null,
  };
}

$('btn-page-next').addEventListener('click', () => turnTo(currentLeaf() + 1));
$('btn-page-prev').addEventListener('click', () => turnTo(currentLeaf() - 1));
$('btn-page-first').addEventListener('click', () => turnTo(0));
$('btn-page-last').addEventListener('click', () => turnTo(leafCount()));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  const actions = {
    ArrowRight: () => turnTo(currentLeaf() + 1),
    ArrowLeft: () => turnTo(currentLeaf() - 1),
    Home: () => turnTo(0),
    End: () => turnTo(leafCount()),
  };
  if (actions[e.key] && canBrowse()) {
    e.preventDefault();
    actions[e.key]();
  }
});

// Klick auf das Produkt: rechts vom Bund = vorblättern, links = zurückblättern
const raycaster = new THREE.Raycaster();
const pointerDown = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => pointerDown.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!canBrowse() || pointerDown.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const visible = leafObjects.filter((o) => o.visible);
  const hit = raycaster.intersectObjects(visible, true).find((h) => h.object.isMesh);
  if (!hit) return;
  const local = sheetGroup.worldToLocal(hit.point.clone());
  const forward = (local.x - model.book.spineX) * foreEdgeDirection(model) > 0;
  turnTo(currentLeaf() + (forward ? 1 : -1));
});

// --- Anzeige --------------------------------------------------------------------

function updateUi(pose) {
  const t = state.t;
  const n = production.n;

  if (view.mode === 'sheet') {
    const active = t < FOLDS ? Math.floor(t) : -1;
    [...stepsEl.children].forEach((li, k) => {
      li.classList.toggle('done', t >= k + 1 - 1e-6);
      li.classList.toggle('active', k === active && t > k + 1e-6);
    });
    const moving = Math.abs(state.target - t) > 1e-6;
    let text;
    if (t <= 1e-6) text = `Flacher Druckbogen ${view.sheet + 1} – 16 Seiten auf 8 Feldern je Seite.`;
    else if (state.target < t && state.book > 1e-6) text = 'Bogen wird zugeklappt …';
    else if (t >= FOLDS - 1e-6 && isBrowsing()) text = 'Blättern im gefalzten Bogen (gedanklich an Kopf und Vorderschnitt beschnitten).';
    else if (t >= FOLDS - 1e-6)
      text =
        model.viewSign > 0
          ? 'Fertig gefalzt: 8 Blätter = 16 Seiten. Bund links, Kopf oben.'
          : 'Fertig gefalzt. Die erste Seite des Bogens liegt hinten – Ansicht „Rückseite“ zeigt sie mit Bund links.';
    else if (moving) text = `${model.folds[Math.floor(t)].name} läuft …`;
    else text = `Angehalten in ${model.folds[Math.floor(t)].name}.`;
    $('status').textContent = text;
    $('btn-play').textContent = state.playingAll ? '⏸ Anhalten' : '▶ Alle Falze abspielen';
    $('btn-prev').disabled = state.target <= 1e-6;
    $('btn-next').disabled = state.target >= FOLDS - 1e-6;
    $('scrub').value = t;
  } else {
    const a = state.a;
    const saddle = production.binding === 'saddle';
    const end = assemblyEnd();
    let text;
    if (a <= 1e-6) text = `${n} gefalzte ${n === 1 ? 'Bogen liegt' : 'Bogen liegen'} bereit.`;
    else if (a < n) {
      const s = n - 1 - Math.floor(a);
      text = saddle
        ? `Bogen ${s + 1} wird aufgeschlagen und ${s === n - 1 ? 'auf den Sammelsattel gelegt' : 'um die inneren Bogen gelegt'} …`
        : `Bogen ${s + 1} wird ${s === n - 1 ? 'als unterster Bogen abgelegt' : 'auf den Stapel gelegt'} …`;
    } else if (a < end - 1e-6) {
      const f = pose?.f ?? 0;
      if (saddle) {
        if (f < 0.4) text = 'Produkt wird geschlossen – die inneren Bogen stehen am Vorderschnitt über (Verdrängung) …';
        else if (f < 0.6) text = 'Heften: zwei Drahtklammern durch den Rücken …';
        else text = 'Beschnitt: der Überstand am Vorderschnitt wird abgeschnitten …';
      } else text = 'Rücken wird gefräst und verklebt …';
    } else
      text = `Fertig: ${production.pages} Seiten aus ${n} Bogen, ${BINDINGS[production.binding]}. ${
        saddle && n > 1
          ? 'Dank Verdrängungsausgleich steht der Inhalt nach dem Beschnitt auf allen Seiten gleich.'
          : ''
      }`;
    $('assembly-status').textContent = text;
    const running = Math.abs(state.aTarget - a) > 1e-6;
    $('btn-asm-play').textContent = running && state.aTarget === end ? '⏸ Anhalten' : '▶ Zusammentragen abspielen';
    $('asm-scrub').value = a;
  }

  // Blättern
  const browse = canBrowse();
  const leaf = currentLeaf();
  const pagesEl = $('book-pages');
  $('browse-title').textContent = view.mode === 'book' ? 'Blättern im Endprodukt' : `Blättern im Bogen ${view.sheet + 1}`;
  if (browse) {
    const { left, right } = visiblePages(leaf);
    pagesEl.textContent =
      left === null ? `Vorne: Seite ${right}` : right === null ? `Hinten: Seite ${left}` : `Seite ${left} | ${right}`;
  } else {
    pagesEl.textContent = view.mode === 'book' ? 'erst nach dem Zusammentragen' : 'erst nach dem 3. Falz';
  }
  pagesEl.classList.toggle('disabled', !browse);
  $('btn-page-prev').disabled = !browse || leaf <= 0;
  $('btn-page-first').disabled = !browse || leaf <= 0;
  $('btn-page-next').disabled = !browse || leaf >= leafCount();
  $('btn-page-last').disabled = !browse || leaf >= leafCount();
  $('book-hint').textContent = browse
    ? 'Auch mit den Pfeiltasten ← → oder per Klick auf die rechte bzw. linke Seite.'
    : view.mode === 'book'
      ? 'Zuerst „Zusammentragen abspielen“.'
      : 'Zuerst alle Falze ausführen.';

  // Im Schema den nächsten bzw. laufenden Falz hervorheben
  const highlight = view.mode === 'sheet' && t < FOLDS ? Math.floor(t) : -1;
  document.querySelectorAll('[data-fold]').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.fold) === highlight);
  });
}

// ---------------------------------------------------------------------------
// Render-Schleife
// ---------------------------------------------------------------------------

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

const clock = new THREE.Clock();
let first = true;

function approach(value, target, delta) {
  const diff = target - value;
  if (Math.abs(diff) <= delta) return target;
  return value + Math.sign(diff) * delta;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const FOLD_SECONDS = 1.8; // Dauer eines Falzes bei normaler Geschwindigkeit
  const LEAF_SECONDS = 0.9; // Dauer eines Umblätterns
  const SHEET_SECONDS = 2.2; // Dauer des Zusammentragens eines Bogens

  // Soll wieder aufgefalzt / auseinandergenommen werden, zuerst zuklappen
  if (view.mode === 'sheet' && state.target < state.t - 1e-9 && state.book > 1e-6) state.bookTarget = 0;
  if (view.mode === 'book' && state.aTarget < state.a - 1e-9 && state.book > 1e-6) state.bookTarget = 0;

  // Blättern (bei großen Sprüngen schneller)
  const bookDiff = Math.abs(state.bookTarget - state.book);
  if (bookDiff > 1e-6) {
    state.book = approach(state.book, state.bookTarget, ((dt * state.speed) / LEAF_SECONDS) * Math.max(1, bookDiff / 2));
  }

  let matrices;
  let objects;
  let pose = null;
  if (view.mode === 'sheet') {
    if (state.book <= 1e-6) {
      if (Math.abs(state.target - state.t) > 1e-6) state.t = approach(state.t, state.target, (dt * state.speed) / FOLD_SECONDS);
      else state.playingAll = false;
    }
    objects = sheetObjects[view.sheet];
    matrices = sheetPose(state.t, state.book);
  } else {
    if (state.book <= 1e-6 && Math.abs(state.aTarget - state.a) > 1e-6) {
      state.a = approach(state.a, state.aTarget, (dt * state.speed) / SHEET_SECONDS);
    }
    pose = bookPose(state.a, state.book);
    objects = leafObjects;
    matrices = pose.matrices;
  }

  for (const obj of leafObjects) obj.visible = false;
  objects.forEach((o) => (o.visible = true));
  applyMatrices(objects, matrices);
  updateFoldLines(state.t);
  updateFastening(pose);
  updateSpineStrips(pose?.protrusions);

  // Objekt in der Bildmitte halten (sanft nachführen) und passend zoomen
  const box = stateBounds(matrices);
  const c = centerOf(box);
  if (first) state.center.copy(c);
  else state.center.lerp(c, 1 - Math.exp(-dt * 4));
  sheetGroup.position.copy(state.center).multiplyScalar(-1);
  const extent = Math.max(box.maxX - box.minX, (box.maxY - box.minY) * 1.4);
  // Kleiner als der Bogen: behutsam heranzoomen; größer (Bogenreihe beim Zusammentragen): ganz einpassen
  const ratio = (scheme.cols * PAGE_W) / extent;
  const zoomTarget = ratio < 1 ? ratio * 0.85 : Math.min(2.2, Math.sqrt(ratio));
  state.zoom = first ? zoomTarget : state.zoom + (zoomTarget - state.zoom) * (1 - Math.exp(-dt * 3));
  flipGroup.scale.setScalar(state.zoom);

  // Wenden
  state.flip += (state.flipTarget - state.flip) * (1 - Math.exp(-dt * 5));
  if (Math.abs(state.flipTarget - state.flip) < 1e-4) state.flip = state.flipTarget;
  flipGroup.rotation.y = state.flip;

  // Automatische Kamerafahrt (z. B. in die Leseansicht)
  if (state.cameraTarget) {
    camera.position.lerp(state.cameraTarget, 1 - Math.exp(-dt * 3));
    if (camera.position.distanceTo(state.cameraTarget) < 0.5) state.cameraTarget = null;
  }

  controls.update();
  scene.updateMatrixWorld();
  updateClipping(pose?.trims);
  updateUi(pose);
  renderer.render(scene, camera);
  first = false;
  requestAnimationFrame(frame);
}

// Start
applyProduct();
selectView('sheet', 0);
requestAnimationFrame(frame);

// Für Tests / Debugging
window.falzschema = {
  get model() {
    return model;
  },
  get production() {
    return production;
  },
  state,
  view,
  goTo,
  setSide,
  turnTo,
  selectView,
  setProduct(p) {
    Object.assign(product, p);
    $('page-count').value = String(product.pages);
    $('binding').value = product.binding;
    $('caliper').value = product.caliper.toFixed(2);
    applyProduct();
  },
  setFold(k, settings) {
    foldSettings[k] = { ...foldSettings[k], ...settings };
    applyProduct();
  },
};
