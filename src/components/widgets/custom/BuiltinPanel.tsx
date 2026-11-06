// A composite widget panel holding one of the dashboard's built-in widgets (GPS, battery, HUD, map...).

import React, { useEffect, useRef, useState } from 'react';
import { CardEmbedContext } from '../../ui/card';
import { BUILTIN_PANELS, builtinPanelId } from '../../../lib/builtinWidgets';
import { renderBuiltinWidget } from '../builtinRegistry';
import type { PanelProps } from './panelKit';

/** From this panel width, the map uses its full-width layout (as it would on a full-width dashboard row). */
const MAP_FULL_WIDTH_PX = 900;

export const BuiltinPanel: React.FC<PanelProps> = ({ def }) => {
  const id = builtinPanelId(def.widgetId);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!id) {
    return <p className="text-xs text-zinc-500 text-center py-4 font-mono">Unknown built-in widget: {String(def.widgetId ?? '')}</p>;
  }
  const info = BUILTIN_PANELS[id];
  const widget = renderBuiltinWidget(id, width >= MAP_FULL_WIDTH_PX ? 12 : 6);
  return (
    <div ref={ref} className="flex-1 flex flex-col min-w-0 [&>*]:flex-1" style={{ minHeight: info.minHeightPx }}>
      <CardEmbedContext.Provider value={true}>{widget}</CardEmbedContext.Provider>
    </div>
  );
};
