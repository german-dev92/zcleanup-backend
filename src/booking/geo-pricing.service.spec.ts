import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { GeoPricingService, ZoneDistance, CoverageZone } from './geo-pricing.service';

const mockZone = (name: string, radiusKm: number): CoverageZone => ({
  name,
  radiusKm,
  lat: 0,
  lng: 0,
});

const zd = (zoneName: string, radiusKm: number, distanceKm: number): ZoneDistance => ({
  zone: mockZone(zoneName, radiusKm),
  distanceKm,
  remainingKm: radiusKm - distanceKm,
});

describe('GeoPricingService — classifyCoverageV2 coverage rules (zones multi priority)', () => {
  let service: GeoPricingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GeoPricingService,
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<GeoPricingService>(GeoPricingService);
  });

  describe('Defensivo — 10 zonas obligatorias (GEO_PRICING_ASSERT_10_ZONES)', () => {
    it('[TR-1.1] Flag GEO_PRICING_ASSERT_10_ZONES=1 + 9 zonas => throw Error pre-filter bug', () => {
      const prevStrict = process.env.GEO_PRICING_ASSERT_10_ZONES;
      process.env.GEO_PRICING_ASSERT_10_ZONES = '1';
      try {
        const distances9: ZoneDistance[] = Array.from({ length: 9 }, (_, i) =>
          zd(`Z${i}`, 10, 5),
        );
        expect(() => service.classifyCoverageV2(distances9)).toThrow(
          /classifyCoverageV2 requires exactly 10 zones.*Got 9.*Possible PRE-filter bug/,
        );
      } finally {
        if (prevStrict === undefined) delete process.env.GEO_PRICING_ASSERT_10_ZONES;
        else process.env.GEO_PRICING_ASSERT_10_ZONES = prevStrict;
      }
    });

    it('Flag OFF (default) + 9 zonas => NO throw, ejecuta clasificación normal', () => {
      const prevStrict = process.env.GEO_PRICING_ASSERT_10_ZONES;
      delete process.env.GEO_PRICING_ASSERT_10_ZONES;
      try {
        const distances9: ZoneDistance[] = Array.from({ length: 9 }, (_, i) =>
          zd(`Z${i}`, 10, 5),
        );
        expect(() => service.classifyCoverageV2(distances9)).not.toThrow();
        const r = service.classifyCoverageV2(distances9);
        expect(r.classification).toBe('INSIDE');
        expect(r.debug.totalEvaluated).toBe(9);
      } finally {
        if (prevStrict !== undefined) process.env.GEO_PRICING_ASSERT_10_ZONES = prevStrict;
      }
    });
  });

  it('Test 1 — INSIDE siempre prevalece aunque otra zona más cercana sea BORDERLINE (Oldsmar/Palm Harbor caso)', () => {
    const distances: ZoneDistance[] = [
      zd('Oldsmar', 9, 9.4),
      zd('Palm Harbor', 11, 10.5),
    ];
    const result = service.classifyCoverageV2(distances);
    expect(result.classification).toBe('INSIDE');
    expect(result.feeApplicable).toBe(false);
    expect(result.assignedZone?.name).toBe('Palm Harbor');
    expect(result.closestZone?.name).toBe('Oldsmar');
    // Debug: 2 zonas evaluadas
    expect(result.debug.totalEvaluated).toBe(2);
    expect(result.debug.insideZonesNames).toEqual(['Palm Harbor']);
    expect(result.debug.borderlineZonesNames).toEqual(['Oldsmar']);
    expect(result.debug.outsideZonesNames).toEqual([]);
    expect(
      [...result.debug.insideZonesNames, ...result.debug.borderlineZonesNames, ...result.debug.outsideZonesNames].length,
    ).toBe(2);
  });

  it('Test 2 — BORDERLINE si ninguna zona es INSIDE pero al menos una entra en el 1km threshold', () => {
    const distances: ZoneDistance[] = [
      zd('Oldsmar', 9, 9.4),
      zd('Palm Harbor', 11, 12.001),
    ];
    const result = service.classifyCoverageV2(distances);
    expect(result.classification).toBe('BORDERLINE');
    expect(result.feeApplicable).toBe(true);
    expect(result.assignedZone?.name).toBe('Oldsmar');
    expect(result.closestZone?.name).toBe('Oldsmar');
    expect(result.debug.totalEvaluated).toBe(2);
    expect(result.debug.insideZonesNames).toEqual([]);
    expect(result.debug.borderlineZonesNames).toEqual(['Oldsmar']);
    expect(result.debug.outsideZonesNames).toEqual(['Palm Harbor']);
  });

  it('Test 3 — OUTSIDE si todas las zonas superan radius + 1 km', () => {
    const distances: ZoneDistance[] = [
      zd('Oldsmar', 9, 10.1),
      zd('Palm Harbor', 11, 12.1),
    ];
    const result = service.classifyCoverageV2(distances);
    expect(result.classification).toBe('OUTSIDE');
    expect(result.feeApplicable).toBe(false);
    expect(result.assignedZone?.name).toBe('Oldsmar');
    expect(result.closestZone?.name).toBe('Oldsmar');
    expect(result.debug.totalEvaluated).toBe(2);
    expect(result.debug.insideZonesNames).toEqual([]);
    expect(result.debug.borderlineZonesNames).toEqual([]);
    expect(result.debug.outsideZonesNames).toEqual(['Oldsmar', 'Palm Harbor']);
  });

  describe('Test límites exactos 1km threshold (R=radius)', () => {
    const zone = (d: number) => [zd('Tampa', 22, d)];
    const expectAt = (
      distance: number,
      expected: 'INSIDE' | 'BORDERLINE' | 'OUTSIDE',
      fee: boolean,
    ) => {
      const result = service.classifyCoverageV2(zone(distance));
      expect(result.classification).toBe(expected);
      expect(result.feeApplicable).toBe(fee);
      // Debug: totalEvaluated=1 y counts consistentes
      expect(result.debug.totalEvaluated).toBe(1);
      const all = [
        ...result.debug.insideZonesNames,
        ...result.debug.borderlineZonesNames,
        ...result.debug.outsideZonesNames,
      ];
      expect(all.length).toBe(1);
    };

    it('distance = radius → INSIDE (boundary inclusive inside)', () => {
      expectAt(22, 'INSIDE', false);
    });
    it('distance = radius + 0.001 → BORDERLINE', () => {
      expectAt(22 + 0.001, 'BORDERLINE', true);
    });
    it('distance = radius + 0.500 → BORDERLINE', () => {
      expectAt(22 + 0.5, 'BORDERLINE', true);
    });
    it('distance = radius + 0.999 → BORDERLINE', () => {
      expectAt(22 + 0.999, 'BORDERLINE', true);
    });
    it('distance = radius + 1.000 → BORDERLINE (1km inclusive)', () => {
      expectAt(22 + 1, 'BORDERLINE', true);
    });
    it('distance = radius + 1.001 → OUTSIDE (excede threshold)', () => {
      expectAt(22 + 1.001, 'OUTSIDE', false);
    });
  });

  describe('Solapamiento multi-zona (INSIDE > BORDERLINE > OUTSIDE, combinaciones)', () => {
    it('INSIDE + BORDERLINE => INSIDE / $0 (nunca cobra borderline)', () => {
      const d = [
        zd('A', 9, 9.4),
        zd('B', 11, 10.5),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('INSIDE');
      expect(r.feeApplicable).toBe(false);
      expect(r.assignedZone?.name).toBe('B');
      expect(r.debug.totalEvaluated).toBe(2);
      expect(r.debug.insideZonesNames).toEqual(['B']);
      expect(r.debug.borderlineZonesNames).toEqual(['A']);
    });

    it('BORDERLINE + INSIDE (orden inverso) => INSIDE / $0 (INSIDE gana sin importar orden)', () => {
      const d = [
        zd('B', 11, 10.5), // B inside (más cerca)
        zd('A', 9, 9.4),   // A borderline (más cerca global? 9.4 < 10.5)
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('INSIDE');
      expect(r.feeApplicable).toBe(false);
      expect(r.assignedZone?.name).toBe('B');
      expect(r.closestZone?.name).toBe('A'); // 9.4 < 10.5
      expect(r.debug.totalEvaluated).toBe(2);
    });

    it('INSIDE + OUTSIDE => INSIDE / $0', () => {
      const d = [
        zd('A', 9, 10.2),
        zd('B', 11, 10.5),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('INSIDE');
      expect(r.feeApplicable).toBe(false);
      expect(r.assignedZone?.name).toBe('B');
      expect(r.debug.totalEvaluated).toBe(2);
      expect(r.debug.outsideZonesNames).toEqual(['A']);
    });

    it('INSIDE + INSIDE => INSIDE / $0 (escoge la más cercana del grupo)', () => {
      const d = [
        zd('A', 9, 8),
        zd('B', 11, 9.5),
        zd('C', 22, 10),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('INSIDE');
      expect(r.feeApplicable).toBe(false);
      const insideDistances = d.filter(z => z.distanceKm <= z.zone.radiusKm).map(z => z.distanceKm);
      const minInside = Math.min(...insideDistances);
      expect(r.assignedZone?.distanceKm).toBeCloseTo(minInside, 6);
      expect(r.debug.totalEvaluated).toBe(3);
      expect(r.debug.insideZonesNames.sort()).toEqual(['A', 'B', 'C'].sort());
    });

    it('BORDERLINE + BORDERLINE => BORDERLINE / $25 (escoge el más cercano del grupo)', () => {
      const d = [
        zd('A', 9, 9.2),
        zd('B', 11, 11.8),
        zd('C', 22, 22.6),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('BORDERLINE');
      expect(r.feeApplicable).toBe(true);
      expect(r.assignedZone?.name).toBe('A');
      expect(r.debug.totalEvaluated).toBe(3);
      expect(r.debug.borderlineZonesNames.sort()).toEqual(['A', 'B', 'C'].sort());
    });

    it('BORDERLINE + BORDERLINE + OUTSIDE => BORDERLINE +$25 (combinación requerida A=B B=B C=O)', () => {
      const d = [
        zd('Zona A', 10, 10.5), // B
        zd('Zona B', 12, 12.7), // B
        zd('Zona C', 8, 10),    // O (8+1=9 <10)
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('BORDERLINE');
      expect(r.feeApplicable).toBe(true);
      expect(r.assignedZone?.name).toBe('Zona A'); // 10.5 < 12.7
      expect(r.debug.totalEvaluated).toBe(3);
      expect(r.debug.insideZonesNames).toEqual([]);
      expect(r.debug.borderlineZonesNames.sort()).toEqual(['Zona A', 'Zona B'].sort());
      expect(r.debug.outsideZonesNames).toEqual(['Zona C']);
    });

    it('BORDERLINE + OUTSIDE => BORDERLINE / $25 (ninguna inside)', () => {
      const d = [
        zd('A', 9, 10.2),
        zd('B', 11, 11.9),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('BORDERLINE');
      expect(r.feeApplicable).toBe(true);
      expect(r.assignedZone?.name).toBe('B');
      expect(r.debug.totalEvaluated).toBe(2);
    });

    it('OUTSIDE + OUTSIDE => OUTSIDE (ninguna inside, ninguna borderline)', () => {
      const d = [
        zd('A', 9, 11),
        zd('B', 11, 13),
      ];
      const r = service.classifyCoverageV2(d);
      expect(r.classification).toBe('OUTSIDE');
      expect(r.feeApplicable).toBe(false);
      expect(r.debug.totalEvaluated).toBe(2);
      expect(r.debug.insideZonesNames.length + r.debug.borderlineZonesNames.length).toBe(0);
    });
  });

  it('Caso Cheval (Tampa BORDERLINE, Odessa INSIDE) clasifica INSIDE correctamente', () => {
    const distances: ZoneDistance[] = [
      zd('Tampa', 22, 22.5),
      zd('Odessa', 15, 14.8),
    ];
    const result = service.classifyCoverageV2(distances);
    expect(result.classification).toBe('INSIDE');
    expect(result.assignedZone?.name).toBe('Odessa');
    expect(result.closestZone?.name).toBe('Odessa');
    expect(result.feeApplicable).toBe(false);
    expect(result.debug.totalEvaluated).toBe(2);
    expect(result.debug.insideZonesNames).toEqual(['Odessa']);
    expect(result.debug.borderlineZonesNames).toEqual(['Tampa']);
  });

  it('Retorna constante BORDERLINE_OUTSIDE_THRESHOLD_V2_KM = 1 km centralizada', () => {
    const distances: ZoneDistance[] = [zd('Test', 10, 10)];
    const result = service.classifyCoverageV2(distances);
    expect(result.borderlineOutsideThresholdKm).toBe(1);
  });

  describe('[TR-2.1] computeSurcharge covering=[] (filterZones vacío por epsilon 50m) PERO hay borderline R+0.3 → devuelve BORDERLINE (V2 NO depende de V1 covering)', () => {
    it('1 zona B con 10.3 (R=10) + 9 zonas O => classification=BORDERLINE aunque covering=[]', () => {
      // Fake 10 zones con spy: 1 sola borderline 10.3, resto distance=20 (> R+1 OUTSIDE)
      const distances10: ZoneDistance[] = [
        zd('Z0_Borderline', 10, 10.3), // R+0.3 > R+0.05 → filterZones lo quita.
        zd('Z1', 5, 20), zd('Z2', 5, 20), zd('Z3', 5, 20), zd('Z4', 5, 20),
        zd('Z5', 5, 20), zd('Z6', 5, 20), zd('Z7', 5, 20), zd('Z8', 5, 20), zd('Z9', 5, 20),
      ];
      const origCompute = (service as any).computeDistances;
      (service as any).computeDistances = jest.fn(() => distances10);
      try {
        // computeSurcharge es publico: llama computeSurchargeInternal -> computeDistances mock.
        const result = service.computeSurcharge(0, 0);
        // Resultado debe ser BORDERLINE según V2:
        expect(result.coverageClassification).toBe('BORDERLINE');
        expect(result.status).toBe('borderline');
        expect(result.isBorderline).toBe(true);
        expect(result.distanceSurcharge).toBe(true);
        expect(result.v2BorderlineFeeApplicable).toBe(true);
        expect(result.borderlineOutsideThresholdKmV2).toBe(1);
        // assigned y closest = Z0_Borderline (único B, min distance global también)
        expect(result.assignedZone).toBe('Z0_Borderline');
        expect(result.closestZoneName).toBe('Z0_Borderline');
      } finally {
        (service as any).computeDistances = origCompute;
      }
    });
  });
});
