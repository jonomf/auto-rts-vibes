import { DEFS, type DefId } from './defs';
import { containsPoint, edgeDist } from './geometry';
import { applyCommand } from './commands';
import { productionSystem } from './systems/production';
import { unitSystem } from './systems/units';
import { separationSystem } from './systems/separation';
import type { Command, CommandResult, Effect, Entity, EntityId, Team } from './types';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

/** Effects older than this many ticks are dropped. */
const EFFECT_TTL_TICKS = 12;

export type MapSize = { width: number; height: number };

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
  private nextId = 1;
  private dead = new Set<EntityId>();

  constructor(map: MapSize = { width: 64, height: 44 }) {
    this.map = map;
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

  issue(cmd: Command): CommandResult {
    const result = applyCommand(this, cmd);
    if (result.ok) this.commandLog.push({ tick: this.tick, cmd });
    return result;
  }

  step(): void {
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
    }

    productionSystem(this, DT);
    unitSystem(this, DT);
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
    const parts: string[] = [String(this.tick)];
    for (const e of this.all())
      parts.push(
        `${e.id}:${e.def}:${e.x.toFixed(3)},${e.y.toFixed(3)}:${e.hp.toFixed(1)}:${e.stock.minerals},${e.stock.gas}:${e.order.type}`,
      );
    return parts.join('|');
  }
}
