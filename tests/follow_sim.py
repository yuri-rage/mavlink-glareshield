"""
Replay MapWidget's follow loop (src/components/map/MapWidget.tsx animate()) at a steady 60 fps
with GPS fixes arriving at a fixed rate, in screen pixels.

Current algorithm, as written:
  marker  += (target - marker) * (1 - exp(-dt*15))           # exponential chase of last fix
  camera: dx = marker - centre; if |d| >= 2px:
            if |d| > 180: animated panTo (ignored here; never triggers at these speeds)
            else panBy(round(dx * (1 - exp(-dt*10))))           # Leaflet panBy rounds to whole pixels

Alternative for comparison:
  marker  = linear interpolation between the last two fixes, displayed one fix-interval late
  camera  = locked to marker (setView/panBy by the exact sub-pixel offset each frame)
"""

import math
import statistics as st

FPS = 60.0
DT = 1 / FPS


def run(speed_px_s, gps_hz, secs=10.0, mode="current"):
    t = 0.0
    fixes = []  # (time, x) of received fixes
    next_fix = 0.0
    marker = cam = 0.0  # world-pixel positions (1-D motion is enough)
    marker_hist, cam_steps, offsets = [], [], []
    while t < secs:
        if (
            t >= next_fix - 1e-9
        ):  # a GPS fix arrives with the true position at that instant
            fixes.append((t, speed_px_s * t))
            next_fix += 1 / gps_hz
        if mode == "current":
            target = fixes[-1][1]
            marker += (target - marker) * (1 - math.exp(-DT * 15))
            d = marker - cam
            step = 0
            if abs(d) >= 2.0:
                step = round(
                    d * (1 - math.exp(-DT * 10))
                )  # Leaflet Map.panBy: toPoint(offset).round()
            cam += step
            cam_steps.append(abs(step))
        else:
            if len(fixes) >= 2:
                (t0, x0), (t1, x1) = fixes[-2], fixes[-1]
                u = min(
                    max((t - t1) / (t1 - t0), 0.0), 1.0
                )  # play back one interval late
                marker = x0 + (x1 - x0) * u
            cam_steps.append(abs(marker - cam))
            cam = marker
        marker_hist.append(marker)
        offsets.append(marker - cam)
        t += DT
    # skip the first second while things settle
    k = int(FPS)
    vel = [(b - a) * FPS for a, b in zip(marker_hist[k:], marker_hist[k + 1 :])]
    steps = cam_steps[k:]
    off = offsets[k:]
    lag = speed_px_s * secs - marker_hist[-1]
    return {
        "speed min/max (x true)": f"{min(vel) / speed_px_s:4.2f} / {max(vel) / speed_px_s:4.2f}",
        "frames marker ~stopped": f"{sum(1 for v in vel if v < 0.05 * speed_px_s) / len(vel):4.0%}",
        "camera idle frames": f"{sum(1 for s in steps if s < 1e-6) / len(steps):4.0%}",
        "camera steps px": sorted({round(s, 2) for s in steps})[:5],
        "vehicle off-centre px (mean/max)": f"{st.mean(abs(o) for o in off):4.1f} / {max(abs(o) for o in off):4.1f}",
        "marker lag behind truth (m)": f"{lag / speed_px_s * 15:4.1f}",  # convert px lag back to metres at 15 m/s
    }


# 15 m/s vehicle. Zoom 17 ≈ 0.945 m/px at lat 37.8 → 15.9 px/s; zoom 19 → 63.5 px/s.
# GPS rate: GLOBAL_POSITION_INT is requested at 3 Hz on "standard", 1.5 Hz on "low", 6 Hz on "high".
for zoom, pxs in [(17, 15.9), (19, 63.5)]:
    for hz in [1.5, 3, 6]:
        cur = run(pxs, hz, mode="current")
        alt = run(pxs, hz, mode="interp")
        print(f"zoom {zoom}, GPS {hz} Hz")
        for k in cur:
            print(f"   {k:34s} current: {cur[k]!s:26s} interp+locked: {alt[k]}")
