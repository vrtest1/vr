# Build assets/trees.json from OpenStreetMap woodland around the Nordschleife.
# Input:  tools/osm/forest.json (Overpass "out geom"), assets/centerline.csv
# Output: assets/trees.json  {species: [[x, z, yHint, scale, rot], ...]} in the game's local metres
#         (X east, Z south, origin E355000 / N5580000 / 300 m NHN, same as drive.js).
import csv, json, math, random, sys
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, MultiPolygon
from shapely.ops import unary_union, polygonize, linemerge
from shapely.strtree import STRtree
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parent.parent
E0, N0, H0 = 355000, 5580000, 300
ROAD_CLEAR = 9.0     # no trunks closer than this to any centreline (road half-width 5 m + verge)
FLOOR_HALF = 43.5    # GLB walkable floor is ~45 m either side; keep a margin
SEED = 2026

to_utm = Transformer.from_crs(4326, 25832, always_xy=True)
def local(lon, lat):
    e, n = to_utm.transform(lon, lat)
    return (e - E0, N0 - n)

rows = list(csv.reader(open(ROOT / 'assets/centerline.csv')))[1:]
center = [(float(r[1]) - E0, N0 - float(r[2]), float(r[4]) - H0) for r in rows]
line = LineString([(x, z) for x, z, _ in center] + [center[0][:2]])
corridor = line.buffer(FLOOR_HALF, quad_segs=8).difference(line.buffer(ROAD_CLEAR, quad_segs=8))
cpts = STRtree([Point(x, z) for x, z, _ in center])
def y_hint(x, z):
    return center[cpts.nearest(Point(x, z))][2]

# ---- OSM polygons ----
osm = json.load(open(ROOT / 'tools/osm/forest.json'))['elements']
def ring(geom):
    pts = [local(g['lon'], g['lat']) for g in geom]
    return pts if len(pts) >= 3 else None

forest, scrub, singles, rows_ = [], [], [], []
for e in osm:
    t = e.get('tags', {}); kind = t.get('landuse') or t.get('natural'); leaf = t.get('leaf_type', 'mixed')
    if e['type'] == 'node':
        singles.append((*local(e['lon'], e['lat']), t.get('leaf_type', 'broadleaved'))); continue
    if e['type'] == 'way':
        pts = ring(e.get('geometry', []))
        if not pts: continue
        if kind == 'tree_row': rows_.append(LineString(pts)); continue
        if pts[0] != pts[-1] and math.dist(pts[0], pts[-1]) > 1: continue
        poly = Polygon(pts).buffer(0)
    else:  # multipolygon relation: polygonize outer/inner member ways
        outer = [LineString(ring(m['geometry'])) for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry') and ring(m['geometry'])]
        inner = [LineString(ring(m['geometry'])) for m in e.get('members', []) if m.get('role') == 'inner' and m.get('geometry') and ring(m['geometry'])]
        po = unary_union(list(polygonize(linemerge(outer)))) if outer else None
        if po is None or po.is_empty: continue
        pi = unary_union(list(polygonize(linemerge(inner)))) if inner else None
        poly = po.difference(pi) if pi is not None and not pi.is_empty else po
    (scrub if kind == 'scrub' else forest).append((poly, leaf))

def merged(items, leaf=None):
    g = [p for p, l in items if leaf is None or l == leaf]
    return unary_union(g) if g else Polygon()

forest_all = merged(forest).intersection(corridor)
needle = merged(forest, 'needleleaved').intersection(corridor)
broad = merged(forest, 'broadleaved').intersection(corridor)
scrub_all = merged(scrub).intersection(corridor).difference(forest_all)
edge_band = forest_all.boundary.buffer(6).intersection(forest_all)
P = {k: prep(v) for k, v in dict(forest=forest_all, needle=needle, broad=broad, scrub=scrub_all, edge=edge_band, corridor=corridor).items()}

# ---- Poisson-disk sampling inside a region (grid-accelerated dart throwing) ----
rng = random.Random(SEED)
def poisson(region, prepared, spacing, tries_per_cell=4):
    if region.is_empty: return []
    minx, minz, maxx, maxz = region.bounds; cell = spacing / math.sqrt(2); grid = {}; out = []
    # Sample only inside the region's parts so long thin corridors don't waste darts on empty bounds.
    parts = list(getattr(region, 'geoms', [region])); areas = [p.area for p in parts]
    for _ in range(int(region.area / cell ** 2 * tries_per_cell) + 10):
        part = rng.choices(parts, areas)[0]; bx0, bz0, bx1, bz1 = part.bounds
        x, z = rng.uniform(bx0, bx1), rng.uniform(bz0, bz1)
        gx, gz = int((x - minx) / cell), int((z - minz) / cell)
        if (gx, gz) in grid: continue
        ok = True
        for i in range(gx - 2, gx + 3):
            for j in range(gz - 2, gz + 3):
                q = grid.get((i, j))
                if q and (q[0] - x) ** 2 + (q[1] - z) ** 2 < spacing ** 2: ok = False; break
            if not ok: break
        if ok and prepared.contains(Point(x, z)):
            grid[(gx, gz)] = (x, z); out.append((x, z))
    return out

trees = {k: [] for k in ('spruce', 'beech', 'birch', 'shrub')}
def add(sp, x, z, smin, smax):
    trees[sp].append([round(x, 1), round(z, 1), round(y_hint(x, z), 1), round(rng.uniform(smin, smax), 2), round(rng.uniform(0, 6.283), 2)])

# Canopy: Eifel mixed woodland, mostly Norway spruce with beech; leaf_type tags override where mapped.
for x, z in poisson(forest_all, P['forest'], 6.5):
    pt = Point(x, z); edge = P['edge'].contains(pt)
    if P['needle'].contains(pt): w = (0.9, 0.1, 0.0)
    elif P['broad'].contains(pt): w = (0.1, 0.75, 0.15)
    else: w = (0.55, 0.35, 0.10) if not edge else (0.35, 0.40, 0.25)
    sp = rng.choices(('spruce', 'beech', 'birch'), w)[0]
    add(sp, x, z, 0.8, 1.25)
# Understorey shrubs along the woodland edge facing the track.
for x, z in poisson(edge_band, P['edge'], 5.0):
    if rng.random() < 0.45: add('shrub', x, z, 0.7, 1.3)
# Scrubland: shrubs with the odd birch.
for x, z in poisson(scrub_all, P['scrub'], 4.0):
    add('birch' if rng.random() < 0.12 else 'shrub', x, z, 0.6, 1.2)
# Individually mapped trees and tree rows.
for x, z, leaf in singles:
    if P['corridor'].contains(Point(x, z)): add('spruce' if leaf == 'needleleaved' else 'beech', x, z, 0.9, 1.2)
for r in rows_:
    n = max(2, int(r.length / 8))
    for i in range(n + 1):
        p = r.interpolate(i / n, normalized=True)
        if P['corridor'].contains(p): add('beech', p.x, p.y, 0.85, 1.15)

out = ROOT / 'assets/trees.json'
json.dump({'source': '© OpenStreetMap contributors (ODbL): landuse=forest, natural=wood/scrub/tree/tree_row',
           'format': '[x, z, yHint, scale, rotY] local metres', **trees}, open(out, 'w'), separators=(',', ':'))
print({k: len(v) for k, v in trees.items()}, 'forest area m2', round(forest_all.area), 'corridor area m2', round(corridor.area), out.stat().st_size, 'bytes')
