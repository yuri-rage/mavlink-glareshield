// The default Tuning tab's parameter sets (src/store/dashboardStore.ts: Attitude Tuning, Navigation) pick each
// vehicle's own: Rover's steering, speed and navigation families as well as Copter's, against parameter lists shaped
// as ArduPilot reports them (AC_PID groups with all their sub-parameters).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { expandParamPatterns } = await import('../src/mavlink/paramMatch.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

/** An AC_PID group's parameters, as ArduPilot names them. */
const pid = (prefix: string) =>
  ['P', 'I', 'D', 'FF', 'IMAX', 'FLTT', 'FLTE', 'FLTD', 'SMAX', 'PDMX', 'D_FF', 'NTF', 'NEF'].map(
    (s) => `${prefix}${s}`
  );
const rover = [
  ...pid('ATC_STR_RAT_'),
  ...pid('ATC_SPEED_'),
  ...pid('ATC_BAL_'),
  'ATC_STR_ANG_P',
  'ATC_STR_RAT_MAX',
  'ATC_STR_ACC_MAX',
  'ATC_STR_DEC_MAX',
  'ATC_ACCEL_MAX',
  'ATC_DECEL_MAX',
  'ATC_BRAKE',
  'ATC_STOP_SPEED',
  'ATC_TURN_MAX_G',
  'CRUISE_SPEED',
  'CRUISE_THROTTLE',
  'TURN_RADIUS',
  'WP_SPEED',
  'WP_RADIUS',
  'WP_ACCEL',
  'WP_JERK',
  'WP_PIVOT_ANGLE',
  'WP_PIVOT_RATE',
  'PSC_POS_P',
  ...pid('PSC_VEL_'),
  'LOIT_RADIUS',
  'LOIT_TYPE',
  'FS_ACTION',
  'BATT_FS_LOW_ACT',
];
const copter = [
  ...pid('ATC_RAT_RLL_'),
  ...pid('ATC_RAT_PIT_'),
  ...pid('ATC_RAT_YAW_'),
  'ATC_ANG_RLL_P',
  'ATC_ACCEL_R_MAX',
  'WPNAV_SPEED',
  'PSC_POSXY_P',
  ...pid('PSC_VELXY_'),
  'LOIT_SPEED',
];
const set = (id: string) =>
  useDashboardStore.getState().profile.customWidgets.find((w) => w.id === id)!.paramSet!.params as string[];
const shown = (id: string, available: string[]) =>
  expandParamPatterns(set(id), available)
    .filter((e) => e.present)
    .map((e) => e.name);

const att = shown('custom-attitude-tuning', rover);
check(
  'Rover attitude: the steering rate PID gains',
  ['ATC_STR_RAT_P', 'ATC_STR_RAT_I', 'ATC_STR_RAT_D', 'ATC_STR_RAT_FF', 'ATC_STR_RAT_IMAX'].every((n) =>
    att.includes(n)
  ),
  att.join(' ')
);
check(
  'Rover attitude: the speed (throttle) PID gains',
  ['ATC_SPEED_P', 'ATC_SPEED_I', 'ATC_SPEED_D', 'ATC_SPEED_FF'].every((n) => att.includes(n))
);
check(
  'Rover attitude: steering angle P, rate and accel limits',
  ['ATC_STR_ANG_P', 'ATC_STR_RAT_MAX', 'ATC_STR_ACC_MAX'].every((n) => att.includes(n))
);
check(
  'Rover attitude: accel, decel, braking, turn G',
  ['ATC_ACCEL_MAX', 'ATC_DECEL_MAX', 'ATC_BRAKE', 'ATC_TURN_MAX_G', 'ATC_STOP_SPEED'].every((n) => att.includes(n))
);
check(
  'Rover attitude: filter and slew extras left out (as for Copter)',
  !att.some((n) => /_(FLT.|SMAX|PDMX|D_FF|NTF|NEF)$/.test(n)),
  att.filter((n) => /_(FLT.|SMAX|PDMX|D_FF|NTF|NEF)$/.test(n)).join(' ')
);
check('Rover attitude: the balance-bot pitch PID not offered', !att.some((n) => n.startsWith('ATC_BAL_')));
const nav = shown('custom-navigation', rover);
check(
  'Rover navigation: cruise speed and throttle, turn radius',
  ['CRUISE_SPEED', 'CRUISE_THROTTLE', 'TURN_RADIUS'].every((n) => nav.includes(n)),
  nav.join(' ')
);
check(
  'Rover navigation: waypoint speed, radius, pivot turns',
  ['WP_SPEED', 'WP_RADIUS', 'WP_PIVOT_ANGLE', 'WP_PIVOT_RATE'].every((n) => nav.includes(n))
);
check(
  'Rover navigation: position controller',
  ['PSC_POS_P', 'PSC_VEL_P', 'PSC_VEL_I'].every((n) => nav.includes(n)) && !nav.includes('PSC_VEL_FLTE')
);
check('Rover navigation: loiter radius', nav.includes('LOIT_RADIUS'));

const catt = shown('custom-attitude-tuning', copter);
check(
  'Copter attitude unchanged: rate PIDs and angle P',
  ['ATC_RAT_RLL_P', 'ATC_RAT_PIT_D', 'ATC_ANG_RLL_P'].every((n) => catt.includes(n)) &&
    !catt.some((n) => n.startsWith('ATC_STR_'))
);
const cnav = shown('custom-navigation', copter);
check(
  "Copter navigation: its own position controller, not Rover's PSC_VEL_",
  ['WPNAV_SPEED', 'PSC_POSXY_P', 'PSC_VELXY_P'].every((n) => cnav.includes(n))
);

// A saved profile from before: its unchanged stock sets take the new default; an edited one is kept.
{
  const { updateStockWidget } = await import('../src/store/dashboardStore.ts');
  const current = useDashboardStore.getState().profile.customWidgets.find((w) => w.id === 'custom-attitude-tuning')!;
  const oldParams = [
    'ATC_RAT_RLL_*',
    'ATC_RAT_PIT_*',
    'ATC_RAT_YAW_*',
    'ATC_ANG_*',
    'ATC_ACCEL_*',
    'RLL_RATE_*',
    'PTCH_RATE_*',
    'YAW_RATE_*',
    '-*_SMAX',
    '-*_PDMX',
    '-*_NTF',
    '-*_NEF',
    '-*_FLT?',
    '-*_D_FF',
  ];
  const saved = { ...current, paramSet: { ...current.paramSet!, params: oldParams } };
  const updated = updateStockWidget(saved);
  check('a saved, unchanged stock set takes the new default', updated.paramSet!.params.includes('ATC_STR_*'));
  const edited = { ...current, paramSet: { ...current.paramSet!, params: [...oldParams, 'MY_PARAM'] } };
  check(
    'an edited one is left alone',
    updateStockWidget(edited).paramSet!.params.includes('MY_PARAM') &&
      !updateStockWidget(edited).paramSet!.params.includes('ATC_STR_*')
  );
  check(
    'confirmation settings are kept',
    updateStockWidget({ ...saved, paramSet: { ...saved.paramSet!, confirmation: false } }).paramSet!.confirmation ===
      false
  );
}

console.log(failures.length ? `\n${failures.length} tuning-set check(s) FAILED` : '\nAll tuning-set checks PASSED');
process.exit(failures.length ? 1 : 0);
