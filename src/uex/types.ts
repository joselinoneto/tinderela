/**
 * Typed subsets of UEX API 2.0 responses. Field names were verified against
 * live responses on 2026-07-31 (see tests/fixtures/ for recorded samples).
 * Only fields this codebase consumes are typed; UEX returns more.
 */

export interface GameVersions {
  live: string;
  ptu: string;
}

export interface Commodity {
  id: number;
  id_parent: number;
  name: string;
  code: string;
  kind: string;
  weight_scu: number;
  /** Galaxy-average prices in aUEC per SCU. */
  price_buy: number;
  price_sell: number;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  is_mineral: number;
  is_raw: number;
  is_refined: number;
  is_refinable: number;
  is_harvestable: number;
  is_buyable: number;
  is_sellable: number;
  is_illegal: number;
  date_modified: number;
}

export interface StarSystem {
  id: number;
  name: string;
  code: string;
  is_available_live: number;
  is_default: number;
  jurisdiction_name: string | null;
  faction_name: string | null;
}

export interface Terminal {
  id: number;
  id_star_system: number;
  id_planet: number;
  id_orbit: number;
  id_moon: number;
  name: string;
  nickname: string;
  code: string;
  type: string;
  mcs: number;
  is_available_live: number;
  is_refinery: number;
  is_cargo_center: number;
  /** Terminal loads/unloads the ship for you — the auto-load flag UEX shows. */
  is_auto_load: number;
  is_refuel: number;
  has_loading_dock: number;
  has_docking_port: number;
  has_freight_elevator: number;
  max_container_size: number;
  game_version: string;
  star_system_name: string | null;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  outpost_name: string | null;
  city_name: string | null;
  faction_name: string | null;
}

/** Row from commodities_prices — the per-terminal price detail endpoint. */
export interface CommodityPrice {
  id: number;
  id_commodity: number;
  id_terminal: number;
  id_star_system: number;
  price_buy: number;
  price_buy_avg: number;
  price_buy_avg_month: number;
  price_sell: number;
  price_sell_avg: number;
  price_sell_avg_month: number;
  scu_buy: number;
  scu_sell_stock: number;
  scu_sell: number;
  status_buy: number;
  status_sell: number;
  volatility_buy: number;
  volatility_sell: number;
  container_sizes: string | null;
  game_version: string;
  date_modified: number;
  commodity_name: string;
  commodity_code: string;
  star_system_name: string | null;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  city_name: string | null;
  outpost_name: string | null;
  terminal_name: string;
  terminal_code: string;
}

/** Slim row from commodities_prices_all / commodities_raw_prices_all. */
export interface CommodityPriceAll {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number;
  price_sell: number;
  price_sell_avg: number;
  scu_buy: number;
  scu_sell_stock: number;
  scu_sell: number;
  status_buy: number;
  status_sell: number;
  date_modified: number;
  commodity_name: string;
  terminal_name: string;
}

export interface RawCommodityPrice {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number;
  price_sell: number;
  price_sell_avg: number;
  date_modified: number;
  commodity_name: string;
  terminal_name: string;
}

export interface CommodityPriceHistoryEntry {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_sell: number;
  scu_buy: number;
  scu_sell: number;
  game_version: string;
  date_added: number;
  commodity_name: string;
  terminal_name: string;
}

export interface CommodityRoute {
  id: number;
  id_commodity: number;
  id_terminal_origin: number;
  id_terminal_destination: number;
  id_star_system_origin: number;
  id_star_system_destination: number;
  code: string;
  price_origin: number;
  price_destination: number;
  price_margin: number;
  price_roi: number;
  scu_origin: number;
  scu_destination: number;
  scu_margin: number;
  investment: number;
  profit: number;
  /** Gm between origin and destination terminals. */
  distance: number;
  score: number;
  game_version_origin: string;
  game_version_destination: string;
  has_docking_port_origin: number;
  has_docking_port_destination: number;
  /**
   * Terminal capability flags. Note the route endpoint has NO auto-load flag —
   * `is_auto_load` lives on the terminal record, so the loading estimate joins
   * these ids back to the terminals cache instead of trusting the elevator.
   */
  has_freight_elevator_origin: number;
  has_freight_elevator_destination: number;
  has_cargo_center_origin: number;
  has_cargo_center_destination: number;
  has_loading_dock_origin: number;
  has_loading_dock_destination: number;
  /** Container sizes the terminal accepts, e.g. "1,2,4,8,16". */
  container_sizes_origin: string | null;
  container_sizes_destination: string | null;
  is_space_station_origin: number;
  is_space_station_destination: number;
  date_added: number;
  commodity_name: string;
  origin_star_system_name: string | null;
  origin_terminal_name: string;
  destination_star_system_name: string | null;
  destination_terminal_name: string;
}

export interface TerminalDistance {
  terminal_name_origin: string;
  terminal_code_origin: string;
  terminal_name_destination: string;
  terminal_code_destination: string;
  /** Gm. */
  distance: number;
}

export interface OrbitDistance {
  id: number;
  id_star_system_origin: number;
  id_star_system_destination: number;
  id_orbit_origin: number;
  id_orbit_destination: number;
  distance: number;
  game_version: string;
  star_system_name: string | null;
  orbit_origin_name: string | null;
  orbit_destination_name: string | null;
}

export interface Vehicle {
  id: number;
  name: string;
  name_full: string;
  slug: string;
  /** Cargo capacity in SCU. */
  scu: number;
  crew: string;
  fuel_quantum: number;
  fuel_hydrogen: number;
  container_sizes: string | null;
  /** Ship has a loading-dock interface (Hull series and little else). */
  is_loading_dock: number;
  /** Ship ships with a cargo-capable tractor beam. */
  is_tractor_beam: number;
  is_cargo: number;
  is_spaceship: number;
  is_ground_vehicle: number;
  is_concept: number;
  is_mining: number;
  pad_type: string | null;
  game_version: string;
  company_name: string;
}

export interface FuelPrice {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number;
  date_modified: number;
  commodity_name: string;
  terminal_name: string;
}

export interface RefineryMethod {
  id: number;
  name: string;
  code: string;
  rating_yield: number;
  rating_cost: number;
  rating_speed: number;
}

export interface RefineryYield {
  id: number;
  id_commodity: number;
  id_terminal: number;
  /** Reported yield bonus/percentage for this commodity at this refinery. */
  value: number;
  value_week: number;
  value_month: number;
  date_modified: number;
  commodity_name: string | null;
  terminal_name: string | null;
  star_system_name: string | null;
}

export interface RefineryCapacity {
  id: number;
  id_terminal: number;
  value: number;
  value_week: number;
  value_month: number;
  terminal_name: string | null;
  star_system_name: string | null;
}
