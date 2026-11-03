/**
 * Mouse & keyboard -> selection changes and sim commands.
 * Unity chain was InputController -> Interaction -> Selection -> HUD; here it is one module.
 */
import { DEFS, type DefId } from '../sim/defs';
import { canAttack, isBuilding, isEnemyOf, isUnit } from '../sim/actions';
import type { Game } from '../game';
import { SPEEDS } from '../game';
import { computeActions, ownControllable } from '../ui/actions';

const DRAG_THRESHOLD = 5;
const PAN_SPEED = 900; // px/s
const DOUBLE_CLICK_MS = 300;

/** Snap a building center so its footprint edges land on the half-unit grid. */
export function snapToGrid(def: DefId, x: number, y: number): { x: number; y: number } {
  const h = DEFS[def].radius;
  return { x: Math.round((x - h) * 2) / 2 + h, y: Math.round((y - h) * 2) / 2 + h };
}

export class Input {
  private keys = new Set<string>();
  private panning: { x: number; y: number } | null = null;
  private lastClick = { id: -1, at: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly game: Game) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => (game.hoverScreen = { x: -1, y: -1 }));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Per-frame: keyboard panning. */
  update(dt: number): void {
    const cam = this.game.camera;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx += 1;
    if (this.keys.has('ArrowRight')) dx -= 1;
    if (this.keys.has('ArrowUp')) dy += 1;
    if (this.keys.has('ArrowDown')) dy -= 1;
    if (dx || dy) cam.pan(dx * PAN_SPEED * dt, dy * PAN_SPEED * dt);
    cam.clampTo(this.game.world.map.width, this.game.world.map.height);
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private updateHover(sx: number, sy: number): void {
    const g = this.game;
    g.hoverScreen = { x: sx, y: sy };
    g.hover = g.camera.toWorld(sx, sy);
  }

  // ---- Pointer -------------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    const p = this.local(e);
    this.updateHover(p.x, p.y);
    if (e.button === 1) {
      e.preventDefault();
      this.panning = p;
      return;
    }
    if (e.button === 2) {
      this.rightClick();
      return;
    }
    if (e.button !== 0) return;
    if (this.game.mode.type !== 'normal') {
      this.modeClick(e.shiftKey);
      return;
    }
    this.game.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    if (this.panning) {
      this.game.camera.pan(p.x - this.panning.x, p.y - this.panning.y);
      this.panning = p;
    }
    const inside = e.target === this.canvas || this.game.drag;
    if (inside) this.updateHover(p.x, p.y);
    if (this.game.drag) {
      this.game.drag.x1 = p.x;
      this.game.drag.y1 = p.y;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.button === 1) {
      this.panning = null;
      return;
    }
    if (e.button !== 0 || !this.game.drag) return;
    const d = this.game.drag;
    this.game.drag = null;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) >= DRAG_THRESHOLD) this.boxSelect(d, e.shiftKey);
    else this.clickSelect(e.shiftKey);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    this.game.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }

  // ---- Selection -----------------------------------------------------------------

  private clickSelect(additive: boolean): void {
    const g = this.game;
    const hit = g.world.pick(g.hover.x, g.hover.y);
    if (!hit) {
      if (!additive) g.select([]);
      return;
    }
    const now = performance.now();
    const isDouble = this.lastClick.id === hit.id && now - this.lastClick.at < DOUBLE_CLICK_MS;
    this.lastClick = { id: hit.id, at: now };

    if (isDouble && ownControllable(hit)) {
      // Everything of the same type on screen.
      const cam = g.camera;
      const tl = cam.toWorld(0, 0);
      const br = cam.toWorld(cam.width, cam.height);
      const same = g.world.list(
        (e) => e.def === hit.def && ownControllable(e) && e.x >= tl.x && e.x <= br.x && e.y >= tl.y && e.y <= br.y,
      );
      g.select(same.map((e) => e.id), additive);
      return;
    }
    if (additive && ownControllable(hit) && isUnit(hit)) g.toggle(hit.id);
    else g.select([hit.id]);
  }

  private boxSelect(d: { x0: number; y0: number; x1: number; y1: number }, additive: boolean): void {
    const g = this.game;
    const a = g.camera.toWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
    const b = g.camera.toWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
    const inBox = (e: { x: number; y: number }) => e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y;
    let picked = g.world.list((e) => ownControllable(e) && isUnit(e) && inBox(e));
    if (picked.length === 0) picked = g.world.list((e) => ownControllable(e) && isBuilding(e) && inBox(e));
    if (picked.length === 0 && !additive) {
      g.select([]);
      return;
    }
    g.select(
      picked.map((e) => e.id),
      additive,
    );
  }

  // ---- Commands ------------------------------------------------------------------

  /** Right-click: the contextual "do the obvious thing" command (Unity: Interaction.HandleInteract*). */
  private rightClick(): void {
    const g = this.game;
    if (g.mode.type !== 'normal') {
      g.cancelMode();
      return;
    }
    const sel = g.selected().filter(ownControllable);
    const units = sel.filter(isUnit);
    const buildings = sel.filter(isBuilding);
    const { x, y } = g.hover;
    const target = g.world.pick(x, y);

    if (units.length > 0) {
      const ids = units.map((u) => u.id);
      if (target && !(target.team === units[0].team && isUnit(target) && ids.includes(target.id))) {
        const r = g.issue({ type: 'target', ids, targetId: target.id });
        if (r.ok) g.ping(target.x, target.y, isEnemyOf(units[0], target) ? 'attack' : 'move');
      } else {
        if (g.issue({ type: 'move', ids, x, y }).ok) g.ping(x, y, 'move');
      }
      return;
    }
    if (buildings.length > 0) {
      const r = g.issue({ type: 'rally', buildingIds: buildings.map((b) => b.id), x, y, targetId: target?.id ?? null });
      if (r.ok) g.ping(target?.x ?? x, target?.y ?? y, 'rally');
    }
  }

  /** Left-click while waiting for a point (Move / Attack / building placement). */
  private modeClick(shift: boolean): void {
    const g = this.game;
    const mode = g.mode;
    const { x, y } = g.hover;
    const ids = g.selected().filter((e) => ownControllable(e) && isUnit(e)).map((e) => e.id);

    if (mode.type === 'place') {
      const p = snapToGrid(mode.def, x, y);
      const r = g.issue({ type: 'build', builderId: mode.builderId, def: mode.def, x: p.x, y: p.y });
      if (r.ok) {
        g.ping(p.x, p.y, 'move');
        if (!shift) {
          g.mode = { type: 'normal' };
          g.menu = 'root';
        }
      }
      return;
    }

    const target = g.world.pick(x, y);
    if (mode.type === 'move') {
      if (target) g.issue({ type: 'target', ids, targetId: target.id });
      else g.issue({ type: 'move', ids, x, y });
      g.ping(x, y, 'move');
    } else if (mode.type === 'attack') {
      const attackers = g.selected().filter((e) => ownControllable(e) && canAttack(e));
      if (target && attackers.length && isEnemyOf(attackers[0], target))
        g.issue({ type: 'target', ids, targetId: target.id });
      else g.issue({ type: 'attackMove', ids, x, y });
      g.ping(x, y, 'attack');
    }
    if (!shift) g.mode = { type: 'normal' };
    g.uiVersion++;
  }

  // ---- Keyboard ------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const g = this.game;
    if (e.key.startsWith('Arrow')) {
      this.keys.add(e.key);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;

    if (e.key === 'Escape') {
      if (!g.cancelMode()) g.select([]);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      g.togglePause();
      return;
    }
    if (e.key === '-' || e.key === '=' || e.key === '+') {
      const i = SPEEDS.indexOf(g.speed as (typeof SPEEDS)[number]);
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (e.key === '-' ? -1 : 1)))];
      g.setSpeed(next);
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      const home = g.world.list((x) => ownControllable(x) && x.def === 'home')[0];
      if (home) {
        g.camera.x = home.x;
        g.camera.y = home.y;
      }
      return;
    }

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const action = computeActions(g).find((a) => a.hotkey === key);
    if (!action) return;
    e.preventDefault();
    if (action.disabled) g.notify(action.disabled);
    else action.run();
  }
}
