import { TRAVEL_HEURISTICS } from '../config.js';
import type { CommodityRoute } from '../uex/types.js';

export type LimitingFactor = 'ship_capacity' | 'budget' | 'reported_supply';

export interface RouteEconomics {
  /** SCU actually loadable given ship, budget and reported supply. */
  scu_loaded: number;
  limiting_factor: LimitingFactor;
  investment_uec: number;
  revenue_uec: number;
  profit_total_uec: number;
  profit_per_scu_uec: number;
  roi_percent: number;
  distance_gm: number;
  profit_per_gm_uec: number | null;
  /** ESTIMATE from documented heuristics, not UEX data. */
  est_time_minutes: number;
  /** ESTIMATE from documented heuristics, not UEX data. */
  est_profit_per_hour_uec: number;
  /** UEX's own opaque route score, for reference. */
  uex_score: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Re-scales a UEX route (which assumes the full reported supply) to what the
 * player can actually move: ship capacity, budget and reported supply.
 * Travel time is estimated as quantum cruise plus fixed per-stop overhead —
 * see TRAVEL_HEURISTICS; callers must label time-derived figures estimates.
 */
export function computeRouteEconomics(
  route: CommodityRoute,
  capacityScu: number,
  budgetUec: number,
): RouteEconomics | null {
  if (route.price_origin <= 0 || route.price_destination <= 0) return null;

  const byBudget = Math.floor(budgetUec / route.price_origin);
  const bySupply = route.scu_origin > 0 ? route.scu_origin : capacityScu;
  const scuLoaded = Math.min(capacityScu, byBudget, bySupply);
  if (scuLoaded <= 0) return null;

  let limiting: LimitingFactor = 'ship_capacity';
  if (scuLoaded === byBudget && byBudget < capacityScu) limiting = 'budget';
  else if (scuLoaded === bySupply && bySupply < capacityScu) limiting = 'reported_supply';

  const investment = scuLoaded * route.price_origin;
  const revenue = scuLoaded * route.price_destination;
  const profit = revenue - investment;
  if (profit <= 0) return null;

  const distance = Number(route.distance) || 0;
  const travelMinutes =
    distance / TRAVEL_HEURISTICS.quantumGmPerMinute + 2 * TRAVEL_HEURISTICS.stopOverheadMinutes;

  return {
    scu_loaded: scuLoaded,
    limiting_factor: limiting,
    investment_uec: investment,
    revenue_uec: revenue,
    profit_total_uec: profit,
    profit_per_scu_uec: round2(route.price_destination - route.price_origin),
    roi_percent: round2((profit / investment) * 100),
    distance_gm: distance,
    profit_per_gm_uec: distance > 0 ? round2(profit / distance) : null,
    est_time_minutes: round2(travelMinutes),
    est_profit_per_hour_uec: round2(profit / (travelMinutes / 60)),
    uex_score: route.score,
  };
}

export const TIME_MODEL_NOTE =
  `est_time/est_profit_per_hour are heuristics: quantum cruise at ` +
  `${TRAVEL_HEURISTICS.quantumGmPerMinute} Gm/min plus ` +
  `${TRAVEL_HEURISTICS.stopOverheadMinutes} min overhead per stop (2 stops); actual times vary by ship and route.`;
