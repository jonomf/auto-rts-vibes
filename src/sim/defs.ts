/**
 * Entity catalog. Replaces the Unity prefabs + CreateEntity ScriptableObjects
 * (costs, build times, which building trains what, which unit builds what).
 *
 * Units of measure: distances in world units (1 unit ~ 1 Unity unit),
 * speeds in units/second, times in seconds.
 */

export type ResourceType = 'minerals' | 'gas';

export type Cost = { minerals: number; gas: number };

export type Attack = {
  range: number; // edge-to-edge distance
  damage: number;
  cooldown: number; // seconds between shots
  hitsGround: boolean;
  hitsAir: boolean;
};

export type DefId =
  | 'home'
  | 'infantryTraining'
  | 'mechFactory'
  | 'port'
  | 'gatherer'
  | 'lightInfantry'
  | 'heavyInfantry'
  | 'tank'
  | 'ship'
  | 'mineralSource'
  | 'gasSource'
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
  speed?: number;
  flying?: boolean;
  cost?: Cost;
  /** Seconds to train (units only). Buildings are built by resource delivery instead. */
  buildTime?: number;
  /** Units this building can train. */
  trains?: DefId[];
  /** Buildings this unit can construct. */
  builds?: DefId[];
  /** A completed building of each listed type must exist before this can be made. */
  requires?: DefId[];
  attack?: Attack;
  /** Gatherer settings. */
  gather?: { seconds: Record<ResourceType, number> };
  /** Resource source settings. */
  resource?: { type: ResourceType; amount: number; pieceSize: number };
  /** Static targets that never act (M1 combat dummies). */
  inert?: boolean;
};

export const MAX_QUEUE = 5;

/** One hauling trip between buildings carries this much ("a crate"). */
export const HAUL_LOAD: Record<ResourceType, number> = { minerals: 50, gas: 25 };

/** Blueprints start at this fraction of full size and grow as resources arrive (Unity: m_ConstructionStartScale). */
export const CONSTRUCTION_START_SCALE = 0.25;

export const DEFS: Record<DefId, Def> = {
  // ---- Buildings ---------------------------------------------------------
  home: {
    id: 'home',
    name: 'Home',
    category: 'building',
    radius: 2,
    hp: 1500,
    cost: { minerals: 400, gas: 0 },
    trains: ['gatherer'],
  },
  infantryTraining: {
    id: 'infantryTraining',
    name: 'Infantry Training',
    category: 'building',
    radius: 1.5,
    hp: 1000,
    cost: { minerals: 150, gas: 0 },
    trains: ['lightInfantry', 'heavyInfantry'],
    requires: ['home'],
  },
  mechFactory: {
    id: 'mechFactory',
    name: 'Mech Factory',
    category: 'building',
    radius: 1.75,
    hp: 1250,
    cost: { minerals: 150, gas: 100 },
    trains: ['tank'],
    requires: ['infantryTraining'],
  },
  port: {
    id: 'port',
    name: 'Port',
    category: 'building',
    radius: 1.75,
    hp: 1300,
    cost: { minerals: 150, gas: 100 },
    trains: ['ship'],
    requires: ['mechFactory'],
  },

  // ---- Units -------------------------------------------------------------
  gatherer: {
    id: 'gatherer',
    name: 'Gatherer',
    category: 'unit',
    radius: 0.35,
    hp: 40,
    speed: 3.5,
    cost: { minerals: 50, gas: 0 },
    buildTime: 6,
    builds: ['home', 'infantryTraining', 'mechFactory', 'port'],
    gather: { seconds: { minerals: 1, gas: 1.5 } },
  },
  lightInfantry: {
    id: 'lightInfantry',
    name: 'Light Infantry',
    category: 'unit',
    radius: 0.35,
    hp: 45,
    speed: 4,
    cost: { minerals: 50, gas: 0 },
    buildTime: 6,
    attack: { range: 4.5, damage: 6, cooldown: 0.6, hitsGround: true, hitsAir: true },
  },
  heavyInfantry: {
    id: 'heavyInfantry',
    name: 'Heavy Infantry',
    category: 'unit',
    radius: 0.45,
    hp: 125,
    speed: 3.25,
    cost: { minerals: 100, gas: 50 },
    buildTime: 9,
    attack: { range: 4, damage: 14, cooldown: 1.1, hitsGround: true, hitsAir: false },
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    category: 'unit',
    radius: 0.65,
    hp: 175,
    speed: 2.75,
    cost: { minerals: 150, gas: 100 },
    buildTime: 14,
    attack: { range: 7, damage: 22, cooldown: 1.6, hitsGround: true, hitsAir: false },
  },
  ship: {
    id: 'ship',
    name: 'Ship',
    category: 'unit',
    radius: 0.6,
    hp: 140,
    speed: 5,
    flying: true,
    cost: { minerals: 150, gas: 100 },
    buildTime: 12,
    attack: { range: 5, damage: 10, cooldown: 0.8, hitsGround: true, hitsAir: true },
  },

  // ---- Resources (Unity: Minerals Source / Gas Source; piece sizes from the prefabs) ----
  mineralSource: {
    id: 'mineralSource',
    name: 'Minerals',
    category: 'resource',
    radius: 0.6,
    hp: 1,
    resource: { type: 'minerals', amount: 1000, pieceSize: 25 },
  },
  gasSource: {
    id: 'gasSource',
    name: 'Gas',
    category: 'resource',
    radius: 1,
    hp: 1,
    resource: { type: 'gas', amount: 2000, pieceSize: 10 },
  },

  // ---- M1 combat targets ---------------------------------------------------
  dummy: {
    id: 'dummy',
    name: 'Target Dummy',
    category: 'unit',
    radius: 0.45,
    hp: 100,
    inert: true,
  },
  dummyBunker: {
    id: 'dummyBunker',
    name: 'Dummy Bunker',
    category: 'building',
    radius: 1.75,
    hp: 1200,
    inert: true,
  },
};

export const defOf = (id: DefId): Def => DEFS[id];

export const costOf = (id: DefId): Cost => DEFS[id].cost ?? { minerals: 0, gas: 0 };

export const formatCost = (c: Cost): string =>
  c.gas > 0 ? `${c.minerals}m ${c.gas}g` : `${c.minerals}m`;
