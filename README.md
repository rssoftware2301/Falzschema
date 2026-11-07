# Falzschema – Ausschießen, Falzen und Zusammentragen nach CIP4

Grafikprogramm (Browser) für Druckprodukte aus einem oder mehreren Falzbogen:
Seitenumfang und Aufteilung auf Falzbogen frei wählbar, jeder Bogen mit einem
Falzschema aus dem **CIP4-Falzkatalog** (JDF Fold Catalog, z. B. F16-7).
Das Programm berechnet aus Raster und Falzfolge des Katalogs die Paginierung
jedes Bogens, zeigt sie als Ausschuss (Vorder- und Rückseite), animiert die
Falzungen, das Zusammentragen (Sammelheftung oder Klebebindung) und lässt durch
das fertige Exemplar blättern.

## Starten

ES-Module brauchen einen Webserver (Öffnen per `file://` funktioniert nicht):

```bash
npm start
```

Danach <http://localhost:8000> im Browser öffnen. Alternativ jeder andere
statische Webserver im Projektordner. Es gibt keine Abhängigkeiten zum
Installieren; Three.js liegt unter `vendor/three/`.

## Weitergeben als Einzeldatei

`dist/Falzschema.html` enthält das komplette Programm (Oberfläche, Code und
Three.js) in einer Datei. Sie kann per E-Mail, USB-Stick o. Ä. weitergegeben
und **per Doppelklick** geöffnet werden – ohne Webserver und ohne Internet.

Nach Änderungen am Code die Datei neu erzeugen:

```bash
npm install
npm run build
```

## Funktionen

- **Drei Register**: „Animation“ (links die Steuerung mit eigenem Scrollbalken,
  rechts das 3D-Bild), „Ausschuss & Bogenübersicht“ und „CIP4-Falzkatalog“.
- **Produkt**: Seitenumfang frei eingeben (Vielfaches von 4, bis 256 Seiten),
  Bindeart **Sammelheftung** oder **Klebebindung**, bei Sammelheftung die
  Papierstärke für die Verdrängung.
- **Bogenaufteilung**: Gruppen aus *Anzahl × Seiten je Bogen × Falzschema*, z. B.
  76 Seiten = 4 × 16 (F16-6) + 1 × 8 (F8-7) + 1 × 4 (F4-1). „Vorschlag“ teilt
  automatisch in 16er-, 8er- und 4er-Bogen auf. Die Summe wird geprüft; Schemata,
  die sich nicht für Sammelheftung eignen, werden gekennzeichnet und abgewiesen.
- **Ausschuss je Bogen** (3D und Schema): Seitenzahlen im Gesamtprodukt, Kopf-
  marke, Bund (violett), Satzspiegel, Falzlinien mit Nummer des Falzschritts.
  Rückseite umgeschlagen. Bei waagrechtem Bund stehen die Seiten im Feld um 90°
  gedreht (wie im CIP4-Katalog).
- **Falzanimation** je Bogen mit der Falzfolge aus dem Katalog; die Linie des
  nächsten Falzes ist rot markiert. Nach dem letzten Falz kann im Bogen geblättert
  werden – die Ansicht dreht dabei in die Leseansicht (Bund links, Kopf oben).
- **Zusammentragen & Endverarbeitung** (Ansicht „Endprodukt“):
  - Sammelheftung: Bogen werden aufgeschlagen und ineinandergesteckt (innerster
    zuerst), dann geschlossen – die inneren Bogen stehen am Vorderschnitt über –,
    geheftet und beschnitten.
  - Klebebindung: Bogen werden aufeinandergelegt (Bogen 1 oben) und verklebt.
  Danach Blättern durch das ganze Exemplar (Buttons, Pfeiltasten, Klick).
- **Verdrängung (Sammelheftung)**: je Bogen = Anzahl Blätter der umschließenden
  Bogen auf einer Seite des Rückens × Papierstärke. Der Seiteninhalt wird um diesen
  Betrag zum Bund verschoben (Darstellung 4-fach überhöht).
- **CIP4-Falzkatalog**: alle 89 Schemata mit normiertem Namen, Langtext, Falzart,
  Raster, Anzahl, Lage und Richtung der Falze, Eignung für Sammelheftung und
  berechnetem Ausschuss; Vorschau, „Als Produkt übernehmen und falzen“ und
  Download als JSON.

## CIP4-Falzkatalog als Datengrundlage

Quelle ist der CIP4 **„Pagination Catalog“ 1.4.3** (2009, Application Note der
CIP4-Arbeitsgruppe Origination & Prepress). Er enthält zu jedem Schema:

- den normierten Namen (`F<Seiten>-<Nr>`, z. B. F16-7),
- die Rastergröße (Spalten × Zeilen),
- die **Falzfolge** in JDF-Notation, z. B. `↑½ + ↑½ + ↓¼`:
  - `↑` linker bzw. unterer Teil kommt **darüber** (nach vorne), `↓` **darunter**,
  - Bruch = Größe des gefalzten Teils bezogen auf den ungefalzten Bogen,
  - der erste Falz geht immer von links nach rechts, `+` wechselt zwischen
    Falzen von links nach rechts und von unten nach oben,
- ein Diagramm mit der Seitenverteilung (Vorder- und Rückseite).

Damit sind Anzahl, Reihenfolge, Lage und Richtung aller Falze eindeutig
bestimmt. Das Programm benötigt **keine weiteren Angaben**: Es simuliert die
Falzfolge und berechnet daraus die Paginierung. Die Leserichtung ergibt sich
nach CIP4-Standard aus dem letzten Falz (Bund) und der Jog-Kante (geschlossener
Kopf): Bund links, Kopf oben (BindingOrientation „Rotate0“, bei einreihigen
Rastern „Flip0“).

Die Berechnung wurde gegen die Diagramme des Katalogs geprüft (F2-1, F8-7,
F10-1 bis F10-3, F12-10 bis F12-12, F16-6 bis F16-8, F32-3, F32-4, F64-1 –
Seitenzahlen und Drehung auf Vorder- und Rückseite stimmen überein; siehe Tests).

Einschränkungen: F6-3, F6-6 und F6-7 sind im Katalog als „unsupported“
markiert (Altarfalz bzw. unterschiedliche Seitengrößen) und ohne Diagramm;
sie sind gelistet, aber nicht verwendbar. Bei Zickzack- und Wickelfalzen ist
die Paginierung als Broschur laut CIP4 „eher theoretisch“.

Dateien:

- `src/cip4-catalog.js` – die 89 Einträge (Name, Raster, Falzfolge), erzeugt mit
  `scripts/extract-cip4-catalog.py` aus dem PDF (benötigt `pdftotext`):

  ```bash
  python3 scripts/extract-cip4-catalog.py CIP4-Pagination-Catalog-1.4.3.pdf
  ```

- `data/cip4-falzkatalog.json` – Export mit allen abgeleiteten Angaben je Schema
  (Langtext, Falzart, Falze mit Lage als Strecken in Feldeinheiten, Richtung,
  Bund, Eignung für Sammelheftung, Ausschuss mit Seitenzahl und Drehung je
  Feld). Neu erzeugen mit:

  ```bash
  npm run export-catalog
  ```

## Wie die Paginierung berechnet wird

`src/falzschema.js`:

- Jedes Feld des Bogens ist ein starres Rechteck mit einer 4×4-Lagematrix.
- Ein Falz ist eine 180°-Drehung der Felder links bzw. unterhalb der Falzlinie;
  die Falzlinie liegt beim angegebenen Bruchteil der Bogengröße, gemessen ab der
  aktuellen linken bzw. unteren Kante des Falzpakets.
- Nach dem letzten Falz wird das Paket in die Leseansicht gedreht. Das Feld in
  Lage *L* (vom Leser aus oben, ab 0) trägt vorne die Seite 2L+1, hinten 2L+2.
- Mehrere Bogen: Klebebindung hängt die Blätter der Bogen hintereinander,
  Sammelheftung verschachtelt sie (vordere Hälfte vor, hintere Hälfte hinter den
  inneren Bogen).

## Tests

```bash
npm test
```

Prüft u. a. die berechneten Ausschüsse gegen die CIP4-Diagramme, alle 86
verwendbaren Schemata, Blättern, Bogenaufteilung, Paginierung und Verdrängung
bei Sammelheftung und Klebebindung.

## Dateien

- `index.html`, `styles.css` – Oberfläche
- `src/falzschema.js` – Rechenkern (ohne Grafik, auch unter Node.js nutzbar)
- `src/cip4-catalog.js` – CIP4-Falzkatalog (Daten)
- `src/catalog-export.js`, `scripts/export-catalog.mjs` – JSON-Export des Katalogs
- `scripts/extract-cip4-catalog.py` – liest den Katalog aus dem CIP4-PDF
- `data/cip4-falzkatalog.json` – exportierter Katalog
- `src/app.js` – 3D-Darstellung (Three.js), SVG-Schema und Bedienung
- `test/` – Tests mit `node:test`
- `scripts/build-single.mjs` – erzeugt die Einzeldatei `dist/Falzschema.html`
- `dist/Falzschema.html` – fertige Einzeldatei zum Weitergeben
- `vendor/three/` – Three.js r170 (MIT-Lizenz)
