// A Leaflet tile layer that shows a stored (kept, downloaded or imported) tile when there is one, and otherwise
// loads the tile as usual: offline maps work with or without the service worker, and in development.

import L from 'leaflet';

import { IMPORT_HOST, offlineTileUrl } from '../../lib/offlineTiles';

type TileImg = HTMLImageElement & { _offlineObjectUrl?: string };

const OfflineAwareTileLayer = L.TileLayer.extend({
  createTile(
    this: L.TileLayer & { _tileOnLoad: Function; _tileOnError: Function; _map?: L.Map },
    coords: L.Coords,
    done: L.DoneCallback
  ) {
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
      // Removed while the store was looked in (Leaflet sets the empty image), or the layer gone: don't load it.
      if (!this._map || tile.getAttribute('src') === L.Util.emptyImageUrl) {
        if (stored) URL.revokeObjectURL(stored);
        return;
      }
      if (stored) {
        tile._offlineObjectUrl = stored;
        tile.src = stored;
      } else if (url.startsWith(`${IMPORT_HOST}/`)) {
        // An imported set without this tile: there is nowhere else to get it (the address is only a cache key).
        this._tileOnError(done, tile, new Error('Not in the imported set'));
      } else {
        tile.src = url;
      }
    });
    return tile;
  },
});

/** A tile layer that looks in the offline store first (see the file comment). */
export function offlineAwareTileLayer(template: string, options: L.TileLayerOptions): L.TileLayer {
  return new (OfflineAwareTileLayer as unknown as new (t: string, o: L.TileLayerOptions) => L.TileLayer)(
    template,
    options
  );
}
