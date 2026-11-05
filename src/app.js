import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import {
  DEFAULT_FOLD_SETTINGS,
  kreuzbruch16,
  halfName,
  directionName,
  computeScheme,
  sheetLayout,
  panelMatrixAt,
  leafMatrixAt,
  openPages,
  pageRotation,
  transformPoint,
  creases,
} from './falzschema.js';

// ---------------------------------------------------------------------------
// Modell
// ---------------------------------------------------------------------------

const PAGE_W = 70; // Endformat (Verhältnis ca. DIN A)
const PAGE_H = 99;
const THICKNESS = 1.2; // Papierstärke in der Darstellung (überzeichnet)

// Gewählte Falzrichtungen (je Falz: bewegte Hälfte und Richtung)
let foldSettings = DEFAULT_FOLD_SETTINGS.map((f) => ({ ...f }));
let scheme;
let model;
let CREASES;

function computeModel() {
  scheme = kreuzbruch16(foldSettings);
  model = computeScheme(scheme, { pageWidth: PAGE_W, pageHeight: PAGE_H, thickness: THICKNESS });
  CREASES = creases(model);
}
computeModel();

const FOLDS = model.folds.length;
const LEAVES = model.panels.length;

const COLORS = {
  front: '#ffffff',
  back: '#dbe7f7',
  ink: '#1d2430',
  border: '#8a95a5',
  head: '#c58a1a',
  fold: 0xe5484d,
};

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

  const layout = sheetLayout(model, side);
  layout.forEach((line, row) => {
    line.forEach((cell, col) => {
      const x = m + col * PAGE_W;
      const y = m + row * PAGE_H;
      const cx = x + PAGE_W / 2;
      const cy = y + PAGE_H / 2;
      svgEl('rect', { x, y, width: PAGE_W, height: PAGE_H, class: `sheet-cell ${side}` }, svg);
      const g = svgEl('g', { transform: `rotate(${cell.rotation} ${cx} ${cy})` }, svg);
      svgEl('rect', { x: cx - 18, y: y + 5, width: 36, height: 4, rx: 1.5, class: 'page-head' }, g);
      const t = svgEl('text', { x: cx, y: cy, class: 'page-no' }, g);
      t.textContent = cell.page;
      if (cell.page === 6 || cell.page === 9) {
        svgEl('rect', { x: cx - 8, y: cy + 15, width: 16, height: 2, class: 'page-underline' }, g);
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
renderSchema(schemaFront, 'front');
renderSchema(schemaBack, 'back');

// ---------------------------------------------------------------------------
// 3D-Szene
// ---------------------------------------------------------------------------

const container = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
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

// flipGroup: Wenden des Bogens (Vorder-/Rückseite)
// sheetGroup: hält den Bogen in der Bildmitte
const flipGroup = new THREE.Group();
const sheetGroup = new THREE.Group();
flipGroup.add(sheetGroup);
scene.add(flipGroup);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

function pageTexture(page, rotation, side) {
  const scale = 6;
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

  // Kopfmarke
  ctx.fillStyle = COLORS.head;
  ctx.fillRect(-pw * 0.26, -ph / 2 + ph * 0.05, pw * 0.52, ph * 0.035);
  ctx.font = `600 ${Math.round(ph * 0.04)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Kopf', 0, -ph / 2 + ph * 0.1);

  // Seitenzahl
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 ${Math.round(ph * 0.3)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(page), 0, ph * 0.02);
  if (page === 6 || page === 9) {
    // 6 und 9 unterstreichen, damit sie auch kopfstehend eindeutig sind
    const tw = ctx.measureText(String(page)).width;
    ctx.fillRect(-tw / 2, ph * 0.17, tw, ph * 0.018);
  }
  ctx.font = `500 ${Math.round(ph * 0.045)}px system-ui, sans-serif`;
  ctx.fillStyle = '#5d6878';
  ctx.fillText(side === 'front' ? 'Schöndruck' : 'Widerdruck', 0, ph * 0.36);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

const plane = new THREE.PlaneGeometry(PAGE_W, PAGE_H);
const edges = new THREE.EdgesGeometry(plane);
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6b7684 });
const FACE_OFFSET = THICKNESS * 0.12;

let panelObjects = [];

function disposePanels() {
  for (const g of panelObjects) {
    for (const child of g.children) {
      if (child.isMesh) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    }
    sheetGroup.remove(g);
  }
  panelObjects = [];
}

function buildPanels() {
  disposePanels();
  panelObjects = model.panels.map(createPanel);
}

function createPanel(p) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;

  const front = new THREE.Mesh(
    plane,
    new THREE.MeshStandardMaterial({
      map: pageTexture(p.front.page, pageRotation(p.front.up, 'front'), 'front'),
      roughness: 0.92,
      metalness: 0,
    }),
  );
  front.position.z = FACE_OFFSET;

  // Rückseite: Ebene um die y-Achse gewendet -> Texturkoordinate u zeigt nach -x,
  // das entspricht genau der Blickrichtung auf die umgeschlagene Rückseite.
  const back = new THREE.Mesh(
    plane,
    new THREE.MeshStandardMaterial({
      map: pageTexture(p.back.page, pageRotation(p.back.up, 'back'), 'back'),
      roughness: 0.92,
      metalness: 0,
    }),
  );
  back.rotation.y = Math.PI;
  back.position.z = -FACE_OFFSET;

  const outline = new THREE.LineSegments(edges, edgeMaterial);
  g.add(front, back, outline);
  sheetGroup.add(g);
  return g;
}
buildPanels();

// Anzeige der Falzlinie des nächsten / laufenden Falzes (auf beiden Bogenseiten)
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
  if (k >= FOLDS) {
    foldLines.forEach((l) => (l.visible = false));
    return;
  }
  const fold = model.folds[k];
  const box = stateBounds(model.matrices[k]);
  const zs = [box.maxZ + THICKNESS, box.minZ - THICKNESS];
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

// t läuft von 0 (flacher Bogen) bis FOLDS (fertig gefalzt); ganzzahliger Anteil = Falz,
// gebrochener Anteil = Fortschritt innerhalb des Falzes.
const state = {
  t: 0,
  target: 0,
  speed: 1,
  playingAll: false,
  flip: 0, // 0 = Vorderseite, Math.PI = Rückseite
  flipTarget: 0,
  center: new THREE.Vector3(),
  zoom: 1,
  // Blättern: book = Anzahl umgeblätterter Blätter (0..LEAVES, stetig für die Animation)
  book: 0,
  bookTarget: 0,
  cameraTarget: null, // laufende Kamerafahrt (Vector3) oder null
};

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function applyPose(t, book) {
  const step = Math.min(Math.floor(t), FOLDS);
  const progress = ease(t - step);
  const current = model.panels.map((p, i) =>
    step >= FOLDS && book > 0
      ? leafMatrixAt(model, i, ease(Math.min(1, Math.max(0, book - p.layer))))
      : panelMatrixAt(model, i, step, progress),
  );
  current.forEach((m, i) => {
    tmpMatrix.fromArray(m);
    panelObjects[i].matrix.copy(tmpMatrix);
    panelObjects[i].matrixWorldNeedsUpdate = true;
  });
  return current;
}

function centerOf(matrices) {
  const b = stateBounds(matrices);
  return new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
}

// ---------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
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
        applyFoldSettings();
      }),
    );
    stepsEl.appendChild(li);
  });
}

/** Schema mit den aktuellen Falzrichtungen neu berechnen und alles neu darstellen. */
function applyFoldSettings() {
  closeBookNow();
  computeModel();
  buildPanels();
  renderSchema(schemaFront, 'front');
  renderSchema(schemaBack, 'back');
  renderSteps();
  const isDefault = foldSettings.every(
    (f, k) => f.moving === DEFAULT_FOLD_SETTINGS[k].moving && f.direction === DEFAULT_FOLD_SETTINGS[k].direction,
  );
  $('btn-fold-default').disabled = isDefault;
}

renderSteps();

$('btn-fold-default').addEventListener('click', () => {
  foldSettings = DEFAULT_FOLD_SETTINGS.map((f) => ({ ...f }));
  applyFoldSettings();
});

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
    // Anhalten
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

const isFolded = () => state.t >= FOLDS - 1e-6 && state.target >= FOLDS - 1e-6;
const isBrowsing = () => isFolded() && (state.book > 1e-6 || state.bookTarget > 0);

function closeBookNow() {
  state.book = state.bookTarget = 0;
}

function turnTo(target) {
  if (!isFolded()) return;
  const k = Math.max(0, Math.min(LEAVES, target));
  if (k > 0 && !isBrowsing()) {
    // Beim Aufschlagen in die Leseansicht wechseln (Seite 1 zum Betrachter)
    setSide(model.viewSign > 0 ? 'front' : 'back');
    state.cameraTarget = READING_CAMERA.clone();
    controls.target.set(0, 0, 0);
  }
  state.bookTarget = k;
}
const currentLeaf = () => Math.round(state.bookTarget);

$('btn-page-next').addEventListener('click', () => turnTo(currentLeaf() + 1));
$('btn-page-prev').addEventListener('click', () => turnTo(currentLeaf() - 1));
$('btn-page-first').addEventListener('click', () => turnTo(0));
$('btn-page-last').addEventListener('click', () => turnTo(LEAVES));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  const actions = {
    ArrowRight: () => turnTo(currentLeaf() + 1),
    ArrowLeft: () => turnTo(currentLeaf() - 1),
    Home: () => turnTo(0),
    End: () => turnTo(LEAVES),
  };
  if (actions[e.key] && isFolded()) {
    e.preventDefault();
    actions[e.key]();
  }
});

// Klick auf das Produkt: rechts vom Bund = vorblättern, links = zurückblättern
const raycaster = new THREE.Raycaster();
const pointerDown = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => pointerDown.set(e.clientX, e.clientY));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!isFolded() || pointerDown.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(panelObjects, true).find((h) => h.object.isMesh);
  if (!hit) return;
  const local = sheetGroup.worldToLocal(hit.point.clone());
  const forward = (local.x - model.book.spineX) * (model.book.leavesSide === 'positive' ? 1 : -1) > 0;
  turnTo(currentLeaf() + (forward ? 1 : -1));
});

function updateUi() {
  const t = state.t;
  const active = t < FOLDS ? Math.floor(t) : -1;
  [...stepsEl.children].forEach((li, k) => {
    li.classList.toggle('done', t >= k + 1 - 1e-6);
    li.classList.toggle('active', k === active && t > k + 1e-6);
  });

  const moving = Math.abs(state.target - t) > 1e-6;
  let text;
  if (t <= 1e-6) text = 'Flacher Druckbogen – 16 Seiten auf 8 Feldern je Seite.';
  else if (state.target < t && state.book > 1e-6) text = 'Produkt wird zugeklappt …';
  else if (t >= FOLDS - 1e-6 && isBrowsing()) text = 'Blättern im Endprodukt (gedanklich an Kopf und Vorderschnitt beschnitten).';
  else if (t >= FOLDS - 1e-6)
    text =
      model.viewSign > 0
        ? 'Fertig gefalzt: 8 Blätter = 16 Seiten. Seite 1 liegt vorne oben, Bund links, Kopf oben.'
        : 'Fertig gefalzt: 8 Blätter = 16 Seiten. Seite 1 liegt hinten – Ansicht „Rückseite“ zeigt sie mit Bund links.';
  else if (moving) text = `${model.folds[Math.floor(t)].name} läuft …`;
  else text = `Angehalten in ${model.folds[Math.floor(t)].name}.`;
  $('status').textContent = text;

  $('btn-play').textContent = state.playingAll ? '⏸ Anhalten' : '▶ Alle Falze abspielen';
  $('btn-prev').disabled = state.target <= 1e-6;
  $('btn-next').disabled = state.target >= FOLDS - 1e-6;
  $('scrub').value = t;

  // Blättern
  const folded = isFolded();
  const leaf = currentLeaf();
  const pagesEl = $('book-pages');
  if (folded) {
    const { left, right } = openPages(model, leaf);
    pagesEl.textContent =
      left === null ? `Titelseite: Seite ${right}` : right === null ? `Rückseite: Seite ${left}` : `Seite ${left} | ${right}`;
  } else {
    pagesEl.textContent = 'erst nach dem 3. Falz';
  }
  pagesEl.classList.toggle('disabled', !folded);
  $('btn-page-prev').disabled = !folded || leaf <= 0;
  $('btn-page-first').disabled = !folded || leaf <= 0;
  $('btn-page-next').disabled = !folded || leaf >= LEAVES;
  $('btn-page-last').disabled = !folded || leaf >= LEAVES;
  $('book-hint').textContent = folded
    ? 'Auch mit den Pfeiltasten ← → oder per Klick auf die rechte bzw. linke Seite.'
    : 'Zuerst alle Falze ausführen.';

  // Im Schema den nächsten bzw. laufenden Falz hervorheben
  const highlight = t < FOLDS ? Math.floor(t) : -1;
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

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const FOLD_SECONDS = 1.8; // Dauer eines Falzes bei normaler Geschwindigkeit

  const LEAF_SECONDS = 0.9; // Dauer eines Umblätterns

  // Soll wieder aufgefalzt werden, zuerst das Produkt zuklappen
  if (state.target < state.t - 1e-9 && state.book > 1e-6) state.bookTarget = 0;

  // Blättern Richtung Ziel bewegen (bei großen Sprüngen schneller)
  const bookDiff = state.bookTarget - state.book;
  if (Math.abs(bookDiff) > 1e-6) {
    const delta = ((dt * state.speed) / LEAF_SECONDS) * Math.max(1, Math.abs(bookDiff) / 2);
    state.book = Math.abs(bookDiff) <= delta ? state.bookTarget : state.book + Math.sign(bookDiff) * delta;
  }

  // Falz-Fortschritt Richtung Ziel bewegen (erst wenn das Produkt zugeklappt ist)
  const diff = state.target - state.t;
  if (state.book > 1e-6) {
    // warten
  } else if (Math.abs(diff) > 1e-6) {
    const delta = (dt * state.speed) / FOLD_SECONDS;
    state.t = Math.abs(diff) <= delta ? state.target : state.t + Math.sign(diff) * delta;
  } else if (state.playingAll) {
    state.playingAll = false;
  }

  const current = applyPose(state.t, state.book);
  updateFoldLines(state.t);

  // Bogen in der Bildmitte halten (sanft nachführen)
  const c = centerOf(current);
  if (first) state.center.copy(c);
  else state.center.lerp(c, 1 - Math.exp(-dt * 4));
  sheetGroup.position.copy(state.center).multiplyScalar(-1);

  // Automatisch heranzoomen, wenn der Bogen kleiner wird
  const b = stateBounds(current);
  const extent = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.4);
  const zoomTarget = Math.min(2.2, Math.sqrt((scheme.cols * PAGE_W) / extent));
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
  updateUi();
  renderer.render(scene, camera);
  first = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Für Tests / Debugging
window.falzschema = {
  get model() {
    return model;
  },
  state,
  goTo,
  setSide,
  turnTo,
  setFold(k, settings) {
    foldSettings[k] = { ...foldSettings[k], ...settings };
    applyFoldSettings();
  },
};
