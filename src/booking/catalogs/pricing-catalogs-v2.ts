/**
 * @file pricing-catalogs-v2.ts
 * @description Catálogos CENTRALIZADOS V2 del nuevo modelo de negocio ZCLEANUP.
 *
 * OBJETIVO:
 *  - Ser la ÚNICA fuente de verdad para:
 *    - Paquetes Regular Cleaning
 *    - Special Services (suplementos) con descripciones, includes, notas
 *    - Optional Extras aprobados
 *    - Compatibility Matrix (extras × services)
 *    - Fees (Borderline, Pets Service Notes $0)
 *    - Reglas de constraints (excluyentes, max qty)
 *
 * REGLAS INQUEBRANTABLES (usuario sección 3-8):
 *  - Regular Cleaning es BASE OBLIGATORIA. NO es checkbox.
 *  - Special Services = 0 ó 1 (máximo UNO). Son SUPLEMENTOS sobre Regular.
 *  - Extras = compatibles según COMPATIBILITY_MATRIX_V2.
 *  - Service Notes (pets / own products) SIEMPRE $0.
 *  - Move-In/Out incluye interior closets/oven/refrigerator, por lo tanto
 *    Closet Organization, Oven y Refrigerator son INCOMPATIBLES (sección 8).
 *  - Garage y Full Garage son MUTUAMENTE EXCLUYENTES.
 *  - Laundry = máximo 2 cargas.
 *  - Outside Window está disponible para TODOS los servicios.
 *
 * ESTE ARCHIVO NO TIENE LÓGICA DE CÁLCULO. Solo CONSTANTES y TIPOS.
 * El cálculo de pricing está en BookingService.calculatePricingBreakdownV2()
 */

export type PricingModelVersion = 'V1' | 'V2';

// ======================================================================
// 1. REGULAR CLEANING – PAQUETES BASE APROBADOS
// ======================================================================
// Sección 3 del usuario.
export const REGULAR_CLEANING_BASE_PRICES_V2: Record<string, number> = {
  '1/1': 110,
  '2/1': 130,
  '2/2': 130,
  '3/1': 150,
  '3/2': 150,
  '4/2': 180,
  '4/3': 180,
  '5/2': 200,
  '5/3': 210,
};

export interface RegularCleaningPackageV2 {
  id: string;
  bedrooms: number;
  bathrooms: number;
  basePrice: number;
  label: string;
}

export const REGULAR_CLEANING_PACKAGES_V2: RegularCleaningPackageV2[] = [
  {
    id: '1-1',
    bedrooms: 1,
    bathrooms: 1,
    basePrice: 110,
    label: '1 bed / 1 bath',
  },
  {
    id: '2-1',
    bedrooms: 2,
    bathrooms: 1,
    basePrice: 130,
    label: '2 bed / 1 bath',
  },
  {
    id: '2-2',
    bedrooms: 2,
    bathrooms: 2,
    basePrice: 130,
    label: '2 bed / 2 bath',
  },
  {
    id: '3-1',
    bedrooms: 3,
    bathrooms: 1,
    basePrice: 150,
    label: '3 bed / 1 bath',
  },
  {
    id: '3-2',
    bedrooms: 3,
    bathrooms: 2,
    basePrice: 150,
    label: '3 bed / 2 bath',
  },
  {
    id: '4-2',
    bedrooms: 4,
    bathrooms: 2,
    basePrice: 180,
    label: '4 bed / 2 bath',
  },
  {
    id: '4-3',
    bedrooms: 4,
    bathrooms: 3,
    basePrice: 180,
    label: '4 bed / 3 bath',
  },
  {
    id: '5-2',
    bedrooms: 5,
    bathrooms: 2,
    basePrice: 200,
    label: '5 bed / 2 bath',
  },
  {
    id: '5-3',
    bedrooms: 5,
    bathrooms: 3,
    basePrice: 210,
    label: '5 bed / 3 bath',
  },
];

export const EXTRA_BEDROOM_PRICE_V2 = 40;

// ======================================================================
// 2. SPECIAL SERVICES – SUPLEMENTOS APROBADOS
// ======================================================================
// Sección 4 del usuario. Contenido FUNCIONAL DEFINITIVO.
export type SpecialServiceIdV2 =
  | 'deep_home_cleaning'
  | 'move_in_out'
  | 'post_construction'
  | 'extreme_home_cleaning';

export interface SpecialServiceV2 {
  id: SpecialServiceIdV2;
  label: string;
  shortDescription: string;
  /** Descripción larga (modal ⓘ) */
  description: string;
  flatFee: number;
  /** Lista completa de lo que incluye (bullets modal ⓘ) */
  includes: string[];
  /** Lista completa de lo que NO incluye (bullets modal ⓘ) */
  doesNotInclude: string[];
  /** Aviso de protección cuando el servicio lo necesite */
  protectionNote?: string;
  /** IDs de extras INCOMPATIBLES porque el servicio ya los incluye.
   *  Son los que posteriormente mostrarán "Already included with this service"
   */
  incompatibleExtraIds: OptionalExtraIdV2[];
  /** IDs de extras que deben mostrar "Already included..." (porque el servicio
   *  los incluye conceptualmente; PUEDE coincidir con incompatibleExtraIds).
   *  Separado para que move_in_out (que incluye interior closets/oven/refri)
   *  muestre claramente que esos 3 extras ya vienen incluidos, aunque la
   *  organización de ropa siga siendo conceptualmente diferente.
   */
  includedExtraReasons?: Partial<Record<OptionalExtraIdV2, string>>;
}

export const SPECIAL_SERVICES_V2: Record<SpecialServiceIdV2, SpecialServiceV2> =
  {
    deep_home_cleaning: {
      id: 'deep_home_cleaning',
      label: 'Deep Home Cleaning',
      shortDescription:
        'Higher-level interior home cleaning for homes that need more attention than a regular cleaning, without becoming extreme cleaning or specialized work.',
      description:
        'Higher-level interior home cleaning for homes that need more attention than a regular cleaning, without becoming extreme cleaning or specialized work.',
      flatFee: 80,
      includes: [
        'Dusting de superficies accesibles.',
        'Limpieza de superficies y muebles accesibles.',
        'Aspirado de alfombras y tapetes.',
        'Barrido y fregado de suelos.',
        'Limpieza de puertas y marcos accesibles.',
        'Limpieza de interruptores y placas.',
        'Limpieza exterior de electrodomésticos.',
        'Limpieza de baños más detallada.',
        'Limpieza de cocina más detallada.',
        'Eliminación de polvo y suciedad acumulada en zonas accesibles.',
        'Atención adicional a esquinas, zócalos y áreas que normalmente reciben menos atención.',
      ],
      doesNotInclude: [
        'Interior de oven.',
        'Interior de refrigerator.',
        'Interior de closets.',
        'Organización de ropa o pertenencias.',
        'Limpieza de ventanas.',
        'Limpieza exterior de la vivienda.',
        'Garaje.',
        'Movimiento de muebles pesados.',
        'Limpieza post-construcción.',
        'Situaciones de acumulación extrema de suciedad, residuos o basura.',
      ],
      incompatibleExtraIds: ['heavy_furniture_moving'],
    },
    move_in_out: {
      id: 'move_in_out',
      label: 'Move-In / Move-Out Cleaning',
      shortDescription:
        'Includes closet interior, inside oven, inside refrigerator. Therefore these extras are NOT available separately.',
      description:
        'Cleaning designed to leave a home ready for move-in or after moving out.',
      flatFee: 75,
      includes: [
        'Dusting de superficies.',
        'Aspirado.',
        'Barrido y fregado.',
        'Limpieza de baños.',
        'Limpieza de cocina.',
        'Limpieza de puertas y marcos accesibles.',
        'Limpieza de zócalos accesibles.',
        'Limpieza de armarios/closets interiores.',
        'Interior de oven.',
        'Interior de refrigerator.',
        'Limpieza de superficies interiores de la vivienda.',
      ],
      doesNotInclude: [
        'Limpieza de ventanas.',
        'Limpieza exterior de la vivienda.',
        'Garaje.',
        'Limpieza post-construcción.',
        'Movimiento de muebles pesados.',
        'Eliminación de grandes cantidades de basura.',
        'Limpieza de objetos personales que permanezcan en la vivienda.',
        'Tratamiento especializado de manchas permanentes, moho, grasa extrema, etc.',
      ],
      incompatibleExtraIds: ['closet_organization', 'oven', 'refrigerator'],
      includedExtraReasons: {
        closet_organization:
          'Interior de closets ya incluido. Nota: organizar ropa/pertenencias NO está incluido.',
        oven: 'Interior de oven ya incluido con este servicio.',
        refrigerator: 'Interior de refrigerator ya incluido con este servicio.',
      },
    },
    post_construction: {
      id: 'post_construction',
      label: 'Post-Construction Cleaning',
      shortDescription:
        'Post-construction heavy cleaning add-on over Regular Cleaning base.',
      description:
        'Interior cleaning after construction, remodeling, or renovation.',
      flatFee: 200,
      includes: [
        'Eliminación de polvo de construcción.',
        'Aspirado detallado de superficies.',
        'Barrido y fregado de suelos.',
        'Limpieza de superficies accesibles.',
        'Limpieza de puertas y marcos.',
        'Limpieza de zócalos.',
        'Limpieza de baños.',
        'Limpieza de cocina.',
        'Limpieza de polvo en áreas de difícil acceso razonablemente accesibles.',
        'Limpieza de residuos ligeros de construcción.',
        'Preparación general de la vivienda para su uso.',
      ],
      doesNotInclude: [
        'Retirada de grandes cantidades de escombros.',
        'Retirada de materiales de construcción.',
        'Demolición.',
        'Retirada de muebles pesados.',
        'Limpieza exterior.',
        'Ventanas exteriores o trabajos en altura.',
        'Eliminación profesional de pintura, cemento, adhesivos o materiales endurecidos.',
        'Moho, asbestos u otros materiales peligrosos.',
        'Trabajos que requieran herramientas o equipos especializados.',
      ],
      protectionNote:
        'Heavy construction debris or specialized cleaning may require a separate quote.',
      incompatibleExtraIds: [
        'closet_organization',
        'laundry',
        'garage',
        'full_garage',
      ],
    },
    extreme_home_cleaning: {
      id: 'extreme_home_cleaning',
      label: 'Extreme Home Cleaning',
      shortDescription:
        'Intensive whole-home cleaning for homes requiring significantly more attention than regular or deep cleaning. It is NOT unlimited regardless of condition.',
      description:
        'Intensive whole-home cleaning for homes requiring significantly more attention than regular or deep cleaning. It is NOT unlimited regardless of condition.',
      flatFee: 250,
      includes: [
        'Limpieza intensiva de superficies.',
        'Dusting detallado.',
        'Aspirado profundo.',
        'Barrido y fregado.',
        'Limpieza intensiva de baños.',
        'Limpieza intensiva de cocina.',
        'Limpieza de puertas y marcos.',
        'Limpieza de zócalos accesibles.',
        'Eliminación de acumulación significativa de polvo y suciedad.',
        'Limpieza de áreas normalmente difíciles de mantener.',
        'Atención especial a grasa y suciedad acumulada.',
        'Limpieza general intensiva de todas las áreas interiores.',
      ],
      doesNotInclude: [
        'Windows.',
        'Exterior de la vivienda.',
        'Garaje.',
        'Movimiento de muebles pesados.',
        'Grandes cantidades de basura.',
        'Retirada de escombros.',
        'Biohazards.',
        'Moho severo.',
        'Plagas.',
        'Materiales peligrosos.',
        'Limpieza especializada que requiera maquinaria especial.',
        'Servicios de organización.',
        'Lavado de ropa.',
        'Limpieza de pertenencias personales.',
      ],
      protectionNote:
        'Homes with extreme accumulation of trash, hazardous materials, biohazards, severe mold, or conditions requiring specialized equipment may require an additional assessment and quote.',
      incompatibleExtraIds: [
        'closet_organization',
        'laundry',
        'garage',
        'full_garage',
      ],
    },
  };

// ======================================================================
// 3. OPTIONAL EXTRAS – CATÁLOGO APROBADO
// ======================================================================
// Sección 6 del usuario (contenido funcional definitivo).
export type OptionalExtraIdV2 =
  | 'closet_organization'
  | 'oven'
  | 'refrigerator'
  | 'laundry'
  | 'garage'
  | 'full_garage'
  | 'heavy_furniture_moving'
  | 'same_day'
  | 'outside_window';

export interface OptionalExtraV2 {
  id: OptionalExtraIdV2;
  label: string;
  /** Sub-label corto mostrado bajo el label cuando exista (ej: "Subject to availability") */
  helperLabel?: string;
  unitPrice: number;
  /** 'bool' = checkbox sin qty (qty fija 1). 'qty' = el usuario introduce cantidad. */
  kind: 'bool' | 'qty';
  /** Si kind='qty', el máximo permitido por el usuario. Undefined = sin límite
   *  específico (aunque otras reglas lo controlen). */
  maxQuantity?: number;
  /** Si kind='qty' valor por defecto mínimo. */
  minQuantity?: number;
  /** Unidad mostrada al usuario. */
  unitLabel?: string;
  /** Indica que el precio por unidad está ya aprobado como $0 (ej: info-only).
   *  Normalmente este campo será false en extras. */
  infoOnly?: boolean;
}

export const OPTIONAL_EXTRAS_V2: Record<OptionalExtraIdV2, OptionalExtraV2> = {
  closet_organization: {
    id: 'closet_organization',
    label: 'Closet / Clothes Organization',
    unitPrice: 25,
    kind: 'bool',
  },
  oven: {
    id: 'oven',
    label: 'Oven',
    unitPrice: 25,
    kind: 'bool',
  },
  refrigerator: {
    id: 'refrigerator',
    label: 'Refrigerator',
    unitPrice: 25,
    kind: 'bool',
  },
  laundry: {
    id: 'laundry',
    label: 'Laundry',
    unitPrice: 15,
    kind: 'qty',
    minQuantity: 1,
    maxQuantity: 2,
    unitLabel: 'loads',
  },
  garage: {
    id: 'garage',
    label: 'Garage',
    unitPrice: 30,
    kind: 'bool',
  },
  full_garage: {
    id: 'full_garage',
    label: 'Full Garage',
    unitPrice: 70,
    kind: 'bool',
  },
  heavy_furniture_moving: {
    id: 'heavy_furniture_moving',
    label: 'Heavy Furniture Moving / Cleaning',
    unitPrice: 25,
    kind: 'qty',
    minQuantity: 1,
    maxQuantity: 2,
    unitLabel: 'items',
  },
  same_day: {
    id: 'same_day',
    label: 'Same-Day / Urgent',
    helperLabel: 'Subject to availability',
    unitPrice: 20,
    kind: 'bool',
  },
  outside_window: {
    id: 'outside_window',
    label: 'Outside Window',
    unitPrice: 7,
    kind: 'qty',
    minQuantity: 1,
    unitLabel: 'windows',
  },
};

// ======================================================================
// 4. CONSTRAINTS ENTRE EXTRAS
// ======================================================================
// Grupo: Garage / Full Garage = MUTUAMENTE EXCLUYENTES (sección 6).
export const MUTUALLY_EXCLUSIVE_EXTRA_GROUPS_V2: OptionalExtraIdV2[][] = [
  ['garage', 'full_garage'],
];

// Máximos por extra (redundante con el propio extra, pero listado centralizado
// para validación rápida).
export const EXTRA_MAX_QUANTITY_V2: Partial<Record<OptionalExtraIdV2, number>> =
  {
    laundry: 2,
    heavy_furniture_moving: 2,
  };

// ======================================================================
// 5. COMPATIBILITY MATRIX V2
// ======================================================================
// Sección 7 del usuario. Matriz explícita:
//
// | Extra | Regular | Deep | Move-In/Out | Post-Construction | Extreme |
// |---|---|---|---|---|---|
// | Closet / Organization | YES | YES | NO | NO | NO |
// | Oven | YES | YES | NO | YES | YES |
// | Refrigerator | YES | YES | NO | YES | YES |
// | Laundry | YES | YES | YES | NO | NO |
// | Garage | YES | YES | YES | NO | NO |
// | Full Garage | YES | YES | YES | NO | NO |
// | Heavy Furniture | YES | NO | NO | NO | NO |
// | Same-Day / Urgent | YES | YES | YES | YES | YES |
// | Outside Window | YES | YES | YES | YES | YES |
//
// SpecialServiceMissing significa "NO Special Service seleccionado" =
// solo Regular Cleaning solo.

export type CompatibilityContextV2 = 'regular_only' | SpecialServiceIdV2;

export const COMPATIBILITY_MATRIX_V2: Record<
  OptionalExtraIdV2,
  Record<CompatibilityContextV2, boolean>
> = {
  closet_organization: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: false,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  oven: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: false,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  refrigerator: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: false,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  laundry: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  garage: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  full_garage: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  heavy_furniture_moving: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  same_day: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
  outside_window: {
    regular_only: true,
    deep_home_cleaning: true,
    move_in_out: true,
    post_construction: true,
    extreme_home_cleaning: true,
  },
};

/**
 * Helper rápido para consultar la matriz. Devuelve true cuando un extra es
 * compatible con el contexto seleccionado (Regular solo o + Special Service).
 * Si el Special Service tiene incompatibleExtraIds (ej: MoveIn/Out), esos
 * IDs DEVUELVEN FALSE de forma determinista independientemente de la matriz.
 */
export function isExtraCompatibleV2(
  extraId: OptionalExtraIdV2,
  specialServiceId: SpecialServiceIdV2 | null,
): boolean {
  const context: CompatibilityContextV2 = specialServiceId ?? 'regular_only';
  const matrixValue = COMPATIBILITY_MATRIX_V2[extraId]?.[context] ?? false;
  if (!matrixValue) return false;

  if (specialServiceId) {
    const ss = SPECIAL_SERVICES_V2[specialServiceId];
    if (ss?.incompatibleExtraIds.includes(extraId)) return false;
  }
  return true;
}

/**
 * Devuelve el motivo literal por el que un extra no está disponible (o empty string si OK).
 * Motivos:
 *  - "Already included with this service." + motivo específico si existe
 *  - "Not compatible with the selected service."
 *  - "Not compatible with Garage / Full Garage (only one can be selected)."
 *  - "" = disponible
 * Usado en backend (validate) y frontend (helper tooltip).
 */
export function explainExtraUnavailabilityV2(
  extraId: OptionalExtraIdV2,
  specialServiceId: SpecialServiceIdV2 | null,
  selectedExtras: Set<OptionalExtraIdV2>,
): string {
  // 1) Incompatible por Included del Special Service (ej: Move incluye oven/refri/closets)
  if (specialServiceId) {
    const ss = SPECIAL_SERVICES_V2[specialServiceId];
    if (ss?.incompatibleExtraIds.includes(extraId)) {
      const customReason = ss.includedExtraReasons?.[extraId];
      return customReason ?? 'Already included with this service.';
    }
  }

  // 2) Compatibility Matrix
  const context: CompatibilityContextV2 = specialServiceId ?? 'regular_only';
  if (!COMPATIBILITY_MATRIX_V2[extraId]?.[context]) {
    return 'Not compatible with the selected service.';
  }

  // 3) Mutual Exclusive (Garage↔Full Garage)
  for (const group of MUTUALLY_EXCLUSIVE_EXTRA_GROUPS_V2) {
    if (group.includes(extraId)) {
      const other = group.find((e) => e !== extraId);
      if (other && selectedExtras.has(other)) {
        return `Not compatible with ${OPTIONAL_EXTRAS_V2[other].label} (only one can be selected).`;
      }
    }
  }

  return '';
}

// ======================================================================
// 6. SERVICE NOTES (SIEMPRE $0)
// ======================================================================
// Sección 9 del usuario. No son extras.
export interface ServiceNotesV2 {
  petsAtHome?: boolean;
  useOwnProducts?: boolean;
}

export const SERVICE_NOTES_LABELS_V2 = {
  petsAtHome: 'Pets at home',
  petsAtHomeHelper: 'Please take precautions.',
  useOwnProducts: 'Customer uses own cleaning products',
  useOwnProductsHelper:
    'Customer prefers the team to use their own cleaning products.',
} as const;

export const SERVICE_NOTES_FEE_V2 = 0;

// ======================================================================
// 7. BORDERLINE / COVERAGE – CLASIFICACIÓN V2
// ======================================================================
// Sección 10 del usuario.
export type CoverageClassificationV2 = 'INSIDE' | 'BORDERLINE' | 'OUTSIDE';

export const BORDERLINE_MAX_OUTSIDE_KM_V2 = 1; // ≤ 1 km fuera de boundary → borderline
export const BORDERLINE_FEE_AMOUNT_V2 = 25;
export const INSIDE_COVERAGE_FEE_V2 = 0;

// ======================================================================
// 8. CUSTOM QUOTE / SOLICITUD ESPECIAL – RUTA INDEPENDIENTE
// ======================================================================
// Sección 11. Info mostrada en links y navegación.
export const CUSTOM_QUOTE_ROUTE_PATH = '/custom-quote';
export const CUSTOM_QUOTE_MENU_LABEL = 'Custom Quote / Solicitud Especial';
export const CUSTOM_QUOTE_DESCRIPTIONS = [
  'Partial cleaning',
  'Unusual requests',
  'Requests outside the standard service catalog',
  'Partial post-construction work',
  'One-room cleaning',
  'One-bathroom cleaning',
  'Partial kitchen remodeling cleanup',
  'Other requests requiring evaluation',
] as const;

// ======================================================================
// 9. DISPLAY LABELS PARA ESPECIAL SERVICES / EXTRAS
// ======================================================================
// Usados por emails y admin display en V2 (análogo a getDisplayServiceLabel legacy).
export function getDisplaySpecialServiceLabelV2(
  id: SpecialServiceIdV2 | string | null | undefined,
): string {
  if (!id) return '';
  const ss = SPECIAL_SERVICES_V2[id as SpecialServiceIdV2];
  if (ss) return ss.label;
  return id;
}

export function getDisplayExtraLabelV2(
  id: OptionalExtraIdV2 | string | null | undefined,
): string {
  if (!id) return '';
  const ex = OPTIONAL_EXTRAS_V2[id as OptionalExtraIdV2];
  if (ex) return ex.label;
  return id;
}

export function getDisplayRegularPackageLabelV2(
  bedrooms: number,
  bathrooms: number,
): string {
  return `${bedrooms} bed / ${bathrooms} bath`;
}
