// A parameter's value as read during this connection only. The telemetry store keeps parameters across a
// disconnect (a brief drop to the same vehicle shouldn't empty them), so a value there may be another vehicle's: a
// QuadPlane's Q_ENABLE = 1 would still be there for a plain plane, which has no Q_ENABLE to replace it. This asks for
// the parameter on each new connection and only counts a value that arrives afterwards.

import { useEffect, useState } from 'react';
import { useTelemetryStore } from '../store/telemetryStore';
import { paramManager } from '../mavlink/paramManager';

export function useConnectionParam(name: string, enabled: boolean): number | undefined {
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const [value, setValue] = useState<number | undefined>(undefined);
  useEffect(() => {
    setValue(undefined);
    if (!enabled || !linked || sysId <= 0) return;
    const before = useTelemetryStore.getState().parameters[name];
    const unsub = useTelemetryStore.subscribe((s) => {
      const p = s.parameters[name];
      if (p && p !== before) setValue(p.value);
    });
    paramManager.requestParam(sysId, compId || 1, name);
    return unsub;
  }, [name, enabled, linked, sysId, compId]);
  return value;
}
