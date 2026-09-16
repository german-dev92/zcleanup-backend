import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient } from 'redis';
import { normalizeAddress } from '../common/utils/normalize-address';

export type CoverageZone = {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
};

export type ZoneDistance = {
  zone: CoverageZone;
  distanceKm: number;
  remainingKm: number;
};

export type GeoCoverageClassificationV2 = 'INSIDE' | 'BORDERLINE' | 'OUTSIDE';

export type GeoPricingResult = {
  status: 'inside' | 'borderline' | 'outside';
  assignedZone: string | null;
  isBorderline: boolean;
  distanceSurcharge: boolean;
  distanceKm: number | null;
  lat: number | null;
  lng: number | null;
  coverageClassification: GeoCoverageClassificationV2;
  closestZoneName: string | null;
  closestZoneDistanceKm: number | null;
  v2BorderlineFeeApplicable: boolean;
  borderlineOutsideThresholdKmV2: number;
};

type GeocodeOk = { ok: true; lat: number; lng: number };
type GeocodeFailReason =
  | 'invalid_address'
  | 'quota_exceeded'
  | 'request_denied'
  | 'api_unavailable';
type GeocodeFail = { ok: false; reason: GeocodeFailReason; message: string };
type GeocodeProviderCooldownState = {
  until: number;
  reason: GeocodeFailReason;
  message: string;
};

type GeoTraceContext = {
  inputAddress: string;
  clientLatLng: { lat: number; lng: number } | null;
  serverLatLng: { lat: number; lng: number } | null;
  chosenLatLng: { lat: number; lng: number };
  chosenSource:
    | 'server_geocoded'
    | 'client_verified'
    | 'client_unverified'
    | 'server_overrode_client';
};

@Injectable()
export class GeoPricingService {
  private readonly logger = new Logger(GeoPricingService.name);
  private resolvedGeocodingKey: {
    key: string;
    source:
      | 'primary'
      | 'fallback_google_maps_api_key'
      | 'fallback_google_api_key'
      | 'none';
  } | null = null;
  private fallbackWarningLogged = false;

  private readonly zones: CoverageZone[] = [
    { name: 'Tampa', lat: 27.9506, lng: -82.4572, radiusKm: 22 },
    { name: 'Brandon', lat: 27.9378, lng: -82.2859, radiusKm: 8 },
    { name: 'Odessa', lat: 28.1822, lng: -82.5695, radiusKm: 15 },
    { name: 'Wesley Chapel', lat: 28.1858, lng: -82.35, radiusKm: 11 },
    { name: 'New Port Richey', lat: 28.2442, lng: -82.7193, radiusKm: 11 },
    {
      name: 'Saint Petersburg',
      lat: 27.7676,
      lng: -82.6403,
      radiusKm: 11,
    },
    { name: 'Clearwater', lat: 27.9659, lng: -82.8001, radiusKm: 11 },
    { name: 'Palm Harbor', lat: 28.0781, lng: -82.7637, radiusKm: 11 },
    { name: 'Bardmoor', lat: 27.8586, lng: -82.7494, radiusKm: 11 },
    { name: 'Oldsmar', lat: 28.0486, lng: -82.6697, radiusKm: 9 },
  ];

  private readonly borderlineThresholdKm = 3;
  // V2: distancia MÁXIMA FUERA del boundary del círculo para seguir en BORDERLINE.
  // INSIDE: distance <= radius
  // BORDERLINE: radius < distance <= radius + BORDERLINE_OUTSIDE_THRESHOLD_V2_KM
  // OUTSIDE: distance > radius + BORDERLINE_OUTSIDE_THRESHOLD_V2_KM
  private readonly BORDERLINE_OUTSIDE_THRESHOLD_V2_KM = 1;
  readonly BORDERLINE_FEE_V2_AMOUNT = 25;
  private readonly filterEpsilonKm = Number(
    process.env.GEO_PRICING_FILTER_EPSILON_KM ?? 0.05,
  );
  private traceOnceRemaining = process.env.GEO_PRICING_TRACE_ONCE === '1';
  private readonly minimumAddressLength = Number(
    process.env.GEO_PRICING_MIN_ADDRESS_LENGTH ?? 10,
  );
  private readonly providerFailureCooldownMs = Number(
    process.env.GEO_PRICING_PROVIDER_FAILURE_COOLDOWN_MS ?? 5 * 60 * 1000,
  );

  private readonly geocodeCacheTtlMs = Number(
    process.env.GEO_PRICING_GEOCODE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000,
  );
  private readonly geocodeTimeoutMs = Number(
    process.env.GEO_PRICING_GEOCODE_TIMEOUT_MS ?? 3000,
  );
  private readonly geocodeTotalTimeoutMs = Number(
    process.env.GEO_PRICING_GEOCODE_TOTAL_TIMEOUT_MS ?? 5000,
  );
  private readonly geocodeMaxRetries = 2;
  private readonly redisUrl =
    typeof process.env.REDIS_URL === 'string'
      ? process.env.REDIS_URL.trim()
      : '';
  private readonly redisCacheKeyPrefix =
    typeof process.env.GEO_PRICING_REDIS_CACHE_PREFIX === 'string' &&
    process.env.GEO_PRICING_REDIS_CACHE_PREFIX.trim()
      ? process.env.GEO_PRICING_REDIS_CACHE_PREFIX.trim()
      : 'geo:geocode:v1:';
  private readonly latLngMismatchThresholdKm = Number(
    process.env.GEO_PRICING_LATLNG_MISMATCH_THRESHOLD_KM ?? 1,
  );
  private readonly redisCommandTimeoutMs = Number(
    process.env.GEO_PRICING_REDIS_COMMAND_TIMEOUT_MS ?? 200,
  );
  private redis: ReturnType<typeof createClient> | null = null;
  private redisConnectPromise: Promise<ReturnType<
    typeof createClient
  > | null> | null = null;
  private providerCooldown: GeocodeProviderCooldownState | null = null;

  async computeFromInput(input: {
    address?: unknown;
    lat?: unknown;
    lng?: unknown;
  }): Promise<GeoPricingResult> {
    const address =
      typeof input.address === 'string' ? input.address.trim() : '';

    const clientLat = this.parseFiniteNumber(input.lat);
    const clientLng = this.parseFiniteNumber(input.lng);
    const hasClientCoords = clientLat !== null && clientLng !== null;
    const isProd = process.env.NODE_ENV === 'production';
    const debugMode = this.isDebugModeEnabled();
    const trace = debugMode || this.shouldTrace();
    const includePii = trace && !isProd;

    this.logger.log(
      JSON.stringify({
        event: 'geo.request_entry',
        address: includePii ? address : undefined,
        addressPresent: !!address,
        addressLength: address.length,
        clientLatLng: includePii
          ? hasClientCoords
            ? { lat: clientLat, lng: clientLng }
            : null
          : hasClientCoords,
        env: {
          GOOGLE_MAPS_SERVER_API_KEY: {
            present:
              typeof process.env.GOOGLE_MAPS_SERVER_API_KEY === 'string' &&
              !!process.env.GOOGLE_MAPS_SERVER_API_KEY.trim(),
          },
          GOOGLE_MAPS_API_KEY: {
            present:
              typeof process.env.GOOGLE_MAPS_API_KEY === 'string' &&
              !!process.env.GOOGLE_MAPS_API_KEY.trim(),
          },
          GOOGLE_API_KEY: {
            present:
              typeof process.env.GOOGLE_API_KEY === 'string' &&
              !!process.env.GOOGLE_API_KEY.trim(),
          },
        },
        debugMode,
      }),
    );

    if (hasClientCoords && !this.isValidLatLng(clientLat, clientLng)) {
      this.logger.warn(
        JSON.stringify({
          event: 'geo.input_validation',
          addressPresent: !!address,
          hasClientCoords,
          accepted: false,
          reason: 'invalid_lat_lng',
          clientLatLng: includePii
            ? { lat: clientLat, lng: clientLng }
            : undefined,
        }),
      );
      throw new BadRequestException('Invalid lat/lng');
    }

    if (!address) {
      if (hasClientCoords) {
        this.logger.warn(
          JSON.stringify({
            event: 'geo.input_validation',
            addressPresent: false,
            hasClientCoords,
            accepted: false,
            reason: 'missing_address_with_lat_lng',
            clientLatLng: includePii
              ? { lat: clientLat, lng: clientLng }
              : undefined,
          }),
        );
        throw new BadRequestException('Address is required');
      }
      this.logger.warn(
        JSON.stringify({
          event: 'geo.input_validation',
          addressPresent: false,
          hasClientCoords: false,
          accepted: false,
          reason: 'missing_address',
        }),
      );
      throw new BadRequestException('Address is required');
    }

    if (address.length < this.getMinimumAddressLength()) {
      this.logger.warn(
        JSON.stringify({
          event: 'geo.input_validation',
          addressPresent: true,
          addressLength: address.length,
          hasClientCoords,
          accepted: false,
          reason: 'address_too_short',
          minAddressLength: this.getMinimumAddressLength(),
        }),
      );
      throw new BadRequestException(
        `Address must be at least ${this.getMinimumAddressLength()} characters`,
      );
    }

    const hasServerKey = this.hasServerGeocodingKey();
    if (hasServerKey) {
      this.logger.log(
        JSON.stringify({
          event: 'geo.input_validation',
          addressPresent: true,
          hasClientCoords,
          accepted: true,
          reason: 'ok',
        }),
      );
      this.logger.log(
        JSON.stringify({
          event: 'geo.geocoding_plan',
          hasServerKey: true,
          willGeocode: true,
        }),
      );

      const geocoded = await this.getGeocodedCoordinates(address, trace);
      if (!geocoded.ok) {
        this.logger.warn(
          JSON.stringify({
            event: 'geo.geocode_failed',
            reason: geocoded.reason,
            message: geocoded.message,
            address: includePii ? address : undefined,
          }),
        );
        if (geocoded.reason === 'invalid_address') {
          throw new BadRequestException(geocoded.message);
        }
        throw new ServiceUnavailableException(
          this.getClientFacingGeocodeErrorMessage(geocoded),
        );
      }

      this.logger.log(
        JSON.stringify({
          event: 'geo.geocode_resolved',
          used: 'server',
          serverLatLng: includePii
            ? { lat: geocoded.lat, lng: geocoded.lng }
            : { present: true },
        }),
      );

      if (hasClientCoords) {
        const validated = this.validateClientCoordinates(
          {
            inputAddress: address,
            clientLat: clientLat,
            clientLng: clientLng,
            serverLat: geocoded.lat,
            serverLng: geocoded.lng,
          },
          trace,
        );
        const chosenSource =
          validated.lat === geocoded.lat && validated.lng === geocoded.lng
            ? 'server_overrode_client'
            : 'client_verified';
        this.logger.log(
          JSON.stringify({
            event: 'geo.coordinate_resolution',
            chosenSource,
            inputAddress: includePii ? address : undefined,
            clientLatLng: includePii
              ? { lat: clientLat, lng: clientLng }
              : undefined,
            serverLatLng: includePii
              ? { lat: geocoded.lat, lng: geocoded.lng }
              : undefined,
            chosenLatLng: includePii
              ? { lat: validated.lat, lng: validated.lng }
              : undefined,
          }),
        );
        return this.computeSurchargeInternal(
          validated.lat,
          validated.lng,
          trace,
          {
            inputAddress: address,
            clientLatLng: { lat: clientLat, lng: clientLng },
            serverLatLng: { lat: geocoded.lat, lng: geocoded.lng },
            chosenLatLng: { lat: validated.lat, lng: validated.lng },
            chosenSource,
          },
        );
      }

      return this.computeSurchargeInternal(geocoded.lat, geocoded.lng, trace, {
        inputAddress: address,
        clientLatLng: null,
        serverLatLng: { lat: geocoded.lat, lng: geocoded.lng },
        chosenLatLng: { lat: geocoded.lat, lng: geocoded.lng },
        chosenSource: 'server_geocoded',
      });
    }

    this.logger.warn(
      JSON.stringify({
        event: 'geo.server_geocoding_key_missing',
        hasClientCoords,
        inputAddress: includePii ? address : undefined,
      }),
    );

    this.logger.error(
      JSON.stringify({
        event: 'geo.final_decision',
        isOutsideService: true,
        assignedZone: null,
        reason: 'geocoding_unavailable_server_key_missing',
        inputAddress: includePii ? address : undefined,
      }),
    );
    throw new ServiceUnavailableException(
      'Service temporarily unavailable. Please try again later.',
    );
  }

  computeSurcharge(lat: number, lng: number): GeoPricingResult {
    return this.computeSurchargeInternal(lat, lng, this.shouldTrace(), null);
  }

  private computeSurchargeInternal(
    lat: number,
    lng: number,
    trace: boolean,
    traceContext: GeoTraceContext | null,
  ): GeoPricingResult {
    const isProd = process.env.NODE_ENV === 'production';
    const includePii = trace && !isProd;
    const distances = this.computeDistances(lat, lng);

    // ============================================================
    // V2 — PRIMERO y sobre LAS 10 ZONAS COMPLETAS.
    // ⚠️ NUNCA llames a filterZones / classifyZones / selectBestZone
    //    (V1 legacy) ANTES de esta línea. distances[] contiene las
    //    10 zonas intactas para la regla INSIDE > BORDERLINE > OUTSIDE.
    // ============================================================
    const v2Coverage = this.classifyCoverageV2(distances);
    // ============================================================
    // VARIABLES V2 SOURCE-OF-TRUTH.
    // Derivadas 100% de classifyCoverageV2 (10 zonas).
    // CONSTRUIR el return GeoPricingResult ÚNICAMENTE con estas;
    // NUNCA con selected.isBorderlineV1 / classified / covering.length.
    // ============================================================
    const v2StatusToLegacy: Record<
      GeoCoverageClassificationV2,
      'inside' | 'borderline' | 'outside'
    > = {
      INSIDE: 'inside',
      BORDERLINE: 'borderline',
      OUTSIDE: 'outside',
    };
    const v2Classification = v2Coverage.classification;
    const v2Assigned = v2Coverage.assignedZone;
    const v2Closest = v2Coverage.closestZone;
    const v2LegacyStatus = v2StatusToLegacy[v2Classification];
    const v2IsBorderline = v2Classification === 'BORDERLINE';
    const v2AssignedZoneName = v2Classification === 'OUTSIDE' ? null : (v2Assigned?.name ?? null);
    const v2AssignedDistanceKm =
      v2Assigned && v2Classification !== 'OUTSIDE'
        ? Math.round(v2Assigned.distanceKm * 10) / 10
        : null;
    if (trace) {
      this.logger.log(
        JSON.stringify({
          event: 'geo.zone_distance_calculation',
          input: includePii ? { lat, lng } : undefined,
          request: includePii ? traceContext : undefined,
          zones: distances.map((d) => ({
            name: d.zone.name,
            center: { lat: d.zone.lat, lng: d.zone.lng },
            radiusKm: d.zone.radiusKm,
            distanceKm: Math.round(d.distanceKm * 1000) / 1000,
          })),
        }),
      );
    }

    // ============================================================
    // ⚠️ LEGACY ONLY (V1) — filterZones() NO INFLUYE en V2.
    // Únicamente para logger traces 'geo.filtering' y para los
    // flujos legacy classifyZones / selectBestZone que SOLO usamos
    // para campos de depuración en logs.
    //
    // REGLA INQUEBRANTABLE:
    //   ❌ NUNCA muevas la llamada a classifyCoverageV2 DESPUÉS de
    //      esta línea. Si classifyCoverageV2 recibe distances[]
    //      con <10 zonas, la regla INSIDE > BORDERLINE se rompe.
    // ============================================================
    const covering = this.filterZones(distances);
    if (trace) {
      const passedSet = new Set(covering.map((c) => c.zone.name));
      const passed = covering.map((d) => ({
        name: d.zone.name,
        distanceKm: Math.round(d.distanceKm * 1000) / 1000,
        radiusKm: d.zone.radiusKm,
        rule: 'distanceKm <= radiusKm + epsilonKm',
      }));
      const failed = distances
        .filter((d) => !passedSet.has(d.zone.name))
        .map((d) => ({
          name: d.zone.name,
          distanceKm: Math.round(d.distanceKm * 1000) / 1000,
          radiusKm: d.zone.radiusKm,
          rule: 'distanceKm <= radiusKm + epsilonKm',
        }));
      this.logger.log(
        JSON.stringify({
          event: 'geo.filtering',
          epsilonKm: this.filterEpsilonKm,
          passed,
          failed,
          coveringZones: covering.map((d) => d.zone.name),
        }),
      );
    }
    if (covering.length === 0) {
      this.logger.log(
        JSON.stringify({
          event: 'geo.final_decision',
          isOutsideService: true,
          assignedZone: null,
          reason: 'no_zones_within_radius',
          distanceKm: null,
          latLng: includePii ? { lat, lng } : undefined,
          inputAddress: includePii
            ? (traceContext?.inputAddress ?? null)
            : undefined,
        }),
      );
      if (includePii) {
        this.logger.log(
          JSON.stringify({
            event: 'geo.trace',
            input: { lat, lng },
            request: traceContext,
            zones: this.zones,
            distances: distances.map((d) => ({
              name: d.zone.name,
              center: { lat: d.zone.lat, lng: d.zone.lng },
              radiusKm: d.zone.radiusKm,
              distanceKm: Math.round(d.distanceKm * 1000) / 1000,
              remainingKm: Math.round(d.remainingKm * 1000) / 1000,
            })),
            coveringZones: [],
            selectedZone: null,
            decision: {
              isOutsideService: true,
              reason: 'no_zones_within_radius',
            },
          }),
        );
      }
      // ============================================================
      // ⚠️ OUTPUT V2 ONLY — covering.length === 0.
      // Todos los campos derivan de v2* (v2Classification,
      // v2LegacyStatus, v2Assigned, v2Closest, v2Coverage).
      // 'covering.length === 0' de V1 NO fuerza OUTSIDE si
      // v2Classification es BORDERLINE (ej: 0.3 km afuera,
      // filterZones lo eliminó por epsilon 50m).
      // ============================================================
      return {
        status: v2LegacyStatus,
        assignedZone: v2AssignedZoneName,
        isBorderline: v2IsBorderline,
        distanceSurcharge: v2IsBorderline,
        distanceKm: v2AssignedDistanceKm,
        lat,
        lng,
        coverageClassification: v2Classification,
        closestZoneName: v2Closest?.name ?? null,
        closestZoneDistanceKm: v2Closest?.distanceKm ?? null,
        v2BorderlineFeeApplicable: v2Coverage.feeApplicable,
        borderlineOutsideThresholdKmV2: v2Coverage.borderlineOutsideThresholdKm,
      };
    }

    // ============================================================
    // CLASIFICACIÓN V1 LEGACY — SOLO para logger traces.
    // NUNCA usar estos valores para construir el return; los
    // returns usan v2* (ver abajo). selected / isBorderlineV1
    // SOLO aparecen en geo.final_decision / geo.trace logs.
    // ============================================================
    const classified = this.classifyZones(covering);
    const { selected, isBorderline: isBorderlineV1 } = this.selectBestZone(classified);
    this.logger.log(
      JSON.stringify({
        event: 'geo.final_decision',
        isOutsideService: false,
        assignedZone: selected.zone.name,
        reason: isBorderlineV1
          ? 'borderline_zone_selected'
          : 'inside_zone_selected',
        distanceKm: Math.round(selected.distanceKm * 10) / 10,
        latLng: includePii ? { lat, lng } : undefined,
        inputAddress: includePii
          ? (traceContext?.inputAddress ?? null)
          : undefined,
      }),
    );
    if (includePii) {
      this.logger.log(
        JSON.stringify({
          event: 'geo.trace',
          input: { lat, lng },
          request: traceContext,
          zones: this.zones,
          distances: distances.map((d) => ({
            name: d.zone.name,
            center: { lat: d.zone.lat, lng: d.zone.lng },
            radiusKm: d.zone.radiusKm,
            distanceKm: Math.round(d.distanceKm * 1000) / 1000,
            remainingKm: Math.round(d.remainingKm * 1000) / 1000,
          })),
          coveringZones: covering.map((d) => ({
            name: d.zone.name,
            distanceKm: Math.round(d.distanceKm * 1000) / 1000,
            radiusKm: d.zone.radiusKm,
            remainingKm: Math.round(d.remainingKm * 1000) / 1000,
          })),
          selectedZone: {
            name: selected.zone.name,
            isBorderline: isBorderlineV1,
            distanceKm: Math.round(selected.distanceKm * 1000) / 1000,
          },
          decision: {
            isOutsideService: false,
            reason: isBorderlineV1
              ? 'borderline_zone_selected'
              : 'inside_zone_selected',
          },
        }),
      );
    }
    // ============================================================
    // ⚠️ OUTPUT V2 ONLY — covering.length > 0.
    // MISMO patrón que el return anterior: todos los campos
    // derivan de v2* variables. selected / isBorderlineV1
    // / classified / covering.length NO influyen NADA en el
    // resultado final de esta función (solo están en logger).
    // ============================================================
    return {
      status: v2LegacyStatus,
      assignedZone: v2AssignedZoneName,
      isBorderline: v2IsBorderline,
      distanceSurcharge: v2IsBorderline,
      distanceKm: v2AssignedDistanceKm,
      lat,
      lng,
      coverageClassification: v2Classification,
      closestZoneName: v2Closest?.name ?? null,
      closestZoneDistanceKm: v2Closest?.distanceKm ?? null,
      v2BorderlineFeeApplicable: v2Coverage.feeApplicable,
      borderlineOutsideThresholdKmV2: v2Coverage.borderlineOutsideThresholdKm,
    };
  }

  private computeDistances(lat: number, lng: number): ZoneDistance[] {
    return this.zones.map((zone) => {
      const distanceKm = this.haversineKm(lat, lng, zone.lat, zone.lng);
      return { zone, distanceKm, remainingKm: zone.radiusKm - distanceKm };
    });
  }

  private filterZones(items: ZoneDistance[]): ZoneDistance[] {
    const epsilon =
      Number.isFinite(this.filterEpsilonKm) && this.filterEpsilonKm >= 0
        ? this.filterEpsilonKm
        : 0.05;
    return items.filter((i) => i.distanceKm <= i.zone.radiusKm + epsilon);
  }

  private classifyZones(items: ZoneDistance[]): {
    nonBorderline: ZoneDistance[];
    borderline: ZoneDistance[];
  } {
    const nonBorderline = items.filter(
      (i) => i.remainingKm > this.borderlineThresholdKm,
    );
    const borderline = items.filter(
      (i) => i.remainingKm <= this.borderlineThresholdKm,
    );
    return { nonBorderline, borderline };
  }

  private selectBestZone(classified: {
    nonBorderline: ZoneDistance[];
    borderline: ZoneDistance[];
  }): { selected: ZoneDistance; isBorderline: boolean } {
    const pickClosest = (items: ZoneDistance[]) =>
      items.reduce((prev, curr) =>
        prev.distanceKm < curr.distanceKm ? prev : curr,
      );

    if (classified.nonBorderline.length > 0) {
      return {
        selected: pickClosest(classified.nonBorderline),
        isBorderline: false,
      };
    }
    return { selected: pickClosest(classified.borderline), isBorderline: true };
  }

  // ========================================================================
  // V2 Coverage Classification — relación con el BOUNDARY (NO distance from center).
  // Preserva el comportamiento legacy V1 intacto.
  // ========================================================================

  /**
   * @internal Publicado únicamente para suites de testeo unitario.
   * La clasificación de cobertura V2 oficial la consume computeSurchargeInternal().
   *
   * ⚠️ PROHIBIDO FILTRAR `distances` ANTES DE LLAMAR ESTA FUNCIÓN.
   * distances DEBE contener las 10 zonas COMPLETAS (sin filterZones,
   * sin closest, sin slice). Si necesitas filtrar para logger legacy o flujos
   * antiguos, hazlo DESPUÉS de esta llamada. Cualquier filtrado previo rompe
   * la regla multi-zona "INSIDE > BORDERLINE > OUTSIDE".
   */
  classifyCoverageV2(distances: ZoneDistance[]): {
    classification: GeoCoverageClassificationV2;
    closestZone: { name: string; distanceKm: number; radiusKm: number } | null;
    assignedZone: { name: string; distanceKm: number; radiusKm: number } | null;
    feeApplicable: boolean;
    borderlineOutsideThresholdKm: number;
    debug: {
      insideZonesNames: string[];
      borderlineZonesNames: string[];
      outsideZonesNames: string[];
      totalEvaluated: number;
    };
  } {
    if (!distances || distances.length === 0) {
      return {
        classification: 'OUTSIDE',
        closestZone: null,
        assignedZone: null,
        feeApplicable: false,
        borderlineOutsideThresholdKm: this.BORDERLINE_OUTSIDE_THRESHOLD_V2_KM,
        debug: {
          insideZonesNames: [],
          borderlineZonesNames: [],
          outsideZonesNames: [],
          totalEvaluated: 0,
        },
      };
    }

    // ============================================================
    // VALIDACIÓN DEFENSIVA — Prevenir filtrado accidental.
    // SOLO con flag explícito GEO_PRICING_ASSERT_10_ZONES=1:
    //   Si distances.length > 0 PERO !== 10 → throw Error inmediato
    //   (alguien llamó a filterZones antes de classifyCoverageV2).
    // Por defecto OFF para no romper suites unitarias que prueban
    // escenarios reducidos (2 zonas, 1 zona) en test environment.
    // ============================================================
    const strictChecks = process.env.GEO_PRICING_ASSERT_10_ZONES === '1';
    if (strictChecks && distances.length > 0 && distances.length !== 10) {
      throw new Error(
        `classifyCoverageV2 requires exactly 10 zones (all zones). Got ${distances.length}. ` +
          `Possible PRE-filter bug: filterZones() or nearest slice called BEFORE classifyCoverageV2.`,
      );
    }

    const threshold = this.BORDERLINE_OUTSIDE_THRESHOLD_V2_KM;

    const insideZones = distances.filter(d => d.distanceKm <= d.zone.radiusKm);
    const borderlineZones = distances.filter(
      d => d.distanceKm > d.zone.radiusKm && d.distanceKm <= d.zone.radiusKm + threshold,
    );
    const outsideZones = distances.filter(
      d => d.distanceKm > d.zone.radiusKm + threshold,
    );

    let assigned: ZoneDistance | null = null;
    let classification: GeoCoverageClassificationV2;
    let feeApplicable = false;

    if (insideZones.length > 0) {
      classification = 'INSIDE';
      feeApplicable = false;
      assigned = insideZones.reduce<ZoneDistance | null>((acc, curr) => {
        if (!acc) return curr;
        return curr.distanceKm < acc.distanceKm ? curr : acc;
      }, null);
    } else if (borderlineZones.length > 0) {
      classification = 'BORDERLINE';
      feeApplicable = true;
      assigned = borderlineZones.reduce<ZoneDistance | null>((acc, curr) => {
        if (!acc) return curr;
        return curr.distanceKm < acc.distanceKm ? curr : acc;
      }, null);
    } else {
      classification = 'OUTSIDE';
      feeApplicable = false;
      assigned = distances.reduce<ZoneDistance | null>((acc, curr) => {
        if (!acc) return curr;
        return curr.distanceKm < acc.distanceKm ? curr : acc;
      }, null);
    }

    const overallClosest = distances.reduce<ZoneDistance | null>((acc, curr) => {
      if (!acc) return curr;
      return curr.distanceKm < acc.distanceKm ? curr : acc;
    }, null);

    const toShape = (zd: ZoneDistance | null) =>
      zd
        ? {
            name: zd.zone.name,
            distanceKm: Math.round(zd.distanceKm * 1000) / 1000,
            radiusKm: zd.zone.radiusKm,
          }
        : null;

    return {
      classification,
      closestZone: toShape(overallClosest),
      assignedZone: toShape(assigned),
      feeApplicable,
      borderlineOutsideThresholdKm: threshold,
      debug: {
        insideZonesNames: insideZones.map(d => d.zone.name),
        borderlineZonesNames: borderlineZones.map(d => d.zone.name),
        outsideZonesNames: outsideZones.map(d => d.zone.name),
        totalEvaluated: distances.length,
      },
    };
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLng = this.deg2rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        (Math.sin(dLng / 2) * Math.sin(dLng / 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }

  private isProd(): boolean {
    const nodeEnv =
      typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
    return nodeEnv === 'production';
  }

  private hasServerGeocodingKey(): boolean {
    return this.resolveGeocodingKey().source !== 'none';
  }

  private getServerGeocodingApiKey(): string {
    const resolved = this.resolveGeocodingKey();
    if (
      !this.fallbackWarningLogged &&
      (resolved.source === 'fallback_google_maps_api_key' ||
        resolved.source === 'fallback_google_api_key')
    ) {
      this.fallbackWarningLogged = true;
      this.logger.warn(
        JSON.stringify({
          event: 'geo.config_fallback_used',
          source: resolved.source,
          message:
            'Using fallback Google API key env var. Set GOOGLE_MAPS_SERVER_API_KEY.',
        }),
      );
    }
    return resolved.key;
  }

  private resolveGeocodingKey(): {
    key: string;
    source:
      | 'primary'
      | 'fallback_google_maps_api_key'
      | 'fallback_google_api_key'
      | 'none';
  } {
    if (this.resolvedGeocodingKey) return this.resolvedGeocodingKey;

    const primaryRaw =
      typeof process.env.GOOGLE_MAPS_SERVER_API_KEY === 'string'
        ? process.env.GOOGLE_MAPS_SERVER_API_KEY
        : '';
    const primary = primaryRaw.trim();
    if (primary) {
      this.resolvedGeocodingKey = { key: primary, source: 'primary' };
      return this.resolvedGeocodingKey;
    }

    const fallbackMapsRaw =
      typeof process.env.GOOGLE_MAPS_API_KEY === 'string'
        ? process.env.GOOGLE_MAPS_API_KEY
        : '';
    const fallbackMaps = fallbackMapsRaw.trim();
    if (fallbackMaps) {
      this.resolvedGeocodingKey = {
        key: fallbackMaps,
        source: 'fallback_google_maps_api_key',
      };
      return this.resolvedGeocodingKey;
    }

    const fallbackGoogleRaw =
      typeof process.env.GOOGLE_API_KEY === 'string'
        ? process.env.GOOGLE_API_KEY
        : '';
    const fallbackGoogle = fallbackGoogleRaw.trim();
    if (fallbackGoogle) {
      this.resolvedGeocodingKey = {
        key: fallbackGoogle,
        source: 'fallback_google_api_key',
      };
      return this.resolvedGeocodingKey;
    }

    this.resolvedGeocodingKey = { key: '', source: 'none' };
    return this.resolvedGeocodingKey;
  }

  private parseFiniteNumber(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : NaN;
    return Number.isFinite(n) ? n : null;
  }

  private isValidLatLng(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
    if (!ms) return promise;
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  }

  private async sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async fetchJsonWithTimeout(
    url: string,
    timeoutMsOverride?: number,
  ): Promise<unknown> {
    const timeoutMs =
      Number.isFinite(timeoutMsOverride) && (timeoutMsOverride as number) > 0
        ? (timeoutMsOverride as number)
        : Number.isFinite(this.geocodeTimeoutMs) && this.geocodeTimeoutMs > 0
          ? this.geocodeTimeoutMs
          : 3000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private isRetryableGeocodeFailure(result: GeocodeFail): boolean {
    return result.reason === 'api_unavailable';
  }

  private getMinimumAddressLength(): number {
    if (
      Number.isFinite(this.minimumAddressLength) &&
      this.minimumAddressLength > 0
    ) {
      return Math.trunc(this.minimumAddressLength);
    }
    return 10;
  }

  private getProviderFailureCooldownMs(): number {
    if (
      Number.isFinite(this.providerFailureCooldownMs) &&
      this.providerFailureCooldownMs > 0
    ) {
      return Math.trunc(this.providerFailureCooldownMs);
    }
    return 5 * 60 * 1000;
  }

  private shouldOpenProviderCooldown(result: GeocodeFail): boolean {
    return (
      result.reason === 'request_denied' || result.reason === 'quota_exceeded'
    );
  }

  private activateProviderCooldown(result: GeocodeFail): void {
    if (!this.shouldOpenProviderCooldown(result)) return;
    const cooldownMs = this.getProviderFailureCooldownMs();
    const until = Date.now() + cooldownMs;
    this.providerCooldown = {
      until,
      reason: result.reason,
      message: result.message,
    };
    this.logger.warn(
      JSON.stringify({
        event: 'geo.provider_cooldown_activated',
        reason: result.reason,
        cooldownMs,
        until: new Date(until).toISOString(),
      }),
    );
  }

  private clearProviderCooldown(): void {
    this.providerCooldown = null;
  }

  private getActiveProviderCooldown(): GeocodeProviderCooldownState | null {
    if (!this.providerCooldown) return null;
    if (Date.now() >= this.providerCooldown.until) {
      this.providerCooldown = null;
      return null;
    }
    return this.providerCooldown;
  }

  private getClientFacingGeocodeErrorMessage(result: GeocodeFail): string {
    if (result.reason === 'request_denied') {
      return 'Address verification is temporarily unavailable due to geocoding provider configuration.';
    }
    if (result.reason === 'quota_exceeded') {
      return 'Address verification is temporarily unavailable due to geocoding provider quota limits.';
    }
    return result.message;
  }

  private async geocodeAddress(
    address: string,
  ): Promise<GeocodeOk | GeocodeFail> {
    const providerCooldown = this.getActiveProviderCooldown();
    if (providerCooldown) {
      this.logger.warn(
        JSON.stringify({
          event: 'geo.provider_cooldown_active',
          reason: providerCooldown.reason,
          until: new Date(providerCooldown.until).toISOString(),
        }),
      );
      return {
        ok: false,
        reason: providerCooldown.reason,
        message: providerCooldown.message,
      };
    }

    const apiKey = this.getServerGeocodingApiKey();
    if (!apiKey) {
      return {
        ok: false,
        reason: 'api_unavailable',
        message: 'Geocoding unavailable',
      };
    }

    const input = `${address}, FL, USA`;
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(input) +
      '&key=' +
      encodeURIComponent(apiKey);

    const attemptOnce = async (
      attemptTimeoutMs: number,
    ): Promise<GeocodeOk | GeocodeFail> => {
      let data: unknown;
      try {
        data = await this.fetchJsonWithTimeout(url, attemptTimeoutMs);
      } catch {
        return {
          ok: false,
          reason: 'api_unavailable',
          message: 'Geocoding unavailable',
        };
      }

      const obj =
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
          : {};
      const status = typeof obj.status === 'string' ? obj.status : '';
      if (status === 'ZERO_RESULTS') {
        return {
          ok: false,
          reason: 'invalid_address',
          message: 'Invalid address',
        };
      }
      if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
        return {
          ok: false,
          reason: 'quota_exceeded',
          message: 'Geocoding quota exceeded',
        };
      }
      if (status === 'REQUEST_DENIED') {
        const errorMessage =
          typeof obj.error_message === 'string' ? obj.error_message.trim() : '';
        return {
          ok: false,
          reason: 'request_denied',
          message: errorMessage || 'Geocoding request denied',
        };
      }
      if (status !== 'OK') {
        return {
          ok: false,
          reason: 'api_unavailable',
          message: 'Geocoding unavailable',
        };
      }

      const results = Array.isArray(obj.results) ? obj.results : [];
      if (results.length === 0) {
        return {
          ok: false,
          reason: 'invalid_address',
          message: 'Invalid address',
        };
      }

      const result =
        typeof results[0] === 'object' && results[0] !== null
          ? (results[0] as Record<string, unknown>)
          : {};
      const comps = Array.isArray(result.address_components)
        ? result.address_components
        : [];
      const isInFlorida = comps.some(
        (c) =>
          typeof c === 'object' &&
          c !== null &&
          ((c as Record<string, unknown>).short_name === 'FL' ||
            (c as Record<string, unknown>).long_name === 'Florida'),
      );
      if (!isInFlorida) {
        return {
          ok: false,
          reason: 'invalid_address',
          message: 'Address must be in Florida',
        };
      }

      const geometry =
        typeof result.geometry === 'object' && result.geometry !== null
          ? (result.geometry as Record<string, unknown>)
          : {};
      const location =
        typeof geometry.location === 'object' && geometry.location !== null
          ? (geometry.location as Record<string, unknown>)
          : {};
      const lat = typeof location.lat === 'number' ? location.lat : null;
      const lng = typeof location.lng === 'number' ? location.lng : null;
      if (lat === null || lng === null || !this.isValidLatLng(lat, lng)) {
        return {
          ok: false,
          reason: 'api_unavailable',
          message: 'Geocoding unavailable',
        };
      }

      return { ok: true, lat, lng };
    };

    const totalTimeoutMs =
      Number.isFinite(this.geocodeTotalTimeoutMs) &&
      this.geocodeTotalTimeoutMs > 0
        ? this.geocodeTotalTimeoutMs
        : 5000;
    const deadline = Date.now() + totalTimeoutMs;

    for (let attempt = 0; attempt <= this.geocodeMaxRetries; attempt++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return {
          ok: false,
          reason: 'api_unavailable',
          message: 'Geocoding unavailable',
        };
      }
      const attemptTimeoutMs = Math.min(
        Math.max(250, this.geocodeTimeoutMs),
        remainingMs,
      );
      const result = await attemptOnce(attemptTimeoutMs);
      if (result.ok) {
        this.clearProviderCooldown();
        return result;
      }
      const canRetry =
        attempt < this.geocodeMaxRetries &&
        this.isRetryableGeocodeFailure(result);
      if (!canRetry) {
        this.activateProviderCooldown(result);
        return result;
      }
      const backoffMs = 250 * 2 ** attempt;
      if (deadline - Date.now() <= 0) return result;
      await this.sleep(Math.min(backoffMs, Math.max(0, deadline - Date.now())));
    }

    return {
      ok: false,
      reason: 'api_unavailable',
      message: 'Geocoding unavailable',
    };
  }

  private validateClientCoordinates(
    input: {
      inputAddress: string;
      clientLat: number;
      clientLng: number;
      serverLat: number;
      serverLng: number;
    },
    trace: boolean,
  ): { lat: number; lng: number } {
    const threshold =
      Number.isFinite(this.latLngMismatchThresholdKm) &&
      this.latLngMismatchThresholdKm > 0
        ? this.latLngMismatchThresholdKm
        : 1;
    const distanceKm = this.haversineKm(
      input.clientLat,
      input.clientLng,
      input.serverLat,
      input.serverLng,
    );

    if (distanceKm > threshold) {
      const isProd = process.env.NODE_ENV === 'production';
      this.logger.warn(
        JSON.stringify({
          event: 'geo.lat_lng_mismatch',
          inputAddress: !isProd && trace ? input.inputAddress : undefined,
          clientLatLng:
            !isProd && trace
              ? { lat: input.clientLat, lng: input.clientLng }
              : undefined,
          serverLatLng:
            !isProd && trace
              ? { lat: input.serverLat, lng: input.serverLng }
              : undefined,
          distanceKm: Math.round(distanceKm * 1000) / 1000,
          thresholdKm: threshold,
        }),
      );
      return { lat: input.serverLat, lng: input.serverLng };
    }

    if (trace) {
      const isProd = process.env.NODE_ENV === 'production';
      const includePii = !isProd;
      this.logger.log(
        JSON.stringify({
          event: 'geo.lat_lng_match',
          inputAddress: includePii ? input.inputAddress : undefined,
          clientLatLng: includePii
            ? { lat: input.clientLat, lng: input.clientLng }
            : undefined,
          serverLatLng: includePii
            ? { lat: input.serverLat, lng: input.serverLng }
            : undefined,
          distanceKm: Math.round(distanceKm * 1000) / 1000,
          thresholdKm: threshold,
        }),
      );
    }
    return { lat: input.clientLat, lng: input.clientLng };
  }

  private normalizeAddressForCache(address: string): string {
    return normalizeAddress(String(address ?? ''));
  }

  private async ensureRedisConnected(): Promise<ReturnType<
    typeof createClient
  > | null> {
    if (!this.redisUrl) return null;
    if (this.redis?.isOpen) return this.redis;
    if (this.redisConnectPromise) return this.redisConnectPromise;

    this.redisConnectPromise = (async () => {
      const client = createClient({ url: this.redisUrl });
      client.on('error', (err) => {
        this.logger.error(
          JSON.stringify({
            event: 'geo.redis_error',
            error:
              err instanceof Error
                ? { name: err.name, message: err.message }
                : String(err),
          }),
        );
      });

      const connectTimeoutMs = 2000;
      try {
        await Promise.race([
          client.connect(),
          new Promise<void>((_, reject) => {
            setTimeout(
              () => reject(new Error('redis_connect_timeout')),
              connectTimeoutMs,
            );
          }),
        ]);
      } catch {
        try {
          if (client.isOpen) await client.quit();
          else await client.disconnect();
        } catch {
          await client.disconnect();
        }
        this.redis = null;
        this.redisConnectPromise = null;
        return null;
      }

      this.redis = client;
      this.redisConnectPromise = null;
      return client;
    })();

    return this.redisConnectPromise;
  }

  private buildRedisCacheKey(normalizedAddress: string): string {
    const key = this.normalizeAddressForCache(normalizedAddress);
    return `${this.redisCacheKeyPrefix}${key}`;
  }

  private getCachedCoordinates(
    normalizedAddress: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const normalized = this.normalizeAddressForCache(normalizedAddress);
    if (!normalized) return Promise.resolve(null);
    return this.ensureRedisConnected()
      .then(async (redis) => {
        if (!redis) return null;
        const key = this.buildRedisCacheKey(normalized);
        const raw = await this.withTimeout(
          redis.get(key),
          this.redisCommandTimeoutMs,
        );
        if (!raw) return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return null;
        }
        const obj =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {};
        const lat = typeof obj.lat === 'number' ? obj.lat : null;
        const lng = typeof obj.lng === 'number' ? obj.lng : null;
        if (lat === null || lng === null || !this.isValidLatLng(lat, lng)) {
          return null;
        }
        return { lat, lng };
      })
      .catch(() => null);
  }

  private setCachedCoordinates(
    normalizedAddress: string,
    coords: { lat: number; lng: number },
  ): Promise<void> {
    const normalized = this.normalizeAddressForCache(normalizedAddress);
    if (!normalized) return Promise.resolve();
    const ttlMs =
      Number.isFinite(this.geocodeCacheTtlMs) && this.geocodeCacheTtlMs > 0
        ? this.geocodeCacheTtlMs
        : 24 * 60 * 60 * 1000;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    return this.ensureRedisConnected()
      .then(async (redis) => {
        if (!redis) return;
        const key = this.buildRedisCacheKey(normalized);
        await this.withTimeout(
          redis.set(key, JSON.stringify({ lat: coords.lat, lng: coords.lng }), {
            EX: ttlSeconds,
          }),
          this.redisCommandTimeoutMs,
        );
      })
      .catch(() => undefined);
  }

  private async getGeocodedCoordinates(
    address: string,
    trace: boolean,
  ): Promise<GeocodeOk | GeocodeFail> {
    const isProd = process.env.NODE_ENV === 'production';
    const includePii = trace && !isProd;
    const normalized = this.normalizeAddressForCache(address);
    const cached = await this.getCachedCoordinates(normalized);
    if (cached) {
      const payload = JSON.stringify({
        event: 'geo.geocode_cache_hit',
        address: includePii ? address : undefined,
        normalizedAddress: includePii ? normalized : undefined,
        serverLatLng: includePii
          ? { lat: cached.lat, lng: cached.lng }
          : undefined,
      });
      if (trace) this.logger.log(payload);
      else this.logger.debug(payload);
      return { ok: true, lat: cached.lat, lng: cached.lng };
    }

    const missPayload = JSON.stringify({
      event: 'geo.geocode_cache_miss',
      address: includePii ? address : undefined,
      normalizedAddress: includePii ? normalized : undefined,
    });
    if (trace) this.logger.log(missPayload);
    else this.logger.debug(missPayload);

    const result = await this.geocodeAddress(address);
    if (result.ok) {
      const okPayload = JSON.stringify({
        event: 'geo.geocode_api_ok',
        address: includePii ? address : undefined,
        serverLatLng: includePii
          ? { lat: result.lat, lng: result.lng }
          : undefined,
      });
      if (trace) this.logger.log(okPayload);
      else this.logger.debug(okPayload);
      await this.setCachedCoordinates(normalized, {
        lat: result.lat,
        lng: result.lng,
      });
    } else {
      const failPayload = JSON.stringify({
        event: 'geo.geocode_api_fail',
        address: includePii ? address : undefined,
        reason: result.reason,
        message: result.message,
      });
      if (trace) this.logger.warn(failPayload);
      else this.logger.debug(failPayload);
    }
    return result;
  }

  private isDebugModeEnabled(): boolean {
    const raw =
      typeof process.env.GEO_PRICING_DEBUG_MODE === 'string'
        ? process.env.GEO_PRICING_DEBUG_MODE.trim().toLowerCase()
        : '';
    return raw === 'true' || raw === '1';
  }

  private shouldTrace(): boolean {
    if (process.env.GEO_PRICING_TRACE === '1') return true;
    if (this.traceOnceRemaining) {
      this.traceOnceRemaining = false;
      return true;
    }
    return false;
  }
}
