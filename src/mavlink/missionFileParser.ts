import { MissionItemIntData } from './encoder';

export type MissionFileType = 'mission' | 'fence' | 'rally';

export interface ParsedMissionFile {
  type: MissionFileType;
  missionType: number; // 0 = mission, 1 = fence, 2 = rally
  items: MissionItemIntData[];
  rawDat?: Uint8Array;
  filename: string;
}

/**
 * Packs MissionItemIntData array into ArduPilot MAVFTP binary .dat file format (0x763d).
 * 10-byte header + 38 bytes per item.
 */
export function packDatFile(items: MissionItemIntData[], missionType: number): Uint8Array {
  const headerSize = 10;
  const itemSize = 38;
  const totalSize = headerSize + items.length * itemSize;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // Header (10 bytes):
  // 0..1: magic (0x763d)
  // 2..3: data_type (0=mission, 1=fence, 2=rally)
  // 4..5: options (0)
  // 6..7: start (0)
  // 8..9: num_items
  view.setUint16(0, 0x763d, true);
  view.setUint16(2, missionType, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, items.length, true);

  let offset = headerSize;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    view.setFloat32(offset + 0, item.param1 ?? 0, true);
    view.setFloat32(offset + 4, item.param2 ?? 0, true);
    view.setFloat32(offset + 8, item.param3 ?? 0, true);
    view.setFloat32(offset + 12, item.param4 ?? 0, true);
    view.setInt32(offset + 16, Math.round((item.x ?? 0) * 1e7), true);
    view.setInt32(offset + 20, Math.round((item.y ?? 0) * 1e7), true);
    view.setFloat32(offset + 24, item.z ?? 0, true);
    view.setUint16(offset + 28, item.seq ?? i, true);
    view.setUint16(offset + 30, item.command ?? 16, true);
    view.setUint8(offset + 32, 0); // target_system
    view.setUint8(offset + 33, 0); // target_component
    view.setUint8(offset + 34, item.frame ?? 3); // MAV_FRAME_GLOBAL_RELATIVE_ALT
    view.setUint8(offset + 35, item.current ? 1 : 0);
    view.setUint8(offset + 36, item.autocontinue ? 1 : 0);
    view.setUint8(offset + 37, missionType);

    offset += itemSize;
  }

  return buffer;
}

/**
 * Parses QGC WPL text format lines.
 * Line format: seq, current, frame, command, p1, p2, p3, p4, lat(x), lon(y), alt(z), autocontinue
 */
export function parseQgcWplText(text: string): MissionItemIntData[] {
  const lines = text.split(/\r?\n/);
  const items: MissionItemIntData[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Skip QGC header lines like "QGC WPL 110" or "QGC FENCE 110"
    if (line.toUpperCase().startsWith('QGC')) continue;

    const parts = line.split(/[\t\s]+/).filter(Boolean);
    if (parts.length < 11) continue;

    const seq = parseInt(parts[0], 10);
    const current = parseInt(parts[1], 10) === 1;
    const frame = parseInt(parts[2], 10);
    const command = parseInt(parts[3], 10);
    const p1 = parseFloat(parts[4]);
    const p2 = parseFloat(parts[5]);
    const p3 = parseFloat(parts[6]);
    const p4 = parseFloat(parts[7]);
    const x = parseFloat(parts[8]); // lat
    const y = parseFloat(parts[9]); // lon
    const z = parseFloat(parts[10]); // alt
    const autocontinue = parts.length > 11 ? parseInt(parts[11], 10) === 1 : true;

    if (isNaN(seq) || isNaN(command) || isNaN(x) || isNaN(y)) continue;

    items.push({
      seq,
      command,
      current,
      frame: isNaN(frame) ? 3 : frame,
      param1: isNaN(p1) ? 0 : p1,
      param2: isNaN(p2) ? 0 : p2,
      param3: isNaN(p3) ? 0 : p3,
      param4: isNaN(p4) ? 0 : p4,
      x,
      y,
      z: isNaN(z) ? 0 : z,
      autocontinue,
    });
  }

  items.sort((a, b) => a.seq - b.seq);
  return items;
}

/**
 * Parses a QGroundControl Plan JSON format.
 */
export function parseQgcPlanJson(jsonStr: string): { type: MissionFileType; items: MissionItemIntData[] } | null {
  try {
    const obj = JSON.parse(jsonStr);
    const items: MissionItemIntData[] = [];

    // 1. Mission items
    if (obj.mission && Array.isArray(obj.mission.items) && obj.mission.items.length > 0) {
      // If planned home position exists, add as seq 0
      if (obj.mission.plannedHomePosition && Array.isArray(obj.mission.plannedHomePosition)) {
        const [hLat, hLon, hAlt] = obj.mission.plannedHomePosition;
        items.push({
          seq: 0,
          command: 16,
          current: 1,
          frame: 0,
          param1: 0,
          param2: 0,
          param3: 0,
          param4: 0,
          x: hLat,
          y: hLon,
          z: hAlt ?? 0,
          autocontinue: 1,
          mission_type: 0,
        });
      }

      for (let i = 0; i < obj.mission.items.length; i++) {
        const it = obj.mission.items[i];
        const params = it.params || [0, 0, 0, 0, 0, 0, 0];
        const seq = items.length;
        items.push({
          seq,
          command: it.command ?? 16,
          current: 0,
          frame: it.frame ?? 3,
          param1: params[0] ?? 0,
          param2: params[1] ?? 0,
          param3: params[2] ?? 0,
          param4: params[3] ?? 0,
          x: params[4] ?? 0,
          y: params[5] ?? 0,
          z: params[6] ?? 0,
          autocontinue: it.autoContinue ?? 1,
          mission_type: 0,
        });
      }
      return { type: 'mission', items };
    }

    // 2. GeoFence
    if (obj.geoFence) {
      let fenceSeq = 0;
      if (Array.isArray(obj.geoFence.polygons)) {
        for (const poly of obj.geoFence.polygons) {
          const inclusion = poly.inclusion !== false;
          const cmd = inclusion ? 5001 : 5002;
          const coords = poly.polygon || [];
          for (const pt of coords) {
            items.push({
              seq: fenceSeq++,
              command: cmd,
              frame: 0,
              param1: coords.length,
              x: pt[0],
              y: pt[1],
              z: 0,
              mission_type: 1,
            });
          }
        }
      }
      if (Array.isArray(obj.geoFence.circles)) {
        for (const circ of obj.geoFence.circles) {
          const inclusion = circ.inclusion !== false;
          const cmd = inclusion ? 5003 : 5004;
          items.push({
            seq: fenceSeq++,
            command: cmd,
            frame: 0,
            param1: circ.radius ?? 50,
            x: circ.circle?.center?.[0] ?? 0,
            y: circ.circle?.center?.[1] ?? 0,
            z: 0,
            mission_type: 1,
          });
        }
      }
      if (items.length > 0) {
        return { type: 'fence', items };
      }
    }

    // 3. Rally points
    if (obj.rallyPoints && Array.isArray(obj.rallyPoints.points) && obj.rallyPoints.points.length > 0) {
      for (let i = 0; i < obj.rallyPoints.points.length; i++) {
        const pt = obj.rallyPoints.points[i];
        items.push({
          seq: i,
          command: 5100,
          frame: 3,
          param1: 0,
          param2: 0,
          param3: 0,
          param4: 0,
          x: pt[0],
          y: pt[1],
          z: pt[2] ?? 0,
          mission_type: 2,
        });
      }
      return { type: 'rally', items };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Universal file parser for dropped mission, fence, or rally point files.
 * Supports binary .dat files (mission.dat, fence.dat, rally.dat), QGC WPL text files (.waypoints, .fence, .rally),
 * and QGC .plan JSON files.
 */
export function parseDroppedMissionFile(filename: string, buffer: Uint8Array): ParsedMissionFile | null {
  const lowerName = filename.toLowerCase();

  // 1. Check if binary .dat file (magic 0x763d)
  if (buffer.length >= 10) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const magic = view.getUint16(0, true);
    if (magic === 0x763d) {
      const dataType = view.getUint16(2, true);
      const numItems = view.getUint16(8, true);

      let detectedType: MissionFileType = 'mission';
      let missionType = 0;

      if (dataType === 1 || lowerName.includes('fence')) {
        detectedType = 'fence';
        missionType = 1;
      } else if (dataType === 2 || lowerName.includes('rally')) {
        detectedType = 'rally';
        missionType = 2;
      }

      // Unpack binary items so we have them available for legacy fallback
      const items: MissionItemIntData[] = [];
      let itemSize = 38;
      if (numItems > 0) {
        const calcSize = Math.floor((buffer.length - 10) / numItems);
        if (calcSize === 37 || calcSize === 38) {
          itemSize = calcSize;
        }
      }

      let offset = 10;
      for (let i = 0; i < numItems && offset + itemSize <= buffer.length; i++) {
        const p1 = view.getFloat32(offset + 0, true);
        const p2 = view.getFloat32(offset + 4, true);
        const p3 = view.getFloat32(offset + 8, true);
        const p4 = view.getFloat32(offset + 12, true);
        const x = view.getInt32(offset + 16, true) / 1e7;
        const y = view.getInt32(offset + 20, true) / 1e7;
        const z = view.getFloat32(offset + 24, true);
        const seq = view.getUint16(offset + 28, true);
        const command = view.getUint16(offset + 30, true);
        const frame = view.getUint8(offset + 34);
        const current = view.getUint8(offset + 35) === 1;

        items.push({
          seq,
          command,
          x,
          y,
          z,
          current,
          frame,
          param1: p1,
          param2: p2,
          param3: p3,
          param4: p4,
          mission_type: missionType,
        });

        offset += itemSize;
      }

      return {
        type: detectedType,
        missionType,
        items,
        rawDat: buffer,
        filename,
      };
    }
  }

  // 2. Check if text file (QGC WPL format or JSON plan)
  const text = new TextDecoder().decode(buffer);

  // Check if QGC .plan JSON
  if (text.trim().startsWith('{')) {
    const planResult = parseQgcPlanJson(text);
    if (planResult && planResult.items.length > 0) {
      const missionType = planResult.type === 'mission' ? 0 : planResult.type === 'fence' ? 1 : 2;
      planResult.items.forEach((it) => {
        it.mission_type = missionType;
      });
      return {
        type: planResult.type,
        missionType,
        items: planResult.items,
        rawDat: packDatFile(planResult.items, missionType),
        filename,
      };
    }
  }

  // Check if QGC WPL format text
  const wplItems = parseQgcWplText(text);
  if (wplItems.length > 0) {
    let type: MissionFileType = 'mission';
    let missionType = 0;

    // Detect type based on file extension, header, or commands
    if (lowerName.endsWith('.fence') || lowerName.includes('fence')) {
      type = 'fence';
      missionType = 1;
    } else if (lowerName.endsWith('.rally') || lowerName.includes('rally')) {
      type = 'rally';
      missionType = 2;
    } else {
      // Check command distribution
      const fenceCommands = [5001, 5002, 5003, 5004, 5005];
      const isFence = wplItems.some((it) => fenceCommands.includes(it.command));
      const isRally = wplItems.some((it) => it.command === 5100);

      if (isFence) {
        type = 'fence';
        missionType = 1;
      } else if (isRally) {
        type = 'rally';
        missionType = 2;
      }
    }

    wplItems.forEach((it) => {
      it.mission_type = missionType;
    });

    return {
      type,
      missionType,
      items: wplItems,
      rawDat: packDatFile(wplItems, missionType),
      filename,
    };
  }

  return null;
}
