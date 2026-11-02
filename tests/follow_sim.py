"""
Simulation and regression tests for MapWidget's follow loop (src/components/map/MapWidget.tsx).

Evaluates:
1. Steady-state follow:
   - Shipped algorithm: linear interpolation played back one fix-interval late,
     camera locked to marker with integer pixel panBy (round(dx)).
   - Legacy algorithm: exponential chase with deadband panBy.
2. Stop-and-move transition (hover then resume):
   - Unhandled gap: stale timestamps produce slow crawl followed by multi-meter jump.
   - Shipped gap handling: stationary timestamp refresh and >1.0s gap snap ensure
     smooth resume with zero jump.
"""

from __future__ import annotations

import math
import statistics as st

FPS = 60.0
DT = 1.0 / FPS


def run(speed_px_s: float, gps_hz: float, secs: float = 10.0, mode: str = "shipped") -> dict[str, str | list[float]]:
    t = 0.0
    fixes: list[tuple[float, float]] = []  # (time, x) of received fixes
    next_fix = 0.0
    marker = cam = 0.0  # world-pixel positions
    marker_hist: list[float] = []
    cam_steps: list[float] = []
    offsets: list[float] = []

    while t < secs:
        if t >= next_fix - 1e-9:
            fixes.append((t, speed_px_s * t))
            next_fix += 1.0 / gps_hz

        if mode == "legacy":
            target = fixes[-1][1]
            marker += (target - marker) * (1.0 - math.exp(-DT * 15.0))
            d = marker - cam
            step = 0
            if abs(d) >= 2.0:
                step = round(d * (1.0 - math.exp(-DT * 10.0)))
            cam += step
            cam_steps.append(abs(step))
        else:  # shipped
            if len(fixes) >= 2:
                (t0, x0), (t1, x1) = fixes[-2], fixes[-1]
                fix_dt = t1 - t0
                if 1e-6 < fix_dt <= 1.0:
                    u = min(max((t - t1) / fix_dt, 0.0), 1.0)
                    marker = x0 + (x1 - x0) * u
                else:
                    marker = x1
            elif fixes:
                marker = fixes[-1][1]

            # Shipped camera follow: whole-pixel step toward marker
            dx = marker - cam
            step = round(dx)
            cam += step
            cam_steps.append(abs(step))

        marker_hist.append(marker)
        offsets.append(marker - cam)
        t += DT

    # Skip initial settling second
    k = int(FPS)
    vel = [(b - a) * FPS for a, b in zip(marker_hist[k:], marker_hist[k + 1 :])]
    steps = cam_steps[k:]
    off = offsets[k:]
    lag = speed_px_s * secs - marker_hist[-1]

    return {
        "speed min/max (x true)": f"{min(vel) / speed_px_s:4.2f} / {max(vel) / speed_px_s:4.2f}",
        "frames marker ~stopped": f"{sum(1 for v in vel if v < 0.05 * speed_px_s) / len(vel):4.0%}",
        "camera idle frames": f"{sum(1 for s in steps if s < 1e-6) / len(steps):4.0%}",
        "camera steps px": [float(x) for x in sorted({round(s, 2) for s in steps})[:5]],
        "vehicle off-centre px (mean/max)": f"{st.mean(abs(o) for o in off):4.1f} / {max(abs(o) for o in off):4.1f}",
        "marker lag behind truth (m)": f"{lag / speed_px_s * 15.0:4.1f}",
    }


def run_stop_and_move(speed_px_s: float = 15.9, gps_hz: float = 3.0, handle_gap: bool = True) -> dict[str, str]:
    """
    Simulate a vehicle cruising for 3s, hovering stationary for 5s (3s-8s),
    then resuming flight from 8s-12s.
    """
    t = 0.0
    fixes: list[tuple[float, float]] = []
    next_fix = 0.0
    marker = cam = 0.0
    prev_marker = 0.0
    frame_vels: list[float] = []

    while t < 12.0:
        if t < 3.0:
            true_x = speed_px_s * t
        elif t < 8.0:
            true_x = speed_px_s * 3.0
        else:
            true_x = speed_px_s * 3.0 + speed_px_s * (t - 8.0)

        # GPS fix delivery
        if t >= next_fix - 1e-9:
            if fixes and abs(true_x - fixes[-1][1]) < 1e-6:
                if handle_gap:
                    # Shipped behavior: update timestamp on stationary fixes
                    fixes[-1] = (t, true_x)
            else:
                fixes.append((t, true_x))
            next_fix += 1.0 / gps_hz

        if len(fixes) >= 2:
            (t0, x0), (t1, x1) = fixes[-2], fixes[-1]
            fix_dt = t1 - t0
            if handle_gap and fix_dt > 1.0:
                marker = x1
            elif fix_dt > 1e-6:
                u = min(max((t - t1) / fix_dt, 0.0), 1.0)
                marker = x0 + (x1 - x0) * u
            else:
                marker = x1
        elif fixes:
            marker = fixes[-1][1]

        step = round(marker - cam)
        cam += step

        if t > 0.1:
            frame_vels.append((marker - prev_marker) * FPS)
        prev_marker = marker
        t += DT

    # Velocity and single-frame jump around resume window (7.8s to 9.0s)
    idx_start = int(7.8 * FPS)
    idx_end = int(9.0 * FPS)
    resume_window = frame_vels[idx_start:idx_end]
    max_frame_step_m = max(resume_window) / FPS / speed_px_s * 15.0

    return {
        "max_resume_step_m": f"{max_frame_step_m:4.2f} m",
        "normal_frame_step_m": f"{15.0 / FPS:4.2f} m",
    }


if __name__ == "__main__":
    print("=== Steady State Follow Simulation ===")
    for zoom, pxs in [(17, 15.9), (19, 63.5)]:
        for hz in [1.5, 3.0, 6.0]:
            leg = run(pxs, hz, mode="legacy")
            shp = run(pxs, hz, mode="shipped")
            print(f"zoom {zoom}, GPS {hz} Hz")
            for k in leg:
                print(f"   {k:34s} legacy: {leg[k]!s:26s} shipped: {shp[k]}")

    print("\n=== Stop-and-Move Transition Simulation (3s cruise -> 5s hover -> resume) ===")
    res_unhandled = run_stop_and_move(handle_gap=False)
    res_shipped = run_stop_and_move(handle_gap=True)
    print(f"Unhandled gap: max single-frame step on resume: {res_unhandled['max_resume_step_m']} (crawl then jump)")
    print(f"Shipped gap:   max single-frame step on resume: {res_shipped['max_resume_step_m']} (normal: {res_shipped['normal_frame_step_m']})")
