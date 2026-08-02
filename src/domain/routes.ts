import { LOADING_HEURISTICS, TRAVEL_HEURISTICS } from '../config.js';
import type { CommodityRoute } from '../uex/types.js';

export type LimitingFactor = 'ship_capacity' | 'budget' | 'reported_supply';

/** How the cargo moves between hold and terminal at one stop. */
export type CargoHandling = 'assisted' | 'manual';

/**
 * A stop is `assisted` when UEX reports a freight elevator or cargo centre at
 * the terminal — the station moves the boxes. Anything else (or missing data,
 * e.g. an older cached row) is treated as `manual`, the pessimistic case.
 */
export function isAssistedStop(hasFreightElevator: number, hasCargoCenter: number): CargoHandling {
  return hasFreightElevator === 1 || hasCargoCenter === 1 ? 'assisted' : 'manual';
}

/** Minutes at one stop: fixed docking overhead plus per-SCU cargo handling. */
export function stopMinutes(scu: number, handling: CargoHandling): number {
  const perScu =
    handling === 'assisted'
      ? LOADING_HEURISTICS.assistedMinutesPerScu
      : LOADING_HEURISTICS.manualMinutesPerScu;
  return TRAVEL_HEURISTICS.stopOverheadMinutes + scu * perScu;
}

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
  /** How the cargo moves at each stop, from UEX terminal flags. */
  cargo_handling_origin: CargoHandling;
  cargo_handling_destination: CargoHandling;
  /** ESTIMATE: docking plus per-SCU handling at the buy terminal. */
  est_load_minutes: number;
  /** ESTIMATE: docking plus per-SCU handling at the sell terminal. */
  est_unload_minutes: number;
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
 * Travel time is quantum cruise plus, at each stop, docking overhead and
 * per-SCU cargo handling that depends on whether the terminal assists — see
 * TRAVEL_HEURISTICS and LOADING_HEURISTICS. Callers must label every
 * time-derived figure an estimate.
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
  // Handling scales with the load, so a full Caterpillar no longer costs the
  // same 30 minutes of overhead as a 2 SCU hop.
  const handlingOrigin = isAssistedStop(
    route.has_freight_elevator_origin,
    route.has_cargo_center_origin,
  );
  const handlingDestination = isAssistedStop(
    route.has_freight_elevator_destination,
    route.has_cargo_center_destination,
  );
  const loadMinutes = stopMinutes(scuLoaded, handlingOrigin);
  const unloadMinutes = stopMinutes(scuLoaded, handlingDestination);
  const travelMinutes =
    distance / TRAVEL_HEURISTICS.quantumGmPerMinute + loadMinutes + unloadMinutes;

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
    cargo_handling_origin: handlingOrigin,
    cargo_handling_destination: handlingDestination,
    est_load_minutes: round2(loadMinutes),
    est_unload_minutes: round2(unloadMinutes),
    est_time_minutes: round2(travelMinutes),
    est_profit_per_hour_uec: round2(profit / (travelMinutes / 60)),
    uex_score: route.score,
  };
}

export const TIME_MODEL_NOTE =
  `est_time/est_profit_per_hour are heuristics: quantum cruise at ` +
  `${TRAVEL_HEURISTICS.quantumGmPerMinute} Gm/min, plus ` +
  `${TRAVEL_HEURISTICS.stopOverheadMinutes} min docking overhead per stop (2 stops) and ` +
  `per-SCU cargo handling — ${LOADING_HEURISTICS.assistedMinutesPerScu} min/SCU where the ` +
  `terminal has a freight elevator or cargo centre, ${LOADING_HEURISTICS.manualMinutesPerScu} ` +
  `min/SCU where the load is moved by tractor beam. The per-SCU rates are UNVERIFIED ` +
  `placeholders (src/config.ts); actual times vary by ship, terminal and route.`;
