# Falzschema – 16-Seiter, 3-Bruch-Kreuzbruch

Grafikprogramm (Browser), das einen Druckbogen mit 16 Endformatseiten
(8 Blätter mit Vorder- und Rückseite, angeordnet 4 × 2) als Ausschuss darstellt
und die drei Falzschritte des Kreuzbruchs als 3D-Animation zeigt.

## Starten

ES-Module brauchen einen Webserver (Öffnen per `file://` funktioniert nicht):

```bash
npm start
```

Danach <http://localhost:8000> im Browser öffnen. Alternativ jeder andere
statische Webserver im Projektordner. Es gibt keine Abhängigkeiten zum
Installieren; Three.js liegt unter `vendor/three/`.

## Funktionen

- **Bogenansicht Vorder-/Rückseite** (Schöndruck/Widerdruck) mit Seitenzahlen,
  Kopfmarke und Kopf-an-Kopf-Stellung der oberen Reihe – sowohl im 3D-Bild als
  auch im 2D-Ausschuss-Schema. Die Rückseite wird umgeschlagen gezeigt (Bogen
  um die senkrechte Achse gewendet).
- **Falzanimation**: alle Falze abspielen, einzeln vor/zurück, per Schieberegler
  frei durchfahren, Geschwindigkeit wählbar. Die Linie des nächsten Falzes ist
  rot markiert; die 3D-Ansicht lässt sich mit der Maus drehen und zoomen.
- **Falzlinien im Schema** mit der Nummer des jeweiligen Falzschritts.

## Falzschema

Blick auf die Vorderseite; alle Falze klappen nach hinten, die Vorderseite
bleibt außen:

1. **Falz** – vertikal in der Bogenmitte, linke Hälfte nach hinten (Bogen halbiert)
2. **Falz** – horizontal, rechtwinklig zum 1. Falz, obere Hälfte nach hinten (Kopf)
3. **Falz** – vertikal, rechtwinklig zum 2. Falz, linke Hälfte nach hinten (Bund)

Ergebnis (Ausschuss, ▼ = kopfstehend):

| Vorderseite      |     |     |     |
| ---------------- | --- | --- | --- |
| 5▼               | 12▼ | 9▼  | 8▼  |
| 4                | 13  | 16  | 1   |

| Rückseite (umgeschlagen) |     |     |     |
| ------------------------ | --- | --- | --- |
| 7▼                       | 10▼ | 11▼ | 6▼  |
| 2                        | 15  | 14  | 3   |

## Wie die Paginierung berechnet wird

Die Seitenzahlen sind nicht fest hinterlegt, sondern werden in
`src/falzschema.js` aus dem Falzvorgang berechnet:

- Jedes Feld des Bogens ist ein starres Rechteck mit einer 4×4-Lagematrix.
- Ein Falz ist eine 180°-Drehung der Felder auf der beweglichen Seite um die
  Falzlinie (knapp über/unter dem Stapel, damit die Lagen sauber aufeinander
  liegen).
- Nach dem letzten Falz wird das Produkt mit Bund links und Kopf oben
  betrachtet. Das Feld in Lage *L* (von oben, ab 0) trägt auf der nach oben
  zeigenden Seite die Seitenzahl 2L+1, auf der Unterseite 2L+2.
- Die Stand-Richtung jeder Seite auf dem Bogen ergibt sich, indem „oben“ des
  fertigen Produkts in die Koordinaten des flachen Bogens zurückgerechnet wird.

Dieselben Matrizen treiben die Animation. Weitere Falzarten lassen sich als
zusätzliches Schema-Objekt (wie `KREUZBRUCH_3_16`) beschreiben.

## Tests

```bash
npm test
```

Prüft u. a. die Seitenverteilung gegen den Standard-Ausschuss, die
Vollständigkeit der Seiten 1–16, die Lage nach dem Falzen und die
Stetigkeit der Animation.

## Dateien

- `index.html`, `styles.css` – Oberfläche
- `src/falzschema.js` – Rechenkern (ohne Grafik, auch unter Node.js nutzbar)
- `src/app.js` – 3D-Darstellung (Three.js), SVG-Schema und Bedienung
- `test/` – Tests mit `node:test`
- `vendor/three/` – Three.js r170 (MIT-Lizenz)
