// The map header's view menu: imagery, the full-width aspect ratio, layers (ADS-B traffic), fitting the view, and
// clearing the trace.

import { useTelemetryStore } from '../../store/telemetryStore';
import React from 'react';
import { Eraser, Layers, Maximize2, Plane } from 'lucide-react';
import { useAdsbSettingsStore } from '../../store/adsbSettingsStore';
import { HeaderMenu, MenuItem, MenuSection } from './HeaderMenu';

export type MapLayerType = 'satellite' | 'street';
export type MapAspect = '1:1' | '4:3' | '16:9';

interface MapViewMenuProps {
  layer: MapLayerType;
  onLayer: (layer: MapLayerType) => void;
  /** Offered only when the map spans the full dashboard width. */
  aspect?: MapAspect;
  onAspect?: (aspect: MapAspect) => void;
  onFit: () => void;
  onClearTrace: () => void;
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

export const MapViewMenu: React.FC<MapViewMenuProps> = ({ layer, onLayer, aspect, onAspect, onFit, onClearTrace }) => {
  const showTraffic = useAdsbSettingsStore((s) => s.showOnMap);
  return (
  <HeaderMenu icon={<Layers className="h-3.5 w-3.5 text-sky-400" />} label="View" title="Map imagery, shape and view" widthClass="w-56">
    {(close) => {
      const run = (fn: () => void) => () => {
        close();
        fn();
      };
      return (
        <>
          <MenuSection label="Imagery" first />
          <MenuItem label="Satellite" detail="Esri" checked={layer === 'satellite'} onClick={run(() => onLayer('satellite'))} />
          <MenuItem label="Street map" detail="OSM" checked={layer === 'street'} onClick={run(() => onLayer('street'))} />

          {aspect && onAspect && (
            <>
              <MenuSection label="Shape" />
              {ASPECTS.map((a) => (
                <MenuItem key={a.value} label={a.label} checked={aspect === a.value} onClick={run(() => onAspect(a.value))} />
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
