import { MavlinkEncoder } from '../src/mavlink/encoder.ts';
import { MavlinkParser, decodePayload } from '../src/mavlink/parser.ts';
import {
  MAVLINK_MSG_ID,
  getVehicleCategory,
  getVehicleCategoryLabel,
  getVehicleModeName,
  getVehicleFlightModes,
} from '../src/mavlink/messages.ts';

const encoder = new MavlinkEncoder(255, 190);
const parser = new MavlinkParser();

console.log('Testing MavlinkEncoder and MavlinkParser...');

// 1. Test Heartbeat
const hb = encoder.createHeartbeat();
console.log(`Generated Heartbeat frame length: ${hb.length}, magic: 0x${hb[0].toString(16)}`);

const parsedHb = parser.parse(hb);
if (parsedHb.length === 1 && parsedHb[0].messageId === MAVLINK_MSG_ID.HEARTBEAT) {
  const decoded = decodePayload(parsedHb[0].messageId, parsedHb[0].payload);
  console.log('Heartbeat decoded successfully:', decoded);
} else {
  console.error('Failed to parse Heartbeat!');
  process.exit(1);
}

// 2. Test Arm Command
const armCmd = encoder.createArmDisarm(1, 1, true);
const parsedArm = parser.parse(armCmd);
if (parsedArm.length === 1 && parsedArm[0].messageId === MAVLINK_MSG_ID.COMMAND_LONG) {
  console.log('Arm command packet verified!');
} else {
  console.error('Failed to parse Arm command!');
  process.exit(1);
}

// 3. Test Set Message Interval
const intervalCmd = encoder.createSetMessageInterval(1, 1, MAVLINK_MSG_ID.ATTITUDE, 100000);
const parsedInterval = parser.parse(intervalCmd);
if (parsedInterval.length === 1 && parsedInterval[0].messageId === MAVLINK_MSG_ID.COMMAND_LONG) {
  console.log('SetMessageInterval packet verified!');
} else {
  console.error('Failed to parse SetMessageInterval!');
  process.exit(1);
}

// 4. Test STATUSTEXT
const statusTextPayload = new Uint8Array(51);
statusTextPayload[0] = 6; // severity = MAV_SEVERITY_INFO
const msgStr = 'PreArm: Compass healthy';
for (let i = 0; i < msgStr.length; i++) {
  statusTextPayload[1 + i] = msgStr.charCodeAt(i);
}
const statusPacket = encoder.packV2(MAVLINK_MSG_ID.STATUSTEXT, statusTextPayload);
const parsedStatus = parser.parse(statusPacket);
if (parsedStatus.length === 1 && parsedStatus[0].messageId === MAVLINK_MSG_ID.STATUSTEXT) {
  const decoded = decodePayload(parsedStatus[0].messageId, parsedStatus[0].payload);
  console.log('STATUSTEXT decoded successfully:', decoded);
  if (decoded.text !== msgStr || decoded.severity !== 6) {
    console.error('STATUSTEXT content mismatch:', decoded);
    process.exit(1);
  }
} else {
  console.error('Failed to parse STATUSTEXT packet (CRC error likely)!');
  process.exit(1);
}

// 5. Test Mission Protocol Packets
// 5a. MISSION_REQUEST_LIST
const reqListPacket = encoder.createMissionRequestList(1, 1);
const parsedList = parser.parse(reqListPacket);
if (parsedList.length === 1 && parsedList[0].messageId === MAVLINK_MSG_ID.MISSION_REQUEST_LIST) {
  console.log('MISSION_REQUEST_LIST packet verified!');
} else {
  console.error('Failed to parse MISSION_REQUEST_LIST!');
  process.exit(1);
}

// 5b. MISSION_COUNT
const countPayload = new Uint8Array(5);
new DataView(countPayload.buffer).setUint16(0, 3, true); // count = 3
countPayload[2] = 1;
countPayload[3] = 1;
const countPacket = encoder.packV2(MAVLINK_MSG_ID.MISSION_COUNT, countPayload);
const parsedCount = parser.parse(countPacket);
if (parsedCount.length === 1 && parsedCount[0].messageId === MAVLINK_MSG_ID.MISSION_COUNT) {
  const decoded = decodePayload(parsedCount[0].messageId, parsedCount[0].payload);
  console.log('MISSION_COUNT decoded successfully:', decoded);
  if (decoded.count !== 3) {
    console.error('MISSION_COUNT count mismatch!');
    process.exit(1);
  }
} else {
  console.error('Failed to parse MISSION_COUNT packet!');
  process.exit(1);
}

// 5c. MISSION_REQUEST_INT (Msg 51)
const reqIntPacket = encoder.createMissionRequestInt(1, 1, 0);
const parsedReqInt = parser.parse(reqIntPacket);
if (parsedReqInt.length === 1 && parsedReqInt[0].messageId === MAVLINK_MSG_ID.MISSION_REQUEST_INT) {
  console.log('MISSION_REQUEST_INT (Msg 51) verified!');
} else {
  console.error('Failed to parse MISSION_REQUEST_INT (Msg 51)!');
  process.exit(1);
}

// 5d. MISSION_ITEM_INT (Msg 73)
const itemPayload = new Uint8Array(37);
const itemView = new DataView(itemPayload.buffer);
itemView.setInt32(16, Math.round(37.7749 * 1e7), true); // x (lat)
itemView.setInt32(20, Math.round(-122.4194 * 1e7), true); // y (lon)
itemView.setFloat32(24, 25.5, true); // z (alt)
itemView.setUint16(28, 0, true); // seq
itemView.setUint16(30, 16, true); // command NAV_WAYPOINT
itemPayload[32] = 1;
itemPayload[33] = 1;
itemPayload[34] = 3; // frame GLOBAL_RELATIVE_ALT
const itemPacket = encoder.packV2(MAVLINK_MSG_ID.MISSION_ITEM_INT, itemPayload);
const parsedItem = parser.parse(itemPacket);
if (parsedItem.length === 1 && parsedItem[0].messageId === MAVLINK_MSG_ID.MISSION_ITEM_INT) {
  const decoded = decodePayload(parsedItem[0].messageId, parsedItem[0].payload);
  console.log('MISSION_ITEM_INT decoded successfully:', decoded);
  if (Math.abs(decoded.x - 37.7749) > 0.0001 || Math.abs(decoded.z - 25.5) > 0.1) {
    console.error('MISSION_ITEM_INT coordinate decoding error:', decoded);
    process.exit(1);
  }
} else {
  console.error('Failed to parse MISSION_ITEM_INT packet!');
  process.exit(1);
}

// 6. Test MAVFTP (Msg 110) Packet Packing & Parsing
import { packFtpMessage, parseFtpPayload, FTP_OPCODE } from '../src/mavlink/ftp.ts';
import { paramManager } from '../src/mavlink/paramManager.ts';
import { missionManager, groupFencePolygons } from '../src/mavlink/missionManager.ts';

const fnameBytes = new TextEncoder().encode('@PARAM/param.pck');
const testFtpMsg = packFtpMessage(1, 1, 42, 1, FTP_OPCODE.OpenFileRO, fnameBytes.length, 0, fnameBytes);
const parsedFtpPackets = parser.parse(testFtpMsg);
if (parsedFtpPackets.length === 1 && parsedFtpPackets[0].messageId === MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL) {
  const ftpPayload = parseFtpPayload(parsedFtpPackets[0].payload);
  if (ftpPayload && ftpPayload.seq === 42 && ftpPayload.opcode === FTP_OPCODE.OpenFileRO) {
    const filename = new TextDecoder().decode(ftpPayload.data);
    console.log('MAVFTP message 110 pack/parse verified for:', filename);
    if (filename !== '@PARAM/param.pck') {
      console.error('MAVFTP filename mismatch:', filename);
      process.exit(1);
    }
  } else {
    console.error('Failed to decode FTP payload fields:', ftpPayload);
    process.exit(1);
  }
} else {
  console.error('Failed to parse FILE_TRANSFER_PROTOCOL packet!');
  process.exit(1);
}

// 7. Test param.pck Unpacking
// Header 6 bytes: magic (0x671b), num_params (2), total_params (2)
// Item 1: BATT_CAPACITY = 5000.0 (float)
// Item 2: BATT_ARM_VOLT = 14.5 (float, shares 'BATT_' = 5 chars common)
const pckBuffer = new Uint8Array(6 + 18 + 17);
const pckDv = new DataView(pckBuffer.buffer);
pckDv.setUint16(0, 0x671b, true);
pckDv.setUint16(2, 2, true);
pckDv.setUint16(4, 2, true);
let pckOfs = 6;

// Item 1: BATT_CAPACITY
const name1 = 'BATT_CAPACITY';
pckBuffer[pckOfs] = 4; // ptype = float32
pckBuffer[pckOfs + 1] = ((name1.length - 1) << 4) | 0; // common_len = 0
pckOfs += 2;
new TextEncoder().encodeInto(name1, pckBuffer.subarray(pckOfs, pckOfs + name1.length));
pckOfs += name1.length;
pckDv.setFloat32(pckOfs, 5000.0, true);
pckOfs += 4;

// Item 2: BATT_ARM_VOLT (shares 'BATT_' = 5 chars with name1)
const common = 5;
const suffix2 = 'ARM_VOLT';
pckBuffer[pckOfs] = 4; // ptype = float32
pckBuffer[pckOfs + 1] = ((suffix2.length - 1) << 4) | common;
pckOfs += 2;
new TextEncoder().encodeInto(suffix2, pckBuffer.subarray(pckOfs, pckOfs + suffix2.length));
pckOfs += suffix2.length;
pckDv.setFloat32(pckOfs, 14.5, true);
pckOfs += 4;

const unpackedParams = paramManager.unpackParamPck(pckBuffer.subarray(0, pckOfs));
if (unpackedParams && unpackedParams['BATT_CAPACITY']?.value === 5000 && unpackedParams['BATT_ARM_VOLT']?.value === 14.5) {
  console.log('param.pck unpacked successfully:', Object.keys(unpackedParams));
} else {
  console.error('param.pck unpacking failed:', unpackedParams);
  process.exit(1);
}

// 7b. Test param.pck Unpacking WITH DEFAULTS (magic 0x671c)
// Header 6 bytes: magic (0x671c), num_params (1), total_params (1)
// Item: WP_RADIUS = 0, default = 50 (int16, ptype = 2, flags bit 0 set -> 0x12)
const defBuffer = new Uint8Array(6 + 2 + 9 + 2 + 2);
const defDv = new DataView(defBuffer.buffer);
defDv.setUint16(0, 0x671c, true); // magic 0x671c = param.pck with defaults
defDv.setUint16(2, 1, true);
defDv.setUint16(4, 1, true);
let defOfs = 6;
const paramDefName = 'WP_RADIUS';
defBuffer[defOfs] = 0x12; // ptype = 2 (int16), flags = 1 (hasDefault)
defBuffer[defOfs + 1] = ((paramDefName.length - 1) << 4) | 0;
defOfs += 2;
new TextEncoder().encodeInto(paramDefName, defBuffer.subarray(defOfs, defOfs + paramDefName.length));
defOfs += paramDefName.length;
defDv.setInt16(defOfs, 0, true); // current value = 0
defOfs += 2;
defDv.setInt16(defOfs, 50, true); // default value = 50
defOfs += 2;

const unpackedWithDefaults = paramManager.unpackParamPck(defBuffer.subarray(0, defOfs));
if (
  unpackedWithDefaults &&
  unpackedWithDefaults['WP_RADIUS']?.value === 0 &&
  unpackedWithDefaults['WP_RADIUS']?.defaultValue === 50
) {
  console.log('param.pck with defaults (0x671c) unpacked successfully: WP_RADIUS = 0 (default: 50)');
} else {
  console.error('param.pck with defaults unpacking failed:', unpackedWithDefaults);
  process.exit(1);
}

// 8. Test mission.dat Unpacking (multi-item with 38-byte MAVLink 2 layout)
// Header 10 bytes: magic (0x763d), data_type (0), options (0), start (0), num_items (3)
const datBuffer = new Uint8Array(10 + 3 * 38);
const datDv = new DataView(datBuffer.buffer);
datDv.setUint16(0, 0x763d, true);
datDv.setUint16(2, 0, true);
datDv.setUint16(4, 0, true);
datDv.setUint16(6, 0, true);
datDv.setUint16(8, 3, true); // num_items = 3

const testCoords = [
  { lat: 37.7749, lon: -122.4194, alt: 10.0, seq: 0 },
  { lat: 37.7760, lon: -122.4180, alt: 25.0, seq: 1 },
  { lat: 37.7770, lon: -122.4170, alt: 30.0, seq: 2 },
];

for (let i = 0; i < testCoords.length; i++) {
  const ofs = 10 + i * 38;
  datDv.setInt32(ofs + 16, Math.round(testCoords[i].lat * 1e7), true);
  datDv.setInt32(ofs + 20, Math.round(testCoords[i].lon * 1e7), true);
  datDv.setFloat32(ofs + 24, testCoords[i].alt, true);
  datDv.setUint16(ofs + 28, testCoords[i].seq, true);
  datDv.setUint16(ofs + 30, 16, true); // NAV_WAYPOINT
  datBuffer[ofs + 34] = 3; // frame GLOBAL_RELATIVE_ALT
  datBuffer[ofs + 35] = i === 0 ? 1 : 0; // current
  datBuffer[ofs + 36] = 1; // autocontinue
  datBuffer[ofs + 37] = 0; // mission_type
}

const unpackedMission = missionManager.unpackMissionDat(datBuffer);
if (
  unpackedMission &&
  unpackedMission.length === 3 &&
  Math.abs(unpackedMission[0].lat - 37.7749) < 0.0001 &&
  Math.abs(unpackedMission[1].lat - 37.7760) < 0.0001 &&
  Math.abs(unpackedMission[2].lat - 37.7770) < 0.0001
) {
  console.log('mission.dat multi-item unpacked successfully without coordinate drift:', unpackedMission.map((w) => ({ seq: w.seq, lat: w.lat, lon: w.lon })));
} else {
  console.error('mission.dat multi-item unpacking failed!', unpackedMission);
  process.exit(1);
}

// 9. Test fence.dat Unpacking (4 polygon vertices, 38-byte layout)
const fenceBuffer = new Uint8Array(10 + 4 * 38);
const fenceDv = new DataView(fenceBuffer.buffer);
fenceDv.setUint16(0, 0x763d, true);
fenceDv.setUint16(2, 1, true); // MAV_MISSION_TYPE_FENCE
fenceDv.setUint16(4, 0, true);
fenceDv.setUint16(6, 0, true);
fenceDv.setUint16(8, 4, true); // num_items = 4

const fenceVertices = [
  { lat: 37.775, lon: -122.420, seq: 0 },
  { lat: 37.775, lon: -122.418, seq: 1 },
  { lat: 37.773, lon: -122.418, seq: 2 },
  { lat: 37.773, lon: -122.420, seq: 3 },
];

for (let i = 0; i < fenceVertices.length; i++) {
  const ofs = 10 + i * 38;
  fenceDv.setFloat32(ofs + 0, 4.0, true); // param1 = vertex count (4)
  fenceDv.setInt32(ofs + 16, Math.round(fenceVertices[i].lat * 1e7), true);
  fenceDv.setInt32(ofs + 20, Math.round(fenceVertices[i].lon * 1e7), true);
  fenceDv.setUint16(ofs + 28, fenceVertices[i].seq, true);
  fenceDv.setUint16(ofs + 30, 5001, true); // MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
  fenceBuffer[ofs + 37] = 1; // mission_type = FENCE
}

const unpackedFence = missionManager.unpackFenceDat(fenceBuffer);
if (
  unpackedFence &&
  unpackedFence.length === 4 &&
  unpackedFence[0].command === 5001 &&
  unpackedFence[0].inclusion === true &&
  Math.abs(unpackedFence[0].lat - 37.775) < 0.0001
) {
  console.log('fence.dat unpacked successfully via MAVFTP format:', unpackedFence.length, 'vertices');
} else {
  console.error('fence.dat unpacking failed!', unpackedFence);
  process.exit(1);
}

// 9a. Test fence.dat with 0 items (valid empty geofence from ArduPilot)
const emptyFenceBuffer = new Uint8Array(10);
const emptyDv = new DataView(emptyFenceBuffer.buffer);
emptyDv.setUint16(0, 0x763d, true);
emptyDv.setUint16(2, 1, true); // MAV_MISSION_TYPE_FENCE
emptyDv.setUint16(8, 0, true); // num_items = 0
const unpackedEmptyFence = missionManager.unpackFenceDat(emptyFenceBuffer);
if (unpackedEmptyFence !== null && unpackedEmptyFence.length === 0) {
  console.log('fence.dat with 0 items unpacked successfully as empty array!');
} else {
  console.error('fence.dat with 0 items should return empty array, got:', unpackedEmptyFence);
  process.exit(1);
}

// 9b. Test groupFencePolygons with consecutive polygon fences
const mockFenceItems = [
  // Inclusion Polygon 1 (4 vertices described in file)
  { seq: 0, command: 5001, param1: 4, vertexCount: 4, lat: 37.10, lon: -122.10, inclusion: true },
  { seq: 1, command: 5001, param1: 4, vertexCount: 4, lat: 37.11, lon: -122.10, inclusion: true },
  { seq: 2, command: 5001, param1: 4, vertexCount: 4, lat: 37.11, lon: -122.11, inclusion: true },
  { seq: 3, command: 5001, param1: 4, vertexCount: 4, lat: 37.10, lon: -122.11, inclusion: true },
  // Inclusion Polygon 2 (4 vertices described in file, immediately consecutive!)
  { seq: 4, command: 5001, param1: 4, vertexCount: 4, lat: 37.20, lon: -122.20, inclusion: true },
  { seq: 5, command: 5001, param1: 4, vertexCount: 4, lat: 37.21, lon: -122.20, inclusion: true },
  { seq: 6, command: 5001, param1: 4, vertexCount: 4, lat: 37.21, lon: -122.21, inclusion: true },
  { seq: 7, command: 5001, param1: 4, vertexCount: 4, lat: 37.20, lon: -122.21, inclusion: true },
  // Exclusion Polygon (3 vertices described in file)
  { seq: 8, command: 5002, param1: 3, vertexCount: 3, lat: 37.30, lon: -122.30, inclusion: false },
  { seq: 9, command: 5002, param1: 3, vertexCount: 3, lat: 37.31, lon: -122.30, inclusion: false },
  { seq: 10, command: 5002, param1: 3, vertexCount: 3, lat: 37.30, lon: -122.31, inclusion: false },
  // Circle fence and Return Point
  { seq: 11, command: 5004, param1: 50, radius: 50, lat: 37.40, lon: -122.40, inclusion: false },
  { seq: 12, command: 5000, param1: 0, lat: 37.10, lon: -122.10, inclusion: false },
];

const groupedPolys = groupFencePolygons(mockFenceItems);
if (
  groupedPolys.length === 3 &&
  groupedPolys[0].type === 'inclusion' &&
  groupedPolys[0].points.length === 4 &&
  groupedPolys[0].seqs[0] === 0 &&
  groupedPolys[0].seqs[3] === 3 &&
  groupedPolys[1].type === 'inclusion' &&
  groupedPolys[1].points.length === 4 &&
  groupedPolys[1].seqs[0] === 4 &&
  groupedPolys[1].seqs[3] === 7 &&
  groupedPolys[2].type === 'exclusion' &&
  groupedPolys[2].points.length === 3 &&
  groupedPolys[2].seqs[0] === 8 &&
  groupedPolys[2].seqs[2] === 10
) {
  console.log('Consecutive polygon fences partitioned successfully into separate polygons containing exact file vertex counts!');
} else {
  console.error('groupFencePolygons failed to isolate consecutive polygon fences!', groupedPolys);
  process.exit(1);
}

// 9c. Test groupFencePolygons with duplicate sequence points (SITL dual packet resilience)
const duplicateFenceItems = [
  { seq: 0, command: 5001, param1: 4, vertexCount: 4, lat: 37.10, lon: -122.10, inclusion: true },
  { seq: 0, command: 5001, param1: 4, vertexCount: 4, lat: 37.10, lon: -122.10, inclusion: true }, // duplicate seq 0
  { seq: 1, command: 5001, param1: 4, vertexCount: 4, lat: 37.11, lon: -122.10, inclusion: true },
  { seq: 1, command: 5001, param1: 4, vertexCount: 4, lat: 37.11, lon: -122.10, inclusion: true }, // duplicate seq 1
  { seq: 2, command: 5001, param1: 4, vertexCount: 4, lat: 37.11, lon: -122.11, inclusion: true },
  { seq: 3, command: 5001, param1: 4, vertexCount: 4, lat: 37.10, lon: -122.11, inclusion: true },
];
const dedupedPolys = groupFencePolygons(duplicateFenceItems);
if (
  dedupedPolys.length === 1 &&
  dedupedPolys[0].type === 'inclusion' &&
  dedupedPolys[0].points.length === 4
) {
  console.log('Duplicate packet resilience verified: polygon retains all 4 distinct vertices without splitting!');
} else {
  console.error('Duplicate packet handling failed in groupFencePolygons!', dedupedPolys);
  process.exit(1);
}

// 10. Test rally.dat Unpacking (1 rally point, 38-byte layout)
const rallyBuffer = new Uint8Array(10 + 1 * 38);
const rallyDv = new DataView(rallyBuffer.buffer);
rallyDv.setUint16(0, 0x763d, true);
rallyDv.setUint16(2, 2, true); // MAV_MISSION_TYPE_RALLY
rallyDv.setUint16(4, 0, true);
rallyDv.setUint16(6, 0, true);
rallyDv.setUint16(8, 1, true); // num_items = 1

const ofsRally = 10;
rallyDv.setInt32(ofsRally + 16, Math.round(37.7740 * 1e7), true);
rallyDv.setInt32(ofsRally + 20, Math.round(-122.4170 * 1e7), true);
rallyDv.setFloat32(ofsRally + 24, 25.0, true);
rallyDv.setUint16(ofsRally + 28, 0, true);
rallyDv.setUint16(ofsRally + 30, 5100, true); // MAV_CMD_NAV_RALLY_POINT
rallyBuffer[ofsRally + 37] = 2; // mission_type = RALLY

const unpackedRally = missionManager.unpackRallyDat(rallyBuffer);
if (
  unpackedRally &&
  unpackedRally.length === 1 &&
  Math.abs(unpackedRally[0].lat - 37.7740) < 0.0001 &&
  Math.abs(unpackedRally[0].alt - 25.0) < 0.1
) {
  console.log('rally.dat unpacked successfully via MAVFTP format:', unpackedRally);
} else {
  console.error('rally.dat unpacking failed!', unpackedRally);
  process.exit(1);
}

// 11. Test TelemetryStore MISSION_ITEM_INT Isolation by mission_type
import { useTelemetryStore } from '../src/store/telemetryStore.ts';

// Reset store state
useTelemetryStore.setState({ missionWaypoints: [], fencePoints: [], rallyPoints: [] });

// Send WP #0 (Home) with mission_type = 0
const wp0Payload = new Uint8Array(38);
const wp0Dv = new DataView(wp0Payload.buffer);
wp0Dv.setInt32(16, Math.round(37.1111 * 1e7), true); // WP0 Home lat
wp0Dv.setInt32(20, Math.round(-122.1111 * 1e7), true); // WP0 Home lon
wp0Dv.setUint16(28, 0, true); // seq = 0
wp0Dv.setUint16(30, 16, true); // NAV_WAYPOINT
wp0Payload[37] = 0; // mission_type = 0 (MISSION)
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 1,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_ITEM_INT,
  payload: wp0Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

// Verify WP0 is stored in missionWaypoints
let storeState = useTelemetryStore.getState();
if (storeState.missionWaypoints.length !== 1 || Math.abs(storeState.missionWaypoints[0].lat - 37.1111) > 0.0001) {
  console.error('Failed to set initial WP0 Home!', storeState.missionWaypoints);
  process.exit(1);
}

// Now send Fence #0 with seq = 0, mission_type = 1 (FENCE)
const fence0Payload = new Uint8Array(38);
const fence0Dv = new DataView(fence0Payload.buffer);
fence0Dv.setInt32(16, Math.round(38.2222 * 1e7), true); // Fence lat
fence0Dv.setInt32(20, Math.round(-121.2222 * 1e7), true); // Fence lon
fence0Dv.setUint16(28, 0, true); // seq = 0
fence0Dv.setUint16(30, 5005, true); // CIRCLE_INCLUSION
fence0Payload[37] = 1; // mission_type = 1 (FENCE)
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 2,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_ITEM_INT,
  payload: fence0Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

storeState = useTelemetryStore.getState();
// Crucial check: WP0 must still have lat = 37.1111, NOT 38.2222!
if (Math.abs(storeState.missionWaypoints[0].lat - 37.1111) > 0.0001) {
  console.error('BUG DETECTED: Fence item seq 0 overwrote missionWaypoints[0] Home position!', storeState.missionWaypoints);
  process.exit(1);
}
if (storeState.fencePoints.length !== 1 || Math.abs(storeState.fencePoints[0].lat - 38.2222) > 0.0001) {
  console.error('Failed to isolate fence point in fencePoints!', storeState.fencePoints);
  process.exit(1);
}

console.log('TelemetryStore mission_type isolation verified: WP0 Home is protected from fence/rally seq 0 overwrite!');

// 7. Test VFR_HUD Wire Layout and Scaling
const vfrPayload = new Uint8Array(20);
const vfrDv = new DataView(vfrPayload.buffer);
vfrDv.setFloat32(0, 15.5, true); // airspeed
vfrDv.setFloat32(4, 12.3, true); // groundspeed
vfrDv.setFloat32(8, 150.25, true); // alt (MSL)
vfrDv.setFloat32(12, 2.1, true); // climb
vfrDv.setInt16(16, 275, true); // heading (offset 16!)
vfrDv.setInt16(18, 65, true); // throttle (offset 18!)

const vfrPacket = encoder.packV2(MAVLINK_MSG_ID.VFR_HUD, vfrPayload);
const parsedVfr = parser.parse(vfrPacket);
if (parsedVfr.length === 1 && parsedVfr[0].messageId === MAVLINK_MSG_ID.VFR_HUD) {
  const decodedVfr = decodePayload(parsedVfr[0].messageId, parsedVfr[0].payload);
  console.log('VFR_HUD decoded successfully:', decodedVfr);
  if (
    decodedVfr.heading !== 275 ||
    decodedVfr.throttle !== 65 ||
    Math.abs(decodedVfr.alt - 150.25) > 0.01 ||
    Math.abs(decodedVfr.airspeed - 15.5) > 0.01 ||
    Math.abs(decodedVfr.groundspeed - 12.3) > 0.01 ||
    Math.abs(decodedVfr.climb - 2.1) > 0.01
  ) {
    console.error('VFR_HUD field decoding mismatch!', decodedVfr);
    process.exit(1);
  }
} else {
  console.error('Failed to parse VFR_HUD packet!');
  process.exit(1);
}

// 7b. Test VFR_HUD Reverse Throttle & Sentinel Unpacking
vfrDv.setInt16(18, -35, true); // Reverse throttle: -35%
const decodedRev = decodePayload(MAVLINK_MSG_ID.VFR_HUD, vfrPayload);
if (decodedRev.throttle !== -35) {
  console.error('VFR_HUD reverse throttle failed! Expected -35, got:', decodedRev.throttle);
  process.exit(1);
}

vfrDv.setInt16(18, -1, true); // Sentinel unmeasured: -1
const decodedSentinel = decodePayload(MAVLINK_MSG_ID.VFR_HUD, vfrPayload);
if (decodedSentinel.throttle !== 0) {
  console.error('VFR_HUD sentinel throttle failed! Expected 0, got:', decodedSentinel.throttle);
  process.exit(1);
}

// 7d. Test MAVLink 2 Zero-Truncated Payload (17 bytes: heading high byte and throttle truncated)
const sitl17BytePayload = new Uint8Array([
  0x00, 0x00, 0x00, 0x00, // airspeed = 0
  0x36, 0x84, 0x9e, 0x3c, // groundspeed ~ 0.019
  0xc2, 0xf5, 0x56, 0x43, // alt ~ 214.96
  0x10, 0xab, 0x8a, 0xb9, // climb ~ -0.00026
  0x07,                   // heading low byte = 7 (high byte 0x00 and throttle 0x0000 truncated!)
]);
const decoded17 = decodePayload(MAVLINK_MSG_ID.VFR_HUD, sitl17BytePayload);
if (decoded17.heading !== 7 || decoded17.throttle !== 0 || Math.abs(decoded17.alt - 214.96) > 0.1) {
  console.error('17-byte zero-truncated VFR_HUD decoding failed!', decoded17);
  process.exit(1);
}
console.log('17-byte zero-truncated live SITL VFR_HUD verified successfully:', decoded17);

// 8. Test SYS_STATUS Wire Layout and Scaling
const sysPayload = new Uint8Array(31);
const sysDv = new DataView(sysPayload.buffer);
sysDv.setUint32(0, 0b111, true); // onboard_control_sensors_present
sysDv.setUint32(4, 0b111, true); // onboard_control_sensors_enabled
sysDv.setUint32(8, 0b111, true); // onboard_control_sensors_health
sysDv.setUint16(12, 450, true); // load: 450 = 45.0%
sysDv.setUint16(14, 16200, true); // voltage_battery: 16200 mV = 16.2V
sysDv.setInt16(16, 1450, true); // current_battery: 1450 cA = 14.5A
sysDv.setUint16(18, 12, true); // drop_rate_comm
sysDv.setUint16(20, 0, true); // errors_comm
sysDv.setInt8(30, 82); // battery_remaining: offset 30 = 82%

const sysPacket = encoder.packV2(MAVLINK_MSG_ID.SYS_STATUS, sysPayload);
const parsedSys = parser.parse(sysPacket);
if (parsedSys.length === 1 && parsedSys[0].messageId === MAVLINK_MSG_ID.SYS_STATUS) {
  const decodedSys = decodePayload(parsedSys[0].messageId, parsedSys[0].payload);
  console.log('SYS_STATUS decoded successfully:', decodedSys);
  if (
    decodedSys.load !== 45 ||
    Math.abs(decodedSys.voltage_battery - 16.2) > 0.01 ||
    Math.abs(decodedSys.current_battery - 14.5) > 0.01 ||
    decodedSys.battery_remaining !== 82
  ) {
    console.error('SYS_STATUS field decoding mismatch!', decodedSys);
    process.exit(1);
  }
} else {
  console.error('Failed to parse SYS_STATUS packet!');
  process.exit(1);
}

// 9. Test GPS_RAW_INT Wire Layout and Scaling
const gpsPayload = new Uint8Array(30);
const gpsDv = new DataView(gpsPayload.buffer);
gpsDv.setBigUint64(0, 1234567890n, true); // time_usec
gpsDv.setInt32(8, Math.round(37.7749 * 1e7), true); // lat: offset 8
gpsDv.setInt32(12, Math.round(-122.4194 * 1e7), true); // lon: offset 12
gpsDv.setInt32(16, 45000, true); // alt: offset 16 (45000 mm = 45m)
gpsDv.setUint16(20, 120, true); // eph: offset 20 (120 cm = 1.20 HDOP)
gpsDv.setUint16(22, 150, true); // epv: offset 22 (150 cm = 1.50 VDOP)
gpsDv.setUint16(24, 540, true); // vel: offset 24 (540 cm/s = 5.4 m/s)
gpsDv.setUint16(26, 18550, true); // cog: offset 26 (185.50 deg)
gpsPayload[28] = 3; // fix_type: offset 28 (3D Fix)
gpsPayload[29] = 18; // satellites_visible: offset 29 (18 sats)

const gpsPacket = encoder.packV2(MAVLINK_MSG_ID.GPS_RAW_INT, gpsPayload);
const parsedGps = parser.parse(gpsPacket);
if (parsedGps.length === 1 && parsedGps[0].messageId === MAVLINK_MSG_ID.GPS_RAW_INT) {
  const decodedGps = decodePayload(parsedGps[0].messageId, parsedGps[0].payload);
  console.log('GPS_RAW_INT decoded successfully:', decodedGps);
  if (
    decodedGps.fix_type !== 3 ||
    decodedGps.satellites_visible !== 18 ||
    Math.abs(decodedGps.lat - 37.7749) > 0.0001 ||
    Math.abs(decodedGps.lon - -122.4194) > 0.0001 ||
    decodedGps.alt !== 45 ||
    decodedGps.eph !== 1.2 ||
    decodedGps.vel !== 5.4 ||
    decodedGps.cog !== 185.5
  ) {
    console.error('GPS_RAW_INT field decoding mismatch!', decodedGps);
    process.exit(1);
  }
} else {
  console.error('Failed to parse GPS_RAW_INT packet!');
  process.exit(1);
}

// 10. Test BATTERY_STATUS Wire Layout and Scaling
const battPayload = new Uint8Array(36);
const battDv = new DataView(battPayload.buffer);
battDv.setInt32(0, 1850, true); // current_consumed: offset 0 (1850 mAh)
battDv.setInt32(4, 500, true); // energy_consumed: offset 4 (500 hJ)
battDv.setInt16(8, 2850, true); // temperature: offset 8 (28.50 C)
battDv.setUint16(10, 4150, true); // cell 1: offset 10 (4.15V)
battDv.setUint16(12, 4140, true); // cell 2: offset 12 (4.14V)
battDv.setUint16(14, 4160, true); // cell 3: offset 14 (4.16V)
battDv.setUint16(16, 4150, true); // cell 4: offset 16 (4.15V)
for (let i = 4; i < 10; i++) battDv.setUint16(10 + i * 2, 65535, true); // unused cells
battDv.setInt16(30, 850, true); // current_battery: offset 30 (850 cA = 8.5A)
battPayload[32] = 0; // id
battPayload[33] = 0; // battery_function
battPayload[34] = 0; // type
battPayload[35] = 75; // battery_remaining: offset 35 (75%)

const battPacket = encoder.packV2(MAVLINK_MSG_ID.BATTERY_STATUS, battPayload);
const parsedBatt = parser.parse(battPacket);
if (parsedBatt.length === 1 && parsedBatt[0].messageId === MAVLINK_MSG_ID.BATTERY_STATUS) {
  const decodedBatt = decodePayload(parsedBatt[0].messageId, parsedBatt[0].payload);
  console.log('BATTERY_STATUS decoded successfully:', decodedBatt);
  if (
    decodedBatt.current_consumed !== 1850 ||
    decodedBatt.current_battery !== 8.5 ||
    decodedBatt.temperature !== 28.5 ||
    decodedBatt.battery_remaining !== 75 ||
    decodedBatt.voltages.length !== 4 ||
    Math.abs(decodedBatt.voltages[0] - 4.15) > 0.001
  ) {
    console.error('BATTERY_STATUS field decoding mismatch!', decodedBatt);
    process.exit(1);
  }
} else {
  console.error('Failed to parse BATTERY_STATUS packet!');
  process.exit(1);
}

// 11. Test Multi-Vehicle Category and Mode Resolution
// 11a. Test Category Detection
if (getVehicleCategory(10) !== 'rover' || getVehicleCategory(11) !== 'rover') {
  console.error('Rover/Boat category detection failed!');
  process.exit(1);
}
if (getVehicleCategory(1) !== 'plane' || getVehicleCategory(20) !== 'plane') {
  console.error('Plane/VTOL category detection failed!');
  process.exit(1);
}
if (getVehicleCategory(2) !== 'copter' || getVehicleCategory(13) !== 'copter') {
  console.error('Copter category detection failed!');
  process.exit(1);
}
if (getVehicleCategory(12) !== 'sub') {
  console.error('Sub category detection failed!');
  process.exit(1);
}
if (getVehicleCategory(5) !== 'tracker') {
  console.error('Tracker category detection failed!');
  process.exit(1);
}

// 11b. Test Mode Name Resolution (especially Rover AUTO vs STEERING)
if (getVehicleModeName(10, 10) !== 'AUTO') {
  console.error(`Rover mode 10 should be AUTO, got: ${getVehicleModeName(10, 10)}`);
  process.exit(1);
}
if (getVehicleModeName(10, 3) !== 'STEERING') {
  console.error(`Rover mode 3 should be STEERING, got: ${getVehicleModeName(10, 3)}`);
  process.exit(1);
}
if (getVehicleModeName(10, 4) !== 'HOLD') {
  console.error(`Rover mode 4 should be HOLD, got: ${getVehicleModeName(10, 4)}`);
  process.exit(1);
}
if (getVehicleModeName(10, 11) !== 'RTL') {
  console.error(`Rover mode 11 should be RTL, got: ${getVehicleModeName(10, 11)}`);
  process.exit(1);
}
if (getVehicleModeName(2, 3) !== 'AUTO' || getVehicleModeName(2, 2) !== 'ALT_HOLD' || getVehicleModeName(2, 9) !== 'LAND') {
  console.error('Copter mode resolution failed!');
  process.exit(1);
}
if (getVehicleModeName(1, 10) !== 'AUTO' || getVehicleModeName(1, 5) !== 'FLY_BY_WIRE_A') {
  console.error('Plane mode resolution failed!');
  process.exit(1);
}
if (getVehicleModeName(12, 9) !== 'SURFACE' || getVehicleModeName(12, 16) !== 'POSHOLD') {
  console.error('Sub mode resolution failed!');
  process.exit(1);
}

// 11c. Test Glareshield Vehicle Flight Mode Selection Sets
const roverModes = getVehicleFlightModes(10);
const roverLabels = roverModes.map((m) => m.label);
if (roverLabels.includes('ALT HOLD') || roverLabels.includes('LAND')) {
  console.error('Rover flight modes must NOT include ALT HOLD or LAND!', roverLabels);
  process.exit(1);
}
if (roverLabels[0] !== 'HOLD' || roverLabels[1] !== 'MANUAL' || roverLabels[2] !== 'ACRO' || roverLabels[3] !== 'AUTO') {
  console.error('Rover first 4 modes must be HOLD | MANUAL | ACRO | AUTO, got:', roverLabels.slice(0, 4));
  process.exit(1);
}
const roverAuto = roverModes.find((m) => m.label === 'AUTO');
if (!roverAuto || roverAuto.mode !== 10) {
  console.error('Rover AUTO mode index must be 10, got:', roverAuto);
  process.exit(1);
}
const roverHold = roverModes.find((m) => m.label === 'HOLD');
if (!roverHold || roverHold.mode !== 4) {
  console.error('Rover HOLD mode index must be 4, got:', roverHold);
  process.exit(1);
}

const copterModes = getVehicleFlightModes(2);
const copterAuto = copterModes.find((m) => m.label === 'AUTO');
if (!copterAuto || copterAuto.mode !== 3) {
  console.error('Copter AUTO mode index must be 3, got:', copterAuto);
  process.exit(1);
}

console.log('Multi-vehicle category and mode resolution verified successfully!');

// 12. Test Fetch Cancellation and Abort Mechanisms
import { mavFtpClient } from '../src/mavlink/ftp.ts';

// Test MAVFTP abort
const aborted = mavFtpClient.abortCurrent();
if (aborted !== false) {
  console.error('abortCurrent() on idle client should return false');
  process.exit(1);
}

// Test ParamManager cancelFetch
let paramStatus: any = null;
const unsubParam = paramManager.onStatusChange((st) => { paramStatus = st; });
// simulate active fetch
(paramManager as any).setStatus({ isFetching: true, method: 'ftp', message: 'Downloading params...' });
if (!paramStatus?.isFetching) {
  console.error('ParamManager status isFetching should be true');
  process.exit(1);
}
paramManager.cancelFetch();
if (paramStatus?.isFetching || paramStatus?.message !== 'Parameter fetch cancelled') {
  console.error('ParamManager cancelFetch failed to reset status:', paramStatus);
  process.exit(1);
}
unsubParam();

// Test MissionManager cancelFetch
let missionStatus: any = null;
const unsubMission = missionManager.onStatusChange((st) => { missionStatus = st; });
(missionManager as any).setStatus({ isFetching: true, method: 'ftp', message: 'Syncing mission & fence...' });
if (!missionStatus?.isFetching) {
  console.error('MissionManager status isFetching should be true');
  process.exit(1);
}
missionManager.cancelFetch();
if (missionStatus?.isFetching || missionStatus?.message !== 'Mission & fence sync cancelled') {
  console.error('MissionManager cancelFetch failed to reset status:', missionStatus);
  process.exit(1);
}
unsubMission();

// Test FTP TerminateSession and ResetSessions packet creation
const termMsg = packFtpMessage(1, 1, 100, 5, FTP_OPCODE.TerminateSession, 0, 0);
const parsedTerm = parser.parse(termMsg);
const termPayload = parseFtpPayload(parsedTerm[0].payload);
if (!termPayload || termPayload.opcode !== FTP_OPCODE.TerminateSession || termPayload.session !== 5) {
  console.error('FTP TerminateSession packet layout invalid:', termPayload);
  process.exit(1);
}

const resetMsg = packFtpMessage(1, 1, 101, 0, FTP_OPCODE.ResetSessions, 0, 0);
const parsedReset = parser.parse(resetMsg);
const resetPayload = parseFtpPayload(parsedReset[0].payload);
if (!resetPayload || resetPayload.opcode !== FTP_OPCODE.ResetSessions) {
  console.error('FTP ResetSessions packet layout invalid:', resetPayload);
  process.exit(1);
}

console.log('Fetch cancellation and MAVFTP session control verified successfully!');

// 13. Test PARAM_VALUE in TelemetryStore Preserves Factory defaultValue
useTelemetryStore.setState({
  parameters: {
    WP_RADIUS: { value: 50, type: 9, index: 1, defaultValue: 50 },
  },
});

// Simulate incoming PARAM_VALUE packet with edited value 75
const pvPayload = new Uint8Array(25);
const pvDv = new DataView(pvPayload.buffer);
pvDv.setFloat32(0, 75.0, true);
pvDv.setUint16(4, 100, true);
pvDv.setUint16(6, 1, true);
const paramName = 'WP_RADIUS';
for (let i = 0; i < 16; i++) {
  pvPayload[8 + i] = i < paramName.length ? paramName.charCodeAt(i) : 0;
}
pvPayload[24] = 9;

const pvMsg = encoder.packV2(MAVLINK_MSG_ID.PARAM_VALUE, pvPayload);
const parsedPv = parser.parse(pvMsg);
if (parsedPv.length > 0) {
  useTelemetryStore.getState().processPacket(parsedPv[0]);
}

const updatedParam = useTelemetryStore.getState().parameters['WP_RADIUS'];
if (!updatedParam || updatedParam.value !== 75.0 || updatedParam.defaultValue !== 50) {
  console.error('PARAM_VALUE failed to preserve defaultValue in telemetry store!', updatedParam);
  process.exit(1);
}
console.log('PARAM_VALUE defaultValue preservation verified successfully: value =', updatedParam.value, 'defaultValue =', updatedParam.defaultValue);

// 14. Test formatParamValue formatting & truncation
import { formatParamValue } from '../src/components/widgets/ParametersWidget.tsx';

if (formatParamValue(50) !== '50') {
  console.error('formatParamValue(50) expected "50", got:', formatParamValue(50));
  process.exit(1);
}
if (formatParamValue(12.30000019) !== '12.3') {
  console.error('formatParamValue(12.30000019) expected "12.3", got:', formatParamValue(12.30000019));
  process.exit(1);
}
if (formatParamValue(150.25) !== '150.25') {
  console.error('formatParamValue(150.25) expected "150.25", got:', formatParamValue(150.25));
  process.exit(1);
}
console.log('formatParamValue truncation & formatting verified successfully!');

// 15. Test 4-Way Unit System (m/s / kmh / mph / kts) and Altitude Mode (AGL / MSL)
import { useUnitsStore } from '../src/store/unitsStore.ts';

// Test m/s (pure SI metric)
useUnitsStore.getState().setSystem('ms');
const spdMs = useUnitsStore.getState().formatSpeed(10); // 10 m/s = 10.0 m/s
const altMs = useUnitsStore.getState().formatAltitude(100); // 100 m
const climbMs = useUnitsStore.getState().formatClimb(2.5); // +2.5 m/s
if (spdMs.unit !== 'm/s' || spdMs.value !== '10.0' || altMs.unit !== 'm' || climbMs.unit !== 'm/s') {
  console.error('Unit system "ms" failed:', { spdMs, altMs, climbMs });
  process.exit(1);
}

// Test kmh (metric)
useUnitsStore.getState().setSystem('kmh');
const spdKmh = useUnitsStore.getState().formatSpeed(10); // 10 m/s = 36.0 km/h
const altKmh = useUnitsStore.getState().formatAltitude(100); // 100 m
const climbKmh = useUnitsStore.getState().formatClimb(2.5); // +2.5 m/s
if (spdKmh.unit !== 'km/h' || spdKmh.value !== '36.0' || altKmh.unit !== 'm' || climbKmh.unit !== 'm/s') {
  console.error('Unit system "kmh" failed:', { spdKmh, altKmh, climbKmh });
  process.exit(1);
}

// Test mph (imperial)
useUnitsStore.getState().setSystem('mph');
const spdMph = useUnitsStore.getState().formatSpeed(10); // 10 m/s ~ 22.4 mph
const altMph = useUnitsStore.getState().formatAltitude(100); // 100 m ~ 328 ft
const climbMph = useUnitsStore.getState().formatClimb(2.5); // 2.5 m/s ~ +492 ft/min
if (spdMph.unit !== 'mph' || spdMph.value !== '22.4' || altMph.unit !== 'ft' || climbMph.unit !== 'ft/min') {
  console.error('Unit system "mph" failed:', { spdMph, altMph, climbMph });
  process.exit(1);
}

// Test kts (imperial)
useUnitsStore.getState().setSystem('kts');
const spdKts = useUnitsStore.getState().formatSpeed(10); // 10 m/s ~ 19.4 kts
const altKts = useUnitsStore.getState().formatAltitude(100); // 100 m ~ 328 ft
const climbKts = useUnitsStore.getState().formatClimb(2.5); // 2.5 m/s ~ +492 ft/min
if (spdKts.unit !== 'kts' || spdKts.value !== '19.4' || altKts.unit !== 'ft' || climbKts.unit !== 'ft/min') {
  console.error('Unit system "kts" failed:', { spdKts, altKts, climbKts });
  process.exit(1);
}

// Test altitudeMode toggle
useUnitsStore.getState().setAltitudeMode('msl');
if (useUnitsStore.getState().altitudeMode !== 'msl') {
  console.error('altitudeMode MSL failed');
  process.exit(1);
}
useUnitsStore.getState().setAltitudeMode('agl');
if (useUnitsStore.getState().altitudeMode !== 'agl') {
  console.error('altitudeMode AGL failed');
  process.exit(1);
}

console.log('4-Way Unit System (m/s / kmh / mph / kts) and Altitude Mode verified successfully!');

// 16. Test Firmware Version Extraction & Telemetry Store Integration
import { extractFirmwareVersion } from '../src/mavlink/messages.ts';

const planeVer = extractFirmwareVersion('ArduPlane V4.8.0-dev (1d44127b)');
if (planeVer !== '4.8.0-dev') {
  console.error('Expected "4.8.0-dev", got:', planeVer);
  process.exit(1);
}

const copterVer = extractFirmwareVersion('ArduCopter V4.5.2 (78057ebe)');
if (copterVer !== '4.5.2') {
  console.error('Expected "4.5.2", got:', copterVer);
  process.exit(1);
}

const roverVer = extractFirmwareVersion('Rover V4.2.0 (52bca1c3)');
if (roverVer !== '4.2.0') {
  console.error('Expected "4.2.0", got:', roverVer);
  process.exit(1);
}

const arduRoverVer = extractFirmwareVersion('ArduRover V4.8.0-dev (0d6ca064)');
if (arduRoverVer !== '4.8.0-dev') {
  console.error('Expected "4.8.0-dev", got:', arduRoverVer);
  process.exit(1);
}

// Test MAV_CMD_DO_SEND_BANNER (42428) creation
const bannerCmd = encoder.createRequestBanner(1, 1);
if (bannerCmd[0] !== 0xfd || bannerCmd.length < 45) {
  console.error('Failed to create DO_SEND_BANNER command');
  process.exit(1);
}
const bannerCmdId = bannerCmd[38] | (bannerCmd[39] << 8);
if (bannerCmdId !== 42428) {
  console.error('Expected command ID 42428, got:', bannerCmdId);
  process.exit(1);
}

// Test TelemetryStore STATUSTEXT processing sets firmwareVersion
const bootStatusPayload = new Uint8Array(51);
bootStatusPayload[0] = 6; // severity INFO
const bannerStr = 'ArduPlane V4.8.0-dev (1d44127b)';
for (let i = 0; i < bannerStr.length; i++) {
  bootStatusPayload[1 + i] = bannerStr.charCodeAt(i);
}
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 1,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.STATUSTEXT,
  payload: bootStatusPayload,
  crc: 0,
  raw: new Uint8Array(0),
});

if (useTelemetryStore.getState().firmwareVersion !== '4.8.0-dev') {
  console.error('TelemetryStore firmwareVersion expected "4.8.0-dev", got:', useTelemetryStore.getState().firmwareVersion);
  process.exit(1);
}

// Test AUTOPILOT_VERSION (msg 148) decode
const apVerPayload = new Uint8Array(60);
const apView = new DataView(apVerPayload.buffer);
// flight_sw_version: major=4, minor=8, patch=0, type=0 (dev) -> (4 << 24) | (8 << 16) | (0 << 8) | 0
apView.setUint32(16, (4 << 24) | (8 << 16) | (0 << 8) | 0, true);
const apDecoded = decodePayload(MAVLINK_MSG_ID.AUTOPILOT_VERSION, apVerPayload);
if (apDecoded.versionStr !== '4.8.0-dev') {
  console.error('AUTOPILOT_VERSION decode expected "4.8.0-dev", got:', apDecoded.versionStr);
  process.exit(1);
}

console.log('Firmware version extraction and store integration verified successfully!');

// 17. Test MISSION_CURRENT (msg 42) decode & store tracking
const missionCurPayload = new Uint8Array(2);
new DataView(missionCurPayload.buffer).setUint16(0, 3, true); // WP seq 3
const decodedMissionCur = decodePayload(MAVLINK_MSG_ID.MISSION_CURRENT, missionCurPayload);
if (decodedMissionCur.seq !== 3) {
  console.error('MISSION_CURRENT decode expected seq 3, got:', decodedMissionCur.seq);
  process.exit(1);
}

useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 2,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_CURRENT,
  payload: missionCurPayload,
  crc: 0,
  raw: new Uint8Array(0),
});

if (useTelemetryStore.getState().currentWaypointSeq !== 3) {
  console.error('currentWaypointSeq expected 3, got:', useTelemetryStore.getState().currentWaypointSeq);
  process.exit(1);
}
console.log('MISSION_CURRENT decode and waypoint tracking verified successfully!');

// 18. Test IMU & Normal Load Factor (Nz) decode and telemetryStore integration
const scaledImuPayload = new Uint8Array(22);
const scaledView = new DataView(scaledImuPayload.buffer);
scaledView.setUint32(0, 1000, true); // time_boot_ms
scaledView.setInt16(4, 0, true);     // xacc
scaledView.setInt16(6, 0, true);     // yacc
scaledView.setInt16(8, -1200, true); // zacc = -1200 mg -> Nz = +1.2 G
const decodedScaledImu = decodePayload(MAVLINK_MSG_ID.SCALED_IMU, scaledImuPayload);
if (Math.abs(decodedScaledImu.nz - 1.2) > 0.001) {
  console.error('SCALED_IMU Nz decode expected 1.2, got:', decodedScaledImu.nz);
  process.exit(1);
}

useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 3,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.SCALED_IMU,
  payload: scaledImuPayload,
  crc: 0,
  raw: new Uint8Array(0),
});

if (Math.abs(useTelemetryStore.getState().imu.nz - 1.2) > 0.001) {
  console.error('telemetryStore imu.nz expected 1.2, got:', useTelemetryStore.getState().imu.nz);
  process.exit(1);
}

// Test HIGHRES_IMU (msg 105)
const highresPayload = new Uint8Array(62);
const highresView = new DataView(highresPayload.buffer);
highresView.setFloat32(16, -19.6133, true); // zacc = -2G in m/s^2 -> Nz = +2.0 G
const decodedHighres = decodePayload(MAVLINK_MSG_ID.HIGHRES_IMU, highresPayload);
if (Math.abs(decodedHighres.nz - 2.0) > 0.01) {
  console.error('HIGHRES_IMU Nz decode expected 2.0, got:', decodedHighres.nz);
  process.exit(1);
}
console.log('IMU and Nz load factor decoding verified successfully!');

// 19. Test Extended Telemetry Store Slices, Custom Widget Value Extraction & Dashboard Reordering
import { extractBoundValueFromState } from '../src/components/widgets/CustomWidgetRenderer.tsx';
import { useDashboardStore } from '../src/store/dashboardStore.ts';

// Test WIND (msg 168) -> store & custom widget binding
const windPayload = new Uint8Array(12);
const windDv = new DataView(windPayload.buffer);
windDv.setFloat32(0, 275.0, true); // direction
windDv.setFloat32(4, 8.5, true);   // speed
windDv.setFloat32(8, -0.4, true);  // speed_z
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 10,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.WIND,
  payload: windPayload,
  crc: 0,
  raw: new Uint8Array(0),
});
if (useTelemetryStore.getState().wind.direction !== 275 || useTelemetryStore.getState().wind.speed !== 8.5) {
  console.error('WIND telemetryStore update failed!', useTelemetryStore.getState().wind);
  process.exit(1);
}
const boundWindDir = extractBoundValueFromState(
  { messageName: 'WIND', fieldName: 'direction', decimals: 0 },
  useTelemetryStore.getState()
);
if (boundWindDir !== '275') {
  console.error('extractBoundValueFromState(WIND.direction) expected "275", got:', boundWindDir);
  process.exit(1);
}

// Test RC_CHANNELS (msg 65) indexed channel extraction
const rcPayload = new Uint8Array(42);
const rcDv = new DataView(rcPayload.buffer);
rcDv.setUint32(0, 5000, true);
rcDv.setUint16(4, 1525, true); // chan1_raw
rcDv.setUint16(8, 1850, true); // chan3_raw
rcPayload[40] = 16; // chancount
rcPayload[41] = 99; // rssi
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 11,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.RC_CHANNELS,
  payload: rcPayload,
  crc: 0,
  raw: new Uint8Array(0),
});
const boundRc3 = extractBoundValueFromState(
  { messageName: 'RC_CHANNELS', fieldName: 'chan3_raw', decimals: 0 },
  useTelemetryStore.getState()
);
if (boundRc3 !== '1850') {
  console.error('extractBoundValueFromState(RC_CHANNELS.chan3_raw) expected "1850", got:', boundRc3);
  process.exit(1);
}

// Test DashboardStore drag-and-drop reorderWidgetsInActiveTab & reorderTabs
useDashboardStore.getState().resetToDefaults();
const beforeWidgets = useDashboardStore.getState().profile.tabs[0].widgets.map((w) => w.instanceId);
useDashboardStore.getState().reorderWidgetsInActiveTab(0, 2);
const afterWidgets = useDashboardStore.getState().profile.tabs[0].widgets.map((w) => w.instanceId);
if (afterWidgets[2] !== beforeWidgets[0] || afterWidgets[0] !== beforeWidgets[1]) {
  console.error('reorderWidgetsInActiveTab failed!', { beforeWidgets, afterWidgets });
  process.exit(1);
}

const beforeTabs = useDashboardStore.getState().profile.tabs.map((t) => t.id);
useDashboardStore.getState().reorderTabs(0, 1);
const afterTabs = useDashboardStore.getState().profile.tabs.map((t) => t.id);
if (afterTabs[0] !== beforeTabs[1] || afterTabs[1] !== beforeTabs[0]) {
  console.error('reorderTabs failed!', { beforeTabs, afterTabs });
  process.exit(1);
}

// Test Action button confirmation prompt displays underlying MAV_CMD name
import { getMavCmdName as getCmdNameCheck } from '../src/mavlink/messages.ts';
if (getCmdNameCheck(400) !== 'COMPONENT_ARM_DISARM') {
  console.error('getMavCmdName(400) expected COMPONENT_ARM_DISARM, got:', getCmdNameCheck(400));
  process.exit(1);
}
if (getCmdNameCheck(20) !== 'NAV_RETURN_TO_LAUNCH') {
  console.error('getMavCmdName(20) expected NAV_RETURN_TO_LAUNCH, got:', getCmdNameCheck(20));
  process.exit(1);
}

// Action prompt formatting verification:
const fakeLabel = 'Trigger Return to Launch';
const fakeCmdId = 400; // Misleading label on force-arm command
const prompt = `Confirm: ${fakeLabel} — ${getCmdNameCheck(fakeCmdId)}?`;
if (prompt !== 'Confirm: Trigger Return to Launch — COMPONENT_ARM_DISARM?') {
  console.error('Confirmation prompt mismatch:', prompt);
  process.exit(1);
}

// Test Duplicate Widget Import Renaming:
const customWidgets = useDashboardStore.getState().profile.customWidgets;
const collidingWidget = {
  id: 'custom-rtl-btn',
  name: 'Quick RTL Trigger',
  displayType: 'action-button' as const,
  category: 'control' as const,
  action: {
    label: 'Trigger Return to Launch',
    commandId: 400,
    params: [1, 21196, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number],
    confirmation: true,
  },
};
const existingIds = new Set(customWidgets.map((c) => c.id));
const existingNames = new Set(customWidgets.map((c) => c.name.trim().toLowerCase()));
let importedWidget = { ...collidingWidget };
if (existingIds.has(importedWidget.id) || existingNames.has(importedWidget.name.trim().toLowerCase())) {
  if (existingIds.has(importedWidget.id)) {
    importedWidget.id = `custom-fresh-${Date.now()}`;
  }
  if (!importedWidget.name.includes('(imported)')) {
    importedWidget.name = `${importedWidget.name} (imported)`;
  }
}
if (importedWidget.id === 'custom-rtl-btn' || importedWidget.name !== 'Quick RTL Trigger (imported)') {
  console.error('Duplicate widget import failed to rename and assign fresh ID:', importedWidget);
  process.exit(1);
}

console.log('Extended telemetry slices, custom widget bindings, and dashboard drag reordering verified!');

// 20. Test Dual GPS Modules (GPS_RAW_INT & GPS2_RAW) with Yaw Latching
// Initial state: gps.hasYaw should be false, gps2 null
const testGpsPayload1 = new Uint8Array(52);
const testGpsDv1 = new DataView(testGpsPayload1.buffer);
testGpsDv1.setBigUint64(0, 1000n, true);
testGpsDv1.setInt32(8, Math.round(37.7749 * 1e7), true);
testGpsDv1.setInt32(12, Math.round(-122.4194 * 1e7), true);
testGpsDv1.setInt32(16, 45000, true);
testGpsDv1.setUint16(20, 85, true); // HDOP 0.85
testGpsDv1.setUint16(22, 120, true); // VDOP 1.2
testGpsDv1.setUint16(24, 520, true); // vel 5.2 m/s
testGpsDv1.setUint16(26, 18000, true); // cog 180 deg
testGpsPayload1[28] = 3; // fix_type 3D
testGpsPayload1[29] = 14; // satellites
testGpsDv1.setUint16(50, 0, true); // yaw 0 (not configured)

useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 20,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS_RAW_INT,
  payload: testGpsPayload1,
  crc: 0,
  raw: new Uint8Array(0),
});

let gpsState = useTelemetryStore.getState().gps;
if (gpsState.hasYaw || gpsState.yaw !== undefined) {
  console.error('GPS_RAW_INT with yaw=0 should not have hasYaw=true!', gpsState);
  process.exit(1);
}

// Receive GPS_RAW_INT with valid yaw = 24550 (245.5 deg)
testGpsDv1.setUint16(50, 24550, true);
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 21,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS_RAW_INT,
  payload: testGpsPayload1,
  crc: 0,
  raw: new Uint8Array(0),
});

gpsState = useTelemetryStore.getState().gps;
if (!gpsState.hasYaw || Math.abs((gpsState.yaw ?? 0) - 245.5) > 0.01) {
  console.error('GPS_RAW_INT failed to latch yaw!', gpsState);
  process.exit(1);
}

// Now simulate vehicle turning North (yaw = 36000 cdeg = 360 deg = 0 deg North):
testGpsDv1.setUint16(50, 36000, true);
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 22,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS_RAW_INT,
  payload: testGpsPayload1,
  crc: 0,
  raw: new Uint8Array(0),
});
gpsState = useTelemetryStore.getState().gps;
if (!gpsState.hasYaw || gpsState.yaw !== 0) {
  console.error('GPS_RAW_INT with raw_yaw=36000 should decode to 0 deg North with hasYaw=true!', gpsState);
  process.exit(1);
}

// Now simulate losing yaw solution (yaw = 0 = unavailable in MAVLink spec):
// hasYaw must remain true (configured), but yaw must be undefined (showing '--' in UI, not 0 deg North!)
testGpsDv1.setUint16(50, 0, true);
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 23,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS_RAW_INT,
  payload: testGpsPayload1,
  crc: 0,
  raw: new Uint8Array(0),
});
gpsState = useTelemetryStore.getState().gps;
if (!gpsState.hasYaw || gpsState.yaw !== undefined) {
  console.error('GPS_RAW_INT with raw_yaw=0 must map to undefined yaw (unavailable), not 0 deg!', gpsState);
  process.exit(1);
}

// Test GPS2_RAW (msg 124) packet decode & store handling
const testGps2Payload = new Uint8Array(37);
const testGps2Dv = new DataView(testGps2Payload.buffer);
testGps2Dv.setBigUint64(0, 2000n, true);
testGps2Dv.setInt32(8, Math.round(37.7749 * 1e7), true);
testGps2Dv.setInt32(12, Math.round(-122.4194 * 1e7), true);
testGps2Dv.setInt32(16, 45000, true);
testGps2Dv.setUint32(20, 0, true); // dgps_age
testGps2Dv.setUint16(24, 65, true); // eph = 0.65
testGps2Dv.setUint16(26, 95, true); // epv = 0.95
testGps2Dv.setUint16(28, 515, true); // vel = 5.15
testGps2Dv.setUint16(30, 18000, true); // cog = 180
testGps2Payload[32] = 6; // fix_type = 6 (RTK Fixed)
testGps2Payload[33] = 18; // satellites_visible = 18
testGps2Payload[34] = 0; // dgps_numch
testGps2Dv.setUint16(35, 12030, true); // yaw = 120.30 deg

const parsedGps2 = decodePayload(MAVLINK_MSG_ID.GPS2_RAW, testGps2Payload);
if (parsedGps2.fix_type !== 6 || parsedGps2.satellites_visible !== 18 || Math.abs(parsedGps2.yaw - 120.3) > 0.01) {
  console.error('decodePayload(GPS2_RAW) failed!', parsedGps2);
  process.exit(1);
}

useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 23,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS2_RAW,
  payload: testGps2Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

const gps2State = useTelemetryStore.getState().gps2;
if (!gps2State || gps2State.fixType !== 6 || gps2State.fixLabel !== 'RTK Fixed' || !gps2State.hasYaw || Math.abs((gps2State.yaw ?? 0) - 120.3) > 0.01) {
  console.error('telemetryStore gps2 handling failed!', gps2State);
  process.exit(1);
}

// Test GPS2_RAW with yaw=65535 (configured in ArduPilot but uninitialized/searching)
const uninitGps2Payload = new Uint8Array(37);
const uninitGps2Dv = new DataView(uninitGps2Payload.buffer);
uninitGps2Dv.setBigUint64(0, 3000n, true);
uninitGps2Payload[32] = 3; // 3D Fix
uninitGps2Payload[33] = 12; // 12 sats
uninitGps2Dv.setUint16(35, 65535, true); // uninitialized yaw sentinel

// Reset gps2 state to simulate a fresh connection to an uninitialized vehicle
useTelemetryStore.setState({ gps2: null });
useTelemetryStore.getState().processPacket({
  version: 2,
  sequence: 24,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.GPS2_RAW,
  payload: uninitGps2Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

const uninitGps2State = useTelemetryStore.getState().gps2;
if (!uninitGps2State || !uninitGps2State.hasYaw || uninitGps2State.yaw !== undefined) {
  console.error('telemetryStore gps2 uninitialized yaw (65535) failed to register hasYaw=true and yaw=undefined!', uninitGps2State);
  process.exit(1);
}

console.log('Dual GPS modules (GPS_RAW_INT & GPS2_RAW) and yaw latching verified successfully!');

// 21. Test Consecutive Identical STATUSTEXT Message Grouping & Counter Badging
useTelemetryStore.getState().clearMessages();

function makeStatusPacket(text: string, severity: number, seq: number) {
  const payload = new Uint8Array(51);
  payload[0] = severity;
  for (let i = 0; i < text.length && i < 50; i++) {
    payload[1 + i] = text.charCodeAt(i);
  }
  return {
    version: 2 as const,
    sequence: seq,
    systemId: 1,
    componentId: 1,
    messageId: MAVLINK_MSG_ID.STATUSTEXT,
    payload,
    crc: 0,
    raw: new Uint8Array(0),
  };
}

// Message 1
useTelemetryStore.getState().processPacket(makeStatusPacket('PreArm: Compass not calibrated', 4, 30));
let msgs = useTelemetryStore.getState().statusMessages;
if (msgs.length !== 1 || msgs[0].count !== 1 || msgs[0].text !== 'PreArm: Compass not calibrated') {
  console.error('STATUSTEXT grouping: initial message failed!', msgs);
  process.exit(1);
}

// Message 2 (identical & consecutive)
useTelemetryStore.getState().processPacket(makeStatusPacket('PreArm: Compass not calibrated', 4, 31));
msgs = useTelemetryStore.getState().statusMessages;
if (msgs.length !== 1 || msgs[0].count !== 2) {
  console.error('STATUSTEXT grouping: duplicate message was not grouped into count=2!', msgs);
  process.exit(1);
}

// Message 3 (identical & consecutive)
useTelemetryStore.getState().processPacket(makeStatusPacket('PreArm: Compass not calibrated', 4, 32));
msgs = useTelemetryStore.getState().statusMessages;
if (msgs.length !== 1 || msgs[0].count !== 3) {
  console.error('STATUSTEXT grouping: duplicate message was not grouped into count=3!', msgs);
  process.exit(1);
}

// Message 4 (different message)
useTelemetryStore.getState().processPacket(makeStatusPacket('EKF3 IMU0 initialised', 6, 33));
msgs = useTelemetryStore.getState().statusMessages;
if (msgs.length !== 2 || msgs[0].text !== 'EKF3 IMU0 initialised' || msgs[0].count !== 1 || msgs[1].count !== 3) {
  console.error('STATUSTEXT grouping: distinct message handling failed!', msgs);
  process.exit(1);
}

// Message 5 (same text as msg 1-3, but non-consecutive)
useTelemetryStore.getState().processPacket(makeStatusPacket('PreArm: Compass not calibrated', 4, 34));
msgs = useTelemetryStore.getState().statusMessages;
if (msgs.length !== 3 || msgs[0].count !== 1 || msgs[2].count !== 3) {
  console.error('STATUSTEXT grouping: non-consecutive message created false grouping!', msgs);
  process.exit(1);
}

console.log('Consecutive identical STATUSTEXT message grouping and counter verification PASSED!');

// 22. Test Multi-Port SERVO_OUTPUT_RAW handling and prevention of servo 1-8 flickering
const testServoPort0Payload = new Uint8Array(37);
const testServoPort0Dv = new DataView(testServoPort0Payload.buffer);
testServoPort0Dv.setUint32(0, 1000, true);
for (let i = 0; i < 8; i++) {
  testServoPort0Dv.setUint16(4 + i * 2, 1000 + (i + 1) * 100, true); // 1100 .. 1800 for servos 1-8
}
testServoPort0Payload[20] = 0; // port 0
for (let i = 0; i < 8; i++) {
  testServoPort0Dv.setUint16(21 + i * 2, 1850 + i * 10, true); // servos 9-16
}

useTelemetryStore.getState().processPacket({
  version: 2 as const,
  sequence: 40,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.SERVO_OUTPUT_RAW,
  payload: testServoPort0Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

let servoState = useTelemetryStore.getState().servo;
if (servoState.servos[0] !== 1100 || servoState.servos[7] !== 1800 || !servoState.ports[0]) {
  console.error('SERVO_OUTPUT_RAW: port 0 initial populate failed!', servoState);
  process.exit(1);
}

// Now send port 1 (servos 17-32)
const testServoPort1Payload = new Uint8Array(37);
const testServoPort1Dv = new DataView(testServoPort1Payload.buffer);
testServoPort1Dv.setUint32(0, 1020, true);
for (let i = 0; i < 8; i++) {
  testServoPort1Dv.setUint16(4 + i * 2, 2100 + i * 10, true); // servos 17-24
}
testServoPort1Payload[20] = 1; // port 1
for (let i = 0; i < 8; i++) {
  testServoPort1Dv.setUint16(21 + i * 2, 2200 + i * 10, true); // servos 25-32
}

useTelemetryStore.getState().processPacket({
  version: 2 as const,
  sequence: 41,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.SERVO_OUTPUT_RAW,
  payload: testServoPort1Payload,
  crc: 0,
  raw: new Uint8Array(0),
});

servoState = useTelemetryStore.getState().servo;
// Servos 1-8 MUST remain 1100..1800 from port 0 (NO flickering!), and ports[1] must be recorded
if (servoState.servos[0] !== 1100 || servoState.servos[7] !== 1800) {
  console.error('SERVO_OUTPUT_RAW: port 1 arrival caused servos 1-8 to flicker/overwrite!', servoState);
  process.exit(1);
}
if (!servoState.ports[0] || !servoState.ports[1] || servoState.servos[16] !== 2100) {
  console.error('SERVO_OUTPUT_RAW: port keying or high channel merge failed!', servoState);
  process.exit(1);
}
console.log('Multi-port SERVO_OUTPUT_RAW non-flicker and port keying PASSED!');

// 23. Test DISTANCE_SENSOR Orientation Filtering (only downward orientation 25 belongs in rangefinder)
useTelemetryStore.setState({
  rangefinder: {
    distance: 3.2,
    voltage: 0,
    minDistance: 0.2,
    maxDistance: 10.0,
    signalQuality: 100,
  },
});

// Send forward-facing proximity sensor: orientation = 0, distance = 0.8m
const testDistSensorFwd = new Uint8Array(39);
const testDistSensorFwdDv = new DataView(testDistSensorFwd.buffer);
testDistSensorFwdDv.setUint16(4, 20, true); // min 0.2m
testDistSensorFwdDv.setUint16(6, 400, true); // max 4.0m
testDistSensorFwdDv.setUint16(8, 80, true); // dist 0.8m
testDistSensorFwd[12] = 0; // orientation 0 (forward facing)
testDistSensorFwd[38] = 90; // signal_quality

useTelemetryStore.getState().processPacket({
  version: 2 as const,
  sequence: 50,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.DISTANCE_SENSOR,
  payload: testDistSensorFwd,
  crc: 0,
  raw: new Uint8Array(0),
});

let rfState = useTelemetryStore.getState().rangefinder;
if (rfState.distance !== 3.2) {
  console.error('DISTANCE_SENSOR: forward sensor (orientation 0) incorrectly overwrote downward rangefinder!', rfState);
  process.exit(1);
}

// Send downward-facing sensor: orientation = 25 (MAV_SENSOR_ROTATION_PITCH_270), distance = 2.5m
const testDistSensorDown = new Uint8Array(39);
const testDistSensorDownDv = new DataView(testDistSensorDown.buffer);
testDistSensorDownDv.setUint16(4, 20, true); // min 0.2m
testDistSensorDownDv.setUint16(6, 1200, true); // max 12.0m
testDistSensorDownDv.setUint16(8, 250, true); // dist 2.5m
testDistSensorDown[12] = 25; // orientation 25 (downward)
testDistSensorDown[38] = 95; // signal_quality

useTelemetryStore.getState().processPacket({
  version: 2 as const,
  sequence: 51,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.DISTANCE_SENSOR,
  payload: testDistSensorDown,
  crc: 0,
  raw: new Uint8Array(0),
});

rfState = useTelemetryStore.getState().rangefinder;
if (rfState.distance !== 2.5 || rfState.maxDistance !== 12.0) {
  console.error('DISTANCE_SENSOR: downward sensor (orientation 25) failed to update rangefinder!', rfState);
  process.exit(1);
}
console.log('DISTANCE_SENSOR downward orientation filtering PASSED!');

// 24. Test MavFtpClient Queue Cancellation on abortCurrent()
async function testFtpQueueCancel() {
  const { mavFtpClient } = await import('../src/mavlink/ftp');
  let secondRan = false;

  // Queue first read
  const p1 = mavFtpClient.readFile(1, 1, '@PARAM/first.pck', 239, 5000);
  // Wait a tick for first read to begin executing and register currentAbort
  await new Promise((r) => setTimeout(r, 10));

  // Queue second read while first is active
  const p2 = mavFtpClient.readFile(1, 1, '@PARAM/second.pck', 239, 5000).then((res) => {
    if (res !== null) secondRan = true;
    return res;
  });

  // Now abort
  const aborted = mavFtpClient.abortCurrent();
  if (!aborted) {
    console.error('MavFtpClient abortCurrent failed to report active transfer aborted!');
    process.exit(1);
  }

  const [res1, res2] = await Promise.all([p1, p2]);
  if (res1 !== null || res2 !== null || secondRan) {
    console.error('MavFtpClient cancel failed: queued transfer ran after cancel!', { res1, res2, secondRan });
    process.exit(1);
  }
  console.log('MavFtpClient queue cancellation on abortCurrent PASSED!');
}

await testFtpQueueCancel();

// 25. Test Mission File Packing, Parsing, and Drop Handling
import { packDatFile, parseDroppedMissionFile, parseQgcWplText, parseQgcPlanJson } from '../src/mavlink/missionFileParser.ts';

// Test 25a: packDatFile roundtrip with unpackMissionDat
const testWps = [
  { seq: 0, command: 16, x: 37.7749, y: -122.4194, z: 10, current: 1, frame: 0, param1: 0, param2: 0, param3: 0, param4: 0, mission_type: 0 },
  { seq: 1, command: 16, x: 37.7760, y: -122.4180, z: 50, current: 0, frame: 3, param1: 0, param2: 0, param3: 0, param4: 0, mission_type: 0 },
];
const packedDat = packDatFile(testWps, 0);
const unpackedDat = missionManager.unpackMissionDat(packedDat);
if (!unpackedDat || unpackedDat.length !== 2 || Math.abs(unpackedDat[1].lat - 37.7760) > 0.0001 || unpackedDat[1].alt !== 50) {
  console.error('packDatFile -> unpackMissionDat roundtrip failed!', unpackedDat);
  process.exit(1);
}
console.log('packDatFile roundtrip with unpackMissionDat PASSED!');

// Test 25b: QGC WPL 110 text parsing
const sampleWplText = `QGC WPL 110
0\t1\t0\t16\t0\t0\t0\t0\t37.774900\t-122.419400\t10.000000\t1
1\t0\t3\t16\t0\t0\t0\t0\t37.776000\t-122.418000\t50.000000\t1
2\t0\t3\t20\t0\t0\t0\t0\t0.000000\t0.000000\t0.000000\t1`;

const parsedWpl = parseDroppedMissionFile('flight_plan.waypoints', new TextEncoder().encode(sampleWplText));
if (!parsedWpl || parsedWpl.type !== 'mission' || parsedWpl.items.length !== 3 || parsedWpl.items[1].command !== 16) {
  console.error('parseDroppedMissionFile failed on QGC WPL text!', parsedWpl);
  process.exit(1);
}
console.log('QGC WPL 110 text parsing PASSED!');

// Test 25c: QGC Fence file parsing
const sampleFenceText = `QGC WPL 110
0\t0\t0\t5001\t4\t0\t0\t0\t37.775000\t-122.420000\t0.000000\t1
1\t0\t0\t5001\t4\t0\t0\t0\t37.775000\t-122.418000\t0.000000\t1
2\t0\t0\t5001\t4\t0\t0\t0\t37.773000\t-122.418000\t0.000000\t1
3\t0\t0\t5001\t4\t0\t0\t0\t37.773000\t-122.420000\t0.000000\t1`;

const parsedFence = parseDroppedMissionFile('boundary.fence', new TextEncoder().encode(sampleFenceText));
if (!parsedFence || parsedFence.type !== 'fence' || parsedFence.items.length !== 4 || parsedFence.missionType !== 1) {
  console.error('parseDroppedMissionFile failed on fence text!', parsedFence);
  process.exit(1);
}
console.log('QGC Fence file parsing PASSED!');

// Test 25d: QGC Plan JSON format parsing
const samplePlanJson = JSON.stringify({
  fileType: 'Plan',
  version: 1,
  mission: {
    plannedHomePosition: [37.7749, -122.4194, 15],
    items: [
      { command: 16, frame: 3, autoContinue: true, params: [0, 0, 0, 0, 37.78, -122.41, 60] },
      { command: 20, frame: 2, autoContinue: true, params: [0, 0, 0, 0, 0, 0, 0] },
    ],
  },
});
const parsedPlan = parseDroppedMissionFile('survey.plan', new TextEncoder().encode(samplePlanJson));
if (!parsedPlan || parsedPlan.type !== 'mission' || parsedPlan.items.length !== 3 || Math.abs(parsedPlan.items[1].x! - 37.78) > 0.001) {
  console.error('parseDroppedMissionFile failed on QGC plan JSON!', parsedPlan);
  process.exit(1);
}
console.log('QGC Plan JSON parsing PASSED!');

// 26. Test GPS_RTCM_DATA and Mission Upload Encoder Methods
const rtcmData = new Uint8Array([0xd3, 0x00, 0x04, 0x41, 0x10, 0x00]);
const rtcmPacket = encoder.createGpsRtcmData(0x08, rtcmData);
const parsedRtcm = parser.parse(rtcmPacket);
if (parsedRtcm.length !== 1 || parsedRtcm[0].messageId !== MAVLINK_MSG_ID.GPS_RTCM_DATA) {
  console.error('Failed to parse GPS_RTCM_DATA packet!', parsedRtcm);
  process.exit(1);
}
const decodedRtcm = decodePayload(MAVLINK_MSG_ID.GPS_RTCM_DATA, parsedRtcm[0].payload);
if (decodedRtcm.flags !== 0x08 || decodedRtcm.len !== 6 || decodedRtcm.data.length !== 6 || decodedRtcm.data[0] !== 0xd3) {
  console.error('Decoded GPS_RTCM_DATA mismatch!', decodedRtcm);
  process.exit(1);
}
console.log('GPS_RTCM_DATA encode and decode PASSED!');

// Test createMissionCount and createMissionItemInt
const encCountPacket = encoder.createMissionCount(1, 1, 5, 1);
const parsedEncCount = parser.parse(encCountPacket);
const decodedEncCount = decodePayload(MAVLINK_MSG_ID.MISSION_COUNT, parsedEncCount[0].payload);
if (decodedEncCount.count !== 5 || decodedEncCount.mission_type !== 1) {
  console.error('createMissionCount payload mismatch!', decodedEncCount);
  process.exit(1);
}

const encItemPacket = encoder.createMissionItemInt(1, 1, {
  seq: 2,
  command: 16,
  frame: 3,
  current: 0,
  autocontinue: 1,
  x: 37.7749,
  y: -122.4194,
  z: 100,
  mission_type: 0,
});
const parsedEncItem = parser.parse(encItemPacket);
const decodedEncItem = decodePayload(MAVLINK_MSG_ID.MISSION_ITEM_INT, parsedEncItem[0].payload);
if (decodedEncItem.seq !== 2 || decodedEncItem.command !== 16 || Math.abs(decodedEncItem.x - 37.7749) > 0.0001 || decodedEncItem.z !== 100) {
  console.error('createMissionItemInt payload mismatch!', decodedEncItem);
  process.exit(1);
}
console.log('createMissionCount & createMissionItemInt PASSED!');

// 27. Test MissionManager uploadFile with MAVFTP failure and item-by-item fallback
import { mavlinkConnection } from '../src/mavlink/connection.ts';

async function testMissionUploadFallback() {
  const originalSend = mavlinkConnection.send.bind(mavlinkConnection);
  let step = 0;

  const emitPacket = (pktBytes: Uint8Array) => {
    const packets = new MavlinkParser().parse(pktBytes);
    for (const pkt of packets) {
      for (const listener of (mavlinkConnection as any).packetListeners) {
        listener(pkt);
      }
    }
  };

  // Intercept outbound MAVLink traffic to simulate vehicle replies
  (mavlinkConnection as any).send = (data: Uint8Array) => {
    const packets = new MavlinkParser().parse(data);
    for (const pkt of packets) {
      if (pkt.messageId === MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL) {
        // Step 1: Vehicle NACKs CreateFile to simulate vehicle without MAVFTP mission support
        const nackPayload = new Uint8Array(254);
        nackPayload[1] = 255; // target system (GCS)
        nackPayload[2] = 190; // target component (GCS)
        const dv = new DataView(nackPayload.buffer, 3, 251);
        dv.setUint16(0, 1, true); // seq
        dv.setUint8(2, 0); // session
        dv.setUint8(3, 129); // NACK opcode
        dv.setUint8(4, 1); // size
        dv.setUint8(5, FTP_OPCODE.CreateFile); // req_opcode
        nackPayload[15] = 1; // FAIL error code
        const nackPkt = encoder.packV2(MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL, nackPayload);
        setTimeout(() => {
          emitPacket(nackPkt);
        }, 10);
      } else if (pkt.messageId === MAVLINK_MSG_ID.MISSION_COUNT) {
        // Step 2: Vehicle replies to MISSION_COUNT with MISSION_REQUEST_INT for seq 0
        const req0Payload = new Uint8Array(5);
        const req0Dv = new DataView(req0Payload.buffer);
        req0Dv.setUint16(0, 0, true); // seq 0
        req0Payload[2] = 255;
        req0Payload[3] = 190;
        req0Payload[4] = 0; // mission_type
        const req0Pkt = encoder.packV2(MAVLINK_MSG_ID.MISSION_REQUEST_INT, req0Payload);
        setTimeout(() => {
          emitPacket(req0Pkt);
        }, 10);
      } else if (pkt.messageId === MAVLINK_MSG_ID.MISSION_ITEM_INT) {
        const itemData = decodePayload(MAVLINK_MSG_ID.MISSION_ITEM_INT, pkt.payload);
        if (itemData.seq === 0) {
          // Request seq 1
          const req1Payload = new Uint8Array(5);
          const req1Dv = new DataView(req1Payload.buffer);
          req1Dv.setUint16(0, 1, true); // seq 1
          req1Payload[2] = 255;
          req1Payload[3] = 190;
          req1Payload[4] = 0;
          const req1Pkt = encoder.packV2(MAVLINK_MSG_ID.MISSION_REQUEST_INT, req1Payload);
          setTimeout(() => {
            emitPacket(req1Pkt);
          }, 10);
        } else if (itemData.seq === 1) {
          // Send MISSION_ACK
          const ackPayload = new Uint8Array(4);
          ackPayload[0] = 255;
          ackPayload[1] = 190;
          ackPayload[2] = 0; // MAV_MISSION_ACCEPTED
          ackPayload[3] = 0; // mission_type = 0
          const ackPkt = encoder.packV2(MAVLINK_MSG_ID.MISSION_ACK, ackPayload);
          setTimeout(() => {
            emitPacket(ackPkt);
          }, 10);
        }
      }
    }
  };

  try {
    const uploadResult = await missionManager.uploadFile('sample.waypoints', new TextEncoder().encode(sampleWplText.split('\n').slice(0, 3).join('\n')));
    if (!uploadResult.success || uploadResult.method !== 'legacy' || uploadResult.count !== 2) {
      console.error('uploadFile fallback to legacy item-by-item failed!', uploadResult);
      process.exit(1);
    }
    console.log('uploadFile MAVFTP -> item-by-item fallback PASSED!');
  } finally {
    (mavlinkConnection as any).send = originalSend;
  }
}

await testMissionUploadFallback();

// 28. Test RTCM3 Stream Parser, CRC24Q, NMEA GGA Generator, and MAVLink Injection
import {
  calculateCrc24q,
  generateNmeaGga,
  RtcmFrameParser,
  rtcmInjector,
  ecefToWgs84,
  extractRtcm1005Arp,
} from '../src/mavlink/rtcmInjector.ts';

// 28a. Test CRC24Q and Frame Assembly
// Create synthetic RTCM 1005 (Base Station ARP): payload length 19 bytes
const arpPayload = new Uint8Array(19);
// Message number 1005 (0x03ED) in first 12 bits:
// byte 0: 0x3E, byte 1: 0xD0 (0x3ED = 1005)
arpPayload[0] = 0x3e;
arpPayload[1] = 0xd0;

const frameHeader = new Uint8Array(3);
frameHeader[0] = 0xd3;
frameHeader[1] = (19 >> 8) & 0x03;
frameHeader[2] = 19 & 0xff;

const rawFrameWithoutCrc = new Uint8Array(3 + 19);
rawFrameWithoutCrc.set(frameHeader, 0);
rawFrameWithoutCrc.set(arpPayload, 3);

const computedCrc = calculateCrc24q(rawFrameWithoutCrc, rawFrameWithoutCrc.length);

const validRtcmFrame = new Uint8Array(3 + 19 + 3);
validRtcmFrame.set(rawFrameWithoutCrc, 0);
validRtcmFrame[22] = (computedCrc >> 16) & 0xff;
validRtcmFrame[23] = (computedCrc >> 8) & 0xff;
validRtcmFrame[24] = computedCrc & 0xff;

const rtcmParser = new RtcmFrameParser();
// Feed garbled noise followed by valid RTCM frame
const noisyStream = new Uint8Array([0x00, 0xff, 0x12, 0xd3, 0x00, 0x01, ...validRtcmFrame]);
const parseResult = rtcmParser.append(noisyStream);
if (parseResult.frames.length !== 1 || parseResult.msgTypes[0] !== 1005) {
  console.error('RtcmFrameParser failed to extract RTCM 1005 frame from noisy stream!', parseResult);
  process.exit(1);
}
console.log('RTCM 1005 frame parser & CRC24Q verification PASSED!');

// 28b. Test NMEA GGA Generation
const ggaSentence = generateNmeaGga(37.7749, -122.4194, 25.5);
if (!ggaSentence.startsWith('$GPGGA,') || !ggaSentence.includes(',3746.4940,N,12225.1640,W,') || !ggaSentence.endsWith('\r\n')) {
  console.error('generateNmeaGga produced invalid NMEA sentence:', ggaSentence);
  process.exit(1);
}
console.log('generateNmeaGga VRS NMEA sentence PASSED!');

// 28c. Test RTCM 1005 Antenna Reference Point (ARP) Base Station Extraction
// Build realistic RTCM 1005 frame for coordinates (37.7749 N, -122.4194 W, 25.0 m MSL)
function writeBitsToBuffer(buf: Uint8Array, bitOffset: number, bitLength: number, val: bigint) {
  let uval = val;
  if (uval < 0n) {
    uval = (1n << BigInt(bitLength)) + uval;
  }
  for (let i = 0; i < bitLength; i++) {
    const bit = Number((uval >> BigInt(bitLength - 1 - i)) & 1n);
    const totalBit = bitOffset + i;
    const byteIdx = totalBit >> 3;
    const bitInByte = 7 - (totalBit & 7);
    buf[byteIdx] |= bit << bitInByte;
  }
}

const arpFramePayload = new Uint8Array(19);
// Msg Type 1005
arpFramePayload[0] = 0x3e;
arpFramePayload[1] = 0xd0;
// ECEF coordinates scaled to 0.0001 m (37.7749 N, -122.4194 W, 25.0 m MSL)
writeBitsToBuffer(arpFramePayload, 34, 38, -27061854405n); // X
writeBitsToBuffer(arpFramePayload, 74, 38, -42610761701n); // Y
writeBitsToBuffer(arpFramePayload, 114, 38, 38857408040n);  // Z

const rawArpFrameNoCrc = new Uint8Array(3 + 19);
rawArpFrameNoCrc[0] = 0xd3;
rawArpFrameNoCrc[1] = (19 >> 8) & 0x03;
rawArpFrameNoCrc[2] = 19 & 0xff;
rawArpFrameNoCrc.set(arpFramePayload, 3);

const arpCrc = calculateCrc24q(rawArpFrameNoCrc, rawArpFrameNoCrc.length);
const validArpFrame = new Uint8Array(3 + 19 + 3);
validArpFrame.set(rawArpFrameNoCrc, 0);
validArpFrame[22] = (arpCrc >> 16) & 0xff;
validArpFrame[23] = (arpCrc >> 8) & 0xff;
validArpFrame[24] = arpCrc & 0xff;

const extractedArp = extractRtcm1005Arp(validArpFrame);
if (!extractedArp || Math.abs(extractedArp.lat - 37.7749) > 0.0001 || Math.abs(extractedArp.lon - -122.4194) > 0.0001) {
  console.error('extractRtcm1005Arp failed to extract correct coordinates:', extractedArp);
  process.exit(1);
}

// Inject frame and verify telemetry store baseStationPosition is updated
rtcmInjector.injectRtcmFrame(validArpFrame, 1005);
const storeBasePos = useTelemetryStore.getState().baseStationPosition;
if (!storeBasePos || Math.abs(storeBasePos.lat - 37.7749) > 0.0001 || Math.abs(storeBasePos.lon - -122.4194) > 0.0001) {
  console.error('Telemetry store baseStationPosition not updated on RTCM 1005 injection:', storeBasePos);
  process.exit(1);
}
console.log('RTCM 1005 ARP coordinate extraction and telemetryStore integration PASSED!');

// 28d. Test RTCM Frame Fragmentation in rtcmInjector
const sentMavlinkPackets: Uint8Array[] = [];
const origSend = mavlinkConnection.send.bind(mavlinkConnection);
(mavlinkConnection as any).send = (data: Uint8Array) => {
  sentMavlinkPackets.push(data);
};

try {
  // Test 1: Single small frame (25 bytes) <= 180 bytes
  rtcmInjector.injectRtcmFrame(validRtcmFrame, 1005);
  if (sentMavlinkPackets.length !== 1) {
    console.error('Expected 1 MAVLink packet for small RTCM frame, got:', sentMavlinkPackets.length);
    process.exit(1);
  }
  const smallPkt = new MavlinkParser().parse(sentMavlinkPackets[0])[0];
  const smallRtcmDecoded = decodePayload(MAVLINK_MSG_ID.GPS_RTCM_DATA, smallPkt.payload);
  // Unfragmented: bit 0 of flags should be 0
  if ((smallRtcmDecoded.flags & 1) !== 0 || smallRtcmDecoded.len !== 25) {
    console.error('Unfragmented RTCM flags/len incorrect:', smallRtcmDecoded);
    process.exit(1);
  }

  // Test 2: Large frame (> 180 bytes, e.g. 250 bytes)
  sentMavlinkPackets.length = 0;
  const largeRtcmFrame = new Uint8Array(250);
  largeRtcmFrame.fill(0xaa);
  rtcmInjector.injectRtcmFrame(largeRtcmFrame, 1077); // GPS MSM7

  if (sentMavlinkPackets.length !== 2) {
    console.error('Expected 2 MAVLink fragments for 250-byte RTCM frame, got:', sentMavlinkPackets.length);
    process.exit(1);
  }

  const frag0 = decodePayload(MAVLINK_MSG_ID.GPS_RTCM_DATA, new MavlinkParser().parse(sentMavlinkPackets[0])[0].payload);
  const frag1 = decodePayload(MAVLINK_MSG_ID.GPS_RTCM_DATA, new MavlinkParser().parse(sentMavlinkPackets[1])[0].payload);

  // Both should have fragmented bit (bit 0 = 1)
  if ((frag0.flags & 1) !== 1 || (frag1.flags & 1) !== 1) {
    console.error('Fragmented packets must have bit 0 set in flags!');
    process.exit(1);
  }
  // frag0 should have fragment ID 0; frag1 should have fragment ID 1
  const frag0Id = (frag0.flags >> 1) & 0x03;
  const frag1Id = (frag1.flags >> 1) & 0x03;
  if (frag0Id !== 0 || frag1Id !== 1 || frag0.len !== 180 || frag1.len !== 70) {
    console.error('RTCM fragment IDs or lengths incorrect:', { frag0Id, frag1Id, len0: frag0.len, len1: frag1.len });
    process.exit(1);
  }
  console.log('RTCM3 fragmentation and GPS_RTCM_DATA injection PASSED!');

  // 28d. Test connectViaBridge and text control messages
  let bridgeReceivedText = '';
  const origSendText = mavlinkConnection.sendText.bind(mavlinkConnection);
  (mavlinkConnection as any).sendText = (msg: string) => {
    bridgeReceivedText = msg;
    return true;
  };

  let injectorBridgeStatus = '';
  const unsubInj = rtcmInjector.onStateChange((st) => {
    injectorBridgeStatus = st.status;
  });

  await rtcmInjector.connectViaBridge({
    host: 'rtk2go.com',
    port: 2101,
    mountpoint: 'TEST-BASE',
    username: 'testuser@example.com',
    password: 'none',
    sendGga: true,
  });

  if (!bridgeReceivedText.includes('ntrip_connect') || !bridgeReceivedText.includes('TEST-BASE')) {
    console.error('connectViaBridge failed to send ntrip_connect:', bridgeReceivedText);
    process.exit(1);
  }

  // Simulate bridge status message back to frontend
  const textListeners = (mavlinkConnection as any).textListeners;
  for (const l of textListeners) {
    l(JSON.stringify({ type: 'ntrip_status', status: 'streaming' }));
  }

  if (injectorBridgeStatus !== 'streaming') {
    console.error('Failed to transition to streaming on bridge message:', injectorBridgeStatus);
    process.exit(1);
  }

  await rtcmInjector.disconnect();
  (mavlinkConnection as any).sendText = origSendText;
  unsubInj();
  console.log('connectViaBridge and text control messages PASSED!');
} finally {
  (mavlinkConnection as any).send = origSend;
  rtcmInjector.stopRateMeter();
}

// 29. Test cmdHasLocation, QGC ComplexItem expansion, RTCM tail fragments, and speed safety
import { cmdHasLocation } from '../src/mavlink/messages.ts';
import { useConnectionStore } from '../src/store/connectionStore.ts';

// 29a: cmdHasLocation location vs non-location commands
if (!cmdHasLocation(16) || !cmdHasLocation(21) || !cmdHasLocation(5001) || !cmdHasLocation(82) || !cmdHasLocation(201)) {
  console.error('cmdHasLocation failed to identify geographic location commands!');
  process.exit(1);
}
if (cmdHasLocation(203) || cmdHasLocation(206) || cmdHasLocation(176) || cmdHasLocation(178)) {
  console.error('cmdHasLocation incorrectly identified non-location command as location!');
  process.exit(1);
}

// 29b: DO_DIGICAM_CONTROL shutter = 1 coordinate preservation
const digicamItem = {
  seq: 0,
  command: 203, // DO_DIGICAM_CONTROL
  x: 1, // shutter command = 1 (param 5)
  y: 0,
  z: 0,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
};
const digicamPacket = encoder.createMissionItemInt(1, 1, digicamItem);
const parsedDigicam = parser.parse(digicamPacket);
if (parsedDigicam.length !== 1 || parsedDigicam[0].messageId !== MAVLINK_MSG_ID.MISSION_ITEM_INT) {
  console.error('Failed to parse MISSION_ITEM_INT packet!', parsedDigicam);
  process.exit(1);
}
const decodedDigicam = decodePayload(parsedDigicam[0].messageId, parsedDigicam[0].payload);
if (decodedDigicam.x !== 1) {
  console.error('DO_DIGICAM_CONTROL shutter=1 was scaled or corrupted!', decodedDigicam);
  process.exit(1);
}
console.log('cmdHasLocation & DO_DIGICAM_CONTROL shutter=1 preservation PASSED!');

// 29c: QGC ComplexItem survey expansion & (0,0) coordinate rejection
const dangerousZeroPlan = JSON.stringify({
  fileType: 'Plan',
  version: 1,
  mission: {
    items: [
      {
        type: 'ComplexItem',
        complexType: 'survey',
        // Missing items, coords default to 0,0
      },
    ],
  },
});
let caughtZeroError = false;
try {
  parseDroppedMissionFile('survey.plan', new TextEncoder().encode(dangerousZeroPlan));
} catch (e: any) {
  caughtZeroError = true;
}
if (!caughtZeroError) {
  console.error('Failed to reject dangerous (0,0) survey ComplexItem!');
  process.exit(1);
}

// 29d: Circle fence radius at circ.circle.radius
const circlePlan = JSON.stringify({
  fileType: 'Plan',
  version: 1,
  geoFence: {
    circles: [
      {
        circle: {
          center: [37.7749, -122.4194],
          radius: 120,
        },
        inclusion: true,
      },
    ],
    polygons: [],
    version: 2,
  },
});
const parsedCircle = parseDroppedMissionFile('fence.plan', new TextEncoder().encode(circlePlan));
const fenceSection = parsedCircle?.sections?.find((s) => s.type === 'fence');
if (!parsedCircle || (parsedCircle.type !== 'fence' && parsedCircle.type !== 'plan') || !fenceSection || fenceSection.items[0]?.param1 !== 120) {
  console.error('Failed to extract correct circle fence radius 120m!', { parsedCircle, fenceSection, item0: fenceSection?.items[0] });
  process.exit(1);
}
console.log('QGC ComplexItem (0,0) rejection and circle radius extraction PASSED!');

// 29e: Classification of fence_line_inspection.waypoints as mission
const fenceLineInspectionText = `QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t37.774900\t-122.419400\t10.000000\t1\n1\t0\t3\t16\t0\t0\t0\t0\t37.776000\t-122.418000\t50.000000\t1`;
const parsedInspection = parseDroppedMissionFile('fence_line_inspection.waypoints', new TextEncoder().encode(fenceLineInspectionText));
if (!parsedInspection || parsedInspection.type !== 'mission' || parsedInspection.missionType !== 0) {
  console.error('Misclassified fence_line_inspection.waypoints as fence!', parsedInspection);
  process.exit(1);
}
console.log('fence_line_inspection.waypoints mission classification PASSED!');

// 29f: RTCM fragmentation 360/540 zero-length tail fragments and >720 drops
const sentRtcmPackets: Uint8Array[] = [];
const origSendRtcm = (mavlinkConnection as any).send;
(mavlinkConnection as any).send = (data: Uint8Array) => {
  sentRtcmPackets.push(data);
};

// 360 bytes: exactly 2 chunks of 180 + 1 zero-length tail fragment
const frame360 = new Uint8Array(360);
rtcmInjector.injectRtcmFrame(frame360, 1004);
if (sentRtcmPackets.length !== 3) {
  console.error('RTCM 360 bytes did not send exactly 3 packets (2 data + 1 tail)!', sentRtcmPackets.length);
  process.exit(1);
}
const tailPacket = parser.parse(sentRtcmPackets[2]);
if (tailPacket.length !== 1 || tailPacket[0].payload[1] !== 0) {
  console.error('RTCM 360 bytes tail packet len != 0!', tailPacket[0]?.payload);
  process.exit(1);
}

// 721 bytes: oversized, must be dropped
const frame721 = new Uint8Array(721);
const droppedBefore = (rtcmInjector as any).state.droppedOversizedFrames;
rtcmInjector.injectRtcmFrame(frame721, 1004);
const droppedAfter = (rtcmInjector as any).state.droppedOversizedFrames;
if (droppedAfter !== droppedBefore + 1) {
  console.error('RTCM frame > 720 bytes was not dropped and counted!', { droppedBefore, droppedAfter });
  process.exit(1);
}

// Low bandwidth SiK MSM7 rate limit
useConnectionStore.getState().setBandwidthProfile('low');
const frameMsm7 = new Uint8Array(200);
const limitedBefore = (rtcmInjector as any).state.droppedRateLimitedFrames;
rtcmInjector.injectRtcmFrame(frameMsm7, 1077); // first one allowed
rtcmInjector.injectRtcmFrame(frameMsm7, 1077); // immediate second one dropped
const limitedAfter = (rtcmInjector as any).state.droppedRateLimitedFrames;
if (limitedAfter !== limitedBefore + 1) {
  console.error('RTCM MSM7 was not rate-limited on low bandwidth profile!', { limitedBefore, limitedAfter });
  process.exit(1);
}
useConnectionStore.getState().setBandwidthProfile('standard');

(mavlinkConnection as any).send = origSendRtcm;
console.log('RTCM 360/540 tail fragment, >720 drop, and SiK MSM7 throttling PASSED!');

console.log('All MAVLink protocol unit tests PASSED!');
process.exit(0);
