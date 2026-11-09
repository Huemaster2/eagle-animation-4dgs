#!/usr/bin/env python3
# Draws the Philip Frame pixel fly and wordmark as currentColor SVGs for the Logo component.
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'src' / 'renderer' / 'components' / 'Logo' / 'assets'

FLY = """
.....##...##.....
....####.####....
....#########....
.....#######.....
.###..#####..###.
#...#..###..#...#
#....#.###.#....#
.#....#####....#.
..##..#####..##..
....#.#####.#....
...#..#####..#...
..#...#####...#..
.......###.......
........#........
""".strip().splitlines()

FONT = {
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    ' ': ['..', '..', '..', '..', '..', '..', '..'],
}


def rects(rows, ox=0, oy=0):
    out = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            if row[x] == '#':
                x2 = x
                while x2 < len(row) and row[x2] == '#':
                    x2 += 1
                out.append(f'M{ox + x} {oy + y}h{x2 - x}v1h{x - x2}z')
                x = x2
            else:
                x += 1
    return ''.join(out)


def svg(width, height, path, label):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" shape-rendering="crispEdges" role="img" aria-label="{label}">'
        f'<path fill="currentColor" d="{path}"/></svg>\n'
    )


def main():
    fly_w = len(FLY[0])
    (OUT / 'icon.svg').write_text(svg(fly_w, len(FLY), rects(FLY), 'Philip Frame'))
    parts, x = [rects(FLY)], fly_w + 4
    for ch in 'PHILIP FRAME':
        glyph = FONT[ch]
        parts.append(rects(glyph, x, 4))
        x += len(glyph[0]) + 1
    (OUT / 'logo.svg').write_text(svg(x, len(FLY), ''.join(parts), 'Philip Frame'))
    print('logo written', x, 'x', len(FLY))


if __name__ == '__main__':
    main()
