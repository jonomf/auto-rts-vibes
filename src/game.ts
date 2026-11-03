import type { DefId } from './sim/defs';
import { DT, World } from './sim/world';
import { ENEMY, type Command, type CommandResult, type Entity, type EntityId } from './sim/types';
import { createSandbox } from './sim/scenario';
import { Camera } from './render/camera';
import { emptyProgram, sanitizeProgram } from './automation/blocks';
import type { Posture, Program, ScopeId } from './automation/types';

/** Pending pointer interaction (Unity: Selection.WaitingForGroundPointSelection + PlacementIndicator). */
export type Mode =
  | { type: 'normal' }
  | { type: 'place'; def: DefId; builderId: EntityId }
  | { type: 'move' }
  | { type: 'attack' }
  /** Editing the program's base layout on the map. */
  | { type: 'layout'; def: DefId | 'muster' };

export type Ping = { x: number; y: number; t: number; kind: 'move' | 'attack' | 'rally' };

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

const PROGRAM_KEY = 'auto-rts.program.v1';
const BEST_KEY = 'auto-rts.best.v1';

/** Commands that steer units or buildings directly (blocked in hands-off mode). */
const DIRECT: Command['type'][] = ['move', 'attackMove', 'target', 'stop', 'haul', 'build', 'train', 'cancelTrain', 'rally'];

/**
 * Client-side state around the simulation: selection, camera, time controls, input modes,
 * the player's program and the match. Nothing here affects the sim except through
 * `issue()` and the program object the sim reads.
 */
export class Game {
  world: World;
  readonly camera = new Camera();
  program: Program;
  /** No direct unit control: the program runs everything (the Auto-Starcraft rule). */
  handsOff = true;
  programsOpen = true;
  /** Scope the editor shows. */
  scope: ScopeId = 'gatherer';
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
  /** Game seconds when the last enemy fell, or null while targets remain. */
  won: number | null = null;
  best: number | null = null;
  targetsTotal = 0;
  /** Bumped whenever something the HUD shows may have changed outside the tick. */
  uiVersion = 0;
  /** Bumped whenever the program changes (the editor re-renders on this). */
  programVersion = 0;
  private acc = 0;

  constructor() {
    this.program = loadProgram();
    this.best = loadNumber(BEST_KEY);
    this.world = this.newMatch();
  }

  private newMatch(): World {
    const w = createSandbox();
    w.program = this.program;
    this.targetsTotal = w.list((e) => e.team === ENEMY).length;
    return w;
  }

  restart(): void {
    this.world = this.newMatch();
    this.selection.clear();
    this.mode = { type: 'normal' };
    this.menu = 'root';
    this.won = null;
    this.acc = 0;
    this.uiVersion++;
    this.programVersion++;
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
    if (this.won === null && this.targetsLeft() === 0) {
      this.won = this.world.seconds;
      if (this.best === null || this.won < this.best) {
        this.best = this.won;
        saveNumber(BEST_KEY, this.best);
      }
      this.uiVersion++;
    }
    return this.paused ? 1 : this.acc / DT;
  }

  targetsLeft(): number {
    let n = 0;
    for (const e of this.world.all()) if (e.team === ENEMY) n++;
    return n;
  }

  issue(cmd: Command): CommandResult {
    if (this.handsOff && DIRECT.includes(cmd.type)) {
      const r = { ok: false as const, reason: 'Hands-off: change the program instead (or switch to hands-on)' };
      this.notify(r.reason);
      return r;
    }
    const r = this.world.issue(cmd);
    if (!r.ok) this.notify(r.reason);
    this.uiVersion++;
    return r;
  }

  /** Call after mutating `program`: saves it and refreshes the editor. */
  programChanged(): void {
    saveProgram(this.program);
    this.programVersion++;
    this.uiVersion++;
  }

  replaceProgram(p: Program): void {
    // Mutate in place so the running world keeps reading the same object.
    Object.assign(this.program, p);
    this.world.auto.step = 0;
    this.world.auto.stepStatus = '';
    for (const e of this.world.all()) e.intent = null;
    this.programChanged();
  }

  setPosture(p: Posture): void {
    this.world.auto.posture = p;
    this.uiVersion++;
  }

  openScope(scope: ScopeId): void {
    this.scope = scope;
    this.programsOpen = true;
    this.programVersion++;
    this.uiVersion++;
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
    if (this.mode.type !== 'normal' && this.mode.type !== 'layout') this.mode = { type: 'normal' };
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
      this.programVersion++;
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

// ---- Persistence (per-browser convenience; the game works without it) ----------------------

function loadProgram(): Program {
  try {
    const raw = localStorage.getItem(PROGRAM_KEY);
    if (raw) return sanitizeProgram(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return emptyProgram();
}

function saveProgram(p: Program): void {
  try {
    localStorage.setItem(PROGRAM_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function loadNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveNumber(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}
