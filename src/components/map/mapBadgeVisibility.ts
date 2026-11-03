export interface BadgeVisibilityInput {
  headerWidth: number;
  controlsWidth: number;
  userWpCount: number;
  fenceCount: number;
  rallyCount: number;
  isFetching: boolean;
  previouslyHidden: boolean;
}

/**
 * Computes whether mission entity badges (Waypoints, Fence, Rally) should be hidden
 * to keep the map header bar strictly on a single row without wrapping or layout flapping.
 *
 * Employs deterministic size estimates and a +24px hysteresis buffer to eliminate
 * rapid oscillation / layout thrashing during waypoint downloads on 1/2-width or narrow views.
 */
export function computeMapBadgeVisibility(input: BadgeVisibilityInput): boolean {
  const { headerWidth, controlsWidth, userWpCount, fenceCount, rallyCount, isFetching, previouslyHidden } = input;

  let countBadgesWidth = 0;
  let activeCountBadges = 0;

  if (userWpCount > 0) {
    countBadgesWidth += userWpCount >= 100 ? 64 : 56;
    activeCountBadges++;
  }
  if (fenceCount > 0) {
    countBadgesWidth += fenceCount >= 100 ? 76 : 68;
    activeCountBadges++;
  }
  if (rallyCount > 0) {
    countBadgesWidth += rallyCount >= 100 ? 72 : 64;
    activeCountBadges++;
  }
  if (activeCountBadges > 1) {
    countBadgesWidth += (activeCountBadges - 1) * 6; // gap-1.5 = 6px
  }

  // If no count badges exist, they don't need to be hidden
  if (activeCountBadges === 0) {
    return false;
  }

  const downloadBadgeWidth = isFetching ? 68 : 0;
  const gapBetween = downloadBadgeWidth > 0 && countBadgesWidth > 0 ? 6 : 0;
  const totalBadgesWidth = countBadgesWidth + downloadBadgeWidth + gapBetween;

  // 16px safety margin for padding and flex gaps
  const neededWidth = controlsWidth + totalBadgesWidth + 16;

  if (previouslyHidden) {
    // Currently hidden: only unhide when there is ample headroom (+24px hysteresis buffer)
    return headerWidth < neededWidth + 24;
  } else {
    // Currently visible: hide if header width drops below needed width
    return headerWidth < neededWidth;
  }
}
