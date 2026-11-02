import { MissionItemIntData } from './encoder';
import { cmdHasLocation } from './messages';

export type MissionFileType = 'mission' | 'fence' | 'rally' | 'plan';

export interface PlanSectionData {
  type: 'mission' | 'fence' | 'rally';
  missionType: number;
  items: MissionItemIntData[];
  rawDat: Uint8Array;
}

export interface ParsedMissionFile {
  type: MissionFileType;
  missionType: number; // 0 = mission, 1 = fence, 2 = rally
  items: MissionItemIntData[];
  rawDat?: Uint8Array;
  filename: string;
  sections?: PlanSectionData[];
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
    const cmd = item.command ?? 16;
    const hasLoc = cmdHasLocation(cmd);

    view.setFloat32(offset + 0, item.param1 ?? 0, true);
    view.setFloat32(offset + 4, item.param2 ?? 0, true);
    view.setFloat32(offset + 8, item.param3 ?? 0, true);
    view.setFloat32(offset + 12, item.param4 ?? 0, true);
    view.setInt32(offset + 16, Math.round(hasLoc ? (item.x ?? 0) * 1e7 : (item.x ?? 0)), true);
    view.setInt32(offset + 20, Math.round(hasLoc ? (item.y ?? 0) * 1e7 : (item.y ?? 0)), true);
    view.setFloat32(offset + 24, item.z ?? 0, true);
    view.setUint16(offset + 28, item.seq ?? i, true);
    view.setUint16(offset + 30, cmd, true);
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
 * Expands ComplexItems (e.g. Survey, Corridor Scan) and validates that no waypoint defaults to (0, 0).
 */
export function parseQgcPlanJson(jsonStr: string): { type: MissionFileType; items: MissionItemIntData[]; sections?: PlanSectionData[] } | null {
  try {
    const obj = JSON.parse(jsonStr);
    const sections: PlanSectionData[] = [];

    // Helper: Expand QGC ComplexItems (Survey, Corridor Scan, etc.)
    const expandItem = (rawItem: any): any[] => {
      if (rawItem.type === 'ComplexItem') {
        if (Array.isArray(rawItem.TransectStyleComplexItem?.Items) && rawItem.TransectStyleComplexItem.Items.length > 0) {
          return rawItem.TransectStyleComplexItem.Items;
        }
        if (Array.isArray(rawItem.Items) && rawItem.Items.length > 0) {
          return rawItem.Items;
        }
        if (Array.isArray(rawItem.transects) && rawItem.transects.length > 0) {
          const flat: any[] = [];
          for (const transect of rawItem.transects) {
            if (Array.isArray(transect)) {
              for (const pt of transect) {
                const lat = pt.lat ?? pt[0];
                const lon = pt.lon ?? pt[1];
                const alt = pt.alt ?? 30;
                flat.push({ command: 16, frame: 3, autoContinue: true, params: [0, 0, 0, null, lat, lon, alt] });
              }
            }
          }
          if (flat.length > 0) return flat;
        }
        throw new Error(
          `Complex item "${rawItem.complexItemType || 'survey'}" contains no expandable waypoints. Export individual waypoints from QGroundControl before uploading.`
        );
      }
      return [rawItem];
    };

    // 1. Mission items
    if (obj.mission && Array.isArray(obj.mission.items) && obj.mission.items.length > 0) {
      const missionItems: MissionItemIntData[] = [];

      // If planned home position exists, add as seq 0
      if (obj.mission.plannedHomePosition && Array.isArray(obj.mission.plannedHomePosition)) {
        const [hLat, hLon, hAlt] = obj.mission.plannedHomePosition;
        if (hLat !== 0 || hLon !== 0) {
          missionItems.push({
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
      }

      for (let i = 0; i < obj.mission.items.length; i++) {
        const rawItem = obj.mission.items[i];
        const subItems = expandItem(rawItem);

        for (const it of subItems) {
          const params = it.params || [0, 0, 0, 0, 0, 0, 0];
          const cmd = it.command ?? 16;
          const seq = missionItems.length;
          const x = params[4] ?? 0;
          const y = params[5] ?? 0;
          const z = params[6] ?? 0;

          // Never default coordinates to (0, 0) for commands that have a location!
          if (cmdHasLocation(cmd) && x === 0 && y === 0) {
            throw new Error(`Waypoint ${seq} (command ${cmd}) has invalid coordinates (0, 0) [Gulf of Guinea]. Upload rejected for vehicle safety.`);
          }

          missionItems.push({
            seq,
            command: cmd,
            current: missionItems.length === 0,
            frame: it.frame ?? 3,
            param1: params[0] ?? 0,
            param2: params[1] ?? 0,
            param3: params[2] ?? 0,
            param4: params[3] ?? 0,
            x,
            y,
            z,
            autocontinue: it.autoContinue ?? 1,
            mission_type: 0,
          });
        }
      }

      if (missionItems.length > 0) {
        sections.push({
          type: 'mission',
          missionType: 0,
          items: missionItems,
          rawDat: packDatFile(missionItems, 0),
        });
      }
    }

    // 2. GeoFence
    if (obj.geoFence) {
      const fenceItems: MissionItemIntData[] = [];
      let fenceSeq = 0;

      if (Array.isArray(obj.geoFence.polygons)) {
        for (const poly of obj.geoFence.polygons) {
          const inclusion = poly.inclusion !== false;
          const cmd = inclusion ? 5001 : 5002;
          const coords = poly.polygon || [];
          for (const pt of coords) {
            fenceItems.push({
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
          // Correctly read circle radius from circ.circle.radius (fallback to circ.radius)
          const radius = typeof circ.circle?.radius === 'number'
            ? circ.circle.radius
            : (typeof circ.radius === 'number' ? circ.radius : 50);

          fenceItems.push({
            seq: fenceSeq++,
            command: cmd,
            frame: 0,
            param1: radius,
            x: circ.circle?.center?.[0] ?? 0,
            y: circ.circle?.center?.[1] ?? 0,
            z: 0,
            mission_type: 1,
          });
        }
      }

      if (fenceItems.length > 0) {
        sections.push({
          type: 'fence',
          missionType: 1,
          items: fenceItems,
          rawDat: packDatFile(fenceItems, 1),
        });
      }
    }

    // 3. Rally points
    if (obj.rallyPoints && Array.isArray(obj.rallyPoints.points) && obj.rallyPoints.points.length > 0) {
      const rallyItems: MissionItemIntData[] = [];
      for (let i = 0; i < obj.rallyPoints.points.length; i++) {
        const pt = obj.rallyPoints.points[i];
        rallyItems.push({
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
      if (rallyItems.length > 0) {
        sections.push({
          type: 'rally',
          missionType: 2,
          items: rallyItems,
          rawDat: packDatFile(rallyItems, 2),
        });
      }
    }

    if (sections.length === 0) return null;

    if (sections.length === 1) {
      const sec = sections[0];
      return { type: sec.type, items: sec.items, sections };
    }

    // Multi-section Plan file containing mission, fence, and/or rally
    const primarySection = sections.find((s) => s.type === 'mission') || sections[0];
    return {
      type: 'plan',
      items: primarySection.items,
      sections,
    };
  } catch (err: any) {
    if (err?.message?.includes('invalid coordinates') || err?.message?.includes('Complex item')) {
      throw err;
    }
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

      // Rely on the binary header dataType (0=mission, 1=fence, 2=rally)
      let detectedType: MissionFileType = 'mission';
      let missionType = 0;

      if (dataType === 1) {
        detectedType = 'fence';
        missionType = 1;
      } else if (dataType === 2) {
        detectedType = 'rally';
        missionType = 2;
      } else if (dataType === 0) {
        detectedType = 'mission';
        missionType = 0;
      } else {
        // Fallback to exact extension only if dataType is unknown
        if (lowerName.endsWith('.fence')) {
          detectedType = 'fence';
          missionType = 1;
        } else if (lowerName.endsWith('.rally')) {
          detectedType = 'rally';
          missionType = 2;
        }
      }

      // Unpack binary items so we have them available for legacy fallback and validation
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
        const command = view.getUint16(offset + 30, true);
        const hasLoc = cmdHasLocation(command);
        const x = hasLoc ? (view.getInt32(offset + 16, true) / 1e7) : view.getInt32(offset + 16, true);
        const y = hasLoc ? (view.getInt32(offset + 20, true) / 1e7) : view.getInt32(offset + 20, true);
        const z = view.getFloat32(offset + 24, true);
        const seq = view.getUint16(offset + 28, true);
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
      const missionType = planResult.type === 'mission' || planResult.type === 'plan' ? 0 : planResult.type === 'fence' ? 1 : 2;
      return {
        type: planResult.type,
        missionType,
        items: planResult.items,
        sections: planResult.sections,
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

    // Detect type based on explicit headers and commands, NOT loose filename substrings (e.g. fence_line_inspection.waypoints is a mission)
    const lines = text.trim().split(/\r?\n/);
    const headerLine = lines[0]?.trim().toUpperCase() || '';
    const fenceCommands = [5001, 5002, 5003, 5004, 5005];
    const isFenceCommands = wplItems.some((it) => fenceCommands.includes(it.command));
    const isRallyCommands = wplItems.some((it) => it.command === 5100);

    if (headerLine.startsWith('QGC FENCE') || isFenceCommands || lowerName.endsWith('.fence')) {
      type = 'fence';
      missionType = 1;
    } else if (headerLine.startsWith('QGC RALLY') || isRallyCommands || lowerName.endsWith('.rally')) {
      type = 'rally';
      missionType = 2;
    } else {
      type = 'mission';
      missionType = 0;
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
