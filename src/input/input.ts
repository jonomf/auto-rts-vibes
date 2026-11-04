/**
 * Mouse & keyboard -> selection changes and sim commands.
 * Unity chain was InputController -> Interaction -> Selection -> HUD; here it is one module.
 */
import { DEFS } from '../sim/defs';
import { PLAYER } from '../sim/types';
import { anchorOf, snapFootprint } from '../automation/layout';
import { canAttack, isBuilding, isEnemyOf, isUnit } from '../sim/actions';
import type { Game } from '../game';
import { SPEEDS } from '../game';
import { computeActions, ownControllable } from '../ui/actions';

const DRAG_THRESHOLD = 5;
const PAN_SPEED = 900; // px/s
const DOUBLE_CLICK_MS = 300;

export const snapToGrid = snapFootprint;

export type WheelMode = 'auto' | 'pan' | 'zoom';

/** How long after a trackpad-looking scroll the rest of that gesture is still treated as a trackpad. */
const GESTURE_GAP_MS = 350;

/** Is this scroll a camera pan (trackpad swipe) or a zoom (mouse wheel)? */
export function classifyScroll(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'timeStamp'>,
  mode: WheelMode,
  lastTrackpadAt: number,
): 'pan' | 'zoom' {
  if (mode !== 'auto') return mode;
  if (e.deltaMode !== 0) return 'zoom'; // line/page steps: a mouse wheel
  if (e.timeStamp - lastTrackpadAt < GESTURE_GAP_MS) return 'pan';
  const fractional = !Number.isInteger(e.deltaY) || !Number.isInteger(e.deltaX);
  if (e.deltaX !== 0 || fractional || Math.abs(e.deltaY) < 40) return 'pan';
  return 'zoom';
}

export class Input {
  private keys = new Set<string>();
  /** Camera drag in progress: middle button, right button (if it moves), or Alt + left. */
  private panning: { x: number; y: number; x0: number; y0: number; button: number; moved: boolean } | null = null;
  private lastClick = { id: -1, at: 0 };
  /** When the last scroll event that looked like a trackpad arrived (gestures stay "trackpad" until they pause). */
  private trackpadAt = -Infinity;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly game: Game) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => (game.hoverScreen = { x: -1, y: -1 }));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key);
      // Alt is used for Alt + drag panning; don't let releasing it focus the browser menu.
      if (e.key === 'Alt') e.preventDefault();
    });
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
    // Middle drag, right drag and Alt + left drag move the camera.
    // A right press that doesn't move is still a right-click (handled on release).
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.panning = { x: p.x, y: p.y, x0: p.x, y0: p.y, button: e.button, moved: e.button !== 2 };
      this.canvas.setPointerCapture(e.pointerId);
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
    const pan = this.panning;
    if (pan) {
      if (!pan.moved && Math.hypot(p.x - pan.x0, p.y - pan.y0) >= DRAG_THRESHOLD) pan.moved = true;
      if (pan.moved) {
        this.game.camera.pan(p.x - pan.x, p.y - pan.y);
        this.canvas.style.cursor = 'grabbing';
      }
      pan.x = p.x;
      pan.y = p.y;
    }
    const inside = e.target === this.canvas || this.game.drag;
    if (inside) this.updateHover(p.x, p.y);
    if (this.game.drag) {
      this.game.drag.x1 = p.x;
      this.game.drag.y1 = p.y;
    }
  }

  private onUp(e: PointerEvent): void {
    const pan = this.panning;
    if (pan && e.button === pan.button) {
      this.panning = null;
      this.canvas.style.cursor = '';
      if (pan.button === 2 && !pan.moved) this.rightClick();
      return;
    }
    if (e.button !== 0 || !this.game.drag) return;
    const d = this.game.drag;
    this.game.drag = null;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) >= DRAG_THRESHOLD) this.boxSelect(d, e.shiftKey);
    else this.clickSelect(e.shiftKey);
  }

  /**
   * Scroll input. Trackpads: two-finger swipe pans, pinch zooms (browsers send pinch as
   * Ctrl + wheel). Mouse wheels zoom. In "auto", a scroll counts as a trackpad when it
   * has sideways movement or small / fractional steps; mouse wheels click in big integer
   * steps (or in lines). Once a gesture looks like a trackpad, it stays one until it pauses.
   */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const cam = this.game.camera;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cam.height : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    if (e.ctrlKey) {
      // Pinch (or Ctrl + wheel). Pinch deltas are small, so they get more weight.
      const k = Math.abs(dy) < 20 ? 0.012 : 0.0025;
      cam.zoomAt(Math.exp(-dy * k), p.x, p.y);
      return;
    }
    if (classifyScroll(e, this.game.wheelMode, this.trackpadAt) === 'pan') {
      this.trackpadAt = e.timeStamp;
      cam.pan(-dx, -dy);
      return;
    }
    cam.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y);
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
    if (g.mode.type === 'layout') {
      this.removeSlotAt(g.hover.x, g.hover.y);
      return;
    }
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

    if (mode.type === 'layout') {
      const a = anchorOf(g.world, PLAYER);
      if (!a) {
        g.notify('Layout is relative to your Home, and there is none');
        return;
      }
      const lay = g.program.layout;
      if (mode.def === 'muster') lay.muster = { dx: Math.round((x - a.x) * 2) / 2, dy: Math.round((y - a.y) * 2) / 2 };
      else {
        const p = snapToGrid(mode.def, x, y);
        lay.slots.push({ def: mode.def, dx: p.x - a.x, dy: p.y - a.y });
      }
      g.programChanged();
      return;
    }

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

  private removeSlotAt(x: number, y: number): void {
    const g = this.game;
    const a = anchorOf(g.world, PLAYER);
    if (!a) return;
    const slots = g.program.layout.slots;
    const i = slots.findIndex((s) => {
      const h = DEFS[s.def].radius;
      return Math.abs(a.x + s.dx - x) <= h && Math.abs(a.y + s.dy - y) <= h;
    });
    if (i < 0) return;
    slots.splice(i, 1);
    g.programChanged();
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
    if (e.key === 'p' || e.key === 'P') {
      g.programsOpen = !g.programsOpen;
      g.uiVersion++;
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      const home = g.world.list((x) => ownControllable(x) && x.def === 'commandCenter')[0];
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
