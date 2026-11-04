import { DEFS, SUPPLY_MAX, type DefId } from './defs';
import { RULESETS, type Ruleset } from './ruleset';
import { statusSystem } from './systems/status';
import { defenseSystem } from './systems/defense';
import { containsPoint, edgeDist } from './geometry';
import { applyCommand } from './commands';
import { productionSystem } from './systems/production';
import { unitSystem } from './systems/units';
import { separationSystem } from './systems/separation';
import type { Command, CommandResult, CommandSource, Effect, Entity, EntityId, Team } from './types';
import type { AutoState, Program } from '../automation/types';
import { AUTO_EVERY, automationSystem, createAutoState } from '../automation/interpreter';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

/** Effects older than this many ticks are dropped. */
const EFFECT_TTL_TICKS = 12;

export type MapSize = { width: number; height: number };

/** Match statistics (the strategy lab and the end-of-match summary read these). */
export type Stats = {
  /** Value (minerals + gas) of units and buildings lost, per team index (0 = player, 1 = enemy). */
  lostValue: [number, number];
  lostUnits: [number, number];
  gathered: { minerals: number; gas: number };
  /** Seconds the player had a production building idle because of the supply cap (hard rules). */
  supplyBlocked: number;
};

/**
 * The whole simulation: pure data + fixed-tick systems, no DOM or rendering.
 * Deterministic given the same initial state and the same commands on the same ticks.
 */
export class World {
  tick = 0;
  readonly map: MapSize;
  readonly entities = new Map<EntityId, Entity>();
  effects: Effect[] = [];
  /** Every accepted command, with the tick it was applied on (replays, M2 debugging). */
  readonly commandLog: { tick: number; cmd: Command }[] = [];
  /** The player's automation program (null = no automation at all). */
  program: Program | null = null;
  readonly auto: AutoState = createAutoState();
  ruleset: Ruleset;
  readonly stats: Stats = { lostValue: [0, 0], lostUnits: [0, 0], gathered: { minerals: 0, gas: 0 }, supplyBlocked: 0 };
  private nextId = 1;
  private dead = new Set<EntityId>();

  constructor(map: MapSize = { width: 64, height: 44 }, ruleset: Ruleset = RULESETS.classic) {
    this.map = map;
    this.ruleset = ruleset;
  }

  get seconds(): number {
    return this.tick / TICK_RATE;
  }

  // ---- Entities --------------------------------------------------------------

  spawn(def: DefId, team: Team, x: number, y: number, overrides: Partial<Entity> = {}): Entity {
    const d = DEFS[def];
    const e: Entity = {
      id: this.nextId++,
      def,
      team,
      x,
      y,
      px: x,
      py: y,
      hp: d.hp,
      facing: 0,
      order: { type: 'idle' },
      stuck: 0,
      complete: true,
      stock: { minerals: 0, gas: 0 },
      required: 0,
      queue: [],
      rally: null,
      cargo: null,
      sourceId: null,
      sourceX: 0,
      sourceY: 0,
      depositId: null,
      remaining: d.resource?.amount ?? 0,
      cooldown: 0,
      intent: null,
      manual: false,
      addon: null,
      linkId: null,
      sieged: false,
      deploying: 0,
      stimmed: 0,
      slowed: 0,
      leash: null,
      ...overrides,
    };
    this.entities.set(e.id, e);
    return e;
  }

  get(id: EntityId | null | undefined): Entity | undefined {
    if (id == null || this.dead.has(id)) return undefined;
    return this.entities.get(id);
  }

  /** Mark for removal at the end of the tick, so systems never see a half-removed entity. */
  kill(e: Entity): void {
    if (this.dead.has(e.id)) return;
    this.dead.add(e.id);
    this.effects.push({ type: 'death', tick: this.tick, x: e.x, y: e.y, radius: DEFS[e.def].radius });
    const d = DEFS[e.def];
    if (e.team === 0 || e.team === 1) {
      this.stats.lostValue[e.team] += (d.cost?.minerals ?? 0) + (d.cost?.gas ?? 0);
      if (d.category === 'unit') this.stats.lostUnits[e.team]++;
    }
    // Attached add-ons live and die with their building.
    const link = this.get(e.linkId);
    if (link) {
      if (d.category === 'building' && link.linkId === e.id) {
        if (link.addon) link.addon = null; // the add-on died: its building loses it
        else this.kill(link); // the building died: so does its add-on
      }
    }
  }

  /** Supply used (units alive + queued) and provided (finished buildings), capped at 200. */
  supply(team: Team): { used: number; cap: number } {
    let used = 0;
    let cap = 0;
    for (const e of this.all()) {
      if (e.team !== team) continue;
      const d = DEFS[e.def];
      used += d.supply ?? 0;
      for (const q of e.queue) used += DEFS[q.def].supply ?? 0;
      if (e.complete) cap += d.supplyProvided ?? 0;
    }
    return { used, cap: Math.min(SUPPLY_MAX, cap) };
  }

  isAlive(e: Entity): boolean {
    return this.entities.has(e.id) && !this.dead.has(e.id);
  }

  /** Live entities in insertion order (deterministic). */
  *all(): IterableIterator<Entity> {
    for (const e of this.entities.values()) if (!this.dead.has(e.id)) yield e;
  }

  list(filter?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    for (const e of this.all()) if (!filter || filter(e)) out.push(e);
    return out;
  }

  /** Nearest live entity matching the filter, by edge distance from `from`. */
  nearest(from: Entity, filter: (e: Entity) => boolean, maxDist = Infinity): Entity | undefined {
    let best: Entity | undefined;
    let bestD = maxDist;
    for (const e of this.all()) {
      if (e.id === from.id || !filter(e)) continue;
      const d = edgeDist(from, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Topmost entity under a world point: flyers, then ground units, then buildings and resources. */
  pick(x: number, y: number, pad = 0.15): Entity | undefined {
    let best: Entity | undefined;
    let bestRank = -1;
    for (const e of this.all()) {
      if (!containsPoint(e, x, y, pad)) continue;
      const d = DEFS[e.def];
      const rank = d.category === 'unit' ? (d.flying ? 3 : 2) : d.category === 'building' ? 1 : 0;
      if (rank > bestRank) {
        best = e;
        bestRank = rank;
      }
    }
    return best;
  }

  hasCompleted(team: Team, def: DefId): boolean {
    for (const e of this.all()) if (e.team === team && e.def === def && e.complete) return true;
    return false;
  }

  // ---- Commands & ticking ----------------------------------------------------------

  /** Player commands are logged; automation commands are derived from the program and aren't. */
  issue(cmd: Command, source: CommandSource = 'player'): CommandResult {
    const result = applyCommand(this, cmd, source);
    if (result.ok && source === 'player') this.commandLog.push({ tick: this.tick, cmd });
    return result;
  }

  step(): void {
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
    }

    productionSystem(this, DT);
    if (this.program && this.tick % AUTO_EVERY === 0) automationSystem(this, this.program);
    statusSystem(this, DT);
    unitSystem(this, DT);
    defenseSystem(this, DT);
    separationSystem(this);

    for (const id of this.dead) this.entities.delete(id);
    this.dead.clear();

    this.tick++;
    const cutoff = this.tick - EFFECT_TTL_TICKS;
    if (this.effects.length && this.effects[0].tick < cutoff)
      this.effects = this.effects.filter((fx) => fx.tick >= cutoff);
  }

  stepSeconds(seconds: number): void {
    const n = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < n; i++) this.step();
  }

  /** Compact fingerprint of the state, for determinism tests. */
  hash(): string {
    const parts: string[] = [String(this.tick), this.auto.posture, String(this.auto.step)];
    for (const e of this.all())
      parts.push(
        `${e.id}:${e.def}:${e.x.toFixed(3)},${e.y.toFixed(3)}:${e.hp.toFixed(1)}:${e.stock.minerals},${e.stock.gas}:${e.order.type}:${e.intent}:${e.addon}:${e.sieged}`,
      );
    return parts.join('|');
  }
}
