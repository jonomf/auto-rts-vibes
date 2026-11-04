/**
 * Entity catalog: Starcraft (Terran) names and roles, stats scaled to this game's clock
 * (build times are roughly half of SC2's; distances are world units).
 *
 * Units of measure: distances in world units, speeds in units/second, times in seconds.
 */

export type ResourceType = 'minerals' | 'gas';

export type Cost = { minerals: number; gas: number };

/** SC2-style attributes. Bonus damage and some abilities key off these. */
export type Tag = 'light' | 'armored' | 'bio' | 'mech' | 'structure' | 'massive';

export type Attack = {
  range: number; // edge-to-edge distance
  /** Damage per hit, before armor. */
  damage: number;
  /** Extra damage per hit against targets with this attribute. */
  bonus?: { vs: Tag; damage: number };
  /** Hits per volley (armor applies to each hit). */
  hits?: number;
  cooldown: number; // seconds between volleys
  hitsGround: boolean;
  hitsAir: boolean;
  /** Splash radius around the target: full damage inside `full`, half to `radius`. */
  splash?: { full: number; radius: number };
  /** Can't fire at targets closer than this (sieged tanks). */
  minRange?: number;
  /** Slows the target's movement (Marauder concussive shells). */
  slow?: number;
};

export type AddonId = 'techLab' | 'reactor';

export type DefId =
  // Buildings
  | 'commandCenter'
  | 'supplyDepot'
  | 'refinery'
  | 'barracks'
  | 'factory'
  | 'starport'
  | AddonId
  // Units
  | 'scv'
  | 'marine'
  | 'marauder'
  | 'medic'
  | 'hellion'
  | 'siegeTank'
  | 'viking'
  | 'medivac'
  | 'banshee'
  // Resources
  | 'mineralSource'
  | 'gasSource'
  // Enemy-only (scenarios)
  | 'zergling'
  | 'bunker'
  | 'missileTurret'
  | 'dummy'
  | 'dummyBunker';

export type Category = 'unit' | 'building' | 'resource';

export type Def = {
  id: DefId;
  name: string;
  category: Category;
  /** Units: circle radius. Buildings & resources: half the side of the square footprint. */
  radius: number;
  hp: number;
  armor?: number;
  tags?: Tag[];
  speed?: number;
  flying?: boolean;
  cost?: Cost;
  /** Seconds to train (units and add-ons). Other buildings are built by resource delivery instead. */
  buildTime?: number;
  /** Units this building can train. */
  trains?: DefId[];
  /** Add-ons this building can build onto itself. */
  addons?: AddonId[];
  /** Buildings this unit can construct. */
  builds?: DefId[];
  /** A completed building of each listed type must exist before this can be made. */
  requires?: DefId[];
  /** The training building must have this add-on. */
  needsAddon?: AddonId;
  /** Population this unit takes / this building provides. */
  supply?: number;
  supplyProvided?: number;
  attack?: Attack;
  /** Siege mode weapon (Siege Tank): the unit must deploy to use it and can't move while deployed. */
  siege?: Attack & { deploySeconds: number };
  /** Stimpack: trade HP for speed and attack rate. */
  stim?: { hpCost: number; seconds: number };
  /** Heals nearby friendly bio units (Medic, Medivac). */
  heal?: { rate: number; range: number };
  /** Gatherer settings. */
  gather?: { seconds: Record<ResourceType, number> };
  /** Resource source settings. */
  resource?: { type: ResourceType; amount: number; pieceSize: number };
  /** Must be placed on a gas geyser (Refinery). */
  onGeyser?: boolean;
  /** Static targets that never act. */
  inert?: boolean;
  /** Only appears on the enemy side in scenarios (not buildable yet). */
  enemyOnly?: boolean;
};

export const MAX_QUEUE = 5;
export const SUPPLY_MAX = 200;

/** Stimmed units move this much faster and shoot this much more often. */
export const STIM_FACTOR = 1.5;

/** One hauling trip between buildings carries this much ("a crate"). */
export const HAUL_LOAD: Record<ResourceType, number> = { minerals: 50, gas: 25 };

/** Blueprints start at this fraction of full size and grow as resources arrive (Unity: m_ConstructionStartScale). */
export const CONSTRUCTION_START_SCALE = 0.25;

const PRODUCTION_ADDONS: AddonId[] = ['techLab', 'reactor'];

export const DEFS: Record<DefId, Def> = {
  // ---- Buildings ---------------------------------------------------------
  commandCenter: {
    id: 'commandCenter',
    name: 'Command Center',
    category: 'building',
    radius: 2,
    hp: 1500,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 400, gas: 0 },
    trains: ['scv'],
    supplyProvided: 15,
  },
  supplyDepot: {
    id: 'supplyDepot',
    name: 'Supply Depot',
    category: 'building',
    radius: 1,
    hp: 400,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 100, gas: 0 },
    requires: ['commandCenter'],
    supplyProvided: 8,
  },
  refinery: {
    id: 'refinery',
    name: 'Refinery',
    category: 'building',
    radius: 1,
    hp: 500,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 75, gas: 0 },
    requires: ['commandCenter'],
    onGeyser: true,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    category: 'building',
    radius: 1.5,
    hp: 1000,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 150, gas: 0 },
    trains: ['marine', 'marauder', 'medic'],
    addons: PRODUCTION_ADDONS,
    requires: ['supplyDepot'],
  },
  factory: {
    id: 'factory',
    name: 'Factory',
    category: 'building',
    radius: 1.5,
    hp: 1250,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 150, gas: 100 },
    trains: ['hellion', 'siegeTank'],
    addons: PRODUCTION_ADDONS,
    requires: ['barracks'],
  },
  starport: {
    id: 'starport',
    name: 'Starport',
    category: 'building',
    radius: 1.5,
    hp: 1300,
    armor: 1,
    tags: ['armored', 'mech', 'structure'],
    cost: { minerals: 150, gas: 100 },
    trains: ['viking', 'medivac', 'banshee'],
    addons: PRODUCTION_ADDONS,
    requires: ['factory'],
  },
  techLab: {
    id: 'techLab',
    name: 'Tech Lab',
    category: 'building',
    radius: 0.75,
    hp: 400,
    armor: 1,
    tags: ['armored', 'structure'],
    cost: { minerals: 50, gas: 25 },
    buildTime: 9,
  },
  reactor: {
    id: 'reactor',
    name: 'Reactor',
    category: 'building',
    radius: 0.75,
    hp: 400,
    armor: 1,
    tags: ['armored', 'structure'],
    cost: { minerals: 50, gas: 50 },
    buildTime: 18,
  },

  // ---- Units -------------------------------------------------------------
  scv: {
    id: 'scv',
    name: 'SCV',
    category: 'unit',
    radius: 0.35,
    hp: 45,
    tags: ['light', 'bio', 'mech'],
    speed: 3.5,
    cost: { minerals: 50, gas: 0 },
    buildTime: 6,
    supply: 1,
    builds: ['commandCenter', 'supplyDepot', 'refinery', 'barracks', 'factory', 'starport'],
    gather: { seconds: { minerals: 1, gas: 1.5 } },
  },
  marine: {
    id: 'marine',
    name: 'Marine',
    category: 'unit',
    radius: 0.35,
    hp: 45,
    tags: ['light', 'bio'],
    speed: 3.6,
    cost: { minerals: 50, gas: 0 },
    buildTime: 6,
    supply: 1,
    attack: { range: 5, damage: 6, cooldown: 0.61, hitsGround: true, hitsAir: true },
    stim: { hpCost: 10, seconds: 8 },
  },
  marauder: {
    id: 'marauder',
    name: 'Marauder',
    category: 'unit',
    radius: 0.45,
    hp: 125,
    armor: 1,
    tags: ['armored', 'bio'],
    speed: 3.6,
    cost: { minerals: 100, gas: 25 },
    buildTime: 9,
    supply: 2,
    needsAddon: 'techLab',
    attack: {
      range: 6,
      damage: 10,
      bonus: { vs: 'armored', damage: 10 },
      cooldown: 1.07,
      hitsGround: true,
      hitsAir: false,
      slow: 0.5,
    },
    stim: { hpCost: 20, seconds: 8 },
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    category: 'unit',
    radius: 0.35,
    hp: 60,
    armor: 1,
    tags: ['light', 'bio'],
    speed: 3.6,
    cost: { minerals: 50, gas: 25 },
    buildTime: 8,
    supply: 1,
    needsAddon: 'techLab',
    heal: { rate: 9, range: 3 },
  },
  hellion: {
    id: 'hellion',
    name: 'Hellion',
    category: 'unit',
    radius: 0.45,
    hp: 90,
    tags: ['light', 'mech'],
    speed: 5.9,
    cost: { minerals: 100, gas: 0 },
    buildTime: 9,
    supply: 2,
    attack: {
      range: 5,
      damage: 8,
      bonus: { vs: 'light', damage: 6 },
      cooldown: 1.79,
      hitsGround: true,
      hitsAir: false,
      splash: { full: 0.6, radius: 1.2 },
    },
  },
  siegeTank: {
    id: 'siegeTank',
    name: 'Siege Tank',
    category: 'unit',
    radius: 0.65,
    hp: 175,
    armor: 1,
    tags: ['armored', 'mech'],
    speed: 3.15,
    cost: { minerals: 150, gas: 125 },
    buildTime: 14,
    supply: 3,
    needsAddon: 'techLab',
    attack: { range: 7, damage: 15, bonus: { vs: 'armored', damage: 10 }, cooldown: 1.04, hitsGround: true, hitsAir: false },
    siege: {
      range: 13,
      minRange: 2,
      damage: 40,
      bonus: { vs: 'armored', damage: 30 },
      cooldown: 2.14,
      hitsGround: true,
      hitsAir: false,
      splash: { full: 0.5, radius: 1.25 },
      deploySeconds: 2,
    },
  },
  viking: {
    id: 'viking',
    name: 'Viking',
    category: 'unit',
    radius: 0.55,
    hp: 135,
    tags: ['armored', 'mech'],
    speed: 3.85,
    flying: true,
    cost: { minerals: 150, gas: 75 },
    buildTime: 12,
    supply: 2,
    attack: { range: 9, damage: 10, bonus: { vs: 'armored', damage: 4 }, hits: 2, cooldown: 1.43, hitsGround: false, hitsAir: true },
  },
  medivac: {
    id: 'medivac',
    name: 'Medivac',
    category: 'unit',
    radius: 0.6,
    hp: 150,
    armor: 1,
    tags: ['armored', 'mech'],
    speed: 3.5,
    flying: true,
    cost: { minerals: 100, gas: 100 },
    buildTime: 12,
    supply: 2,
    heal: { rate: 12.6, range: 4 },
  },
  banshee: {
    id: 'banshee',
    name: 'Banshee',
    category: 'unit',
    radius: 0.55,
    hp: 140,
    tags: ['light', 'mech'],
    speed: 3.85,
    flying: true,
    cost: { minerals: 150, gas: 100 },
    buildTime: 14,
    supply: 3,
    needsAddon: 'techLab',
    attack: { range: 6, damage: 12, hits: 2, cooldown: 1.25, hitsGround: true, hitsAir: false },
  },

  // ---- Resources ---------------------------------------------------------------
  mineralSource: {
    id: 'mineralSource',
    name: 'Mineral Field',
    category: 'resource',
    radius: 0.6,
    hp: 1,
    resource: { type: 'minerals', amount: 1000, pieceSize: 25 },
  },
  gasSource: {
    id: 'gasSource',
    name: 'Vespene Geyser',
    category: 'resource',
    radius: 1,
    hp: 1,
    resource: { type: 'gas', amount: 2000, pieceSize: 10 },
  },

  // ---- Enemy-only (scenarios) ------------------------------------------------------
  zergling: {
    id: 'zergling',
    name: 'Zergling',
    category: 'unit',
    radius: 0.3,
    hp: 35,
    tags: ['light', 'bio'],
    speed: 5.4,
    attack: { range: 0.15, damage: 5, cooldown: 0.5, hitsGround: true, hitsAir: false },
    enemyOnly: true,
  },
  bunker: {
    id: 'bunker',
    name: 'Bunker',
    category: 'building',
    radius: 1.5,
    hp: 400,
    armor: 1,
    tags: ['armored', 'structure'],
    // A garrisoned bunker: four marines' worth of fire.
    attack: { range: 6, damage: 6, hits: 4, cooldown: 0.61, hitsGround: true, hitsAir: true },
    enemyOnly: true,
  },
  missileTurret: {
    id: 'missileTurret',
    name: 'Missile Turret',
    category: 'building',
    radius: 1,
    hp: 250,
    tags: ['armored', 'mech', 'structure'],
    attack: { range: 7, damage: 12, hits: 2, cooldown: 0.86, hitsGround: false, hitsAir: true },
    enemyOnly: true,
  },
  dummy: {
    id: 'dummy',
    name: 'Target Dummy',
    category: 'unit',
    radius: 0.45,
    hp: 100,
    tags: ['light', 'bio'],
    inert: true,
    enemyOnly: true,
  },
  dummyBunker: {
    id: 'dummyBunker',
    name: 'Dummy Bunker',
    category: 'building',
    radius: 1.75,
    hp: 1200,
    armor: 1,
    tags: ['armored', 'structure'],
    inert: true,
    enemyOnly: true,
  },
};

export const defOf = (id: DefId): Def => DEFS[id];

export const costOf = (id: DefId): Cost => DEFS[id].cost ?? { minerals: 0, gas: 0 };

export const isAddon = (id: DefId): id is AddonId => id === 'techLab' || id === 'reactor';

export const formatCost = (c: Cost): string =>
  c.gas > 0 ? `${c.minerals}m ${c.gas}g` : `${c.minerals}m`;

/** Old ids from earlier versions of saved programs. */
export const DEF_ALIASES: Record<string, DefId> = {
  home: 'commandCenter',
  gatherer: 'scv',
  infantryTraining: 'barracks',
  mechFactory: 'factory',
  port: 'starport',
  lightInfantry: 'marine',
  heavyInfantry: 'marauder',
  tank: 'siegeTank',
  ship: 'banshee',
};
