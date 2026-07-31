import type { UexClient } from './client.js';
import type {
  Commodity,
  CommodityPrice,
  CommodityPriceAll,
  CommodityPriceHistoryEntry,
  CommodityRoute,
  FuelPrice,
  GameVersions,
  OrbitDistance,
  RawCommodityPrice,
  RefineryCapacity,
  RefineryMethod,
  RefineryYield,
  StarSystem,
  Terminal,
  TerminalDistance,
  Vehicle,
} from './types.js';

/** One typed function per UEX resource this server consumes. */
export class UexEndpoints {
  constructor(private readonly client: UexClient) {}

  gameVersions(): Promise<GameVersions> {
    return this.client.get<GameVersions>('game_versions');
  }

  commodities(): Promise<Commodity[]> {
    return this.client.get<Commodity[]>('commodities');
  }

  starSystems(): Promise<StarSystem[]> {
    return this.client.get<StarSystem[]>('star_systems');
  }

  terminals(idStarSystem?: number): Promise<Terminal[]> {
    return this.client.get<Terminal[]>('terminals', { id_star_system: idStarSystem });
  }

  commodityPrices(params: { id_commodity?: number; id_terminal?: number }): Promise<CommodityPrice[]> {
    return this.client.get<CommodityPrice[]>('commodities_prices', params);
  }

  commodityPricesAll(): Promise<CommodityPriceAll[]> {
    return this.client.get<CommodityPriceAll[]>('commodities_prices_all');
  }

  commodityRawPricesAll(): Promise<RawCommodityPrice[]> {
    return this.client.get<RawCommodityPrice[]>('commodities_raw_prices_all');
  }

  /** UEX requires id_terminal here; id_commodity alone returns missing_id_terminal. */
  commodityPriceHistory(params: {
    id_commodity: number;
    id_terminal: number;
  }): Promise<CommodityPriceHistoryEntry[]> {
    return this.client.get<CommodityPriceHistoryEntry[]>('commodities_prices_history', params);
  }

  commodityRoutes(params: {
    id_commodity?: number;
    id_terminal_origin?: number;
    id_terminal_destination?: number;
  }): Promise<CommodityRoute[]> {
    return this.client.get<CommodityRoute[]>('commodities_routes', params);
  }

  /** UEX returns a bare object for a single pair; normalize to an array. */
  async terminalDistance(idOrigin: number, idDestination: number): Promise<TerminalDistance[]> {
    const data = await this.client.get<TerminalDistance | TerminalDistance[]>('terminals_distances', {
      id_terminal_origin: idOrigin,
      id_terminal_destination: idDestination,
    });
    return Array.isArray(data) ? data : [data];
  }

  orbitDistances(idSystemOrigin: number, idSystemDestination: number): Promise<OrbitDistance[]> {
    return this.client.get<OrbitDistance[]>('orbits_distances', {
      id_star_system_origin: idSystemOrigin,
      id_star_system_destination: idSystemDestination,
    });
  }

  vehicles(): Promise<Vehicle[]> {
    return this.client.get<Vehicle[]>('vehicles');
  }

  fuelPricesAll(): Promise<FuelPrice[]> {
    return this.client.get<FuelPrice[]>('fuel_prices_all');
  }

  refineryMethods(): Promise<RefineryMethod[]> {
    return this.client.get<RefineryMethod[]>('refineries_methods');
  }

  refineryYields(): Promise<RefineryYield[]> {
    return this.client.get<RefineryYield[]>('refineries_yields');
  }

  refineryCapacities(): Promise<RefineryCapacity[]> {
    return this.client.get<RefineryCapacity[]>('refineries_capacities');
  }
}
