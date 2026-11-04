import type { AddonId, Cost, DefId, ResourceType } from './defs';

export type EntityId = number;

/** 0 = player, 1 = enemy (M1: inert dummies), -1 = neutral (resources). */
export type Team = -1 | 0 | 1;

export const PLAYER: Team = 0;
export const ENEMY: Team = 1;
export const NEUTRAL: Team = -1;

/**
 * What a unit is currently doing. Each order owns its own target, so a unit can
 * never be "moving to a point" and "moving to an entity" at once -- that split
 * (Entity.Target + Entity.TargetPosition) caused the Unity gather loop bug.
 */
export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'follow'; targetId: EntityId }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'attackMove'; x: number; y: number; engagedId: EntityId | null }
  | { type: 'gather'; phase: 'toSource' | 'harvesting' | 'toDeposit'; timer: number }
  | { type: 'build'; def: DefId; x: number; y: number }
  /** Carry one load of `res` from one building's stockpile to another's (single trip). */
  | { type: 'haul'; res: ResourceType; fromId: EntityId; toId: EntityId; phase: 'toFrom' | 'toTo' };

export type Rally = { kind: 'point'; x: number; y: number } | { kind: 'entity'; id: EntityId };

export type QueueItem = { def: DefId; elapsed: number };

export type { AddonId };

export type Cargo = { type: ResourceType; amount: number };

export type Entity = {
  id: EntityId;
  def: DefId;
  team: Team;
  x: number;
  y: number;
  /** Position at the start of the current tick, for render interpolation. */
  px: number;
  py: number;
  hp: number;
  facing: number;
  order: Order;
  /** Seconds the unit has been close to its destination without getting closer. */
  stuck: number;

  // Buildings ---------------------------------------------------------------
  /** False while a blueprint is waiting on resource deliveries. */
  complete: boolean;
  /** Per-building stockpile. Negative values are construction debt. */
  stock: Cost;
  /** Total resources the blueprint needed (drives the grow-as-delivered scale). */
  required: number;
  queue: QueueItem[];
  rally: Rally | null;

  // Gatherers -----------------------------------------------------------------
  cargo: Cargo | null;
  /** Where this gatherer harvests (Unity: m_LastGatherTarget). */
  sourceId: EntityId | null;
  /** Remembered source position, to find a nearby replacement when it runs dry. */
  sourceX: number;
  sourceY: number;
  /** Where this gatherer delivers (Unity: m_LastDepositTarget). */
  depositId: EntityId | null;

  // Resources -----------------------------------------------------------------
  remaining: number;

  // Combat --------------------------------------------------------------------
  cooldown: number;

  // Add-ons -------------------------------------------------------------------
  /** Production building: its add-on (attached or in-place, see Ruleset.addons). */
  addon: AddonId | null;
  /** Attached add-on entity (classic rules), or the parent building of an add-on entity. */
  linkId: EntityId | null;

  // Abilities & status ------------------------------------------------------------
  /** Siege Tank deployed (siege weapon, can't move). */
  sieged: boolean;
  /** Seconds left in a siege / unsiege transition (can't act while > 0). */
  deploying: number;
  /** Seconds of Stimpack left. */
  stimmed: number;
  /** Seconds of Marauder slow left. */
  slowed: number;
  /** Scenario defenders return here if they chase too far (null = no leash). */
  leash: { x: number; y: number } | null;

  // Automation ----------------------------------------------------------------
  /** Rule key this unit is following (see automation/types.ts ruleKey), or null. */
  intent: string | null;
  /** Last order came from the player; automation leaves the unit alone until it goes idle. */
  manual: boolean;
};

export type CommandSource = 'player' | 'auto';

export type Command =
  | { type: 'move'; ids: EntityId[]; x: number; y: number }
  | { type: 'attackMove'; ids: EntityId[]; x: number; y: number }
  /** Contextual right-click on an entity: gather, deposit, attack or follow. */
  | { type: 'target'; ids: EntityId[]; targetId: EntityId }
  | { type: 'stop'; ids: EntityId[] }
  | { type: 'siege'; ids: EntityId[]; on: boolean }
  | { type: 'stim'; ids: EntityId[] }
  | { type: 'addon'; buildingId: EntityId; def: AddonId }
  | { type: 'haul'; ids: EntityId[]; res: ResourceType; fromId: EntityId; toId: EntityId }
  | { type: 'build'; builderId: EntityId; def: DefId; x: number; y: number }
  | { type: 'train'; buildingId: EntityId; def: DefId }
  | { type: 'cancelTrain'; buildingId: EntityId; index: number }
  | { type: 'rally'; buildingIds: EntityId[]; x: number; y: number; targetId: EntityId | null };

export type CommandResult = { ok: true } | { ok: false; reason: string };

export type Effect =
  | { type: 'heal'; tick: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'splash'; tick: number; x: number; y: number; radius: number }
  | { type: 'shot'; tick: number; x1: number; y1: number; x2: number; y2: number; heavy: boolean }
  | { type: 'death'; tick: number; x: number; y: number; radius: number }
  | { type: 'deposit'; tick: number; x: number; y: number; resource: ResourceType; amount: number };
