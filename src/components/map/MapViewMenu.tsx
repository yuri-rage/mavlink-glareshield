// The map header's view menu: imagery, the full-width aspect ratio, layers (ADS-B traffic), fitting the view, and
// clearing the trace.

import React from 'react';

import { Eraser, HardDrive, Layers, Maximize2, Plane } from 'lucide-react';

import { useAdsbSettingsStore } from '../../store/adsbSettingsStore';
import { useOfflineMapStore } from '../../store/offlineMapStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { HeaderMenu, MenuItem, MenuSection } from './HeaderMenu';

/** Built-in imagery, your own tile source, or an imported (MBTiles) set by its area id. */
export type MapLayerType = 'satellite' | 'street' | 'custom' | `import:${string}`;
export type MapAspect = '1:1' | '4:3' | '16:9';

interface MapViewMenuProps {
  layer: MapLayerType;
  onLayer: (layer: MapLayerType) => void;
  /** Offered only when the map spans the full dashboard width. */
  aspect?: MapAspect;
  onAspect?: (aspect: MapAspect) => void;
  onFit: () => void;
  onClearTrace: () => void;
  /** Open the offline maps panel. */
  onOffline: () => void;
}

const ASPECTS: { value: MapAspect; label: string }[] = [
  { value: '16:9', label: 'Widescreen 16:9' },
  { value: '4:3', label: 'Standard 4:3' },
  { value: '1:1', label: 'Square 1:1' },
];

/**
 * "Clear flight trace" with the trail's point count: its own subscription, rendered only while the menu is open, so
 * a new trail point doesn't re-render the closed View button.
 */
const ClearTraceItem: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const tracePoints = useTelemetryStore((s) => s.flightTrace.length);
  return (
    <MenuItem
      icon={<Eraser className="h-3.5 w-3.5 text-amber-400" />}
      label="Clear flight trace"
      detail={tracePoints > 0 ? String(tracePoints) : undefined}
      disabled={tracePoints === 0}
      onClick={onClick}
    />
  );
};

export const MapViewMenu: React.FC<MapViewMenuProps> = ({
  layer,
  onLayer,
  aspect,
  onAspect,
  onFit,
  onClearTrace,
  onOffline,
}) => {
  const showTraffic = useAdsbSettingsStore((s) => s.showOnMap);
  const customSource = useOfflineMapStore((s) => s.customSource);
  const areas = useOfflineMapStore((s) => s.areas);
  const imported = areas.filter((a) => a.kind === 'imported');
  return (
    <HeaderMenu
      icon={<Layers className="h-3.5 w-3.5 text-sky-400" />}
      label="View"
      title="Map imagery, shape and view"
      widthClass="w-56"
    >
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuSection label="Imagery" first />
            <MenuItem
              label="Satellite"
              detail="Esri"
              checked={layer === 'satellite'}
              onClick={run(() => onLayer('satellite'))}
            />
            <MenuItem
              label="Street map"
              detail="OSM"
              checked={layer === 'street'}
              onClick={run(() => onLayer('street'))}
            />
            {customSource && (
              <MenuItem
                label={customSource.name}
                detail="yours"
                checked={layer === 'custom'}
                onClick={run(() => onLayer('custom'))}
              />
            )}
            {imported.map((a) => (
              <MenuItem
                key={a.id}
                label={a.name}
                detail="offline"
                checked={layer === `import:${a.id}`}
                onClick={run(() => onLayer(`import:${a.id}`))}
              />
            ))}
            <MenuItem
              icon={<HardDrive className="h-3.5 w-3.5 text-sky-400" />}
              label="Offline maps…"
              onClick={run(onOffline)}
            />

            {aspect && onAspect && (
              <>
                <MenuSection label="Shape" />
                {ASPECTS.map((a) => (
                  <MenuItem
                    key={a.value}
                    label={a.label}
                    checked={aspect === a.value}
                    onClick={run(() => onAspect(a.value))}
                  />
                ))}
              </>
            )}

            <MenuSection label="Layers" />
            <MenuItem
              icon={<Plane className="h-3.5 w-3.5 text-sky-400" />}
              label="ADS-B traffic"
              detail={showTraffic ? 'shown' : 'hidden'}
              checked={showTraffic}
              onClick={run(() => useAdsbSettingsStore.getState().setShowOnMap(!showTraffic))}
            />

            <MenuSection label="View" />
            <MenuItem
              icon={<Maximize2 className="h-3.5 w-3.5 text-sky-400" />}
              label="Fit vehicle and mission"
              onClick={run(onFit)}
            />
            <ClearTraceItem onClick={run(onClearTrace)} />
          </>
        );
      }}
    </HeaderMenu>
  );
};
