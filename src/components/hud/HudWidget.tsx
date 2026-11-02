import React, { useEffect, useRef } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Compass } from 'lucide-react';

export const HudWidget: React.FC = () => {
  const attitude = useTelemetryStore((state) => state.attitude);
  const vfr = useTelemetryStore((state) => state.vfr);
  const position = useTelemetryStore((state) => state.position);
  const gps = useTelemetryStore((state) => state.gps);
  const missionWaypoints = useTelemetryStore((state) => state.missionWaypoints);
  const currentWaypointSeq = useTelemetryStore((state) => state.currentWaypointSeq);
  const imu = useTelemetryStore((state) => state.imu);
  const { formatSpeed, formatAltitude, formatClimb, system: unitSystem, altitudeMode } = useUnitsStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpmStateRef = useRef<{ gamma: number; delta: number; initialized: boolean }>({ gamma: 0, delta: 0, initialized: false });

  // Register subscription for high-frequency attitude, VFR, and IMU
  useEffect(() => {
    messageRateManager.registerRequirement('hud-attitude', MAVLINK_MSG_ID.ATTITUDE);
    messageRateManager.registerRequirement('hud-vfr', MAVLINK_MSG_ID.VFR_HUD);
    messageRateManager.registerRequirement('hud-pos', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
    messageRateManager.registerRequirement('hud-gps', MAVLINK_MSG_ID.GPS_RAW_INT);
    messageRateManager.registerRequirement('hud-imu', MAVLINK_MSG_ID.RAW_IMU);
    messageRateManager.registerRequirement('hud-scaled-imu', MAVLINK_MSG_ID.SCALED_IMU);
    messageRateManager.registerRequirement('hud-highres-imu', MAVLINK_MSG_ID.HIGHRES_IMU);
    return () => {
      messageRateManager.unregisterRequirement('hud-attitude');
      messageRateManager.unregisterRequirement('hud-vfr');
      messageRateManager.unregisterRequirement('hud-pos');
      messageRateManager.unregisterRequirement('hud-gps');
      messageRateManager.unregisterRequirement('hud-imu');
      messageRateManager.unregisterRequirement('hud-scaled-imu');
      messageRateManager.unregisterRequirement('hud-highres-imu');
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const cx = width / 2;
    const cy = height / 2;

    // =========================================================
    // Clear Background - Deep cockpit glass with true optical vignette falloff
    // =========================================================
    ctx.fillStyle = '#051509';
    ctx.fillRect(0, 0, width, height);

    // Smooth optical falloff toward corners (pure dark falloff, zero green donut/banding)
    const maxRadius = Math.hypot(cx, cy);
    const hudGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
    hudGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    hudGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.08)');
    hudGrad.addColorStop(0.75, 'rgba(0, 0, 0, 0.45)');
    hudGrad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
    ctx.fillStyle = hudGrad;
    ctx.fillRect(0, 0, width, height);

    const HUD_GREEN = '#22c55e';
    const HUD_DIM_GREEN = 'rgba(34, 197, 94, 0.35)';
    const HUD_BRIGHT = '#4ade80';
    const HUD_HIGHLIGHT = '#86efac';

    ctx.save();

    // Inner viewport clipping
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    // =========================================================
    // 1. Artificial Horizon & Pitch Ladder (Rotates with roll)
    // =========================================================
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-attitude.roll);

    const PITCH_SCALE = 4.2; // Pixels per degree
    const pitchOffset = attitude.pitchDeg * PITCH_SCALE;
    ctx.translate(0, pitchOffset);

    // Horizon line with central 44px gap for boresight
    ctx.strokeStyle = HUD_GREEN;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([]);
    ctx.beginPath();
    // Left horizon segment
    ctx.moveTo(-width * 0.45, 0);
    ctx.lineTo(-24, 0);
    // Right horizon segment
    ctx.moveTo(24, 0);
    ctx.lineTo(width * 0.45, 0);
    ctx.stroke();

    // Pitch Ladder (MIL-STD style)
    ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let deg = -50; deg <= 50; deg += 5) {
      if (deg === 0) continue;
      const y = -deg * PITCH_SCALE;
      const isMajor = deg % 10 === 0;
      const armWidth = isMajor ? 32 : 18;
      const tickHeight = isMajor ? 6 : 4;

      if (deg > 0) {
        // Positive pitch: Solid line with downward ticks (toward horizon)
        ctx.strokeStyle = HUD_GREEN;
        ctx.fillStyle = HUD_BRIGHT;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);

        // Left arm
        ctx.beginPath();
        ctx.moveTo(-armWidth - 14, y);
        ctx.lineTo(-14, y);
        ctx.lineTo(-14, y + tickHeight);
        ctx.stroke();

        // Right arm
        ctx.beginPath();
        ctx.moveTo(14 + armWidth, y);
        ctx.lineTo(14, y);
        ctx.lineTo(14, y + tickHeight);
        ctx.stroke();

        if (isMajor) {
          ctx.fillText(deg.toString(), -armWidth - 24, y);
          ctx.fillText(deg.toString(), armWidth + 24, y);
        }
      } else {
        // Negative pitch: Dashed line with upward ticks (toward horizon)
        ctx.strokeStyle = HUD_GREEN;
        ctx.fillStyle = HUD_BRIGHT;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);

        // Left arm
        ctx.beginPath();
        ctx.moveTo(-armWidth - 14, y);
        ctx.lineTo(-14, y);
        ctx.lineTo(-14, y - tickHeight);
        ctx.stroke();

        // Right arm
        ctx.beginPath();
        ctx.moveTo(14 + armWidth, y);
        ctx.lineTo(14, y);
        ctx.lineTo(14, y - tickHeight);
        ctx.stroke();

        if (isMajor) {
          ctx.fillText(Math.abs(deg).toString(), -armWidth - 24, y);
          ctx.fillText(Math.abs(deg).toString(), armWidth + 24, y);
        }
      }
    }
    ctx.setLineDash([]);

    // =========================================================
    // 1b. Flight Path Marker (FPM) / Velocity Vector (The "Bird")
    // Conformal Earth-referenced trajectory marker anchored to the
    // artificial horizon and pitch ladder. In this horizon frame:
    // y = 0 is the horizon line (0° climb/descent).
    // y = -gamma * PITCH_SCALE is the flight path angle.
    // x = delta * PITCH_SCALE is the drift angle (Track - Heading).
    // Roll and pitch maneuvers translate/rotate the frame in hardware
    // sync, eliminating all lag, jitter, and rubber-banding.
    // =========================================================
    let vn = position.vx;
    let ve = position.vy;
    let vd = position.vz;

    // Fallback if position.vx/vy are not yet populated
    if (Math.hypot(vn, ve) < 0.1 && vfr.groundspeed > 0.1) {
      const hdgRad = (attitude.yawDeg * Math.PI) / 180;
      vn = vfr.groundspeed * Math.cos(hdgRad);
      ve = vfr.groundspeed * Math.sin(hdgRad);
      vd = -vfr.climb;
    }

    const gs = Math.hypot(vn, ve);
    const climb = Math.abs(vd) > 0.05 ? -vd : vfr.climb;

    // Flight Path Angle (gamma: degrees above horizon)
    let fpaDeg = 0;
    if (gs > 0.2) {
      fpaDeg = (Math.atan2(climb, gs) * 180) / Math.PI;
    }

    // Track (Course Over Ground) & Drift Angle relative to high-rate AHRS heading
    let driftDeg = 0;
    if (gs > 0.2) {
      let trackDeg = (Math.atan2(ve, vn) * 180) / Math.PI;
      if (trackDeg < 0) trackDeg += 360;

      driftDeg = trackDeg - attitude.yawDeg;
      while (driftDeg > 180) driftDeg -= 360;
      while (driftDeg < -180) driftDeg += 360;
    }

    // Always visible: when stationary (gs < 0.4), smoothly park the FPM on the
    // aircraft boresight/waterline (gamma = pitch, drift = 0).
    const blend = Math.min(1.0, Math.max(0.0, (gs - 0.4) / 0.8));
    const targetGamma = (1 - blend) * attitude.pitchDeg + blend * fpaDeg;
    const targetDelta = blend * driftDeg;

    // Filter in angular space with an EMA to absorb discrete GPS/baro step-updates
    if (!fpmStateRef.current.initialized) {
      fpmStateRef.current = { gamma: targetGamma, delta: targetDelta, initialized: true };
    } else {
      fpmStateRef.current.gamma += (targetGamma - fpmStateRef.current.gamma) * 0.35;
      fpmStateRef.current.delta += (targetDelta - fpmStateRef.current.delta) * 0.35;
    }

    const displayGamma = fpmStateRef.current.gamma;
    const displayDelta = fpmStateRef.current.delta;

    // Coordinates in the horizon frame
    const rawFpmX = displayDelta * PITCH_SCALE;
    const rawFpmY = -displayGamma * PITCH_SCALE;

    // Bounded within central corridor so it never overlaps speed/alt ladders
    const maxFpmX = width * 0.34;
    const maxFpmY = height * 0.38;
    const fpmX = Math.max(-maxFpmX, Math.min(maxFpmX, rawFpmX));
    const fpmY = Math.max(-maxFpmY, Math.min(maxFpmY, rawFpmY));
    const isCaged = Math.abs(rawFpmX) > maxFpmX || Math.abs(rawFpmY) > maxFpmY;

    // Draw the FPM Symbol:
    ctx.save();
    ctx.strokeStyle = HUD_HIGHLIGHT;
    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.lineWidth = 1.8;
    if (isCaged) {
      ctx.setLineDash([3, 2]); // Caged indicator
    } else {
      ctx.setLineDash([]);
    }

    // Center circle (5px radius)
    ctx.beginPath();
    ctx.arc(fpmX, fpmY, 5, 0, Math.PI * 2);
    ctx.stroke();

    // Left wing (10px wide)
    ctx.beginPath();
    ctx.moveTo(fpmX - 5, fpmY);
    ctx.lineTo(fpmX - 15, fpmY);
    ctx.stroke();

    // Right wing (10px wide)
    ctx.beginPath();
    ctx.moveTo(fpmX + 5, fpmY);
    ctx.lineTo(fpmX + 15, fpmY);
    ctx.stroke();

    // Top vertical fin (6px tall)
    ctx.beginPath();
    ctx.moveTo(fpmX, fpmY - 5);
    ctx.lineTo(fpmX, fpmY - 11);
    ctx.stroke();

    // Center precision pip
    ctx.beginPath();
    ctx.arc(fpmX, fpmY, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.restore();

    // =========================================================
    // 2. Aircraft Waterline / Boresight Reticle (Fixed center)
    // =========================================================
    ctx.strokeStyle = HUD_BRIGHT;
    ctx.fillStyle = HUD_BRIGHT;
    ctx.lineWidth = 2.0;

    // Waterline symbol: center inverted caret with side wings
    ctx.beginPath();
    // Center caret
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx + 5, cy);
    // Left wing
    ctx.moveTo(cx - 30, cy);
    ctx.lineTo(cx - 10, cy);
    // Right wing
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 30, cy);
    ctx.stroke();

    // Center tiny dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // =========================================================
    // 3. Roll Index & Bank Angle Scale (Continuous bottom arc)
    // =========================================================
    ctx.save();
    const rollRadius = Math.min(cx * 0.72, cy - 40);
    ctx.strokeStyle = HUD_DIM_GREEN;
    ctx.lineWidth = 1.3;

    // Continuous unbroken arc spanning full scale from -60° to +60°
    // (In canvas 2D: 0 rad is 3 o'clock, 90° (PI/2) is 6 o'clock straight down)
    // -60° bank = 30° in canvas = (30 * PI) / 180
    // +60° bank = 150° in canvas = (150 * PI) / 180
    ctx.beginPath();
    ctx.arc(cx, cy, rollRadius, (30 * Math.PI) / 180, (150 * Math.PI) / 180);
    ctx.stroke();

    // Bank angle tick marks anchored to continuous arc
    [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].forEach((ang) => {
      const rad = (ang + 90) * (Math.PI / 180);
      const isMajor = Math.abs(ang) === 30 || Math.abs(ang) === 60 || ang === 0;
      const r1 = rollRadius - (isMajor ? 7 : 4);
      const r2 = rollRadius;
      ctx.beginPath();
      ctx.moveTo(cx + r1 * Math.cos(rad), cy + r1 * Math.sin(rad));
      ctx.lineTo(cx + r2 * Math.cos(rad), cy + r2 * Math.sin(rad));
      ctx.strokeStyle = isMajor ? HUD_GREEN : HUD_DIM_GREEN;
      ctx.lineWidth = isMajor ? 1.4 : 1.0;
      ctx.stroke();
    });

    // Roll indicator pointer triangle (glides along continuous arc)
    ctx.translate(cx, cy);
    ctx.rotate(-attitude.roll);
    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.beginPath();
    ctx.moveTo(0, rollRadius - 2);
    ctx.lineTo(-4, rollRadius - 10);
    ctx.lineTo(4, rollRadius - 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // =========================================================
    // 4. Moving Heading Compass Tape (Top) - Smooth scrolling fix
    // =========================================================
    const tapeY = 18;
    const tapeWidth = Math.min(280, width - 110);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - tapeWidth / 2, 0, tapeWidth, 36);
    ctx.clip();

    const degPx = 4; // 4 pixels per compass degree
    const curHdg = ((vfr.heading % 360) + 360) % 360;

    // Compute visible compass degree range based on tape width
    const visibleRange = Math.ceil(tapeWidth / 2 / degPx) + 5;
    const startDeg = Math.floor((curHdg - visibleRange) / 5) * 5;
    const endDeg = Math.ceil((curHdg + visibleRange) / 5) * 5;

    for (let d = startDeg; d <= endDeg; d += 5) {
      const normDeg = ((d % 360) + 360) % 360;
      const x = cx + (d - curHdg) * degPx;

      const isCard = normDeg % 90 === 0;
      const isMajor = normDeg % 30 === 0;
      const isTen = normDeg % 10 === 0;

      const tickLen = isCard ? 10 : isMajor ? 8 : isTen ? 5 : 3;

      ctx.strokeStyle = isCard ? HUD_HIGHLIGHT : isMajor ? HUD_BRIGHT : HUD_DIM_GREEN;
      ctx.lineWidth = isCard ? 2.0 : isMajor ? 1.4 : 1.0;
      ctx.beginPath();
      ctx.moveTo(x, tapeY);
      ctx.lineTo(x, tapeY + tickLen);
      ctx.stroke();

      if (isCard) {
        ctx.fillStyle = HUD_HIGHLIGHT;
        ctx.font = 'bold 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = normDeg === 0 ? 'N' : normDeg === 90 ? 'E' : normDeg === 180 ? 'S' : 'W';
        ctx.fillText(label, x, tapeY + 12);
      } else if (isMajor) {
        ctx.fillStyle = HUD_BRIGHT;
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText((normDeg / 10).toFixed(0).padStart(2, '0'), x, tapeY + 12);
      }
    }
    ctx.restore();

    // Central Heading Caret & Digital Heading Box
    ctx.strokeStyle = HUD_BRIGHT;
    ctx.fillStyle = HUD_BRIGHT;
    ctx.beginPath();
    ctx.moveTo(cx, tapeY + 3);
    ctx.lineTo(cx - 4, tapeY - 4);
    ctx.lineTo(cx + 4, tapeY - 4);
    ctx.closePath();
    ctx.fill();

    // Digital Heading Box
    ctx.fillStyle = 'rgba(2, 5, 4, 0.92)';
    ctx.strokeStyle = HUD_GREEN;
    ctx.lineWidth = 1.2;
    ctx.fillRect(cx - 24, 2, 48, 14);
    ctx.strokeRect(cx - 24, 2, 48, 14);
    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${curHdg.toFixed(0).padStart(3, '0')}°`, cx, 9);

    // =========================================================
    // 5. Left: Airspeed / Groundspeed Ladder & Prominent IAS
    // =========================================================
    const spdBoxX = 10;
    const spdBoxW = 62;
    const spdBoxH = 30;
    const spdBoxY = cy - spdBoxH / 2;

    // Speed vertical bracket
    ctx.strokeStyle = HUD_DIM_GREEN;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(spdBoxX + spdBoxW, cy - 65);
    ctx.lineTo(spdBoxX + spdBoxW, cy + 65);
    ctx.stroke();

    // Prominent Speed: Indicated Airspeed (IAS)
    const isKtsMode = unitSystem === 'kts';
    const iasKts = vfr.airspeed * 1.943844;
    const gsKts = vfr.groundspeed * 1.943844;

    const primarySpeedVal = isKtsMode
      ? (iasKts >= 100 ? iasKts.toFixed(0) : iasKts.toFixed(1))
      : formatSpeed(vfr.airspeed).value;
    const primarySpeedUnit = isKtsMode ? 'KIAS' : `IAS ${formatSpeed(vfr.airspeed).unit.toUpperCase()}`;

    // Current Speed Value Box (Mask pitch ladders)
    ctx.fillStyle = 'rgba(2, 5, 4, 0.94)';
    ctx.strokeStyle = HUD_BRIGHT;
    ctx.lineWidth = 1.5;
    ctx.fillRect(spdBoxX, spdBoxY, spdBoxW, spdBoxH);
    ctx.strokeRect(spdBoxX, spdBoxY, spdBoxW, spdBoxH);

    // Pointer to bracket
    ctx.fillStyle = HUD_BRIGHT;
    ctx.beginPath();
    ctx.moveTo(spdBoxX + spdBoxW, cy);
    ctx.lineTo(spdBoxX + spdBoxW + 5, cy);
    ctx.stroke();

    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(primarySpeedVal, spdBoxX + spdBoxW / 2, spdBoxY + 10);

    ctx.fillStyle = HUD_BRIGHT;
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.fillText(primarySpeedUnit, spdBoxX + spdBoxW / 2, spdBoxY + 22);

    // Groundspeed readout beneath box (Mask pitch ladders)
    const gsVal = isKtsMode
      ? (gsKts >= 100 ? gsKts.toFixed(0) : gsKts.toFixed(1))
      : formatSpeed(vfr.groundspeed).value;
    const gsUnit = isKtsMode ? 'KGS' : formatSpeed(vfr.groundspeed).unit.toUpperCase();
    const gsText = isKtsMode ? `${gsVal} ${gsUnit}` : `GS ${gsVal} ${gsUnit}`;

    const gsMetrics = ctx.measureText(gsText);
    const gsW = gsMetrics.width + 8;
    const gsH = 15;
    const gsY = spdBoxY + spdBoxH + 4;

    ctx.fillStyle = 'rgba(2, 5, 4, 0.9)';
    ctx.fillRect(spdBoxX, gsY, gsW, gsH);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(spdBoxX, gsY, gsW, gsH);

    ctx.fillStyle = HUD_BRIGHT;
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(gsText, spdBoxX + 4, gsY + gsH / 2);

    // =========================================================
    // 6. Right: Altitude Ladder & Box
    // =========================================================
    const altBoxW = 62;
    const altBoxX = width - altBoxW - 10;
    const altBoxH = 30;
    const altBoxY = cy - altBoxH / 2;

    // Altitude vertical bracket
    ctx.strokeStyle = HUD_DIM_GREEN;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(altBoxX, cy - 65);
    ctx.lineTo(altBoxX, cy + 65);
    ctx.stroke();

    // Current Altitude Value Box (Mask pitch ladders)
    ctx.fillStyle = 'rgba(2, 5, 4, 0.94)';
    ctx.strokeStyle = HUD_BRIGHT;
    ctx.lineWidth = 1.5;
    ctx.fillRect(altBoxX, altBoxY, altBoxW, altBoxH);
    ctx.strokeRect(altBoxX, altBoxY, altBoxW, altBoxH);

    // Pointer to bracket
    ctx.fillStyle = HUD_BRIGHT;
    ctx.beginPath();
    ctx.moveTo(altBoxX, cy);
    ctx.lineTo(altBoxX - 5, cy);
    ctx.stroke();

    const rawAltM =
      altitudeMode === 'msl'
        ? position.alt !== 0
          ? position.alt
          : vfr.alt
        : position.relativeAlt !== 0
        ? position.relativeAlt
        : vfr.alt;
    const altFormatted = formatAltitude(rawAltM);
    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(altFormatted.value, altBoxX + altBoxW / 2, altBoxY + 10);

    ctx.fillStyle = HUD_BRIGHT;
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.fillText(`${altFormatted.unit.toUpperCase()} ${altitudeMode.toUpperCase()}`, altBoxX + altBoxW / 2, altBoxY + 22);

    // Vertical Speed / Climb Rate readout beneath box (Mask pitch ladders)
    const climbFormatted = formatClimb(vfr.climb);
    const vviText = climbFormatted.full;
    const vviMetrics = ctx.measureText(vviText);
    const vviW = vviMetrics.width + 8;
    const vviH = 15;
    const vviY = altBoxY + altBoxH + 4;
    const vviX = width - vviW - 10;

    ctx.fillStyle = 'rgba(2, 5, 4, 0.9)';
    ctx.fillRect(vviX, vviY, vviW, vviH);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vviX, vviY, vviW, vviH);

    ctx.fillStyle = Math.abs(vfr.climb) > 0.3 ? HUD_HIGHLIGHT : HUD_BRIGHT;
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(vviText, vviX + 4, vviY + vviH / 2);

    // =========================================================
    // 7. Bottom Status Readout (WP N/NNN and THR with Masking)
    // =========================================================
    const bottomY = height - 12;
    const rawTotalWps = missionWaypoints.length;
    // Human readable waypoint count excludes WP 0 (Home position)
    const totalWps = Math.max(0, rawTotalWps - 1);
    const currentWp = currentWaypointSeq ?? missionWaypoints.find((w) => w.current)?.seq ?? 0;
    const wpText = totalWps > 0 ? `WP ${currentWp}/${totalWps}` : 'WP 0/0';
    const thrText = `THR: ${Math.round(vfr.throttle)}%`;

    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';

    // Lower Left: WP N/NNN with mask
    const wpMetrics = ctx.measureText(wpText);
    const wpPadX = 7;
    const wpBoxW = wpMetrics.width + wpPadX * 2;
    const wpBoxH = 20;
    const wpBoxX = 10;
    const wpBoxY = bottomY - wpBoxH / 2;

    ctx.fillStyle = 'rgba(2, 5, 4, 0.92)';
    ctx.fillRect(wpBoxX, wpBoxY, wpBoxW, wpBoxH);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(wpBoxX, wpBoxY, wpBoxW, wpBoxH);

    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.textAlign = 'left';
    ctx.fillText(wpText, wpBoxX + wpPadX, bottomY);

    // Lower Right: THR with mask
    const thrMetrics = ctx.measureText(thrText);
    const thrBoxW = thrMetrics.width + wpPadX * 2;
    const thrBoxH = 20;
    const thrBoxX = width - thrBoxW - 10;
    const thrBoxY = bottomY - thrBoxH / 2;

    ctx.fillStyle = 'rgba(2, 5, 4, 0.92)';
    ctx.fillRect(thrBoxX, thrBoxY, thrBoxW, thrBoxH);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(thrBoxX, thrBoxY, thrBoxW, thrBoxH);

    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.textAlign = 'left';
    ctx.fillText(thrText, thrBoxX + wpPadX, bottomY);

    // =========================================================
    // 8. Upper Left: Normal Load Factor (Nz) in G
    // =========================================================
    const nzVal =
      imu && imu.nz !== 0 && !isNaN(imu.nz)
        ? imu.nz
        : Math.min(9.9, Math.max(-4.0, 1 / Math.max(0.15, Math.cos(attitude.roll))));
    const nzText = `${nzVal.toFixed(1)} G`;

    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';

    const nzMetrics = ctx.measureText(nzText);
    const nzPadX = 7;
    const nzBoxW = nzMetrics.width + nzPadX * 2;
    const nzBoxH = 20;
    const nzBoxX = 10;
    const nzBoxY = 16 - nzBoxH / 2;

    ctx.fillStyle = 'rgba(2, 5, 4, 0.92)';
    ctx.fillRect(nzBoxX, nzBoxY, nzBoxW, nzBoxH);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(nzBoxX, nzBoxY, nzBoxW, nzBoxH);

    ctx.fillStyle = HUD_HIGHLIGHT;
    ctx.textAlign = 'left';
    ctx.fillText(nzText, nzBoxX + nzPadX, 16);

    ctx.restore();
  }, [attitude, vfr, position, missionWaypoints, currentWaypointSeq, imu, unitSystem, altitudeMode, formatSpeed, formatAltitude, formatClimb]);

  return (
    <Card className="h-full border-zinc-800 bg-zinc-950 shadow-lg overflow-hidden flex flex-col">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Compass className="h-3.5 w-3.5 text-sky-400" />
          Heads-Up Display (HUD)
        </CardTitle>
        <span className="text-[10px] font-mono text-zinc-500 uppercase">
          {altitudeMode.toUpperCase()} • {unitSystem.toUpperCase()}
        </span>
      </CardHeader>
      <CardContent className="p-0 flex-1 relative w-full flex items-center justify-center min-h-[340px]">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </CardContent>
    </Card>
  );
};
