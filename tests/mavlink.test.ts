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
  magic: 0xfd,
  incompatibleFlags: 0,
  compatibleFlags: 0,
  sequence: 1,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_ITEM_INT,
  payload: wp0Payload,
  checksum: 0,
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
  magic: 0xfd,
  incompatibleFlags: 0,
  compatibleFlags: 0,
  sequence: 2,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_ITEM_INT,
  payload: fence0Payload,
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
    decodedGps.vel !== 5.4
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

// Test TelemetryStore STATUSTEXT processing sets firmwareVersion
const bootStatusPayload = new Uint8Array(51);
bootStatusPayload[0] = 6; // severity INFO
const bannerStr = 'ArduPlane V4.8.0-dev (1d44127b)';
for (let i = 0; i < bannerStr.length; i++) {
  bootStatusPayload[1 + i] = bannerStr.charCodeAt(i);
}
useTelemetryStore.getState().processPacket({
  magic: 0xfd,
  length: 51,
  incompatFlags: 0,
  compatFlags: 0,
  sequence: 1,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.STATUSTEXT,
  payload: bootStatusPayload,
  checksum: 0,
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
  magic: 0xfd,
  length: 2,
  incompatFlags: 0,
  compatFlags: 0,
  sequence: 2,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.MISSION_CURRENT,
  payload: missionCurPayload,
  checksum: 0,
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
  magic: 0xfd,
  length: 22,
  incompatFlags: 0,
  compatFlags: 0,
  sequence: 3,
  systemId: 1,
  componentId: 1,
  messageId: MAVLINK_MSG_ID.SCALED_IMU,
  payload: scaledImuPayload,
  checksum: 0,
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

console.log('All MAVLink protocol unit tests PASSED!');
