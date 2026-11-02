import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CustomWidgetDefinition, WidgetDisplayType } from '../../types/widget';
import {
  Compass,
  Radio,
  MapPin,
  Battery,
  Satellite,
  Gauge,
  Terminal,
  Sliders,
  LineChart,
  Plus,
  Upload,
  Zap,
} from 'lucide-react';

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWidgetCreator: () => void;
}

const BUILT_IN_CATALOG = [
  {
    id: 'built-in-glareshield',
    name: 'Autopilot Glareshield Panel',
    category: 'control',
    description: 'Arm/Disarm slider, flight mode switcher, and guided targets (Altitude & Speed).',
    icon: Radio,
    defaultSpan: 12,
  },
  {
    id: 'built-in-pfd',
    name: 'Primary Flight Display (PFD)',
    category: 'avionics',
    description: 'Artificial horizon, pitch ladder, roll arc, altitude/airspeed ladders, and heading tape.',
    icon: Compass,
    defaultSpan: 6,
  },
  {
    id: 'built-in-map',
    name: 'Tactical Navigation Map',
    category: 'avionics',
    description: 'Leaflet GPS map with vehicle heading vector, breadcrumb trail, and mission waypoints.',
    icon: MapPin,
    defaultSpan: 6,
  },
  {
    id: 'built-in-battery-card',
    name: 'Battery & Power Card',
    category: 'telemetry',
    description: 'Bus voltage, current draw, remaining capacity %, and individual cell voltages.',
    icon: Battery,
    defaultSpan: 4,
  },
  {
    id: 'built-in-gps-card',
    name: 'GNSS / GPS Card',
    category: 'telemetry',
    description: 'Fix status (3D/RTK), satellite count, HDOP precision, and coordinates.',
    icon: Satellite,
    defaultSpan: 4,
  },
  {
    id: 'built-in-vfr-hud',
    name: 'VFR Flight Metrics',
    category: 'telemetry',
    description: 'Groundspeed, airspeed, climb rate, throttle percentage, and compass heading.',
    icon: Gauge,
    defaultSpan: 4,
  },
  {
    id: 'built-in-charts',
    name: 'Real-Time Telemetry Charts',
    category: 'telemetry',
    description: 'Rolling time-series graphs of altitude, groundspeed, and battery current.',
    icon: LineChart,
    defaultSpan: 12,
  },
  {
    id: 'built-in-statustext',
    name: 'MAVLink STATUSTEXT Console',
    category: 'telemetry',
    description: 'Live flight controller status message log with severity filtering and audio alerts.',
    icon: Terminal,
    defaultSpan: 6,
  },
  {
    id: 'built-in-parameters',
    name: 'ArduPilot Parameter Manager',
    category: 'control',
    description: 'Searchable parameter table with live modification and reading from vehicle.',
    icon: Sliders,
    defaultSpan: 6,
  },
];

export const AddWidgetModal: React.FC<AddWidgetModalProps> = ({
  isOpen,
  onClose,
  onOpenWidgetCreator,
}) => {
  const { profile, addWidgetToActiveTab, saveCustomWidget } = useDashboardStore();
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const handleAddBuiltIn = (widgetId: string, colSpan: number) => {
    addWidgetToActiveTab(widgetId, colSpan);
    onClose();
  };

  const handleUploadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as CustomWidgetDefinition;
        if (parsed.id && parsed.name && parsed.displayType) {
          saveCustomWidget(parsed);
          addWidgetToActiveTab(parsed.id, 6);
          onClose();
        } else {
          alert('Invalid custom widget format: missing id, name, or displayType.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const filteredBuiltIn = filterCategory === 'all'
    ? BUILT_IN_CATALOG
    : BUILT_IN_CATALOG.filter((w) => w.category === filterCategory);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Widget to Current View"
      description="Choose a built-in instrument or select/upload a declarative custom widget."
    >
      <div className="space-y-4">
        {/* Action Header: Creator & Upload */}
        <div className="flex items-center gap-2 p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onClose();
              onOpenWidgetCreator();
            }}
            className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold gap-1.5 h-9"
          >
            <Plus className="h-4 w-4" />
            Build Custom Widget
          </Button>

          <label className="flex-1">
            <input
              type="file"
              accept=".json"
              onChange={handleUploadJson}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="w-full gap-1.5 h-9 border-zinc-700 text-zinc-200 pointer-events-none"
            >
              <Upload className="h-4 w-4 text-emerald-400" />
              Upload .json Widget
            </Button>
          </label>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
          {['all', 'control', 'avionics', 'telemetry', 'custom'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 rounded-lg capitalize font-semibold transition-colors ${
                filterCategory === cat
                  ? 'bg-zinc-800 text-sky-400 border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Widget Catalog List */}
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {/* Custom User Widgets */}
          {(filterCategory === 'all' || filterCategory === 'custom') &&
            profile.customWidgets.map((cw) => (
              <div
                key={cw.id}
                className="flex items-start justify-between p-3 rounded-xl border border-sky-950/60 bg-sky-950/10 hover:border-sky-500/40 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 mt-0.5">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                      {cw.name}
                      <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800">
                        {cw.displayType}
                      </span>
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{cw.description || 'Custom user widget'}</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="default"
                  className="h-8 px-3 text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white"
                  onClick={() => handleAddBuiltIn(cw.id, 6)}
                >
                  Place
                </Button>
              </div>
            ))}

          {/* Built-in Widgets */}
          {filteredBuiltIn.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="flex items-start justify-between p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300 mt-0.5">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100">{item.name}</h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{item.description}</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs font-bold border-zinc-700 hover:bg-zinc-800"
                  onClick={() => handleAddBuiltIn(item.id, item.defaultSpan)}
                >
                  Place
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
