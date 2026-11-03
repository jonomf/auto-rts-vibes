import type { DefId } from './sim/defs';
import { DT, World } from './sim/world';
import type { Command, CommandResult, Entity, EntityId } from './sim/types';
import { Camera } from './render/camera';

/** Pending pointer interaction (Unity: Selection.WaitingForGroundPointSelection + PlacementIndicator). */
export type Mode =
  | { type: 'normal' }
  | { type: 'place'; def: DefId; builderId: EntityId }
  | { type: 'move' }
  | { type: 'attack' };

export type Ping = { x: number; y: number; t: number; kind: 'move' | 'attack' | 'rally' };

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/**
 * Client-side state around the simulation: selection, camera, time controls, input modes.
 * Nothing here affects the sim except through `issue()`.
 */
export class Game {
  readonly world: World;
  readonly camera = new Camera();
  selection = new Set<EntityId>();
  mode: Mode = { type: 'normal' };
  menu: 'root' | 'build' = 'root';
  paused = false;
  speed = 1;
  /** Real seconds since start (for UI animation, independent of sim speed). */
  time = 0;
  hover = { x: 0, y: 0 };
  hoverScreen = { x: -1, y: -1 };
  drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  pings: Ping[] = [];
  toast: { text: string; until: number } | null = null;
  /** Bumped whenever something the HUD shows may have changed outside the tick. */
  uiVersion = 0;
  private acc = 0;

  constructor(world: World) {
    this.world = world;
  }

  /** Advance real time; runs as many fixed sim ticks as are due. Returns the interpolation alpha. */
  frame(dt: number): number {
    this.time += dt;
    if (!this.paused) {
      this.acc += Math.min(dt, 0.25) * this.speed;
      while (this.acc >= DT) {
        this.world.step();
        this.acc -= DT;
      }
    }
    this.pings = this.pings.filter((p) => this.time - p.t < 0.6);
    this.pruneSelection();
    return this.paused ? 1 : this.acc / DT;
  }

  issue(cmd: Command): CommandResult {
    const r = this.world.issue(cmd);
    if (!r.ok) this.notify(r.reason);
    this.uiVersion++;
    return r;
  }

  notify(text: string): void {
    this.toast = { text, until: this.time + 2.5 };
    this.uiVersion++;
  }

  ping(x: number, y: number, kind: Ping['kind']): void {
    this.pings.push({ x, y, t: this.time, kind });
  }

  selected(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  select(ids: Iterable<EntityId>, additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.menu = 'root';
    if (this.mode.type !== 'normal') this.mode = { type: 'normal' };
    this.uiVersion++;
  }

  toggle(id: EntityId): void {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.menu = 'root';
    this.uiVersion++;
  }

  cancelMode(): boolean {
    if (this.mode.type !== 'normal') {
      this.mode = { type: 'normal' };
      this.uiVersion++;
      return true;
    }
    if (this.menu !== 'root') {
      this.menu = 'root';
      this.uiVersion++;
      return true;
    }
    return false;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.paused = false;
    this.uiVersion++;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.uiVersion++;
  }

  private pruneSelection(): void {
    for (const id of this.selection) {
      if (!this.world.get(id)) {
        this.selection.delete(id);
        this.uiVersion++;
      }
    }
    if (this.mode.type === 'place' && !this.world.get(this.mode.builderId)) this.mode = { type: 'normal' };
  }
}
