// Answers the vehicle's terrain requests (ArduPilot AP_Terrain, with TERRAIN_ENABLE set and no terrain on its SD
// card, or not yet): for each 4 x 4 sub-grid a TERRAIN_REQUEST asks for, the heights from the elevation tiles, sent
// as TERRAIN_DATA. The vehicle asks again every couple of seconds for what it still lacks, so a sub-grid already being
// answered isn't answered twice at once, and one the tiles can't cover is counted and left for its next request.

import { requestedGridbits, subgridPoints, toTerrainInt16 } from './terrain';
import type { TerrainService } from '../lib/terrainService';

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
    private send: (packet: Uint8Array) => void,
    private encode: (lat: number, lon: number, spacing: number, gridbit: number, heights: number[]) => Uint8Array,
    private onResult: (sent: number, unavailable: number) => void = () => {}
  ) {}

  async handle(req: TerrainRequest): Promise<{ sent: number; unavailable: number }> {
    let sent = 0;
    let unavailable = 0;
    if (!this.service.enabled || req.grid_spacing <= 0) return { sent, unavailable };
    const bits = requestedGridbits(req.mask).filter((b) => !this.busy.has(`${req.lat},${req.lon},${req.grid_spacing},${b}`));
    bits.forEach((b) => this.busy.add(`${req.lat},${req.lon},${req.grid_spacing},${b}`));
    try {
      // One batch: the block's tiles are fetched once.
      const points = bits.map((b) => subgridPoints(req.lat, req.lon, req.grid_spacing, b));
      const heights = await this.service.heightsAt(points.flat());
      bits.forEach((b, i) => {
        const h = heights.slice(i * 16, i * 16 + 16);
        if (h.some((v) => v === null)) {
          unavailable++;
          return;
        }
        this.send(this.encode(req.lat, req.lon, req.grid_spacing, b, h.map((v) => toTerrainInt16(v!))));
        sent++;
      });
    } finally {
      bits.forEach((b) => this.busy.delete(`${req.lat},${req.lon},${req.grid_spacing},${b}`));
    }
    this.onResult(sent, unavailable);
    return { sent, unavailable };
  }
}
