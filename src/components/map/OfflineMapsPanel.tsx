// Offline maps (from the map's View menu): keep the area you're viewing, use your own tile source and download an
// area from it, download terrain, import MBTiles, and see and delete what's stored. See lib/offlineTiles.ts.

import React, { useEffect, useRef, useState } from 'react';

import L from 'leaflet';
import { Download, FileUp, HardDrive, MapPinned, Mountain, Square, Trash2, X } from 'lucide-react';

import {
  AVG_TILE_BYTES,
  countTiles,
  MAX_DOWNLOAD_TILES,
  newAreaId,
  offlineAvailable,
  preloadMbtilesReader,
  requestPersistence,
  storageInfo,
  tilesIn,
  tileUrl,
  validTemplate,
  type LatLngBoundsLike,
  type OfflineArea,
} from '../../lib/offlineTiles';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { TERRAIN_ZOOM, terrariumUrl } from '../../mavlink/terrain';
import { useOfflineMapStore, type CustomTileSource } from '../../store/offlineMapStore';
import { Modal } from '../ui/modal';
import type { MapLayerType } from './MapViewMenu';

/** At most this many terrain tiles at once (each about 100 KB). */
const MAX_TERRAIN_TILES = 2000;

const mb = (b: number) =>
  b >= 1e9
    ? `${(b / 1e9).toFixed(2)} GB`
    : b >= 1e6
      ? `${(b / 1e6).toFixed(1)} MB`
      : `${Math.max(0, Math.round(b / 1e3))} KB`;
// Never squeezed by a full-width field beside it: one line, its own width.
const BTN =
  'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] font-bold disabled:opacity-40';
const PLAIN = `${BTN} border-zinc-700 text-zinc-200 hover:bg-zinc-800`;
const PRIMARY = `${BTN} border-sky-600 bg-sky-600 text-white hover:bg-sky-500`;
const FIELD = 'h-7 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100';
const SECTION = 'space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The map's current view: what a download covers, and the zoom it starts at. */
  getView: () => { bounds: LatLngBoundsLike; zoom: number } | null;
  /** The layer showing now (what keeping keeps), by name and type. */
  layerName: string;
  layer: MapLayerType;
  onShowLayer: (layer: MapLayerType) => void;
  onFitBounds: (b: LatLngBoundsLike) => void;
}

const KIND_LABEL: Record<OfflineArea['kind'], string> = {
  kept: 'Kept',
  downloaded: 'Downloaded',
  imported: 'Imported',
  terrain: 'Terrain',
};

export const OfflineMapsPanel: React.FC<Props> = ({
  isOpen,
  onClose,
  getView,
  layerName,
  layer,
  onShowLayer,
  onFitBounds,
}) => {
  const { areas, refresh, remove, keeping, startKeeping, stopKeeping, customSource, setCustomSource, deleting } =
    useOfflineMapStore();
  const available = offlineAvailable();
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [keepName, setKeepName] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    void storageInfo().then(setStorage);
  }, [isOpen, refresh, areas.length]);
  // Online with the panel open: load the MBTiles reader now, so the browser has it (cached with the app) for an
  // import made offline later.
  useEffect(() => {
    if (isOpen && available && navigator.onLine) void preloadMbtilesReader();
  }, [isOpen, available]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Offline maps"
      description="Map tiles and terrain kept for use without internet"
      size="xl"
    >
      <div className="space-y-3 text-xs text-zinc-300">
        {!available ? (
          <p className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-amber-200">
            Offline maps need a secure page: open the app over https (the bridge can serve it, --ssl-cert / --ssl-key)
            or on localhost. Browsers don't offer storage for them on a plain http address.
          </p>
        ) : (
          <>
            {/* Keep while browsing */}
            <section className={SECTION}>
              <h3 className="flex items-center gap-1.5 font-bold text-zinc-100">
                <MapPinned className="h-3.5 w-3.5 text-sky-400" />
                Keep an area while you view it
              </h3>
              <p className="text-[11px] leading-snug text-zinc-400">
                Pan and zoom over the area at the zoom levels you'll need: every {layerName} tile the map loads is kept.
                The built-in imagery and street tiles can only be kept this way (their providers don't allow bulk
                downloads).
              </p>
              {/* A keep under way first: its Stop stays here whatever layer is showing now. */}
              {keeping ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-emerald-300">
                    Keeping "{keeping.name}": {keeping.tiles} tiles, {mb(keeping.bytes)}
                  </span>
                  <button type="button" className={PRIMARY} onClick={() => void stopKeeping()}>
                    <Square className="h-3 w-3" />
                    Stop and save
                  </button>
                </div>
              ) : layer.startsWith('import:') ? (
                <p className="text-[11px] text-zinc-500">
                  The imported map showing is stored already: switch to another layer to keep it.
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="Area name (e.g. North field)"
                    value={keepName}
                    onChange={(e) => setKeepName(e.target.value)}
                  />
                  <button
                    type="button"
                    className={PRIMARY}
                    onClick={() => {
                      startKeeping(keepName, layerName, layer);
                      setKeepName('');
                      onClose();
                    }}
                  >
                    Start keeping
                  </button>
                </div>
              )}
            </section>

            <CustomSourceSection source={customSource} onSave={setCustomSource} onShow={() => onShowLayer('custom')} />
            <DownloadSection getView={getView} source={customSource} />
            <ImportSection onDone={(a) => void refresh().then(() => onShowLayer(`import:${a.id}`))} />

            {/* Stored */}
            <section className={SECTION}>
              <h3 className="flex items-center gap-1.5 font-bold text-zinc-100">
                <HardDrive className="h-3.5 w-3.5 text-sky-400" />
                Stored
                <span className="ml-auto font-mono text-[10px] font-normal text-zinc-500">
                  {storage.usage !== undefined ? `${mb(storage.usage)} used` : ''}
                  {storage.quota !== undefined ? ` of ${mb(storage.quota)}` : ''}
                </span>
              </h3>
              {storage.persisted === false && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-300">
                  The browser may clear this storage when space runs low.
                  <button
                    type="button"
                    className={PLAIN}
                    onClick={() => void requestPersistence().then(() => storageInfo().then(setStorage))}
                  >
                    Ask to keep it
                  </button>
                </div>
              )}
              {areas.length === 0 ? (
                <p className="text-[11px] text-zinc-500">Nothing stored yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {areas.map((a) => (
                    <AreaRow
                      key={a.id}
                      area={a}
                      busy={deleting.includes(a.id) ? 'Deleting…' : keeping?.id === a.id ? 'Being kept' : null}
                      onRemove={() => void remove(a.id)}
                      onShowLayer={onShowLayer}
                      onFitBounds={onFitBounds}
                      onClose={onClose}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};

const AreaRow: React.FC<{
  area: OfflineArea;
  /** Why it can't be deleted now (deleting already, or being kept), or null. */
  busy: string | null;
  onRemove: () => void;
  onShowLayer: (layer: MapLayerType) => void;
  onFitBounds: (b: LatLngBoundsLike) => void;
  onClose: () => void;
}> = ({ area, busy, onRemove, onShowLayer, onFitBounds, onClose }) => {
  const del = useConfirmStep();
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold text-zinc-100">{area.name}</div>
        <div className="font-mono text-[10px] text-zinc-500">
          {KIND_LABEL[area.kind]} · {area.source} · {area.tiles} tiles · {mb(area.bytes)}
          {area.minZoom !== undefined ? ` · z${area.minZoom}–${area.maxZoom}` : ''}
        </div>
      </div>
      {area.kind === 'imported' && (
        <button
          type="button"
          className={PLAIN}
          onClick={() => {
            onShowLayer(`import:${area.id}`);
            if (area.bounds) onFitBounds(area.bounds);
            onClose();
          }}
        >
          Show
        </button>
      )}
      {area.kind !== 'imported' && area.bounds && (
        <button
          type="button"
          className={PLAIN}
          onClick={() => {
            onFitBounds(area.bounds!);
            onClose();
          }}
        >
          Go to
        </button>
      )}
      <button
        type="button"
        disabled={busy !== null}
        title={busy ?? undefined}
        className={`${BTN} ${del.armed ? 'border-red-500 bg-red-600 text-white' : 'border-zinc-700 text-red-300 hover:bg-red-950/50'}`}
        onClick={() => {
          if (!del.armed) return del.arm();
          del.cancel();
          onRemove();
        }}
      >
        <Trash2 className="h-3 w-3" />
        {busy ?? (del.armed ? 'Confirm delete' : 'Delete')}
      </button>
    </li>
  );
};

const CustomSourceSection: React.FC<{
  source: CustomTileSource | null;
  onSave: (s: CustomTileSource | null) => void;
  onShow: () => void;
}> = ({ source, onSave, onShow }) => {
  const [draft, setDraft] = useState<CustomTileSource>(
    source ?? { name: 'My tiles', url: '', maxZoom: 19, subdomains: 'abc', attribution: '' }
  );
  const valid = validTemplate(draft.url.trim());
  return (
    <section className={SECTION}>
      <h3 className="font-bold text-zinc-100">Your tile source</h3>
      <p className="text-[11px] leading-snug text-zinc-400">
        A tile server you run or are licensed to download from (e.g. https://tiles.example.com/{'{z}/{x}/{y}'}.png). It
        becomes a map layer, and areas can be downloaded from it. The server must allow other sites to load its tiles
        (CORS: Access-Control-Allow-Origin).
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <input
          className={FIELD}
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label="Source name"
        />
        <input
          className={FIELD}
          placeholder="https://…/{z}/{x}/{y}.png"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          aria-label="Tile URL template"
        />
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          Max zoom
          <select
            className={`${FIELD} w-16`}
            value={draft.maxZoom}
            onChange={(e) => setDraft({ ...draft, maxZoom: Number(e.target.value) })}
            aria-label="Max zoom"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          Subdomains
          <input
            className={`${FIELD} w-16`}
            value={draft.subdomains}
            onChange={(e) => setDraft({ ...draft, subdomains: e.target.value })}
          />
        </label>
        <input
          className={FIELD}
          placeholder="Attribution"
          value={draft.attribution}
          onChange={(e) => setDraft({ ...draft, attribution: e.target.value })}
          aria-label="Attribution"
        />
      </div>
      {draft.url.trim() !== '' && !valid && (
        <p className="text-[11px] text-amber-300">
          The URL needs {'{z}'}, {'{x}'} and {'{y}'} (or {'{-y}'}), and http(s).
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={!valid}
          onClick={() => onSave({ ...draft, url: draft.url.trim() })}
        >
          Save
        </button>
        {source && (
          <>
            <button type="button" className={PLAIN} onClick={onShow}>
              Show on the map
            </button>
            <button type="button" className={PLAIN} onClick={() => onSave(null)}>
              Remove
            </button>
          </>
        )}
      </div>
    </section>
  );
};

/** Download the current view: from your tile source (a zoom range), and/or the open terrain tiles. */
const DownloadSection: React.FC<{ getView: Props['getView']; source: CustomTileSource | null }> = ({
  getView,
  source,
}) => {
  const { job, jobError, startDownload, cancelJob } = useOfflineMapStore();
  const view = getView();
  const startZoom = view ? Math.max(0, Math.floor(view.zoom)) : 10;
  const [name, setName] = useState('');
  // From the map's zoom (no deeper than the source goes) to three levels deeper, within the source's maximum.
  const [zMin, setZMin] = useState(source ? Math.min(source.maxZoom, startZoom) : startZoom);
  const [zMax, setZMax] = useState(source ? Math.min(source.maxZoom, startZoom + 3) : startZoom);
  // The source set or changed (its maximum lowered, say) with the panel open: the range again, within it.
  useEffect(() => {
    if (!source) return;
    const lo = Math.min(source.maxZoom, zMin);
    setZMin(lo);
    setZMax(Math.min(source.maxZoom, Math.max(lo, startZoom + 3)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.maxZoom, source?.url]);

  const count = view && source ? countTiles(view.bounds, zMin, zMax) : 0;
  const terrainCount = view ? countTiles(view.bounds, TERRAIN_ZOOM, TERRAIN_ZOOM) : 0;
  const tooMany = count > MAX_DOWNLOAD_TILES;
  const zooms = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

  const run = (kind: 'downloaded' | 'terrain') => {
    if (!view) return;
    // The URLs the map will ask for: the same subdomains, and @2x on a high-density screen as Leaflet adds it.
    const urls =
      kind === 'terrain'
        ? [...tilesIn(view.bounds, TERRAIN_ZOOM, TERRAIN_ZOOM)].map((t) => terrariumUrl(t.z, t.x, t.y))
        : [...tilesIn(view.bounds, zMin, zMax)].map((t) =>
            tileUrl(source!.url, t.z, t.x, t.y, source!.subdomains, L.Browser.retina)
          );
    const area: OfflineArea = {
      id: newAreaId(),
      name: name.trim() || (kind === 'terrain' ? 'Terrain' : 'Downloaded area'),
      kind,
      source: kind === 'terrain' ? 'AWS Terrain Tiles' : source!.name,
      bounds: view.bounds,
      minZoom: kind === 'terrain' ? TERRAIN_ZOOM : zMin,
      maxZoom: kind === 'terrain' ? TERRAIN_ZOOM : zMax,
      tiles: 0,
      bytes: 0,
      created: Date.now(),
    };
    void startDownload(area, urls, kind === 'terrain' ? 'terrain' : source!.name);
  };

  return (
    <section className={SECTION}>
      <h3 className="flex items-center gap-1.5 font-bold text-zinc-100">
        <Download className="h-3.5 w-3.5 text-sky-400" />
        Download the area in view
      </h3>
      {job && job.kind !== 'import' ? (
        <div className="space-y-1.5">
          <div className="h-2 overflow-hidden rounded bg-zinc-800">
            <div className="h-full bg-sky-500" style={{ width: `${(100 * job.done) / Math.max(1, job.total)}%` }} />
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            {job.label}: {job.done} / {job.total} tiles, {mb(job.bytes)}
            {job.failed > 0 && <span className="text-amber-300">{job.failed} failed</span>}
            <button type="button" className={`${PLAIN} ml-auto`} onClick={cancelJob}>
              <X className="h-3 w-3" />
              Stop (keep what arrived)
            </button>
          </div>
          <p className="text-[10px] text-zinc-500">It carries on with this window closed.</p>
        </div>
      ) : (
        <>
          <input className={FIELD} placeholder="Area name" value={name} onChange={(e) => setName(e.target.value)} />
          {source ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                From {source.name}, zoom
                <select
                  className={`${FIELD} w-16`}
                  value={zMin}
                  onChange={(e) => setZMin(Number(e.target.value))}
                  aria-label="From zoom"
                >
                  {zooms(0, zMax).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                to
                <select
                  className={`${FIELD} w-16`}
                  value={zMax}
                  onChange={(e) => setZMax(Number(e.target.value))}
                  aria-label="To zoom"
                >
                  {zooms(zMin, source.maxZoom).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <span className={`font-mono ${tooMany ? 'text-amber-300' : 'text-zinc-300'}`}>
                  {count.toLocaleString()} tiles, about {mb(count * AVG_TILE_BYTES)}
                </span>
              </div>
              {tooMany && (
                <p className="text-[11px] text-amber-300">
                  More than {MAX_DOWNLOAD_TILES.toLocaleString()} tiles: zoom in on a smaller area, or lower the top
                  zoom.
                </p>
              )}
              <button
                type="button"
                className={PRIMARY}
                disabled={!view || tooMany || count === 0 || job !== null}
                onClick={() => run('downloaded')}
              >
                <Download className="h-3 w-3" />
                Download from {source.name}
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">Set your tile source above to download imagery for an area.</p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
            <span className="text-[11px] text-zinc-400">
              Terrain heights for this area (open data, for the terrain profile and clearance checks): {terrainCount}{' '}
              tiles
            </span>
            <button
              type="button"
              className={PLAIN}
              disabled={!view || terrainCount === 0 || terrainCount > MAX_TERRAIN_TILES || job !== null}
              onClick={() => run('terrain')}
            >
              <Mountain className="h-3 w-3" />
              Download terrain
            </button>
            {terrainCount > MAX_TERRAIN_TILES && (
              <span className="w-full text-[11px] text-amber-300">
                More than {MAX_TERRAIN_TILES.toLocaleString()} terrain tiles: zoom in on a smaller area.
              </span>
            )}
          </div>
        </>
      )}
      {jobError?.from === 'download' && <p className="text-[11px] text-red-300">{jobError.message}</p>}
    </section>
  );
};

const ImportSection: React.FC<{ onDone: (a: OfflineArea) => void }> = ({ onDone }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { job, jobError, startImport } = useOfflineMapStore();
  const importing = job?.kind === 'import' ? job : null;
  return (
    <section className={SECTION}>
      <h3 className="flex items-center gap-1.5 font-bold text-zinc-100">
        <FileUp className="h-3.5 w-3.5 text-sky-400" />
        Import MBTiles
      </h3>
      <p className="text-[11px] leading-snug text-zinc-400">
        A raster .mbtiles file (png, jpg or webp tiles), e.g. made with QGIS "Generate XYZ tiles (MBTiles)" from imagery
        you may use offline. It's shown as a map layer of its own.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".mbtiles"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const area = await startImport(f);
          if (area) onDone(area);
        }}
      />
      {importing ? (
        <p className="font-mono text-[11px]">
          Importing {importing.label}: {importing.done} / {importing.total || '…'} tiles (carries on with this window
          closed)
        </p>
      ) : (
        <button type="button" className={PLAIN} disabled={job !== null} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-3 w-3" />
          Choose a file…
        </button>
      )}
      {jobError?.from === 'import' && !job && <p className="text-[11px] text-red-300">{jobError.message}</p>}
    </section>
  );
};
