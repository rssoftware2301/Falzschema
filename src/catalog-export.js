import {
  CIP4_CATALOG,
  computeSignature,
  describeEntry,
  foldText,
  sheetLayout,
  creases,
} from './falzschema.js';

/**
 * Baut die Exportdaten des Falzkatalogs (auch im Browser nutzbar, z. B. für den Download).
 *
 * Koordinaten der Falzlinien in Feldeinheiten auf der Vorderseite des flachen Bogens:
 * x von links (0..Spalten), y von oben (0..Zeilen).
 */
export function buildCatalogExport() {
  const schemes = CIP4_CATALOG.map((entry) => {
    const d = describeEntry(entry);
    const base = {
      id: entry.id,
      name: d.longText,
      type: d.type,
      pages: entry.pages,
      leaves: entry.pages / 2,
      cols: entry.cols,
      rows: entry.rows,
      foldCount: entry.folds.length,
      sequence: d.sequence,
    };
    if (entry.unsupported) {
      return { ...base, supported: false, unsupportedReason: entry.unsupported, folds: entry.folds };
    }
    const sig = computeSignature(entry, { pageWidth: 1, pageHeight: 1, thickness: 0.01 });
    const lines = creases(sig);
    const sheetW = sig.cols * sig.cellW;
    const sheetH = sig.rows * sig.cellH;
    const toCells = ([x, y]) => [
      Math.round(((x + sheetW / 2) / sig.cellW) * 1000) / 1000,
      Math.round(((sheetH / 2 - y) / sig.cellH) * 1000) / 1000,
    ];
    const layout = (side) =>
      sheetLayout(sig, side).map((row) => row.map(({ page, rotation }) => ({ page, rotation })));
    return {
      ...base,
      supported: true,
      folds: entry.folds.map((f, k) => ({
        step: k + 1,
        orientation: f.orientation,
        fraction: `${f.fraction[0]}/${f.fraction[1]}`,
        direction: f.direction,
        description: foldText(f),
        lines: lines[k].map((seg) => seg.map(toCells)),
      })),
      bindingEdge: sig.bindingBottom ? 'horizontal' : 'vertical',
      pageRotatedInCell: sig.bindingBottom,
      saddleStitchSuitable: sig.saddleCompatible,
      layout: { front: layout('front'), back: layout('back') },
    };
  });
  return {
    source: 'CIP4 Pagination Catalog 1.4.3 (2009) – Falzfolgen; Ausschuss berechnet',
    notes: {
      orientation: 'vertical = Falz von links nach rechts (senkrechte Falzlinie), horizontal = von unten nach oben',
      fraction: 'Größe des gefalzten (linken bzw. unteren) Teils als Bruchteil des ungefalzten Bogens, ab der aktuellen linken bzw. unteren Kante',
      direction: 'over = darüber (nach vorne, zum Betrachter), under = darunter (nach hinten)',
      lines: 'Falzlinien als Strecken in Feldeinheiten auf der Vorderseite: x von links, y von oben',
      layout: 'Ausschuss je Seite als Zeilen (oben nach unten) und Spalten (links nach rechts, Rückseite umgeschlagen); rotation = Drehung der Seite im Uhrzeigersinn in Grad',
      reading: 'Leseansicht nach CIP4-Standard (BindingOrientation Rotate0, einreihig Flip0): Bund links, Kopf oben',
    },
    schemes,
  };
}
