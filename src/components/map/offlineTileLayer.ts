// A Leaflet tile layer that shows a stored (kept, downloaded or imported) tile when there is one, and otherwise
// loads the tile as usual: offline maps work with or without the service worker, and in development.

import L from 'leaflet';
import { offlineTileUrl } from '../../lib/offlineTiles';

type TileImg = HTMLImageElement & { _offlineObjectUrl?: string };

const OfflineAwareTileLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer & { _tileOnLoad: Function; _tileOnError: Function }, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img') as TileImg;
    const release = () => {
      if (tile._offlineObjectUrl) {
        URL.revokeObjectURL(tile._offlineObjectUrl);
        tile._offlineObjectUrl = undefined;
      }
    };
    L.DomEvent.on(tile, 'load', () => {
      release();
      this._tileOnLoad(done, tile);
    });
    L.DomEvent.on(tile, 'error', ((e: unknown) => {
      release();
      this._tileOnError(done, tile, e as Error);
    }) as L.DomEvent.EventHandlerFn);
    const co = this.options.crossOrigin;
    if (co || co === '') tile.crossOrigin = co === true ? '' : co;
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const url = this.getTileUrl(coords);
    void offlineTileUrl(url).then((stored) => {
      if (stored) tile._offlineObjectUrl = stored;
      tile.src = stored ?? url;
    });
    return tile;
  },
});

/** A tile layer that looks in the offline store first (see the file comment). */
export function offlineAwareTileLayer(template: string, options: L.TileLayerOptions): L.TileLayer {
  return new (OfflineAwareTileLayer as unknown as new (t: string, o: L.TileLayerOptions) => L.TileLayer)(template, options);
}
