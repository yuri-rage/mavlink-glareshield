import { create } from 'zustand';

export type UnitSystem = 'ms' | 'kmh' | 'mph' | 'kts';
export type AltitudeMode = 'agl' | 'msl';

const STORAGE_KEY_UNITS = 'mavlink_glareshield_unit_system';
const STORAGE_KEY_ALT = 'mavlink_glareshield_alt_mode';

function getStoredUnitSystem(): UnitSystem {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_UNITS);
      if (saved === 'ms' || saved === 'kmh' || saved === 'mph' || saved === 'kts') {
        return saved;
      }
      if (saved === 'imperial') return 'kts';
      if (saved === 'metric') return 'kmh';
    }
  } catch (e) {
    console.warn('Failed to read stored unit system:', e);
  }
  return 'kmh';
}

function getStoredAltitudeMode(): AltitudeMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_ALT);
      if (saved === 'agl' || saved === 'msl') {
        return saved;
      }
    }
  } catch (e) {
    console.warn('Failed to read stored altitude mode:', e);
  }
  return 'agl';
}

interface UnitsState {
  system: UnitSystem;
  setSystem: (system: UnitSystem) => void;
  altitudeMode: AltitudeMode;
  setAltitudeMode: (mode: AltitudeMode) => void;
  isImperial: () => boolean;

  // Formatters
  formatSpeed: (m_s: number) => { value: string; unit: string; full: string };
  formatAltitude: (m: number) => { value: string; unit: string; full: string };
  formatClimb: (m_s: number) => { value: string; unit: string; full: string };
  formatDistance: (m: number) => { value: string; unit: string; full: string };
  formatHomeVector: (bearingDeg: number | null, distanceM: number | null) => string;
  formatCrosstrack: (m: number) => { value: string; unit: string; full: string };
}

export const useUnitsStore = create<UnitsState>((set, get) => ({
  system: getStoredUnitSystem(),
  altitudeMode: getStoredAltitudeMode(),

  setSystem: (system: UnitSystem) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_UNITS, system);
      }
    } catch (e) {
      console.warn('Failed to save unit system:', e);
    }
    set({ system });
  },

  setAltitudeMode: (altitudeMode: AltitudeMode) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_ALT, altitudeMode);
      }
    } catch (e) {
      console.warn('Failed to save altitude mode:', e);
    }
    set({ altitudeMode });
  },

  isImperial: () => {
    const sys = get().system;
    return sys === 'mph' || sys === 'kts';
  },

  formatSpeed: (m_s: number) => {
    const sys = get().system;
    if (sys === 'ms') {
      const val = m_s.toFixed(1);
      return { value: val, unit: 'm/s', full: `${val} m/s` };
    }
    if (sys === 'kts') {
      const kts = m_s * 1.94384;
      const val = kts.toFixed(1);
      return { value: val, unit: 'kts', full: `${val} kts` };
    }
    if (sys === 'mph') {
      const mph = m_s * 2.23694;
      const val = mph.toFixed(1);
      return { value: val, unit: 'mph', full: `${val} mph` };
    }
    const kmh = m_s * 3.6;
    const val = kmh.toFixed(1);
    return { value: val, unit: 'km/h', full: `${val} km/h` };
  },

  formatAltitude: (m: number) => {
    const isImp = get().isImperial();
    if (isImp) {
      const ft = m * 3.28084;
      const val = Math.round(ft).toString();
      return { value: val, unit: 'ft', full: `${val} ft` };
    }
    const val = m.toFixed(1);
    return { value: val, unit: 'm', full: `${val} m` };
  },

  formatClimb: (m_s: number) => {
    const isImp = get().isImperial();
    if (isImp) {
      const fpm = m_s * 196.85;
      const sign = fpm >= 0 ? '+' : '';
      const val = `${sign}${Math.round(fpm)}`;
      return { value: val, unit: 'fpm', full: `${val} fpm` };
    }
    const sign = m_s >= 0 ? '+' : '';
    const val = `${sign}${m_s.toFixed(1)}`;
    return { value: val, unit: 'm/s', full: `${val} m/s` };
  },

  formatDistance: (m: number) => {
    const sys = get().system;
    const safeM = isNaN(m) || m < 0 ? 0 : m;
    if (sys === 'ms') {
      const val = Math.round(safeM).toString();
      return { value: val, unit: 'M', full: `${val} M` };
    }
    if (sys === 'kmh') {
      if (safeM < 1000) {
        const val = Math.round(safeM).toString();
        return { value: val, unit: 'M', full: `${val} M` };
      }
      const val = (safeM / 1000).toFixed(1);
      return { value: val, unit: 'KM', full: `${val} KM` };
    }
    if (sys === 'mph') {
      const ft = safeM * 3.28084;
      if (ft < 1000) {
        const val = Math.round(ft).toString();
        return { value: val, unit: 'FT', full: `${val} FT` };
      }
      const val = (safeM / 1609.344).toFixed(1);
      return { value: val, unit: 'MI', full: `${val} MI` };
    }
    // kts
    const ft = safeM * 3.28084;
    if (ft < 1000) {
      const val = Math.round(ft).toString();
      return { value: val, unit: 'FT', full: `${val} FT` };
    }
    const val = (safeM / 1852).toFixed(1);
    return { value: val, unit: 'NM', full: `${val} NM` };
  },

  formatHomeVector: (bearingDeg: number | null, distanceM: number | null) => {
    if (distanceM === null || isNaN(distanceM)) return 'H ---°/--';
    const brg = Math.round(((bearingDeg ?? 0) % 360 + 360)) % 360;
    const brgStr = `${brg.toString().padStart(3, '0')}°`;
    const distStr = get().formatDistance(distanceM).full;
    return `H ${brgStr}/${distStr}`;
  },

  formatCrosstrack: (m: number) => {
    const isImp = get().isImperial();
    let safeM = isNaN(m) ? 0 : m;
    if (Math.abs(safeM) < 0.05) safeM = 0;
    if (isImp) {
      const ft = safeM * 3.28084;
      const roundedFt = Math.abs(ft) < 0.05 ? 0 : ft;
      const val = Math.abs(roundedFt) >= 100 ? Math.round(roundedFt).toString() : roundedFt.toFixed(1);
      return { value: val, unit: 'ft', full: `${val} ft` };
    }
    const val = Math.abs(safeM) >= 100 ? Math.round(safeM).toString() : safeM.toFixed(1);
    return { value: val, unit: 'm', full: `${val} m` };
  },
}));
