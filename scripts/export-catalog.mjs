/**
 * Exportiert den CIP4-Falzkatalog mit allen abgeleiteten Angaben als JSON
 * (data/cip4-falzkatalog.json), z. B. zur Verwendung in anderen Programmen.
 *
 * Je Schema: Name, Langtext, Falzart, Seiten, Raster, Falzfolge (Lage, Richtung),
 * Lage der Falzlinien auf dem flachen Bogen, Bindekante, Eignung für
 * Sammelheftung und der berechnete Ausschuss (Seitenzahl + Drehung je Feld).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { buildCatalogExport } from '../src/catalog-export.js';

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const data = buildCatalogExport();
const out = new URL('../data/cip4-falzkatalog.json', import.meta.url);
await writeFile(out, JSON.stringify(data, null, 2) + '\n');
console.log(`Erstellt: data/cip4-falzkatalog.json (${data.schemes.length} Schemata)`);
