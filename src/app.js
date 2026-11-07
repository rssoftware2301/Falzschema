import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import {
  CIP4_CATALOG,
  BINDINGS,
  SHEET_PAGE_COUNTS,
  DEFAULT_SCHEMES,
  catalogEntry,
  computeSignature,
  computeProduction,
  suggestGroups,
  validPageTotal,
  pageStep,
  describeEntry,
  foldText,
  sheetLayout,
  bookLeafMatrix,
  bookAxisZ,
  signatureAxisZ,
  turnCanonical,
  panelMatrixAt,
  openPages,
  pageRotation,
  transformPoint,
  multiply,
  translation,
  creases,
  rotation,
  computeCover,
  resolveFormat,
  sheetImposition,
  coverBleed,
} from './falzschema.js';
import { buildCatalogExport } from './catalog-export.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

// Endformat in Darstellungseinheiten (Leseansicht): die längere Seite hat 99 Einheiten,
// das Verhältnis folgt dem gewählten Endformat (siehe applyFormat)
let PAGE_W = 70;
let PAGE_H = 99;
let MM_PER_UNIT = 148 / 70;
const REF_WIDTH = 280; // Bezugsbreite für die automatische Zoomanpassung
const MAX_PAGES = 2000; // z. B. 572 Seiten = 286 Einzelblätter im Digitaldruck
const MAX_GROUP_COUNT = 1000; // Bogen je Bogengruppe
const CHIP_LIMIT = 12; // mehr Bogen: Auswahlliste statt Schaltflächen
// Papierstärke in der Darstellung (überzeichnet; bei vielen Blättern dünner)
const displayThickness = (pages) =>
  pages <= 32 ? 1.2 : pages <= 64 ? 0.75 : pages <= 128 ? 0.5 : pages <= 256 ? 0.3 : pages <= 640 ? 0.2 : 0.1;
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
const sheetColor = (s) => SHEET_COLORS[s % SHEET_COLORS.length];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const fmtMm = (v) => `${v.toFixed(2).replace('.', ',')} mm`;
const fmtNum = (v) => (Math.round(v * 10) / 10).toLocaleString('de-AT', { maximumFractionDigits: 1 });
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------------------
// Modell
// ---------------------------------------------------------------------------

const product = {
  format: { key: 'A5', orientation: 'portrait', width: 148, height: 210 },
  bleed: { enabled: false, mm: 3 }, // Kern abfallend: Überfüller
  milling: 3, // Fräsrand am Bund (Klebebindung)
  cover: { enabled: false, caliper: 0.3, flapLeft: 0, flapRight: 0, bleed: false, bleedMm: 3 },
  pages: 16,
  binding: 'saddle',
  caliper: 0.1,
  groups: [{ count: 1, scheme: 'F16-7' }],
};
let production;
let BOOK_AXIS_Z = 0;
let coverData = null; // Maße des Umschlags (mm) oder null
let format = resolveFormat(product.format); // Endformat in mm { width, height, label }

/** Endformat übernehmen: Darstellungsmaße der Seite daraus ableiten. */
function applyFormat() {
  format = resolveFormat(product.format);
  const k = 99 / Math.max(format.width, format.height);
  PAGE_W = format.width * k;
  PAGE_H = format.height * k;
  MM_PER_UNIT = 1 / k;
}

/** Umschlag nur bei Klebebindung. */
const hasCover = () => product.binding === 'perfect' && product.cover.enabled;

const sigOptions = () => ({ pageWidth: PAGE_W, pageHeight: PAGE_H, thickness: displayThickness(product.pages) });

/** Berechnet die Produktion; liefert Fehlerliste (leer = übernommen). */
function computeAll() {
  const prod = computeProduction(product.groups, {
    binding: product.binding,
    caliper: product.caliper,
    pages: product.pages,
    ...sigOptions(),
  });
  if (prod.errors.length) return prod.errors;
  production = prod;
  BOOK_AXIS_Z = bookAxisZ(production);
  return [];
}

const sheetOf = (s = view.sheet) => production.sheets[s];
const sigOf = (s = view.sheet) => production.sheets[s].sig;
const foldsOf = (s = view.sheet) => sigOf(s).folds.length;

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

const invert = (m) => new THREE.Matrix4().fromArray(m).invert().toArray();

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

/**
 * Zeichnet eine Bogenseite maßstabsgetreu in mm: Felder mit Überfüller (orange) bzw.
 * Fräsrand (violett), Endformat mit Schnittlinien, Seitenzahl (im Feld gedreht),
 * Kopfmarke, Bund, Satzspiegel (um die Verdrängung zum Bund verschoben) und Falzlinien.
 */
function renderSheetSvg(svg, sig, panels, side, { shift = 0, imp } = {}) {
  imp = imp ?? sheetImposition(sig, panels, { page: format, binding: 'saddle', bleed: 0 });
  const W = imp.width;
  const H = imp.height;
  const unit = Math.max(format.width, format.height) / 99; // Bezug für Strichstärken und Schriften
  const m = 22 * unit;
  svg.setAttribute('viewBox', `0 0 ${W + 2 * m} ${H + 2 * m + 10 * unit}`);
  svg.replaceChildren();
  const mx = (x, w = 0) => (side === 'back' ? W - x - w : x) + m; // Rückseite umgeschlagen
  const my = (y) => y + m;
  const byPanel = new Map(imp.cells.map((c) => [c.panel, c]));
  const sw = (v) => `stroke-width:${v * unit}px`;

  sheetLayout(sig, side, panels).forEach((line) => {
    line.forEach((cell) => {
      const g0 = byPanel.get(cell.panel);
      // Zugaben: auf der Rückseite sind links und rechts vertauscht
      const ml = side === 'back' ? { left: g0.m.right, right: g0.m.left } : { left: g0.m.left, right: g0.m.right };
      const tl = side === 'back' ? { left: g0.types.right, right: g0.types.left } : { left: g0.types.left, right: g0.types.right };
      const x = mx(g0.x, g0.w);
      const y = my(g0.y);
      const area = (type) => (type === 'spine' ? 'mill-area' : 'bleed-area');
      // Zugaben als Streifen
      if (ml.left > 0) svgEl('rect', { x, y, width: ml.left, height: g0.h, class: area(tl.left) }, svg);
      if (ml.right > 0) svgEl('rect', { x: x + g0.w - ml.right, y, width: ml.right, height: g0.h, class: area(tl.right) }, svg);
      if (g0.m.top > 0) svgEl('rect', { x, y, width: g0.w, height: g0.m.top, class: area(g0.types.top) }, svg);
      if (g0.m.bottom > 0) svgEl('rect', { x, y: y + g0.h - g0.m.bottom, width: g0.w, height: g0.m.bottom, class: area(g0.types.bottom) }, svg);
      // Endformat (beschnittene Seite)
      const tx = mx(g0.trim.x, g0.trim.w);
      const ty = my(g0.trim.y);
      const cw = g0.trim.w;
      const ch = g0.trim.h;
      svgEl('rect', { x: tx, y: ty, width: cw, height: ch, class: `sheet-cell ${side}`, style: sw(0.6) }, svg);
      const cx = tx + cw / 2;
      const cy = ty + ch / 2;
      // Inhalt aufrecht (Seitenkoordinaten) um die Seitenmitte zeichnen, dann drehen
      const quarter = cell.rotation % 180 !== 0;
      const pw = quarter ? ch : cw;
      const ph = quarter ? cw : ch;
      const px = cx - pw / 2;
      const py = cy - ph / 2;
      const g = svgEl('g', { transform: `rotate(${cell.rotation} ${cx} ${cy})` }, svg);
      const spineLeft = cell.page % 2 === 1;
      const bar = 2.5 * unit;
      svgEl('rect', { x: spineLeft ? px : px + pw - bar, y: py, width: bar, height: ph, class: 'spine-mark' }, g);
      const content = svgEl('g', { transform: `translate(${spineLeft ? -shift : shift} 0)` }, g);
      svgEl('rect', { x: px + pw * 0.1, y: py + ph * 0.13, width: pw * 0.8, height: ph * 0.78, class: 'satzspiegel', style: sw(0.6) }, content);
      svgEl('rect', { x: cx - pw * 0.26, y: py + ph * 0.05, width: pw * 0.52, height: 4 * unit, rx: 1.5 * unit, class: 'page-head' }, content);
      const fontSize = Math.min(pw * (cell.page >= 100 ? 0.34 : 0.43), ph * 0.34);
      const t = svgEl('text', { x: cx, y: cy, class: 'page-no', style: `font-size:${fontSize}px` }, content);
      t.textContent = cell.page;
      if (needsUnderline(cell.page)) {
        const w = String(cell.page).length * fontSize * 0.55;
        svgEl('rect', { x: cx - w / 2, y: cy + fontSize / 2, width: w, height: 2 * unit, class: 'page-underline' }, content);
      }
      const title = svgEl('title', {}, g);
      title.textContent = `Seite ${cell.page}${cell.rotation ? ` (um ${cell.rotation}° gedreht)` : ''}`;
    });
  });

  svgEl('rect', { x: m, y: m, width: W, height: H, class: 'sheet-outline', style: sw(1.2) }, svg);

  // Falzlinien mit Nummer des Falzschritts: Lage aus dem Raster in mm umrechnen
  const sheetUW = sig.cols * sig.cellW;
  const sheetUH = sig.rows * sig.cellH;
  const toX = (x) => imp.colX[Math.round((x + sheetUW / 2) / sig.cellW)];
  const toY = (y) => imp.rowY[Math.round((sheetUH / 2 - y) / sig.cellH)];
  const used = new Set();
  const r = 7 * unit;
  creases(sig).forEach((segs, k) => {
    for (const [[x1, y1], [x2, y2]] of segs) {
      const a = [mx(toX(x1)), my(toY(y1))];
      const b = [mx(toX(x2)), my(toY(y2))];
      svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'crease', 'data-fold': k, style: `${sw(1.4)};stroke-dasharray:${5 * unit} ${3 * unit}` }, svg);
      const vertical = Math.abs(a[0] - b[0]) < 1e-6;
      const end = vertical ? (a[1] < b[1] ? a : b) : a[0] < b[0] ? a : b;
      const pos = vertical ? [end[0], end[1] - 1.4 * r] : [end[0] - 1.4 * r, end[1]];
      const key = pos.map((v) => Math.round(v)).join(',');
      if (used.has(key)) continue;
      used.add(key);
      const g = svgEl('g', { class: 'crease-label', 'data-fold': k }, svg);
      svgEl('circle', { cx: pos[0], cy: pos[1], r, style: sw(1.4) }, g);
      const t = svgEl('text', { x: pos[0], y: pos[1], style: `font-size:${9 * unit}px` }, g);
      t.textContent = k + 1;
    }
  });

  // Maß des Falzbogens
  const dim = svgEl('text', { x: m + W / 2, y: m + H + 14 * unit, class: 'sheet-dim', style: `font-size:${9 * unit}px` }, svg);
  dim.textContent = `Falzbogen ${fmtNum(W)} × ${fmtNum(H)} mm`;
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

// flipGroup: Ausrichtung (Vorder-/Rückseite, Leseansicht); sheetGroup: hält das Objekt in der Bildmitte
const flipGroup = new THREE.Group();
const sheetGroup = new THREE.Group();
flipGroup.add(sheetGroup);
scene.add(flipGroup);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

function pageTexture({ page, rotation, side, shift, label, cellW, cellH, scale }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cellW * scale);
  canvas.height = Math.round(cellH * scale);
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
  const size = Math.min(ph * (page >= 100 ? 0.24 : 0.3), pw * (page >= 100 ? 0.34 : 0.43));
  ctx.font = `700 ${Math.round(size)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(page), 0, ph * 0.02);
  if (needsUnderline(page)) {
    const tw = ctx.measureText(String(page)).width;
    ctx.fillRect(-tw / 2, ph * 0.02 + size / 2 + ph * 0.01, tw, ph * 0.018);
  }
  ctx.font = `500 ${Math.round(ph * 0.04)}px system-ui, sans-serif`;
  ctx.fillStyle = '#5d6878';
  ctx.fillText(`${label} · ${side === 'front' ? 'Schöndruck' : 'Widerdruck'}`, 0, ph * 0.36);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

const FACE_OFFSET = 0.08; // Abstand Vorder-/Rückseite eines Blattes (kleiner als jede Lagenstärke)
const spineStripGeometry = new THREE.PlaneGeometry(1, 1);
const spineStripMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f4f8, roughness: 0.92, side: THREE.DoubleSide });
const geometryCache = new Map();
function cellGeometry(w, h) {
  const key = `${w}x${h}`;
  if (!geometryCache.has(key)) {
    const plane = new THREE.PlaneGeometry(w, h);
    geometryCache.set(key, { plane, edges: new THREE.EdgesGeometry(plane) });
  }
  return geometryCache.get(key);
}

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
  const total = production.totalLeaves;
  // Texturgröße so begrenzen, dass alle Seiten zusammen etwa 64 MB Grafikspeicher brauchen
  const scale = Math.max(1, Math.min(6, Math.sqrt(64e6 / (PAGE_W * PAGE_H * 4 * 1.34 * 2 * total))));
  production.sheets.forEach((sheet, s) => {
    const sig = sheet.sig;
    const shift = creepUnits(s);
    const { plane, edges } = cellGeometry(sig.cellW, sig.cellH);
    const label = `Bogen ${s + 1}`;
    sheetObjects[s] = sheet.panels.map((p) => {
      // Richtung Vorderschnitt in Blattkoordinaten (kanonisch +x)
      const c = sig.canonical[p.id];
      const foreLocal = new THREE.Vector3(c[0], c[4], c[8]).normalize();
      const clipPlane = new THREE.Plane();
      // Beschnitt-Ebene nur bei Sammelheftung nötig (spart bei vielen Blättern Rechenzeit)
      const clipping = production.binding === 'saddle' ? [clipPlane] : [];
      const material = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, clippingPlanes: clipping });
      const tex = (face, side) =>
        pageTexture({ page: face.page, rotation: pageRotation(face.up, side), side, shift, label, cellW: sig.cellW, cellH: sig.cellH, scale });

      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const front = new THREE.Mesh(plane, material(tex(p.front, 'front')));
      front.position.z = FACE_OFFSET;
      // Rückseite: Ebene um die y-Achse gewendet -> Texturkoordinate u zeigt nach -x,
      // das entspricht der Blickrichtung auf die umgeschlagene Rückseite.
      const back = new THREE.Mesh(plane, material(tex(p.back, 'back')));
      back.rotation.y = Math.PI;
      back.position.z = -FACE_OFFSET;
      const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: sheetColor(s), clippingPlanes: clipping }));
      // Papierstreifen am Bund: füllt bei der Verdrängung (Blatt nach außen versetzt) die Lücke zum Rücken
      const strip = new THREE.Mesh(spineStripGeometry, spineStripMaterial);
      strip.visible = false;
      g.add(front, back, outline, strip);
      g.userData = { sheet: s, panel: p.id, leaf: p.leaf, w: sig.cellW, h: sig.cellH, foreLocal, clipPlane, localPlane: new THREE.Plane(), strip };
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
const glue = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe9d9a8, roughness: 0.6 }));
sheetGroup.add(glue);

const tmpMatrix = new THREE.Matrix4();

/** Begrenzungsquader; items = [{ m, w, h }] (Matrix und Feldgröße). */
function bounds(items) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { m, w, h } of items) {
    for (const [x, y] of [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
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
  if (view.mode !== 'sheet' || k >= foldsOf()) {
    foldLines.forEach((l) => (l.visible = false));
    return;
  }
  const sig = sigOf();
  const fold = sig.folds[k];
  const box = bounds(sig.matrices[k].map((m) => ({ m, w: sig.cellW, h: sig.cellH })));
  const zs = [box.maxZ + sig.thickness, box.minZ - sig.thickness];
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
  // Bogenansicht: t läuft von 0 (flach) bis Anzahl Falze (gefalzt)
  t: 0,
  target: 0,
  playingAll: false,
  // Endprodukt: a läuft von 0 (Bogen liegen bereit) bis n (alle zusammengetragen) bis n+1 (fertig)
  a: 0,
  aTarget: 0,
  speed: 1,
  side: 'front', // Vorder- oder Rückseite
  reading: false, // Bogenansicht: in Leseansicht (Bund links, Kopf oben) gedreht
  center: new THREE.Vector3(),
  zoom: 1,
  // Blättern: book = Anzahl umgeblätterter Blätter (stetig für die Animation)
  book: 0,
  bookTarget: 0,
  cameraTarget: null, // laufende Kamerafahrt (Vector3) oder null
};

const assemblyEnd = () => production.n + 1 + (hasCover() ? 1 : 0);

/** Lage der Blätter des gewählten Bogens in der Bogenansicht. */
function sheetPose(t, book) {
  const sig = sigOf();
  const n = sig.folds.length;
  const step = Math.min(Math.floor(t), n);
  const progress = ease(t - step);
  if (step >= n && book > 0) {
    // Blättern im kanonischen System, zurück in Bogenkoordinaten
    const inv = sig.inverseCanonical ?? (sig.inverseCanonical = invert(sig.canonicalTransform));
    const axis = signatureAxisZ(sig);
    return sig.panels.map((p, i) => multiply(inv, turnCanonical(sig.canonical[i], ease(clamp01(book - p.layer)), axis)));
  }
  return sig.panels.map((p, i) => panelMatrixAt(sig, i, step, progress));
}

/**
 * Lage aller Blätter im Endprodukt (kanonisches System: Bund bei x = 0) in Abhängigkeit
 * vom Fortschritt a des Zusammentragens und vom Blättern.
 */
function bookPose(a, book) {
  const n = production.n;
  const saddle = production.binding === 'saddle';
  const f = clamp01(a - n); // Abschluss: Schließen / Heften / Kleben / Beschnitt
  // Sammelheftung: eingesteckte Bogen liegen aufgeschlagen (vordere Hälfte umgelegt),
  // am Ende wird das Produkt geschlossen.
  const openTurn = saddle ? 1 - ease(clamp01(f / 0.4)) : 0;
  const fasten = saddle ? ease(clamp01((f - 0.4) / 0.2)) : ease(clamp01(f / 0.6));
  const trim = saddle ? ease(clamp01((f - 0.6) / 0.4)) : 0;
  // Bereitstellung der gefalzten Bogen rechts neben dem Produkt: bis 16 Bogen in Reihen zu 8,
  // bei mehr Bogen als Stapel (der nächste Bogen liegt oben)
  const slot = (i) =>
    n <= 16
      ? [2 * PAGE_W + 40 + (i % 8) * (PAGE_W + 14), -Math.floor(i / 8) * (PAGE_H + 24), 0]
      : [2 * PAGE_W + 40, 0, -pileDepth[i]];

  const matrices = [];
  const trims = [];
  const protrusions = [];
  for (const leaf of production.leaves) {
    const s = leaf.sheet;
    const sig = production.sheets[s].sig;
    const i = n - 1 - s; // Reihenfolge: innerster bzw. unterster Bogen zuerst
    const q = clamp01(a - i);
    const base = sig.canonical[leaf.panel];
    const dzBook = bookLeafMatrix(production, leaf)[14] - base[14];
    const front = leaf.layer < sig.leaves / 2;
    const [sx, sy, sz] = slot(i);
    let m;
    if (saddle) {
      // Verdrängung: innere Bogen stehen nach dem Schließen am Vorderschnitt über
      const protrusion = creepUnits(s) * (f > 0 ? 1 - openTurn : 0);
      protrusions[leaf.g] = protrusion;
      const local = multiply(translation(protrusion, 0, 0), base);
      if (q >= 1) {
        m = multiply(translation(0, 0, dzBook), local);
        if (front) m = turnCanonical(m, openTurn, BOOK_AXIS_Z);
      } else {
        // Bogen aufschlagen (in der Bereitstellung), dann unter die eingesteckten Bogen schieben
        const qOpen = ease(clamp01(q / 0.3));
        const qMove = ease(clamp01((q - 0.3) / 0.7));
        m = multiply(translation(0, 0, dzBook * qOpen), local);
        if (front) m = turnCanonical(m, qOpen, BOOK_AXIS_Z);
        const dip = -8 * Math.sin(Math.PI * qMove);
        m = multiply(translation(sx * (1 - qMove), sy * (1 - qMove), sz * (1 - qMove) + dip), m);
      }
    } else if (q >= 1) {
      m = multiply(translation(0, 0, dzBook), base);
    } else {
      // Klebebindung: Bogen wird angehoben und auf den Stapel gelegt
      const e = ease(q);
      const lift = (20 + production.thickness * production.totalLeaves) * Math.sin(Math.PI * q);
      m = multiply(translation(sx * (1 - e), sy * (1 - e), sz * (1 - e) + dzBook * e + lift), base);
    }
    // mit Umschlag wird zuerst die Vorderseite des Umschlags umgeblättert
    if (book > 0) m = turnCanonical(m, ease(clamp01(book - leaf.g - (hasCover() ? 1 : 0))), BOOK_AXIS_Z);
    matrices[leaf.g] = m;
    trims[leaf.g] = saddle ? creepUnits(s) * trim : 0;
  }
  return { matrices, trims, protrusions, fasten, f };
}

// Stapeltiefe der bereitliegenden Bogen (Index = Reihenfolge des Zusammentragens)
let pileDepth = [];
function computePile() {
  pileDepth = [];
  let depth = 0;
  for (let i = 0; i < production.n; i++) {
    pileDepth[i] = depth;
    depth += (production.sheets[production.n - 1 - i].sig.leaves + 1) * production.thickness;
  }
}

// ---------------------------------------------------------------------------
// Umschlag (3D): U1 mit rechter Klappe, Rücken, U4 mit linker Klappe
// ---------------------------------------------------------------------------

const COVER_COLORS = { outside: '#f2d8c2', inside: '#fbfbfb', edge: 0x9a6b4f };
const GLUE_WIDTH = 2.2; // Klebstoffschicht am Rücken (Darstellung)
let coverObjects = []; // [{ key, obj, w, h }]

function coverTexture({ w, h, title, sub, color, scale, vertical = false, flip = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round(w * scale));
  canvas.height = Math.max(8, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#b08a70';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (vertical) ctx.rotate(-Math.PI / 2);
  if (flip) ctx.rotate(Math.PI);
  const span = vertical ? canvas.height : canvas.width;
  const size = Math.min(span * 0.11, (vertical ? canvas.width : canvas.height) * 0.6, 14 * scale);
  ctx.fillStyle = '#5b3a26';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(6, Math.round(size))}px system-ui, sans-serif`;
  ctx.fillText(title, 0, sub && !vertical ? -size * 0.6 : 0);
  if (sub && !vertical) {
    ctx.font = `500 ${Math.max(5, Math.round(size * 0.55))}px system-ui, sans-serif`;
    ctx.fillText(sub, 0, size * 0.6);
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

/** Geometrie des Umschlags im kanonischen System (Bund bei x = 0). */
function coverGeometry() {
  const th = production.thickness;
  const T = production.totalLeaves;
  const ct = Math.max(th * 1.5, 0.5); // Umschlagstärke (Darstellung)
  const zT = th * 0.5; // Oberseite des Buchblocks
  const zB = -(T - 1) * th - th * 0.5; // Unterseite
  const xS = -GLUE_WIDTH - ct / 2; // Ebene des Umschlagrückens (außerhalb der Klebstoffschicht)
  return {
    ct,
    xS,
    zU1: zT + 1.5 * ct,
    zFlapF: zT + 0.5 * ct,
    zU4: zB - 1.5 * ct,
    zFlapB: zB - 0.5 * ct,
    fR: coverData.flapRight / MM_PER_UNIT,
    fL: coverData.flapLeft / MM_PER_UNIT,
  };
}

function disposeCover() {
  for (const { obj } of coverObjects) {
    for (const child of obj.children) {
      child.material.map?.dispose();
      child.material.dispose();
      child.geometry.dispose();
    }
    sheetGroup.remove(obj);
  }
  coverObjects = [];
}

function buildCover() {
  disposeCover();
  if (!coverData) return;
  const g = coverGeometry();
  const W = PAGE_W;
  const H = PAGE_H;
  const panelW = W - g.xS;
  const depth = g.zU1 - g.zU4;
  const spineText = `Rücken ${fmtNum(coverData.spineMm)} mm`;
  const defs = [
    { key: 'front', w: panelW, out: ['U1', 'Vorderseite'], ins: ['U2', 'Innenseite vorne'] },
    { key: 'back', w: panelW, out: ['U4', 'Rückseite'], ins: ['U3', 'Innenseite hinten'] },
    { key: 'spine', w: depth, out: [spineText], ins: ['Rücken innen'], vertical: true },
  ];
  if (g.fR > 0) defs.push({ key: 'flapRight', w: g.fR, out: ['rechte Klappe', `${fmtNum(coverData.flapRight)} mm`], ins: ['Klappe'] });
  if (g.fL > 0) defs.push({ key: 'flapLeft', w: g.fL, out: ['linke Klappe', `${fmtNum(coverData.flapLeft)} mm`], ins: ['Klappe'] });
  for (const d of defs) {
    const geom = new THREE.PlaneGeometry(d.w, H);
    const tex = (side) =>
      coverTexture({
        w: d.w,
        h: H,
        title: side === 'out' ? d.out[0] : d.ins[0],
        sub: side === 'out' ? d.out[1] : d.ins[1],
        color: side === 'out' ? COVER_COLORS.outside : COVER_COLORS.inside,
        scale: 4,
        vertical: d.vertical,
      });
    const obj = new THREE.Group();
    obj.matrixAutoUpdate = false;
    const outside = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: tex('out'), roughness: 0.7 }));
    outside.position.z = 0.05;
    const inside = new THREE.Mesh(geom.clone(), new THREE.MeshStandardMaterial({ map: tex('in'), roughness: 0.9 }));
    inside.rotation.y = Math.PI;
    inside.position.z = -0.05;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geom), new THREE.LineBasicMaterial({ color: COVER_COLORS.edge }));
    obj.add(outside, inside, edge);
    obj.visible = false;
    sheetGroup.add(obj);
    coverObjects.push({ key: d.key, obj, w: d.w, h: H });
  }
}

/** Drehung um eine Scharnierlinie parallel zur y-Achse durch (hx, hz). */
const hinge = (hx, hz, angle) =>
  multiply(translation(hx, 0, hz), multiply(rotation('y', angle), translation(-hx, 0, -hz)));

/**
 * Lage der Umschlagteile: c = Fortschritt der Umschlagphase (0..1), book = Blättern.
 * Ablauf: herangeführt (flach, senkrecht am Rücken) -> Klappen einschlagen -> U1/U4 umlegen.
 */
function coverPose(c, book) {
  const g = coverGeometry();
  const W = PAGE_W;
  const H = PAGE_H;
  const pa = ease(clamp01(c / 0.35));
  const pf = ease(clamp01((c - 0.35) / 0.25));
  const p1 = ease(clamp01((c - 0.6) / 0.4));
  const approach = translation(-(2 * W + 60) * (1 - pa), 0, 0);
  const cx = (g.xS + W) / 2;
  const R1 = hinge(g.xS, g.zU1, (-Math.PI / 2) * (1 - p1));
  const R4 = hinge(g.xS, g.zU4, (Math.PI / 2) * (1 - p1));
  const flipY = rotation('y', Math.PI);
  const turnFront = (m) => (book > 0 ? turnCanonical(m, ease(clamp01(book)), BOOK_AXIS_Z) : m);
  const poses = {
    front: turnFront(multiply(R1, translation(cx, H / 2, g.zU1))),
    flapRight: turnFront(
      multiply(R1, multiply(hinge(W, (g.zU1 + g.zFlapF) / 2, Math.PI * pf), translation(W + g.fR / 2, H / 2, g.zU1))),
    ),
    back: multiply(R4, multiply(translation(cx, H / 2, g.zU4), flipY)),
    flapLeft: multiply(R4, multiply(hinge(W, (g.zU4 + g.zFlapB) / 2, -Math.PI * pf), multiply(translation(W + g.fL / 2, H / 2, g.zU4), flipY))),
    spine: multiply(translation(g.xS, H / 2, (g.zU1 + g.zU4) / 2), rotation('y', -Math.PI / 2)),
  };
  return coverObjects.map(({ key }) => multiply(approach, poses[key]));
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
  const depth = production.thickness * production.totalLeaves + 2;
  staples.forEach((st, i) => {
    st.visible = show && saddle;
    st.position.set(0, PAGE_H / 2 + (i === 0 ? 1 : -1) * PAGE_H * 0.28, BOOK_AXIS_Z);
    st.scale.set(1, Math.max(0.001, pose?.fasten ?? 0), depth);
  });
  glue.visible = show && !saddle;
  glue.position.set(-1.1, PAGE_H / 2, BOOK_AXIS_Z);
  glue.scale.set(1, PAGE_H, Math.max(0.001, depth * (pose?.fasten ?? 0)));
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
    strip.scale.set(w, PAGE_H, 1);
  }
}

function updateClipping(trims) {
  for (const obj of leafObjects) {
    const { foreLocal, clipPlane, localPlane, leaf } = obj.userData;
    const trim = trims ? trims[leaf] : 0;
    // Behalten wird, was höchstens (halbe Seitenbreite - Beschnitt) Richtung Vorderschnitt liegt
    localPlane.set(foreLocal.clone().negate(), PAGE_W / 2 - trim + (trim > 0 ? 0 : 1000));
    clipPlane.copy(localPlane).applyMatrix4(obj.matrixWorld);
  }
}

// ---------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

// --- Register -------------------------------------------------------------------

let activeTab = 'anim';
function selectTab(tab) {
  activeTab = tab;
  for (const [name, btn, panel] of [
    ['anim', 'tab-anim', 'panel-anim'],
    ['schema', 'tab-schema', 'panel-schema'],
    ['cover', 'tab-cover', 'panel-cover'],
    ['catalog', 'tab-catalog', 'panel-catalog'],
  ]) {
    $(btn).classList.toggle('active', name === tab);
    $(btn).setAttribute('aria-selected', name === tab);
    $(panel).hidden = name !== tab;
  }
  if (tab === 'anim') resize();
  if (tab === 'cover') resizeCoverView();
}
$('tab-anim').addEventListener('click', () => selectTab('anim'));
$('tab-schema').addEventListener('click', () => selectTab('schema'));
$('tab-cover').addEventListener('click', () => selectTab('cover'));
$('tab-catalog').addEventListener('click', () => selectTab('catalog'));

// --- Produkt und Bogenaufteilung -------------------------------------------------

$('page-total').value = String(product.pages);
$('binding').value = product.binding;
$('caliper').value = product.caliper.toFixed(2);

$('page-total').addEventListener('change', (e) => {
  product.pages = Number(e.target.value);
  // Passt die bisherige Aufteilung nicht mehr, einen Vorschlag machen
  const sum = product.groups.reduce((s, g) => s + g.count * catalogEntry(g.scheme).pages, 0);
  if (sum !== product.pages && validTotal(product.pages)) product.groups = suggestGroups(product.pages, product.binding);
  renderGroups();
  tryApply();
});
function updatePageInput() {
  const step = pageStep(product.binding);
  $('page-total').step = String(step);
  $('page-total').min = String(step);
}

$('binding').addEventListener('change', (e) => {
  product.binding = e.target.value;
  updatePageInput();
  updateBleedInputs();
  renderGroups();
  tryApply();
});
$('caliper').addEventListener('change', (e) => {
  const v = Number(String(e.target.value).replace(',', '.'));
  product.caliper = Number.isFinite(v) ? Math.min(0.5, Math.max(0.03, v)) : 0.1;
  e.target.value = product.caliper.toFixed(2);
  tryApply();
});

// --- Endformat ---
function updateFormatInputs() {
  const custom = product.format.key === 'custom';
  $('format-key').value = product.format.key;
  $('format-orientation').value = product.format.orientation;
  $('format-orientation').hidden = custom;
  // Breite × Höhe immer anzeigen; bei DIN-Formaten aus der Auswahl übernommen (nicht änderbar)
  let shown = { width: product.format.width, height: product.format.height };
  if (!custom) {
    try {
      shown = resolveFormat(product.format);
    } catch {
      /* ungültig: Eingabe belassen */
    }
  }
  $('format-width').value = String(shown.width);
  $('format-height').value = String(shown.height);
  $('format-width').disabled = !custom;
  $('format-height').disabled = !custom;
}
$('format-key').addEventListener('change', (e) => {
  const key = e.target.value;
  if (key === 'custom') {
    // manuelle Eingabe mit dem bisherigen Format vorbelegen
    product.format = { ...product.format, key, width: format.width, height: format.height };
  } else {
    product.format = { ...product.format, key };
  }
  updateFormatInputs();
  tryApply();
});
$('format-orientation').addEventListener('change', (e) => {
  product.format = { ...product.format, orientation: e.target.value };
  updateFormatInputs();
  tryApply();
});

// --- Abfallend / Fräsrand ---
function updateBleedInputs() {
  $('core-bleed').checked = product.bleed.enabled;
  $('core-bleed-field').hidden = !product.bleed.enabled;
  $('core-bleed-mm').value = String(product.bleed.mm);
  $('milling-field').hidden = product.binding !== 'perfect';
  $('milling-mm').value = String(product.milling);
  $('cover-bleed').checked = product.cover.bleed;
  $('cover-bleed-field').hidden = !product.cover.bleed;
  $('cover-bleed-mm').value = String(product.cover.bleedMm);
}
const mmValue = (el, max = 20) => {
  const v = Number(String(el.value).replace(',', '.'));
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
};
$('core-bleed').addEventListener('change', (e) => {
  product.bleed.enabled = e.target.checked;
  updateBleedInputs();
  tryApply();
});
$('core-bleed-mm').addEventListener('change', (e) => {
  product.bleed.mm = mmValue(e.target);
  updateBleedInputs();
  tryApply();
});
$('milling-mm').addEventListener('change', (e) => {
  product.milling = mmValue(e.target);
  updateBleedInputs();
  tryApply();
});
$('cover-bleed').addEventListener('change', (e) => {
  product.cover.bleed = e.target.checked;
  updateBleedInputs();
  tryApply();
});
$('cover-bleed-mm').addEventListener('change', (e) => {
  product.cover.bleedMm = mmValue(e.target);
  updateBleedInputs();
  tryApply();
});
for (const id of ['format-width', 'format-height']) {
  $(id).addEventListener('change', () => {
    product.format = {
      ...product.format,
      width: Number(String($('format-width').value).replace(',', '.')),
      height: Number(String($('format-height').value).replace(',', '.')),
    };
    tryApply();
  });
}

$('cover-enabled').addEventListener('change', (e) => {
  product.cover.enabled = e.target.checked;
  tryApply();
});
for (const [id, field, max] of [
  ['cover-caliper', 'caliper', 2],
  ['flap-right', 'flapRight', null],
  ['flap-left', 'flapLeft', null],
]) {
  $(id).addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    const min = field === 'caliper' ? 0.05 : 0;
    // Klappe höchstens so breit wie die Seite
    const limit = max ?? format.width;
    product.cover[field] = Number.isFinite(v) ? Math.min(limit, Math.max(min, v)) : min;
    e.target.value = field === 'caliper' ? product.cover[field].toFixed(2) : String(product.cover[field]);
    tryApply();
  });
}

const validTotal = (p) => validPageTotal(p, product.binding, MAX_PAGES);

const schemesFor = (pages) => CIP4_CATALOG.filter((e) => e.pages === pages && !e.unsupported);
const saddleOk = (id) => computeSignature(id, sigOptions()).saddleCompatible;

function renderGroups() {
  const box = $('groups');
  box.replaceChildren();
  product.groups.forEach((g, i) => {
    const entry = catalogEntry(g.scheme);
    const row = document.createElement('div');
    row.className = 'group-row';
    const pageOptions = SHEET_PAGE_COUNTS.map(
      (p) => `<option value="${p}"${p === entry.pages ? ' selected' : ''}>${p} Seiten</option>`,
    ).join('');
    const schemeOptions = schemesFor(entry.pages)
      .map((e) => {
        const d = describeEntry(e);
        const warn = product.binding === 'saddle' && !saddleOk(e.id) ? ' – nicht für Sammelheftung' : '';
        return `<option value="${e.id}"${e.id === g.scheme ? ' selected' : ''} title="${escapeHtml(d.longText)}">${e.id} · ${escapeHtml(d.type)} (${escapeHtml(d.sequence)})${warn}</option>`;
      })
      .join('');
    row.innerHTML = `
      <div class="group-line">
        <input type="number" class="g-count" min="1" max="${MAX_GROUP_COUNT}" value="${g.count}" aria-label="Anzahl Bogen" />
        <span>×</span>
        <select class="g-pages" aria-label="Seiten je Bogen">${pageOptions}</select>
        <button class="g-del" title="Bogengruppe entfernen" aria-label="Bogengruppe entfernen">✕</button>
      </div>
      <select class="g-scheme" aria-label="Falzschema" title="${escapeHtml(describeEntry(entry).longText)}">${schemeOptions}</select>`;
    row.querySelector('.g-count').addEventListener('change', (e) => {
      g.count = Math.max(1, Math.min(MAX_GROUP_COUNT, Math.round(Number(e.target.value)) || 1));
      e.target.value = g.count;
      tryApply();
    });
    row.querySelector('.g-pages').addEventListener('change', (e) => {
      const pages = Number(e.target.value);
      g.scheme = DEFAULT_SCHEMES[pages] && !catalogEntry(DEFAULT_SCHEMES[pages]).unsupported ? DEFAULT_SCHEMES[pages] : schemesFor(pages)[0].id;
      renderGroups();
      tryApply();
    });
    row.querySelector('.g-scheme').addEventListener('change', (e) => {
      g.scheme = e.target.value;
      renderGroups();
      tryApply();
    });
    row.querySelector('.g-del').addEventListener('click', () => {
      product.groups.splice(i, 1);
      renderGroups();
      tryApply();
    });
    row.querySelector('.g-del').disabled = product.groups.length === 1;
    box.appendChild(row);
  });
}

$('btn-group-add').addEventListener('click', () => {
  product.groups.push({ count: 1, scheme: 'F4-1' });
  renderGroups();
  tryApply();
});
$('btn-group-suggest').addEventListener('click', () => {
  if (!validTotal(product.pages)) return;
  product.groups = suggestGroups(product.pages, product.binding);
  renderGroups();
  tryApply();
});

/** Eingaben prüfen und bei Gültigkeit übernehmen. */
function tryApply() {
  const status = $('group-status');
  const sum = product.groups.reduce((s, g) => s + g.count * catalogEntry(g.scheme).pages, 0);
  const sheets = product.groups.reduce((s, g) => s + g.count, 0);
  const errors = [];
  const previous = { PAGE_W, PAGE_H, MM_PER_UNIT, format };
  try {
    applyFormat();
  } catch (err) {
    errors.push(err.message);
  }
  if (errors.length) {
    // ungültiges Endformat: nichts weiter prüfen
  } else if (!validTotal(product.pages)) {
    const step = pageStep(product.binding);
    errors.push(
      `Der Seitenumfang muss bei ${BINDINGS[product.binding]} ein Vielfaches von ${step} zwischen ${step} und ${MAX_PAGES} sein` +
        (product.binding === 'saddle' && product.pages % 2 === 0 ? ' (Einzelblätter nur bei Klebebindung).' : '.'),
    );
  }
  else errors.push(...computeAll());
  status.classList.toggle('error', errors.length > 0);
  if (errors.length) {
    // bisherige (gültige) Darstellung behalten
    ({ PAGE_W, PAGE_H, MM_PER_UNIT, format } = previous);
    status.innerHTML = `Summe: ${sum} von ${product.pages} Seiten · ${sheets} Bogen<br>${errors.map(escapeHtml).join('<br>')}`;
    return false;
  }
  status.textContent = `Summe: ${sum} von ${product.pages} Seiten · ${sheets} Bogen ✓`;
  applyProduction();
  return true;
}

/** Neu berechnete Produktion darstellen. */
function applyProduction() {
  closeBookNow();
  state.a = state.aTarget = 0;
  view.sheet = Math.min(view.sheet, production.n - 1);
  state.t = state.target = Math.min(state.t, foldsOf());
  state.reading = false;
  computePile();
  coverData = hasCover() ? computeCover(production.totalLeaves, product.caliper, product.cover, format) : null;
  if (coverData) coverData.bleed = coverBleed(product.cover, product.cover.bleed ? product.cover.bleedMm : 0);
  buildLeaves();
  buildCover();
  renderCoverTab();
  renderViewChips();
  renderOverview();
  renderSteps();
  renderSchemaAll();
  renderProductTexts();
}

function groupSummary() {
  return product.groups.map((g) => `${g.count}×${g.scheme}`).join(' + ');
}

function renderProductTexts() {
  const { n, pages, binding } = production;
  $('subtitle').textContent = `${format.label}${product.format.key === 'custom' ? '' : ` (${format.width} × ${format.height} mm)`} · ${pages} Seiten · ${n} Druckbogen (${groupSummary()}) · ${BINDINGS[binding]}`;
  $('cover-options').hidden = binding !== 'perfect';
  $('cover-fields').hidden = !hasCover();
  const maxCreep = Math.max(...production.sheets.map((s) => s.creep));
  $('product-info').textContent =
    binding === 'saddle'
      ? n === 1
        ? 'Der Bogen wird am Rücken geheftet. Bei nur einem Bogen entsteht keine Verdrängung zwischen Bogen.'
        : `${n} Bogen werden ineinandergesteckt und am Rücken geheftet. Verdrängung: 0 bis ${fmtMm(maxCreep)} (innerster Bogen).`
      : `${n} Bogen werden nacheinander zusammengetragen und am Rücken verklebt (auch Einzelblätter F2-1 möglich). ` +
        `Rückenstärke (Buchblock): ${production.totalLeaves} Blätter × ${fmtMm(product.caliper)} = ${fmtMm(
          (production.totalLeaves * product.caliper),
        )}.`;
  $('cover-info').textContent = hasCover()
    ? `Rückenbreite Umschlag: ${fmtMm(coverData.spineMm)} (Buchblock + 2 × ${fmtMm(coverData.coverCaliper)}). ` +
      `Umschlag offen: ${fmtNum(coverData.totalWidth)} × ${fmtNum(coverData.height)} mm – siehe Register „Umschlag“.`
    : '';
  $('assembly-intro').textContent =
    binding === 'saddle'
      ? 'Sammelheftung: Die gefalzten Bogen werden aufgeschlagen und ineinandergesteckt – der innerste Bogen zuerst, Bogen 1 zuletzt außen. Dann wird geschlossen, geheftet und am Vorderschnitt beschnitten.'
      : 'Klebebindung: Die gefalzten Bogen werden nacheinander aufeinandergelegt (Bogen 1 oben) und am Rücken verklebt.';
  $('asm-scrub').max = String(assemblyEnd());
  $('legend-sheets').hidden = n === 1;
}

// --- Ansicht: Bogen / Endprodukt ------------------------------------------------

function chipButton(s, active, onClick) {
  const b = document.createElement('button');
  const sheet = production.sheets[s];
  b.innerHTML = `<i class="dot" style="background:${sheetColor(s)}"></i>Bogen ${s + 1} <small>${sheet.scheme}</small>`;
  b.title = `Bogen ${s + 1} (${sheet.scheme}): Seiten ${sheet.pageRanges}`;
  b.classList.toggle('active', active);
  b.addEventListener('click', onClick);
  return b;
}

/** Auswahlliste der Bogen (bei vielen Bogen statt einzelner Schaltflächen). */
function sheetSelect(selected, onChange) {
  const sel = document.createElement('select');
  sel.className = 'sheet-select';
  sel.setAttribute('aria-label', 'Bogen wählen');
  sel.innerHTML =
    (selected === null ? '<option value="" selected>Bogen wählen …</option>' : '') +
    production.sheets
      .map((sheet, s) => `<option value="${s}"${s === selected ? ' selected' : ''}>Bogen ${s + 1} · ${sheet.scheme} · S. ${sheet.pageRanges}</option>`)
      .join('');
  sel.addEventListener('change', () => sel.value !== '' && onChange(Number(sel.value)));
  return sel;
}

function renderViewChips() {
  const many = production.n > CHIP_LIMIT;
  const schemaChips = $('schema-chips');
  const chips = $('view-chips');
  if (many) {
    schemaChips.replaceChildren(sheetSelect(view.sheet, (s) => selectView(view.mode === 'book' ? 'book' : 'sheet', s)));
    chips.replaceChildren(sheetSelect(view.mode === 'sheet' ? view.sheet : null, (s) => selectView('sheet', s)));
  } else {
    schemaChips.replaceChildren(
      ...production.sheets.map((_, s) => chipButton(s, view.sheet === s, () => selectView(view.mode === 'book' ? 'book' : 'sheet', s))),
    );
    chips.replaceChildren(...production.sheets.map((_, s) => chipButton(s, view.mode === 'sheet' && view.sheet === s, () => selectView('sheet', s))));
  }
  const b = document.createElement('button');
  b.className = 'product';
  b.textContent = production.n > 1 ? 'Endprodukt (zusammentragen)' : 'Endprodukt';
  b.classList.toggle('active', view.mode === 'book');
  b.addEventListener('click', () => selectView('book'));
  chips.appendChild(b);
}

function selectView(mode, sheet = view.sheet) {
  // Im Endprodukt ändert die Bogenwahl nur das Schema – das Blättern bleibt erhalten
  const changed = mode !== view.mode || (mode === 'sheet' && sheet !== view.sheet);
  view.mode = mode;
  view.sheet = sheet;
  if (changed) {
    closeBookNow();
    state.reading = false;
    state.t = state.target = Math.min(state.t, foldsOf());
  }
  $('sheet-controls').hidden = mode !== 'sheet';
  $('book-controls').hidden = mode !== 'book';
  $('sheet-label').textContent = `Bogen ${sheet + 1}`;
  renderViewChips();
  renderOverview();
  renderSteps();
  renderSchemaAll();
}

/** Falzbogen (mm) eines Bogens der Produktion mit Überfüller und Fräsrand. */
function impositionOf(s = view.sheet) {
  const sheet = production.sheets[s];
  return sheetImposition(sheet.sig, sheet.panels, {
    page: format,
    binding: production.binding,
    bleed: product.bleed.enabled ? product.bleed.mm : 0,
    milling: product.milling,
  });
}

/** Text der Zugaben, z. B. „Überfüller 3 mm, Fräsrand 3 mm“. */
function allowanceText() {
  const parts = [];
  parts.push(product.bleed.enabled ? `Überfüller ${fmtNum(product.bleed.mm)} mm` : 'nicht abfallend');
  if (production.binding === 'perfect') parts.push(`Fräsrand ${fmtNum(product.milling)} mm`);
  else parts.push('Bund ohne Zugabe');
  return parts.join(', ');
}

function renderSchemaAll() {
  const sheet = sheetOf();
  const imp = impositionOf();
  const opts = { shift: creepUnits(view.sheet) * MM_PER_UNIT, imp };
  renderSheetSvg(schemaFront, sheet.sig, sheet.panels, 'front', opts);
  renderSheetSvg(schemaBack, sheet.sig, sheet.panels, 'back', opts);
  $('schema-title').textContent = `Ausschuss Bogen ${view.sheet + 1} von ${production.n} (${sheet.scheme}) – Seiten ${sheet.pageRanges}`;
  const note = $('schema-creep');
  const parts = [
    `${escapeHtml(describeEntry(sheet.sig.entry).longText)}. Endformat ${escapeHtml(format.label)}${
      product.format.key === 'custom' ? '' : ` (${format.width} × ${format.height} mm)`
    }. <strong>Falzbogen ${fmtNum(imp.width)} × ${fmtNum(imp.height)} mm</strong> (Endformat netto ${fmtNum(imp.netWidth)} × ${fmtNum(
      imp.netHeight,
    )} mm; ${allowanceText()}).`,
  ];
  if (sheet.sig.bindingBottom) parts.push('Bund waagrecht: die Seiten stehen im Feld um 90° gedreht.');
  if (production.binding === 'saddle' && production.n > 1) {
    parts.push(
      sheet.creep > 0
        ? `Verdrängung: Seiteninhalt um <strong>${fmtMm(sheet.creep)}</strong> zum Bund verschoben (Darstellung ${CREEP_EXAG}-fach überhöht).`
        : 'Verdrängung: 0 mm – Bogen 1 liegt außen.',
    );
  }
  parts.push('Der violette Streifen markiert den Bund jeder Seite.');
  note.hidden = false;
  note.innerHTML = parts.join(' ');
}

/** Falzbogenformat (mit Überfüller und Fräsrand) in mm. */
function sheetSizeText(s) {
  const imp = impositionOf(s);
  return `${fmtNum(imp.width)} × ${fmtNum(imp.height)} mm`;
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
    tr.innerHTML = `<td><i class="dot" style="background:${sheetColor(s)}"></i>Bogen ${s + 1}</td>
      <td title="${escapeHtml(describeEntry(sheet.sig.entry).longText)}">${sheet.scheme}</td>
      <td>${sheetSizeText(s)}</td>
      <td>${sheet.pageRanges}</td><td>${position}</td><td>${saddle ? fmtMm(sheet.creep) : '–'}</td>`;
    tr.classList.toggle('active', view.sheet === s);
    tr.title = 'Bogen anzeigen';
    tr.addEventListener('click', () => selectView(view.mode === 'book' ? 'book' : 'sheet', s));
    tbody.appendChild(tr);
  });
}

// --- Falzschritte (aus dem CIP4-Katalog) -----------------------------------------

const stepsEl = $('steps');

function renderSteps() {
  const sheet = sheetOf();
  const entry = sheet.sig.entry;
  $('steps-scheme').textContent = entry.id;
  $('steps-intro').textContent = `${describeEntry(entry).longText}. Falzfolge laut CIP4-Katalog:`;
  stepsEl.replaceChildren();
  entry.folds.forEach((fold, k) => {
    const li = document.createElement('li');
    li.title = `Bis einschließlich ${k + 1}. Falz falzen`;
    li.innerHTML = `<strong>${k + 1}. Falz ${fold.direction === 'over' ? '↑' : '↓'}</strong><span>${escapeHtml(foldText(fold))}</span>`;
    li.addEventListener('click', () => goTo(k + 1));
    stepsEl.appendChild(li);
  });
  if (!entry.folds.length) stepsEl.innerHTML = '<li class="done"><strong>Kein Falz</strong><span>Einzelblatt</span></li>';
  $('scrub').max = String(Math.max(0.001, entry.folds.length));
  $('scrub').disabled = entry.folds.length === 0;
}

// --- Falzanimation --------------------------------------------------------------

function goTo(target) {
  state.playingAll = false;
  state.target = Math.max(0, Math.min(foldsOf(), target));
}

$('btn-next').addEventListener('click', () => goTo(Math.floor(state.target + 1e-6) + 1));
$('btn-prev').addEventListener('click', () => goTo(Math.ceil(state.target - 1e-6) - 1));
$('btn-reset').addEventListener('click', () => {
  goTo(0);
  state.t = 0;
  closeBookNow();
  state.reading = false;
});
$('btn-play').addEventListener('click', () => {
  if (state.playingAll) {
    state.playingAll = false;
    state.target = state.t;
    return;
  }
  if (state.t >= foldsOf() - 1e-6) {
    state.t = 0;
    closeBookNow();
    state.reading = false;
  }
  state.target = foldsOf();
  state.playingAll = true;
});
$('scrub').addEventListener('input', (e) => {
  state.playingAll = false;
  state.t = state.target = Number(e.target.value);
  closeBookNow();
  state.reading = false;
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

// --- Seite / Ausrichtung / Kamera ---------------------------------------------------

function setSide(side) {
  state.side = side;
  $('btn-front').classList.toggle('active', side === 'front');
  $('btn-back').classList.toggle('active', side === 'back');
  $('btn-front').setAttribute('aria-pressed', side === 'front');
  $('btn-back').setAttribute('aria-pressed', side === 'back');
}
$('btn-front').addEventListener('click', () => setSide('front'));
$('btn-back').addEventListener('click', () => setSide('back'));

const flipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const targetQuat = new THREE.Quaternion();
/** Zielausrichtung: Leseansicht (Bogen gedreht, Bund links, Kopf oben) und Vorder-/Rückseite. */
function orientationTarget() {
  targetQuat.identity();
  if (view.mode === 'sheet' && state.reading) {
    targetQuat.setFromRotationMatrix(new THREE.Matrix4().fromArray(sigOf().readerRotation));
  }
  if (state.side === 'back') targetQuat.premultiply(flipQuat);
  return targetQuat;
}

$('btn-camera').addEventListener('click', () => {
  state.cameraTarget = null;
  camera.position.copy(isBrowsing() ? READING_CAMERA : DEFAULT_CAMERA);
  controls.target.set(0, 0, 0);
});
// Sobald der Benutzer die Kamera selbst bewegt, keine automatische Kamerafahrt mehr
controls.addEventListener('start', () => (state.cameraTarget = null));

// --- Blättern ---------------------------------------------------------------

const leafCount = () => (view.mode === 'book' ? production.totalLeaves + (hasCover() ? 1 : 0) : sigOf().leaves);

/** Kann geblättert werden? (Bogen fertig gefalzt bzw. Produkt fertig) */
function canBrowse() {
  if (view.mode === 'book') {
    const end = assemblyEnd();
    return state.a >= end - 1e-6 && state.aTarget >= end - 1e-6;
  }
  return state.t >= foldsOf() - 1e-6 && state.target >= foldsOf() - 1e-6;
}
const isBrowsing = () => canBrowse() && (state.book > 1e-6 || state.bookTarget > 0);

function closeBookNow() {
  state.book = state.bookTarget = 0;
}

function turnTo(target) {
  if (!canBrowse()) return;
  const k = Math.max(0, Math.min(leafCount(), target));
  if (k > 0 && !isBrowsing()) {
    // Beim Aufschlagen in die Leseansicht wechseln: Bund links, Kopf oben, Seite 1 zum Betrachter
    state.reading = true;
    setSide('front');
    state.cameraTarget = READING_CAMERA.clone();
    controls.target.set(0, 0, 0);
  }
  state.bookTarget = k;
}
const currentLeaf = () => Math.round(state.bookTarget);

/** Aufgeschlagene Seiten nach k umgeblätterten Blättern (Seitenzahlen im Produkt). */
function visiblePages(k) {
  if (view.mode === 'book' && hasCover()) {
    // k = 0: geschlossen (U1), k = 1: U2 | Seite 1, …, k = Blätter+1: letzte Seite | U3
    const T = production.totalLeaves;
    if (k <= 0) return { left: null, right: 'Umschlag U1' };
    return { left: k === 1 ? 'U2' : 2 * (k - 1), right: k - 1 < T ? 2 * (k - 1) + 1 : 'U3' };
  }
  if (view.mode === 'book') return openPages(k, production.totalLeaves);
  const sheet = sheetOf();
  const leafOfLayer = (L) => sheet.panels.find((p) => p.layer === L).leaf;
  return {
    left: k > 0 ? 2 * leafOfLayer(k - 1) + 2 : null,
    right: k < sheet.sig.leaves ? 2 * leafOfLayer(k) + 1 : null,
  };
}

$('btn-page-next').addEventListener('click', () => turnTo(currentLeaf() + 1));
$('btn-page-prev').addEventListener('click', () => turnTo(currentLeaf() - 1));
$('btn-page-first').addEventListener('click', () => turnTo(0));
$('btn-page-last').addEventListener('click', () => turnTo(leafCount()));

document.addEventListener('keydown', (e) => {
  if (activeTab !== 'anim' || helpDialog?.open || e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
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
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(leafObjects.filter((o) => o.visible), true).find((h) => h.object.isMesh);
  if (!hit) return;
  const local = sheetGroup.worldToLocal(hit.point.clone());
  // in das kanonische System (Bund bei x = 0) umrechnen
  const p = view.mode === 'book' ? [local.x, local.y, local.z] : transformPoint(sigOf().canonicalTransform, [local.x, local.y, local.z]);
  turnTo(currentLeaf() + (p[0] > 0 ? 1 : -1));
});

// --- Anzeige --------------------------------------------------------------------

function updateUi(pose) {
  const t = state.t;
  const n = production.n;

  if (view.mode === 'sheet') {
    const sig = sigOf();
    const folds = sig.folds.length;
    const active = t < folds ? Math.floor(t) : -1;
    if (folds) {
      [...stepsEl.children].forEach((li, k) => {
        li.classList.toggle('done', t >= k + 1 - 1e-6);
        li.classList.toggle('active', k === active && t > k + 1e-6);
      });
    }
    const moving = Math.abs(state.target - t) > 1e-6;
    let text;
    if (!folds) text = `Einzelblatt ${view.sheet + 1} (${sig.id}) – ohne Falz, 2 Seiten (nur bei Klebebindung).`;
    else if (t <= 1e-6) text = `Flacher Druckbogen ${view.sheet + 1} (${sig.id}) – ${sig.entry.pages} Seiten auf ${sig.leaves} Feldern je Seite.`;
    else if (state.target < t && state.book > 1e-6) text = 'Bogen wird zugeklappt …';
    else if (t >= folds - 1e-6 && isBrowsing()) text = 'Blättern im gefalzten Bogen (Leseansicht: Bund links, Kopf oben; gedanklich beschnitten).';
    else if (t >= folds - 1e-6)
      text = `Fertig gefalzt: ${sig.leaves} ${sig.leaves === 1 ? 'Blatt' : 'Blätter'} = ${sig.entry.pages} Seiten. Beim Blättern wird in die Leseansicht gedreht.`;
    else if (moving) text = `${Math.floor(t) + 1}. Falz läuft …`;
    else text = `Angehalten im ${Math.floor(t) + 1}. Falz.`;
    $('status').textContent = text;
    $('btn-play').textContent = state.playingAll ? '⏸ Anhalten' : '▶ Alle Falze abspielen';
    $('btn-prev').disabled = state.target <= 1e-6;
    $('btn-next').disabled = state.target >= folds - 1e-6;
    $('btn-play').disabled = folds === 0;
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
        ? `Bogen ${s + 1} (${sheetOf(s).scheme}) wird aufgeschlagen und ${s === n - 1 ? 'auf den Sammelsattel gelegt' : 'um die inneren Bogen gelegt'} …`
        : `Bogen ${s + 1} (${sheetOf(s).scheme}) wird ${s === n - 1 ? 'als unterster Bogen abgelegt' : 'auf den Stapel gelegt'} …`;
    } else if (a < end - 1e-6) {
      const f = pose?.f ?? 0;
      if (saddle) {
        if (f < 0.4) text = 'Produkt wird geschlossen – die inneren Bogen stehen am Vorderschnitt über (Verdrängung) …';
        else if (f < 0.6) text = 'Heften: zwei Drahtklammern durch den Rücken …';
        else text = 'Beschnitt: der Überstand am Vorderschnitt wird abgeschnitten …';
      } else if (a < n + 1) text = 'Rücken wird gefräst und verklebt …';
      else {
        const c = a - n - 1;
        const flaps = coverData && (coverData.flapLeft > 0 || coverData.flapRight > 0);
        text =
          c < 0.35
            ? 'Umschlag wird herangeführt und an den beleimten Rücken gedrückt …'
            : c < 0.6 && flaps
              ? 'Klappen werden eingeschlagen …'
              : 'Umschlag wird um den Buchblock gelegt …';
      }
    } else
      text = `Fertig: ${production.pages} Seiten aus ${n} Bogen, ${BINDINGS[production.binding]}${
        hasCover() ? ` mit Umschlag (Rückenbreite ${fmtMm(coverData.spineMm)})` : ''
      }. ${
        saddle && n > 1 ? 'Dank Verdrängungsausgleich steht der Inhalt nach dem Beschnitt auf allen Seiten gleich.' : ''
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
    const lbl = (x) => (typeof x === 'number' ? `Seite ${x}` : x);
    pagesEl.textContent =
      left === null
        ? `Vorne: ${lbl(right)}`
        : right === null
          ? `Hinten: ${lbl(left)}`
          : typeof left === 'number' && typeof right === 'number'
            ? `Seite ${left} | ${right}`
            : `${lbl(left)} | ${lbl(right)}`;
  } else {
    pagesEl.textContent = view.mode === 'book' ? 'erst nach dem Zusammentragen' : 'erst nach dem letzten Falz';
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
  const highlight = view.mode === 'sheet' && t < foldsOf() ? Math.floor(t) : -1;
  document.querySelectorAll('#panel-schema [data-fold]').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.fold) === highlight);
  });
}

// ---------------------------------------------------------------------------
// Register „Umschlag“ (maßstabsgetreu in mm)
// ---------------------------------------------------------------------------

function renderCoverSvg(svg, data, side) {
  const b = data.bleed; // Überfüller rund um den offenen Umschlag
  const m0 = { top: 34, bottom: 40, left: 34, right: 12 };
  const W = data.totalWidth;
  const H = data.height;
  // Ränder um den Überfüller erweitern; m = Lage des Endformats (Schnittkante)
  const m = { top: m0.top + b.top, bottom: m0.bottom + b.bottom, left: m0.left + b.left, right: m0.right + b.right };
  svg.setAttribute('viewBox', `0 0 ${W + m.left + m.right} ${H + m.top + m.bottom}`);
  svg.replaceChildren();
  const gW = W + b.left + b.right;
  const gH = H + b.top + b.bottom;
  if (gW > W || gH > H) {
    svgEl('rect', { x: m.left - b.left, y: m.top - b.top, width: gW, height: gH, class: 'bleed-area' }, svg);
  }
  // Innenseite: Umschlag umgedreht (um die senkrechte Achse) -> Reihenfolge gespiegelt
  const parts = data.parts.map((p) => ({ ...p, x: side === 'outside' ? p.x : W - p.x - p.width }));
  const insideNames = { front: 'U2 – Innenseite vorne', back: 'U3 – Innenseite hinten', spine: 'Rücken', flapLeft: 'linke Klappe', flapRight: 'rechte Klappe' };
  for (const p of parts) {
    const x = m.left + p.x;
    svgEl('rect', { x, y: m.top, width: p.width, height: H, class: `cover-part ${side} ${p.key}` }, svg);
    const name = side === 'outside' ? p.name : insideNames[p.key];
    const cx = x + p.width / 2;
    const narrow = p.width < 40;
    const tiny = p.width < 14; // zu schmal für eine Beschriftung im Feld
    const t = svgEl(
      'text',
      { x: cx, y: m.top + H / 2, class: 'cover-label', transform: narrow ? `rotate(-90 ${cx} ${m.top + H / 2})` : '' },
      svg,
    );
    t.textContent = tiny ? '' : name;
    // Maß über dem Teil (bei schmalem Rücken mit Bezeichnung)
    const dim = svgEl('text', { x: cx, y: m.top - 8, class: 'cover-dim' }, svg);
    dim.textContent = tiny ? `${p.key === 'spine' ? 'Rücken ' : ''}${fmtNum(p.width)}` : `${fmtNum(p.width)}`;
    svgEl('line', { x1: x + 1, y1: m.top - 4, x2: x + p.width - 1, y2: m.top - 4, class: 'dim-line' }, svg);
  }
  // Rill-/Falzlinien an den inneren Grenzen
  for (const p of parts) {
    for (const xEdge of [p.x, p.x + p.width]) {
      if (xEdge <= 0.01 || xEdge >= W - 0.01) continue;
      svgEl('line', { x1: m.left + xEdge, y1: m.top, x2: m.left + xEdge, y2: m.top + H, class: 'cover-crease' }, svg);
    }
  }
  svgEl('rect', { x: m.left, y: m.top, width: W, height: H, class: gW > W || gH > H ? 'cover-outline trim' : 'cover-outline' }, svg);
  // Gesamtbreite und Höhe
  svgEl('line', { x1: m.left, y1: m.top + H + 14, x2: m.left + W, y2: m.top + H + 14, class: 'dim-line' }, svg);
  const tw = svgEl('text', { x: m.left + W / 2, y: m.top + H + 30, class: 'cover-dim strong' }, svg);
  tw.textContent =
    gW > W || gH > H
      ? `Gesamtbreite ${fmtNum(W)} mm · mit Überfüller ${fmtNum(gW)} × ${fmtNum(gH)} mm`
      : `Gesamtbreite ${fmtNum(W)} mm`;
  svgEl('line', { x1: m.left - 14, y1: m.top, x2: m.left - 14, y2: m.top + H, class: 'dim-line' }, svg);
  const th = svgEl('text', { x: m.left - 20, y: m.top + H / 2, class: 'cover-dim strong', transform: `rotate(-90 ${m.left - 20} ${m.top + H / 2})` }, svg);
  th.textContent = `${fmtNum(H)} mm`;
}

function renderCoverTab() {
  const has = !!coverData;
  $('cover-empty').hidden = has;
  $('cover-content').hidden = !has;
  $('cover-title').textContent = has ? `Umschlag – offen ${fmtNum(coverData.totalWidth)} × ${fmtNum(coverData.height)} mm` : 'Umschlag';
  if (!has) {
    buildCoverAnim(); // entfernt eine bisherige Animation
    return;
  }
  const d = coverData;
  $('cover-format-note').textContent = `${fmtNum(format.width)} × ${fmtNum(format.height)} mm (${format.label})`;
  const rows = [
    ['Endformat', `${fmtNum(format.width)} × ${fmtNum(format.height)} mm (${format.label})`],
    ['Inhalt', `${production.pages} Seiten = ${production.totalLeaves} Blätter, Papierstärke ${fmtMm(product.caliper)}`],
    ['Rückenstärke Buchblock', `${production.totalLeaves} × ${fmtMm(product.caliper)} = ${fmtMm(d.blockMm)}`],
    ['Papierstärke Umschlag', fmtMm(d.coverCaliper)],
    ['Rückenbreite Umschlag', `${fmtMm(d.blockMm)} + 2 × ${fmtMm(d.coverCaliper)} = ${fmtMm(d.spineMm)}`],
    ['linke Klappe', d.flapLeft > 0 ? `${fmtNum(d.flapLeft)} mm (an U4)` : 'keine'],
    ['rechte Klappe', d.flapRight > 0 ? `${fmtNum(d.flapRight)} mm (an U1)` : 'keine'],
    ['Umschlag offen (Endformat)', `${fmtNum(d.totalWidth)} × ${fmtNum(d.height)} mm`],
    [
      'Überfüller Umschlag',
      product.cover.bleed
        ? `${fmtNum(product.cover.bleedMm)} mm – oben/unten${d.bleed.left > 0 ? ', links/rechts' : ' (links/rechts keiner, da mit Klappen)'}`
        : 'nicht abfallend',
    ],
    ['Umschlag offen mit Überfüller', `${fmtNum(d.totalWidth + d.bleed.left + d.bleed.right)} × ${fmtNum(d.height + d.bleed.top + d.bleed.bottom)} mm`],
    [
      'Beschnitt nach dem Binden',
      d.bleed.left > 0 || (!d.flapLeft && !d.flapRight)
        ? 'dreiseitig mit dem Inhalt (Kopf, Fuß, Vorderschnitt)'
        : 'Kopf und Fuß mit dem Inhalt; Vorderschnitt nicht (Klappen)',
    ],
  ];
  $('cover-facts').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('');
  renderCoverSvg($('cover-outside'), d, 'outside');
  renderCoverSvg($('cover-inside'), d, 'inside');
  coverAnim.t = coverAnim.target = 0;
  buildCoverAnim();
}

// ---------------------------------------------------------------------------
// Umschlag-Animation im Register „Umschlag“ (maßstabsgetreu in mm, y nach oben)
// Ablauf: flach (Innenseite oben) -> Klappen einschlagen -> Buchblock mit beleimtem
// Rücken auf den Umschlagrücken setzen -> Vorder- und Rückseite hochklappen
// ---------------------------------------------------------------------------

const covContainer = $('cover-viewport');
const covRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
covRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
covContainer.appendChild(covRenderer.domElement);
const covScene = new THREE.Scene();
covScene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2d0, 2.0));
const covSun = new THREE.DirectionalLight(0xffffff, 1.2);
covSun.position.set(300, 600, 500);
covScene.add(covSun);
const covCamera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
const covControls = new OrbitControls(covCamera, covRenderer.domElement);
covControls.enableDamping = true;
const covRoot = new THREE.Group();
covScene.add(covRoot);
const coverAnim = {
  t: 0,
  target: 0,
  parts: [],
  cameraPos: new THREE.Vector3(),
  cameraTarget: new THREE.Vector3(),
  endPos: new THREE.Vector3(),
  endTarget: new THREE.Vector3(),
  userCamera: false, // Kamera vom Benutzer bewegt -> keine automatische Kamerafahrt
};
covControls.addEventListener('start', () => (coverAnim.userCamera = true));

function resizeCoverView() {
  const { clientWidth: w, clientHeight: h } = covContainer;
  if (!w || !h) return;
  covRenderer.setSize(w, h, false);
  covCamera.aspect = w / h;
  covCamera.updateProjectionMatrix();
}
new ResizeObserver(resizeCoverView).observe(covContainer);

/** Drehung um eine Achse parallel zu z durch (px, py). */
function pivotZ(px, py, angle) {
  return new THREE.Matrix4()
    .makeTranslation(px, py, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-px, -py, 0));
}

function covMaterial(tex, color) {
  return new THREE.MeshStandardMaterial(tex ? { map: tex, roughness: 0.75 } : { color, roughness: 0.8 });
}

function buildCoverAnim() {
  for (const { mesh } of coverAnim.parts) {
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    mesh.geometry.dispose();
    covRoot.remove(mesh);
  }
  coverAnim.parts = [];
  if (!coverData) return;
  const d = coverData;
  const W = format.width;
  const H = format.height;
  const ct = Math.max(d.coverCaliper, 0.4); // Umschlagstärke (mind. 0,4 mm, damit sichtbar)
  const gap = 0.15;
  const blockT = Math.max(d.blockMm, 0.5);
  const spine = blockT + 2 * ct;
  const xs0 = -spine / 2;
  const xs1 = spine / 2;
  const scale = 2;
  const edge = 0xc9a58a;
  const tex = (w, title, sub, side, flip = false) =>
    coverTexture({ w, h: H, title, sub, color: side === 'out' ? COVER_COLORS.outside : COVER_COLORS.inside, scale, vertical: w < 40, flip });

  // Teile: Breite (x), Lage im flachen Zustand, Beschriftung innen/außen
  const defs = [
    { key: 'front', x0: xs0 - W, w: W, ins: ['U2', 'Innenseite U1'], out: ['U1', 'Vorderseite'] },
    { key: 'spine', x0: xs0, w: spine, ins: ['Rücken'], out: [`Rücken ${fmtNum(d.spineMm)} mm`] },
    { key: 'back', x0: xs1, w: W, ins: ['U3', 'Innenseite U4'], out: ['U4', 'Rückseite'] },
  ];
  if (d.flapRight > 0) defs.push({ key: 'flapRight', x0: xs0 - W - d.flapRight, w: d.flapRight, ins: ['rechte Klappe', 'innen'], out: ['rechte Klappe'] });
  if (d.flapLeft > 0) defs.push({ key: 'flapLeft', x0: xs1 + W, w: d.flapLeft, ins: ['linke Klappe', 'innen'], out: ['linke Klappe'] });

  for (const def of defs) {
    const geom = new THREE.BoxGeometry(def.w, ct, H);
    const side = covMaterial(null, edge);
    // Reihenfolge der Box-Flächen: +x, -x, +y (innen), -y (außen), +z, -z
    // Außenseite von U1 so beschriften, dass sie am hingelegten Buch lesbar ist
    const outTex = tex(def.w, def.out[0], def.out[1], 'out', def.key === 'front');
    const mesh = new THREE.Mesh(geom, [side, side, covMaterial(tex(def.w, def.ins[0], def.ins[1], 'in')), covMaterial(outTex), side, side]);
    mesh.matrixAutoUpdate = false;
    const base = new THREE.Matrix4().makeTranslation(def.x0 + def.w / 2, ct / 2, 0);
    let pose;
    if (def.key === 'spine') pose = () => base;
    else if (def.key === 'front') pose = (k) => pivotZ(xs0, 0, (-Math.PI / 2) * k.up).multiply(base);
    else if (def.key === 'back') pose = (k) => pivotZ(xs1, 0, (Math.PI / 2) * k.up).multiply(base);
    else if (def.key === 'flapRight')
      pose = (k) => pivotZ(xs0, 0, (-Math.PI / 2) * k.up).multiply(pivotZ(xs0 - W, ct + gap / 2, -Math.PI * k.flap)).multiply(base);
    else pose = (k) => pivotZ(xs1, 0, (Math.PI / 2) * k.up).multiply(pivotZ(xs1 + W, ct + gap / 2, Math.PI * k.flap)).multiply(base);
    covRoot.add(mesh);
    coverAnim.parts.push({ mesh, pose });
  }

  // Buchblock (steht auf dem Rücken): Dicke = Rückenstärke, Höhe = Seitenbreite, Tiefe = Seitenhöhe
  const pageTex = (title, sub) => coverTexture({ w: H, h: W, title, sub, color: '#ffffff', scale, vertical: false });
  const paper = covMaterial(null, 0xf3f4f6);
  const blockGeom = new THREE.BoxGeometry(blockT, W, H);
  const blockMesh = new THREE.Mesh(blockGeom, [
    covMaterial(pageTex(`Seite ${production.pages}`, 'letzte Seite')),
    covMaterial(pageTex('Seite 1', 'Buchblock')),
    paper, // Vorderschnitt
    covMaterial(null, 0xe9d9a8), // beleimter Rücken
    paper,
    paper,
  ]);
  blockMesh.matrixAutoUpdate = false;
  const blockY = ct + gap + W / 2;
  coverAnim.parts.push({
    mesh: blockMesh,
    pose: (k) => new THREE.Matrix4().makeTranslation(0, blockY + (1 - k.block) * (W * 0.45 + 30), 0),
  });
  covRoot.add(blockMesh);

  // Kamera: ganzen offenen Umschlag zeigen
  const total = d.totalWidth + spine - d.spineMm;
  coverAnim.cameraTarget.set(0, W * 0.55, 0);
  coverAnim.cameraPos.set(total * 0.1, total * 0.85, total * 1.15);
  coverAnim.bookHeight = W;
  // Endansicht: näher am hingelegten Buch
  const S = Math.max(W, H);
  coverAnim.endTarget.set(0, W / 2, 0);
  coverAnim.endPos.set(S * 0.1, W / 2 + S * 1.3, S * 1.45);
  coverAnim.userCamera = false;
  covCamera.position.copy(coverAnim.cameraPos);
  covControls.target.copy(coverAnim.cameraTarget);
  covControls.update();
  applyCoverAnim();
  resizeCoverView();
}

/** Phasen der Animation aus dem Fortschritt t (0..1). */
function coverAnimPhases(t) {
  return {
    flap: ease(clamp01((t - 0.05) / 0.22)),
    block: ease(clamp01((t - 0.27) / 0.23)),
    up: ease(clamp01((t - 0.5) / 0.3)),
    lay: ease(clamp01((t - 0.82) / 0.18)),
  };
}

function applyCoverAnim() {
  const k = coverAnimPhases(coverAnim.t);
  // zum Schluss das fertige Buch hinlegen (U1 oben)
  covRoot.matrixAutoUpdate = false;
  covRoot.matrix.copy(pivotZ(0, (coverAnim.bookHeight ?? 0) / 2, (-Math.PI / 2) * k.lay));
  covRoot.matrixWorldNeedsUpdate = true;
  for (const { mesh, pose } of coverAnim.parts) {
    mesh.matrix.copy(pose(k));
    mesh.matrixWorldNeedsUpdate = true;
  }
}

function updateCoverAnimUi() {
  const t = coverAnim.t;
  const running = Math.abs(coverAnim.target - t) > 1e-6;
  $('btn-cov-play').textContent = running ? '⏸ Anhalten' : t >= 1 - 1e-6 ? '▶ Nochmals' : '▶ Abspielen';
  $('cov-scrub').value = t;
  const items = [...$('cov-steps').children];
  items.forEach((li, i) => {
    const from = Number(li.dataset.from);
    const to = i + 1 < items.length ? Number(items[i + 1].dataset.from) : 1;
    li.classList.toggle('active', t >= from && (t < to || (i === items.length - 1 && t < 1 - 1e-6)) && !(i === 1 && !(coverData?.flapLeft || coverData?.flapRight)));
    li.classList.toggle('done', t >= to - 1e-6 || t >= 1 - 1e-6);
  });
}

$('btn-cov-play').addEventListener('click', () => {
  if (Math.abs(coverAnim.target - coverAnim.t) > 1e-6) {
    coverAnim.target = coverAnim.t; // anhalten
    return;
  }
  if (coverAnim.t >= 1 - 1e-6) coverAnim.t = 0;
  coverAnim.target = 1;
});
$('btn-cov-reset').addEventListener('click', () => {
  coverAnim.t = coverAnim.target = 0;
});
$('cov-scrub').addEventListener('input', (e) => {
  coverAnim.t = coverAnim.target = Number(e.target.value);
});
$('btn-cov-camera').addEventListener('click', () => {
  coverAnim.userCamera = false;
  placeCoverCamera();
});

/** Kamera passend zum Fortschritt (Fahrt zur Endansicht beim Hinlegen). */
function placeCoverCamera() {
  const lay = coverAnimPhases(coverAnim.t).lay;
  covCamera.position.lerpVectors(coverAnim.cameraPos, coverAnim.endPos, lay);
  covControls.target.lerpVectors(coverAnim.cameraTarget, coverAnim.endTarget, lay);
}

/** Pro Bild aufgerufen, wenn das Register „Umschlag“ sichtbar ist. */
function frameCoverAnim(dt) {
  if (!coverAnim.parts.length) return;
  const COVER_SECONDS = 8;
  if (Math.abs(coverAnim.target - coverAnim.t) > 1e-6) {
    coverAnim.t = approach(coverAnim.t, coverAnim.target, (dt * state.speed) / COVER_SECONDS);
  }
  applyCoverAnim();
  updateCoverAnimUi();
  if (!coverAnim.userCamera) placeCoverCamera();
  covControls.update();
  covRenderer.render(covScene, covCamera);
}

// ---------------------------------------------------------------------------
// Hilfe (kontextsensitiv)
// ---------------------------------------------------------------------------

const helpDialog = $('help');

/** Thema passend zum aktuellen Bereich: fokussiertes Element, sonst Register und Ansicht. */
function contextTopic() {
  const focused = document.activeElement?.closest?.('[data-help]');
  if (focused && !helpDialog.contains(focused)) return focused.dataset.help;
  if (activeTab === 'schema') return 'schema';
  if (activeTab === 'catalog') return 'catalog';
  if (activeTab === 'cover') return 'cover';
  if (view.mode === 'book') return canBrowse() ? 'browse' : 'assembly';
  return canBrowse() && foldsOf() > 0 ? 'browse' : 'folding';
}

function openHelp(topic = contextTopic()) {
  const id = topic === 'overview-table' ? 'help-overview-table' : `help-${topic}`;
  const target = $(id) ?? $('help-overview');
  if (!helpDialog.open) helpDialog.showModal();
  helpDialog.querySelectorAll('.help-content section').forEach((sec) => sec.classList.toggle('current', sec === target));
  helpDialog.querySelectorAll('.help-toc a').forEach((a) => {
    const active = a.getAttribute('href') === `#${target.id}`;
    a.classList.toggle('active', active);
    if (active) a.parentElement.scrollLeft = a.offsetLeft - 16; // schmale Ansicht: Thema im Inhaltsverzeichnis zeigen
  });
  $('help-content').scrollTop = target.offsetTop - $('help-content').offsetTop - 8;
}

$('btn-help').addEventListener('click', () => openHelp());
$('btn-help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog) helpDialog.close(); // Klick auf den Hintergrund
});
helpDialog.querySelectorAll('.help-toc a').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openHelp(a.dataset.topic);
  }),
);
// „?“-Schalter an den Abschnitten (Bogenübersicht hat ein eigenes Thema)
document.querySelectorAll('.help-btn').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    openHelp(b.dataset.topic === 'overview' ? 'overview-table' : b.dataset.topic);
  }),
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    openHelp();
  }
});

// ---------------------------------------------------------------------------
// Register „CIP4-Falzkatalog“
// ---------------------------------------------------------------------------

let catalogSelected = 'F16-7';

function renderCatalogFilter() {
  const counts = [...new Set(CIP4_CATALOG.map((e) => e.pages))].sort((a, b) => a - b);
  $('catalog-filter').innerHTML = `<option value="">alle</option>${counts.map((p) => `<option value="${p}">${p}</option>`).join('')}`;
}

function renderCatalogTable() {
  const filter = Number($('catalog-filter').value) || 0;
  const tbody = $('catalog-rows');
  tbody.replaceChildren();
  for (const entry of CIP4_CATALOG) {
    if (filter && entry.pages !== filter) continue;
    const d = describeEntry(entry);
    const tr = document.createElement('tr');
    const saddle = entry.unsupported ? '–' : computeSignature(entry, sigOptions()).saddleCompatible ? '✓' : '–';
    tr.innerHTML = `<td><strong>${entry.id}</strong></td><td>${escapeHtml(entry.unsupported ? `nicht unterstützt (${entry.unsupported})` : d.type)}</td>
      <td>${entry.pages}</td><td>${entry.cols}×${entry.rows}</td><td>${entry.folds.length}</td>
      <td class="seq">${escapeHtml(d.sequence)}</td><td>${saddle}</td>`;
    tr.classList.toggle('unsupported', !!entry.unsupported);
    tr.classList.toggle('active', entry.id === catalogSelected);
    tr.title = d.longText;
    tr.addEventListener('click', () => {
      catalogSelected = entry.id;
      renderCatalogTable();
      renderCatalogDetail();
    });
    tbody.appendChild(tr);
  }
}

function renderCatalogDetail() {
  const entry = catalogEntry(catalogSelected);
  const d = describeEntry(entry);
  const box = $('catalog-detail');
  if (entry.unsupported) {
    box.innerHTML = `<h3>${entry.id}</h3><p>${escapeHtml(d.longText)}</p>
      <p class="hint">Im CIP4-Katalog als nicht unterstützt markiert (${escapeHtml(entry.unsupported)}) – ohne Ausschuss-Diagramm.</p>`;
    return;
  }
  const sig = computeSignature(entry, sigOptions());
  box.innerHTML = `
    <h3>${entry.id}</h3>
    <p class="long">${escapeHtml(d.longText)}</p>
    <dl class="facts">
      <dt>Seiten</dt><dd>${entry.pages} (${sig.leaves} ${sig.leaves === 1 ? 'Blatt' : 'Blätter'})</dd>
      <dt>Raster</dt><dd>${entry.cols} nebeneinander × ${entry.rows} übereinander</dd>
      <dt>Falze</dt><dd>${entry.folds.length}</dd>
      <dt>Bund</dt><dd>${entry.folds.length ? (sig.bindingBottom ? 'waagrecht (Seiten im Feld um 90° gedreht)' : 'senkrecht') : '–'}</dd>
      <dt>Sammelheftung</dt><dd>${sig.saddleCompatible ? 'geeignet' : 'nicht geeignet'}</dd>
    </dl>
    <ol class="fold-list">${entry.folds.map((f) => `<li>${f.direction === 'over' ? '↑' : '↓'} ${escapeHtml(foldText(f))}</li>`).join('') || '<li>kein Falz</li>'}</ol>
    <figure><svg id="cat-front" role="img" aria-label="Vorderseite"></svg><figcaption>Vorderseite</figcaption></figure>
    <figure><svg id="cat-back" role="img" aria-label="Rückseite"></svg><figcaption>Rückseite (umgeschlagen)</figcaption></figure>
    <button id="btn-catalog-use" class="primary">Als Produkt übernehmen und falzen</button>`;
  renderSheetSvg($('cat-front'), sig, sig.panels, 'front');
  renderSheetSvg($('cat-back'), sig, sig.panels, 'back');
  $('btn-catalog-use').addEventListener('click', () => {
    product.pages = entry.pages;
    product.groups = [{ count: 1, scheme: entry.id }];
    if (product.binding === 'saddle' && !sig.saddleCompatible) product.binding = 'perfect';
    $('page-total').value = String(product.pages);
    $('binding').value = product.binding;
    updatePageInput();
    renderGroups();
    if (tryApply()) {
      selectView('sheet', 0);
      state.t = state.target = 0;
      selectTab('anim');
    }
  });
}

$('catalog-filter').addEventListener('change', renderCatalogTable);
$('btn-catalog-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildCatalogExport(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cip4-falzkatalog.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------------------
// Render-Schleife
// ---------------------------------------------------------------------------

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  if (w === 0 || h === 0) return; // Register ausgeblendet
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
  // Dauer des Zusammentragens eines Bogens; bei vielen Bogen kürzer (gesamt höchstens ca. 30 s)
  const SHEET_SECONDS = Math.min(2.2, 30 / (production.n + 1));

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
      if (Math.abs(state.target - state.t) > 1e-6) {
        state.t = approach(state.t, state.target, (dt * state.speed) / FOLD_SECONDS);
        if (state.t < foldsOf() - 1e-6) state.reading = false; // beim Auffalzen wieder in Bogenlage
      } else state.playingAll = false;
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
  // Umschlag: sichtbar im Endprodukt, sobald alle Bogen zusammengetragen sind
  const coverVisible = view.mode === 'book' && coverObjects.length > 0 && state.a >= production.n - 1e-6;
  let coverMatrices = [];
  if (coverVisible) {
    coverMatrices = coverPose(clamp01(state.a - production.n - 1), state.book);
    applyMatrices(coverObjects.map((c) => c.obj), coverMatrices);
  }
  coverObjects.forEach((c) => (c.obj.visible = coverVisible));
  updateFoldLines(state.t);
  updateFastening(pose);
  updateSpineStrips(pose?.protrusions);

  // Objekt in der Bildmitte halten (sanft nachführen) und passend zoomen
  const box = bounds([
    ...objects.map((o, i) => ({ m: matrices[i], w: o.userData.w, h: o.userData.h })),
    ...coverMatrices.map((m, i) => ({ m, w: coverObjects[i].w, h: coverObjects[i].h })),
  ]);
  const c = new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
  if (first) state.center.copy(c);
  else state.center.lerp(c, 1 - Math.exp(-dt * 4));
  sheetGroup.position.copy(state.center).multiplyScalar(-1);
  const extent = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 1.05;
  // Kleiner als die Bezugsbreite: behutsam heranzoomen; größer: ganz einpassen
  const ratio = REF_WIDTH / extent;
  const zoomTarget = ratio < 1 ? ratio * 0.9 : Math.min(2.2, Math.sqrt(ratio));
  state.zoom = first ? zoomTarget : state.zoom + (zoomTarget - state.zoom) * (1 - Math.exp(-dt * 3));
  flipGroup.scale.setScalar(state.zoom);

  // Ausrichtung (Vorder-/Rückseite, Leseansicht) sanft nachführen
  flipGroup.quaternion.slerp(orientationTarget(), first ? 1 : 1 - Math.exp(-dt * 5));

  // Automatische Kamerafahrt (z. B. in die Leseansicht)
  if (state.cameraTarget) {
    camera.position.lerp(state.cameraTarget, 1 - Math.exp(-dt * 3));
    if (camera.position.distanceTo(state.cameraTarget) < 0.5) state.cameraTarget = null;
  }

  controls.update();
  scene.updateMatrixWorld();
  updateClipping(pose?.trims);
  updateUi(pose);
  if (activeTab === 'anim') renderer.render(scene, camera);
  if (activeTab === 'cover') frameCoverAnim(dt);
  first = false;
  requestAnimationFrame(frame);
}

// Start
updateFormatInputs();
updateBleedInputs();
updatePageInput();
renderGroups();
tryApply();
selectView('sheet', 0);
renderCatalogFilter();
renderCatalogTable();
renderCatalogDetail();
requestAnimationFrame(frame);

// Für Tests / Debugging
window.falzschema = {
  get production() {
    return production;
  },
  state,
  view,
  goTo,
  setSide,
  turnTo,
  selectView,
  selectTab,
  setProduct(p) {
    Object.assign(product, p);
    $('page-total').value = String(product.pages);
    $('binding').value = product.binding;
    $('caliper').value = product.caliper.toFixed(2);
    updateFormatInputs();
    product.cover = { bleed: false, bleedMm: 3, ...product.cover };
    product.bleed = { enabled: false, mm: 3, ...product.bleed };
    updateBleedInputs();
    $('cover-enabled').checked = product.cover.enabled;
    $('cover-caliper').value = product.cover.caliper.toFixed(2);
    $('flap-right').value = String(product.cover.flapRight);
    $('flap-left').value = String(product.cover.flapLeft);
    updatePageInput();
    renderGroups();
    return tryApply();
  },
};
