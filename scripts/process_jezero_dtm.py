#!/usr/bin/env python3
"""Crop the HiRISE Jezero DTM to a sim heightmap. Offline; no GDAL required."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "data/raw/DTEEC_048842_1985_048908_1985_U01.IMG"
OUT = ROOT / "shared/mars"

RECORD_BYTES = 27820
LINES = 14775
SAMPLES = 6955
MISSING = np.uint32(0xFF7FFFFB)
MAP_SCALE_M = 1.0096633268711
# Image line 0 is north. Lat/lon of the full DTM (from the PDS label).
LAT_MAX = 18.588602118832
LAT_MIN = 18.336842565755
LON_WEST = 77.46147725
LON_EAST = 77.58415512

# Operational grid matches the synthetic map so the scripted mission still fits.
OP_W, OP_H = 24, 16
HI_W, HI_H = 128, 128
# ~25 m cells → a 600 × 400 m traverse, rover-scale.
CELL_M = 25.0
ROCK_DEG = 6.0
ROCK_PERCENTILE = 82


def load_dtm() -> tuple[np.ndarray, np.ndarray]:
    raw = np.memmap(IMG, dtype="<f4", mode="r", offset=RECORD_BYTES, shape=(LINES, SAMPLES))
    bits = raw.view("<u4")
    valid = bits != MISSING
    elev = np.array(raw, dtype=np.float32)
    elev[~valid] = np.nan
    return elev, valid


def block_mean(elev: np.ndarray, y0: int, x0: int, win_h: int, win_w: int, out_h: int, out_w: int) -> np.ndarray:
    crop = elev[y0 : y0 + win_h, x0 : x0 + win_w]
    # Trim to a multiple of the output so reshape is exact.
    th, tw = (crop.shape[0] // out_h) * out_h, (crop.shape[1] // out_w) * out_w
    crop = crop[:th, :tw]
    bh, bw = th // out_h, tw // out_w
    blocks = crop.reshape(out_h, bh, out_w, bw)
    with np.errstate(all="ignore"):
        return np.nanmean(blocks, axis=(1, 3)).astype(np.float32)


def slopes(elev: np.ndarray, meters: float) -> np.ndarray:
    dy, dx = np.gradient(elev, meters)
    return np.degrees(np.arctan(np.hypot(dx, dy)))


def latlon(y: int, x: int) -> tuple[float, float]:
    lat = LAT_MAX - (y / max(LINES - 1, 1)) * (LAT_MAX - LAT_MIN)
    lon = LON_WEST + (x / max(SAMPLES - 1, 1)) * (LON_EAST - LON_WEST)
    return lat, lon


def pick_window(elev: np.ndarray, win_h: int, win_w: int) -> tuple[int, int]:
    """Prefer a valid, high-relief patch. Coarse stride; this is a one-off offline job."""
    best = None
    step_y, step_x = max(win_h // 3, 80), max(win_w // 3, 80)
    for y0 in range(0, LINES - win_h, step_y):
        for x0 in range(0, SAMPLES - win_w, step_x):
            patch = elev[y0 : y0 + win_h, x0 : x0 + win_w]
            valid = float(np.isfinite(patch).mean())
            if valid < 0.98:
                continue
            relief = float(np.nanpercentile(patch, 95) - np.nanpercentile(patch, 5))
            if relief < 35:
                continue
            score = relief
            if best is None or score > best[0]:
                best = (score, y0, x0, relief, valid)
    if best is None:
        raise SystemExit("no valid high-relief DTM window")
    _, y0, x0, relief, valid = best
    print(f"window y0={y0} x0={x0} relief={relief:.1f} m valid={valid:.3f}")
    return y0, x0


def classify(slope: np.ndarray) -> list[str]:
    finite = slope[np.isfinite(slope)]
    cut = max(ROCK_DEG, float(np.percentile(finite, ROCK_PERCENTILE))) if finite.size else ROCK_DEG
    print(f"rock threshold {cut:.2f}°")
    cells: list[str] = []
    for s in slope.ravel():
        if not np.isfinite(s) or s >= cut:
            cells.append("rock")
        else:
            cells.append("ground")
    return cells


def idx(x: int, y: int, w: int) -> int:
    return y * w + x


def neighbors(x: int, y: int, w: int, h: int):
    for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h:
            yield nx, ny


def path(cells: list[str], w: int, h: int, start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]] | None:
    sx, sy = start
    gx, gy = goal
    if cells[idx(gx, gy, w)] != "ground":
        return None
    prev = {start: start}
    q = [start]
    for cur in q:
        if cur == goal:
            break
        x, y = cur
        for n in neighbors(x, y, w, h):
            if cells[idx(*n, w)] != "ground" or n in prev:
                continue
            prev[n] = cur
            q.append(n)
    if goal not in prev:
        return None
    out = []
    cur = goal
    while cur != start:
        out.append(cur)
        cur = prev[cur]
    out.reverse()
    return out


def carve(cells: list[str], w: int, trail: list[tuple[int, int]]) -> None:
    for x, y in trail:
        cells[idx(x, y, w)] = "ground"


def flattest(slope: np.ndarray, cells: list[str], w: int, xs: range, ys: range) -> tuple[int, int]:
    best = None
    for y in ys:
        for x in xs:
            if cells[idx(x, y, w)] != "ground":
                continue
            s = float(slope[y, x])
            if best is None or s < best[0]:
                best = (s, x, y)
    if best is None:
        raise SystemExit(f"no ground in {xs} {ys}")
    return best[1], best[2]


def steepest(slope: np.ndarray, cells: list[str], w: int, xs: range, ys: range) -> tuple[int, int]:
    best = None
    for y in ys:
        for x in xs:
            i = idx(x, y, w)
            s = float(slope[y, x]) if np.isfinite(slope[y, x]) else -1
            # Prefer a cell we can stand on, or turn a rocky science target into ground.
            if best is None or s > best[0]:
                best = (s, x, y, cells[i])
    assert best
    x, y = best[1], best[2]
    cells[idx(x, y, w)] = "ground"
    return x, y


def place_features(cells: list[str], slope: np.ndarray, w: int, h: int) -> dict:
    home = flattest(slope, cells, w, range(0, 5), range(h - 4, h))
    o1 = steepest(slope, cells, w, range(w - 6, w), range(0, 5))
    o2 = steepest(slope, cells, w, range(w - 5, w), range(4, 9))
    wp_a = flattest(slope, cells, w, range(13, 19), range(3, 8))
    wp_alt = flattest(slope, cells, w, range(11, 17), range(7, 12))
    wp_b = flattest(slope, cells, w, range(2, 7), range(1, 6))
    wp_c = flattest(slope, cells, w, range(w - 7, w - 2), range(h - 5, h - 1))

    needed = {
        "wp-home": home,
        "wp-A": wp_a,
        "wp-A-alt": wp_alt,
        "wp-B": wp_b,
        "wp-C": wp_c,
        "outcrop-1": o1,
        "outcrop-2": o2,
    }
    for name, dest in needed.items():
        trail = path(cells, w, h, home, dest)
        if trail is None:
            # Straight-line carve, then 4-connected fill of gaps.
            x, y = home
            gx, gy = dest
            while (x, y) != (gx, gy):
                if x != gx:
                    x += 1 if gx > x else -1
                elif y != gy:
                    y += 1 if gy > y else -1
                cells[idx(x, y, w)] = "ground"
            trail = path(cells, w, h, home, dest)
        if trail is None:
            raise SystemExit(f"could not connect home to {name}")
        carve(cells, w, trail)

    # Sand: a compact flat not on the mission spine.
    spine = set()
    for dest in (wp_a, wp_alt, o1, o2, home):
        for p in path(cells, w, h, home, dest) or []:
            spine.add(p)
        spine.add(dest)
    sand = None
    best_flat = 1e9
    for y in range(3, h - 6):
        for x in range(5, w - 8):
            rect = [(x + i, y + j) for j in range(4) for i in range(4)]
            if any(p in spine or not (0 <= p[0] < w and 0 <= p[1] < h) for p in rect):
                continue
            mean = float(np.nanmean([slope[yy, xx] for xx, yy in rect]))
            if mean < best_flat:
                best_flat = mean
                sand = (x, y)
    if sand is None:
        sand = (7, 5)
    sx, sy = sand
    for j in range(4):
        for i in range(4):
            cells[idx(sx + i, sy + j, w)] = "sand"
    # Re-carve mission paths in case sand overlapped.
    for dest in (wp_a, wp_alt, o1, o2):
        trail = path(cells, w, h, home, dest)
        if trail is None:
            raise SystemExit("sand blocked the mission")

    def feat(fid, kind, label, tag, pos):
        return {"id": fid, "kind": kind, "label": label, "tag": tag, "pos": {"x": pos[0], "y": pos[1]}}

    return {
        "roverStart": {"x": home[0], "y": home[1]},
        "features": [
            feat("wp-home", "waypoint", "Landing site", "H", home),
            feat("wp-A", "waypoint", "Approach to outcrop", "A", wp_a),
            feat("wp-A-alt", "waypoint", "Alternate approach", "A'", wp_alt),
            feat("wp-B", "waypoint", "West ridge", "B", wp_b),
            feat("wp-C", "waypoint", "South flats", "C", wp_c),
            feat("outcrop-1", "target", "Layered outcrop", "O1", o1),
            feat("outcrop-2", "target", "Secondary outcrop", "O2", o2),
        ],
        "noGoZones": [{"id": "sand-1", "label": "Sand", "rect": {"x": sx, "y": sy, "w": 4, "h": 4}}],
        "sites": {
            "outcrop-1": {
                "slopeDeg": round(float(slope[o1[1], o1[0]]), 1),
                "elevM": round(float(np.nan), 2),
            },
            "outcrop-2": {"slopeDeg": round(float(slope[o2[1], o2[0]]), 1)},
        },
    }


def hillshade(elev: np.ndarray) -> np.ndarray:
    dy, dx = np.gradient(np.nan_to_num(elev, nan=np.nanmean(elev)))
    zenith = math.radians(45)
    azimuth = math.radians(315)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    shaded = np.cos(zenith) * np.cos(slope) + np.sin(zenith) * np.sin(slope) * np.cos(azimuth - aspect)
    shaded = np.clip(shaded, 0, 1)
    shaded[~np.isfinite(elev)] = 0
    return (shaded * 255).astype(np.uint8)


def write_pgm(path: Path, pixels: np.ndarray) -> None:
    h, w = pixels.shape
    path.write_bytes(f"P5\n{w} {h}\n255\n".encode("ascii") + pixels.tobytes())


def write_png(path: Path, pixels: np.ndarray) -> None:
    try:
        from PIL import Image

        Image.fromarray(pixels, mode="L").save(path)
    except ImportError:
        write_pgm(path.with_suffix(".pgm"), pixels)


def main() -> None:
    if not IMG.exists():
        raise SystemExit(f"missing {IMG}")
    OUT.mkdir(parents=True, exist_ok=True)
    elev, _ = load_dtm()

    op_win = int(round(OP_H * CELL_M / MAP_SCALE_M)), int(round(OP_W * CELL_M / MAP_SCALE_M))
    hi_win = int(round(HI_H * CELL_M / MAP_SCALE_M)), int(round(HI_W * CELL_M / MAP_SCALE_M))
    # Same origin so the 24×16 map is the SW of the 128×128 product, just coarser.
    y0, x0 = pick_window(elev, *op_win)
    # Recenter the high-res square on that operational window.
    hi_y0 = max(0, min(LINES - hi_win[0], y0 + op_win[0] // 2 - hi_win[0] // 2))
    hi_x0 = max(0, min(SAMPLES - hi_win[1], x0 + op_win[1] // 2 - hi_win[1] // 2))

    op_elev = block_mean(elev, y0, x0, *op_win, OP_H, OP_W)
    hi_elev = block_mean(elev, hi_y0, hi_x0, *hi_win, HI_H, HI_W)
    op_slope = slopes(op_elev, CELL_M)
    hi_slope = slopes(hi_elev, CELL_M)
    cells = classify(op_slope)
    placed = place_features(cells, op_slope, OP_W, OP_H)

    o1 = next(f for f in placed["features"] if f["id"] == "outcrop-1")
    placed["sites"]["outcrop-1"]["elevM"] = round(float(op_elev[o1["pos"]["y"], o1["pos"]["x"]]), 2)
    placed["sites"]["outcrop-1"]["slopeDeg"] = round(float(op_slope[o1["pos"]["y"], o1["pos"]["x"]]), 1)

    lat0, lon0 = latlon(y0 + op_win[0] - 1, x0)
    lat1, lon1 = latlon(y0, x0 + op_win[1] - 1)
    source = {
        "productId": "DTEEC_048842_1985_048908_1985_U01",
        "dataset": "MRO-M-HIRISE-5-DTM-V1.0",
        "site": "Jezero crater, 2020 candidate landing site",
        "cellMeters": CELL_M,
        "bbox": {"south": lat0, "west": lon0, "north": lat1, "east": lon1},
        "note": "Elevations are metres above the Mars 2000 areoid. Slope from the downsampled DTM.",
    }

    def finite_list(a: np.ndarray) -> list[float | None]:
        return [None if not np.isfinite(v) else round(float(v), 2) for v in a.ravel()]

    op = {
        "source": source,
        "seed": 42,
        "width": OP_W,
        "height": OP_H,
        "cellMeters": CELL_M,
        "cells": cells,
        "elevations": finite_list(op_elev),
        "slopesDeg": finite_list(op_slope),
        **placed,
    }
    hi = {
        "source": {**source, "cellMeters": CELL_M, "width": HI_W, "height": HI_H},
        "width": HI_W,
        "height": HI_H,
        "cellMeters": CELL_M,
        "elevations": finite_list(hi_elev),
        "slopesDeg": finite_list(hi_slope),
    }

    (OUT / "jezero.map.json").write_text(json.dumps(op, indent=2) + "\n")
    (OUT / "jezero.heightmap.json").write_text(json.dumps(hi) + "\n")
    write_png(OUT / "jezero-relief.png", hillshade(hi_elev))
    print("rocks", cells.count("rock"), "sand", cells.count("sand"), "ground", cells.count("ground"))
    print("wrote", OUT / "jezero.map.json")


if __name__ == "__main__":
    main()
