#!/usr/bin/env python3
"""
Liest die Falzfolgen aus dem CIP4 "Pagination Catalog" (Version 1.4.3, 2009) und
schreibt sie als JavaScript-Modul src/cip4-catalog.js.

Aufruf:  python3 scripts/extract-cip4-catalog.py <Pagination-Catalog-1.4.3.pdf>
Benötigt pdftotext (poppler-utils).

Im PDF steht zu jedem Eintrag:  Name (z. B. F16-6), Rastergröße (Spalten x Zeilen)
und die Falzfolge in JDF-Notation, z. B.  ↑1/2 + ↑1/2 + ↑1/4 :
  ↑  (Wingdings U+F0E1) = linker Teil über den rechten  bzw. unterer Teil über den oberen
  ↓  (Wingdings U+F0E2) = linker Teil unter den rechten bzw. unterer Teil unter den oberen
  a/b = Größe des gefalzten Teils als Bruchteil des ungefalzten Bogens
  +   = Wechsel zwischen Falzen von links nach rechts und von unten nach oben
        (der erste Falz ist immer von links nach rechts)
"""
import json, re, subprocess, sys

def main(pdf):
    text = subprocess.run(['pdftotext', '-f', '13', '-raw', pdf, '-'], capture_output=True, check=True).stdout.decode('utf-8')
    parts = re.split(r'(?m)^(F\d+-\d+)\b', text)
    entries = []
    for i in range(1, len(parts), 2):
        name, body = parts[i], parts[i + 1]
        grid = re.search(r'(\d+)x(\d+)', body)
        cols, rows = int(grid.group(1)), int(grid.group(2))
        folds, orientation = [], 'vertical'
        for m in re.finditer(r'(|)\s*(\d+)\s*/\s*(\d+)|(\+)', body):
            if m.group(4):
                orientation = 'horizontal' if orientation == 'vertical' else 'vertical'
                continue
            folds.append({
                'orientation': orientation,
                'fraction': [int(m.group(2)), int(m.group(3))],
                'direction': 'over' if m.group(1) == '' else 'under',
            })
        entry = {'id': name, 'pages': int(name[1:].split('-')[0]), 'cols': cols, 'rows': rows, 'folds': folds}
        if 'UNSUPPORTED' in body:
            note = re.search(r'\((gatefold|multiple page sizes)\)', body)
            entry['unsupported'] = note.group(1) if note else 'unsupported'
        entries.append(entry)
    lines = [
        '// Automatisch erzeugt aus dem CIP4 "Pagination Catalog" 1.4.3 (2009)',
        '// mit scripts/extract-cip4-catalog.py – nicht von Hand ändern.',
        '// Copyright © 2009, International Cooperation for the Integration of Processes in',
        '// Prepress, Press and Postpress (CIP4) with registered office in Zurich, Switzerland.',
        '//',
        '// folds[].orientation: vertical = Falz von links nach rechts (senkrechte Falzlinie),',
        '//                      horizontal = Falz von unten nach oben (waagrechte Falzlinie)',
        '// folds[].fraction:    Größe des gefalzten Teils als Bruchteil des ungefalzten Bogens',
        '// folds[].direction:   over = linker/unterer Teil kommt darüber, under = darunter',
        'export const CIP4_CATALOG = ' + json.dumps(entries, indent=2, ensure_ascii=False) + ';',
        '',
    ]
    open('src/cip4-catalog.js', 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'{len(entries)} Einträge geschrieben: src/cip4-catalog.js')

if __name__ == '__main__':
    main(sys.argv[1])
