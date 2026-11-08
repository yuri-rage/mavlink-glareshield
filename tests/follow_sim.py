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
import sys

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


def run_stop_and_move(
    speed_px_s: float = 15.9,
    gps_hz: float = 3.0,
    mode: str = "push",  # "push" (shipped), "mutate" (in-place stationary refresh), "unhandled"
    stop_t: float = 3.15,  # Stop between fixes to uncover mid-interval transition jumps
    resume_t: float = 8.15,
) -> dict[str, str]:
    """
    Simulate a vehicle cruising, stopping between GPS fix boundaries, hovering stationary,
    then resuming flight.
    """
    t = 0.0
    fixes: list[tuple[float, float, float]] = []  # (t_arrival, time_boot_ms, x)
    next_fix = 0.0
    marker = cam = 0.0
    prev_marker = 0.0
    frame_vels: list[float] = []
    backward_jumps_m: list[float] = []

    while t < 12.0:
        if t < stop_t:
            true_x = speed_px_s * t
        elif t < resume_t:
            true_x = speed_px_s * stop_t
        else:
            true_x = speed_px_s * stop_t + speed_px_s * (t - resume_t)

        # GPS fix delivery (every 1/gps_hz from autopilot with incrementing time_boot_ms)
        if t >= next_fix - 1e-9:
            time_boot_ms = t * 1000.0
            if fixes and abs(true_x - fixes[-1][2]) < 1e-6 and mode == "mutate":
                # Legacy stationary branch: update timestamp on stationary fixes in-place
                fixes[-1] = (t, time_boot_ms, true_x)
            else:
                # Shipped: push every fix normally into buffer
                fixes.append((t, time_boot_ms, true_x))
            next_fix += 1.0 / gps_hz

        if len(fixes) >= 2:
            (t0, boot0, x0), (t1, boot1, x1) = fixes[-2], fixes[-1]
            if mode == "unhandled":
                fix_dt = t1 - t0
                if fix_dt > 1e-6:
                    u = min(max((t - t1) / fix_dt, 0.0), 1.0)
                    marker = x0 + (x1 - x0) * u
                else:
                    marker = x1
            else:
                boot_dt = (boot1 - boot0) / 1000.0
                fix_dt = boot_dt if 0.010 <= boot_dt <= 1.0 else (t1 - t0)
                if fix_dt > 1.0:
                    marker = x1
                elif fix_dt > 1e-6:
                    u = min(max((t - t1) / fix_dt, 0.0), 1.0)
                    marker = x0 + (x1 - x0) * u
                else:
                    marker = x1
        elif fixes:
            marker = fixes[-1][2]

        step = round(marker - cam)
        cam += step

        step_m = (marker - prev_marker) / speed_px_s * 15.0
        if t > stop_t and t < resume_t and step_m < -0.01:
            backward_jumps_m.append(abs(step_m))

        if t > 0.1:
            frame_vels.append((marker - prev_marker) * FPS)
        prev_marker = marker
        t += DT

    # Velocity and single-frame jump around resume window
    idx_start = int((resume_t - 0.2) * FPS)
    idx_end = int((resume_t + 1.0) * FPS)
    resume_window = frame_vels[idx_start:idx_end]
    max_frame_step_m = max(resume_window) / FPS / speed_px_s * 15.0

    return {
        "max_resume_step_m": f"{max_frame_step_m:4.2f} m",
        "normal_frame_step_m": f"{15.0 / FPS:4.2f} m",
        "backward_jumps_count": f"{len(backward_jumps_m)}",
        "max_backward_jump_m": f"{max(backward_jumps_m) if backward_jumps_m else 0.0:4.2f} m",
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

    print("\n=== Stop-and-Move Transition Simulation (stop between fixes at 3.15s -> hover -> resume at 8.15s) ===")
    res_mutate = run_stop_and_move(mode="mutate")
    res_shipped = run_stop_and_move(mode="push")
    res_unhandled = run_stop_and_move(mode="unhandled")
    print(f"Mutate stationary: backward jumps: {res_mutate['backward_jumps_count']} (largest: {res_mutate['max_backward_jump_m']}), resume step: {res_mutate['max_resume_step_m']}")
    print(f"Shipped push:      backward jumps: {res_shipped['backward_jumps_count']} (largest: {res_shipped['max_backward_jump_m']}), resume step: {res_shipped['max_resume_step_m']} (normal: {res_shipped['normal_frame_step_m']})")
    print(f"Unhandled gap:     backward jumps: {res_unhandled['backward_jumps_count']}, resume step: {res_unhandled['max_resume_step_m']}")

    # --- Assertions: the shipped algorithm must keep these properties (exit 1 otherwise) --------------------------
    failures: list[str] = []

    def num(text: str) -> float:
        return float(str(text).split()[0])

    for zoom, pxs in [(17, 15.9), (19, 63.5)]:
        for hz in [1.5, 3.0, 6.0]:
            shp = run(pxs, hz, mode="shipped")
            lo, hi = (float(x) for x in str(shp["speed min/max (x true)"]).split("/"))
            if not (0.95 <= lo and hi <= 1.05):
                failures.append(f"zoom {zoom} GPS {hz} Hz: marker speed {lo:.2f}-{hi:.2f}x true (want 0.95-1.05)")
            off_max = float(str(shp["vehicle off-centre px (mean/max)"]).split("/")[1])
            if off_max > 1.0:
                failures.append(f"zoom {zoom} GPS {hz} Hz: vehicle {off_max:.1f} px off centre (want <= 1)")

    if num(res_shipped["backward_jumps_count"]) != 0:
        failures.append(f"stop-and-move: {res_shipped['backward_jumps_count']} backward jumps (want 0)")
    if num(res_shipped["max_resume_step_m"]) > 2 * num(res_shipped["normal_frame_step_m"]):
        failures.append(f"stop-and-move: resume step {res_shipped['max_resume_step_m']} (want <= 2x {res_shipped['normal_frame_step_m']})")
    # The simulation must still be able to see the problem the gap handling fixes.
    if num(res_mutate["backward_jumps_count"]) == 0:
        failures.append("stop-and-move: the in-place stationary refresh no longer shows backward jumps; the simulation has lost its sensitivity")

    if failures:
        print("\nFAILED:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print("\nAll follow-loop checks passed")
