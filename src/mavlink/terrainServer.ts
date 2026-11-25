// Answers the vehicle's terrain requests (ArduPilot AP_Terrain, with TERRAIN_ENABLE set and no terrain on its SD
// card, or not yet): for each 4 x 4 sub-grid a TERRAIN_REQUEST asks for, the heights from the elevation tiles, sent
// as TERRAIN_DATA. The vehicle asks again every couple of seconds for what it still lacks, so a sub-grid already being
// answered isn't answered twice at once, and one the tiles can't cover is counted and left for its next request.
// Answers are paced (a block is up to 56 messages, ~3 KB): a 57600 baud radio or a small autopilot UART buffer would
// drop a burst, and the vehicle would only ask again. A send that fails (link gone) stops the rest.

import type { TerrainService } from '../lib/terrainService';
import { requestedGridbits, subgridPoints, toTerrainInt16 } from './terrain';

export interface TerrainRequest {
  mask: bigint;
  lat: number;
  lon: number;
  grid_spacing: number;
}

export class TerrainServer {
  private busy = new Set<string>();

  constructor(
    private service: TerrainService,
    /** False when the packet couldn't be sent (no link). */
    private send: (packet: Uint8Array) => boolean | void,
    private encode: (lat: number, lon: number, spacing: number, gridbit: number, heights: number[]) => Uint8Array,
    private onResult: (sent: number, unavailable: number) => void = () => {},
    /** Pause between TERRAIN_DATA messages (ms): ~2.7 KB/s, within a 57600 baud radio. */
    private gapMs = 20
  ) {}

  async handle(req: TerrainRequest): Promise<{ sent: number; unavailable: number }> {
    let sent = 0;
    let unavailable = 0;
    if (!this.service.enabled || req.grid_spacing <= 0) return { sent, unavailable };
    const bits = requestedGridbits(req.mask).filter(
      (b) => !this.busy.has(`${req.lat},${req.lon},${req.grid_spacing},${b}`)
    );
    if (bits.length === 0) return { sent, unavailable };
    bits.forEach((b) => this.busy.add(`${req.lat},${req.lon},${req.grid_spacing},${b}`));
    try {
      // One batch: the block's tiles are fetched once.
      const points = bits.map((b) => subgridPoints(req.lat, req.lon, req.grid_spacing, b));
      const heights = await this.service.heightsAt(points.flat());
      for (let i = 0; i < bits.length; i++) {
        const h = heights.slice(i * 16, i * 16 + 16);
        if (h.some((v) => v === null)) {
          unavailable++;
          continue;
        }
        if (sent > 0 && this.gapMs > 0) await new Promise((r) => setTimeout(r, this.gapMs));
        if (
          this.send(
            this.encode(
              req.lat,
              req.lon,
              req.grid_spacing,
              bits[i],
              h.map((v) => toTerrainInt16(v!))
            )
          ) === false
        )
          break;
        sent++;
      }
    } finally {
      bits.forEach((b) => this.busy.delete(`${req.lat},${req.lon},${req.grid_spacing},${b}`));
    }
    this.onResult(sent, unavailable);
    return { sent, unavailable };
  }
}
