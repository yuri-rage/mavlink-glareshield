// The altitude to show for the chosen reference (Settings: AGL or MSL), from the vehicle's reports.
//
// AGL is GLOBAL_POSITION_INT.relative_alt (height above home). MSL is GLOBAL_POSITION_INT.alt, or VFR_HUD.alt until
// a position has arrived: VFR_HUD.alt is above sea level on ArduPilot (GCS_MAVLINK::vfr_hud_alt; Copter sends a
// relative height there only with a compatibility dev-option), so it is never a stand-in for AGL. A height above home
// of exactly 0 is a real value (sitting at home), not "none".

export type AltitudeReference = 'agl' | 'msl';

export function displayAltitudeM(mode: AltitudeReference, position: { alt: number; relativeAlt: number }, vfrAlt: number): number {
  if (mode === 'agl') return position.relativeAlt;
  return position.alt !== 0 ? position.alt : vfrAlt;
}
