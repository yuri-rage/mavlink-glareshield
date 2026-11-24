// Terrain in and out: answers the vehicle's TERRAIN_REQUESTs from the elevation tiles, keeps its TERRAIN_REPORT, and
// asks for both (they ride in a stream a link may have turned off). Imported once at startup.

import { mavlinkConnection } from './connection';
import { decodePayload } from './parser';
import { MAVLINK_MSG_ID } from './messages';
import { messageRateManager } from './rateManager';
import { TerrainServer } from './terrainServer';
import { TerrainService, browserTerrainIO } from '../lib/terrainService';
import { useTerrainStore } from '../store/terrainStore';
import { useTelemetryStore } from '../store/telemetryStore';

export const terrainService = new TerrainService(browserTerrainIO);
terrainService.enabled = useTerrainStore.getState().enabled;
useTerrainStore.subscribe((s) => {
  terrainService.enabled = s.enabled;
});

const server = new TerrainServer(
  terrainService,
  (packet) => mavlinkConnection.send(packet), // false with no link: the server stops and doesn't count it
  (lat, lon, spacing, bit, heights) => mavlinkConnection.getEncoder().createTerrainData(lat, lon, spacing, bit, heights),
  (sent, unavailable) => useTerrainStore.setState((s) => ({ sent: s.sent + sent, unavailable: s.unavailable + unavailable }))
);

mavlinkConnection.onPacket((p) => {
  if (p.messageId !== MAVLINK_MSG_ID.TERRAIN_REQUEST && p.messageId !== MAVLINK_MSG_ID.TERRAIN_REPORT) return;
  if (p.systemId !== useTelemetryStore.getState().heartbeat.systemId) return;
  const d = decodePayload(p.messageId, p.payload);
  if (p.messageId === MAVLINK_MSG_ID.TERRAIN_REQUEST) {
    void server.handle(d);
  } else {
    useTerrainStore.setState({
      report: { terrainHeight: d.terrain_height, currentHeight: d.current_height, spacing: d.spacing, pending: d.pending, loaded: d.loaded, at: Date.now() },
    });
  }
});

messageRateManager.registerRequirement('terrain', MAVLINK_MSG_ID.TERRAIN_REQUEST);
messageRateManager.registerRequirement('terrain', MAVLINK_MSG_ID.TERRAIN_REPORT);

mavlinkConnection.onStatus((status) => {
  if (status !== 'connected') useTerrainStore.setState({ report: null, sent: 0, unavailable: 0 });
});
