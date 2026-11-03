import { DEFS, type DefId } from '../sim/defs';
import { checkPlacement, constructionProgress, constructionScale, isBuilding, isResource } from '../sim/actions';
import { TICK_RATE } from '../sim/world';
import { ENEMY, PLAYER, type Entity } from '../sim/types';
import type { Game } from '../game';
import { snapToGrid } from '../input/input';
import { anchorOf } from '../automation/layout';

/**
 * Canvas 2D renderer. Draws in world units (the context is scaled by the camera zoom),
 * interpolating unit positions between sim ticks by `alpha`.
 */

export const COLORS = {
  bg: '#0f1418',
  gridMinor: 'rgba(120,150,170,0.05)',
  gridMajor: 'rgba(120,150,170,0.10)',
  mapEdge: '#2a3641',
  player: '#3ea0ff',
  playerDark: '#163a5f',
  enemy: '#e8604a',
  enemyDark: '#5a221a',
  dummy: '#9aa0a8',
  dummyDark: '#3a3e44',
  minerals: '#6fdcff',
  mineralsDark: '#1b5a72',
  gas: '#8be37b',
  gasDark: '#25502a',
  selectOwn: '#9dffb8',
  selectOther: '#ffd479',
  selectEnemy: '#ff8b78',
  hpHigh: '#62e07a',
  hpMid: '#f2c14e',
  hpLow: '#ef5a4c',
  rally: '#ffd479',
  text: '#d8e2ea',
} as const;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly game: Game) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.game.camera.width = w;
    this.game.camera.height = h;
  }

  render(alpha: number): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const { world } = game;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cam.width, cam.height);

    // World-space transform.
    const z = cam.zoom;
    ctx.setTransform(
      z * this.dpr,
      0,
      0,
      z * this.dpr,
      (cam.width / 2 - cam.x * z) * this.dpr,
      (cam.height / 2 - cam.y * z) * this.dpr,
    );
    this.drawGrid();
    this.drawLayout();

    const entities = world.list();
    const pos = (e: Entity) => ({ x: e.px + (e.x - e.px) * alpha, y: e.py + (e.y - e.py) * alpha });

    // Order lines and rally points under everything else.
    for (const e of game.selected()) this.drawIntent(e, pos(e));

    for (const e of entities) if (isResource(e)) this.drawResource(e);
    for (const e of entities) if (isBuilding(e)) this.drawBuilding(e);
    for (const e of entities) if (game.selection.has(e.id)) this.drawSelection(e, pos(e));
    for (const e of entities) if (DEFS[e.def].category === 'unit' && !DEFS[e.def].flying) this.drawUnit(e, pos(e));
    for (const e of entities) if (DEFS[e.def].flying) this.drawUnit(e, pos(e));
    for (const e of entities) this.drawBars(e, pos(e));

    this.drawEffects(alpha);
    this.drawPings();
    this.drawPlacementGhost();

    // Screen-space overlays.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawWorldLabels(entities, pos);
    this.drawDragBox();
  }

  // ---- Background ---------------------------------------------------------------

  private drawGrid(): void {
    const { ctx, game } = this;
    const cam = game.camera;
    const { width, height } = game.world.map;
    const z = cam.zoom;
    const tl = cam.toWorld(0, 0);
    const br = cam.toWorld(cam.width, cam.height);
    const x0 = Math.max(0, Math.floor(tl.x));
    const x1 = Math.min(width, Math.ceil(br.x));
    const y0 = Math.max(0, Math.floor(tl.y));
    const y1 = Math.min(height, Math.ceil(br.y));

    ctx.fillStyle = '#121a20';
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 1 / z;
    for (const [style, step] of [
      [COLORS.gridMinor, 1],
      [COLORS.gridMajor, 4],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.mapEdge;
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(0, 0, width, height);
  }

  // ---- Entities -----------------------------------------------------------------

  private teamColors(e: Entity): [string, string] {
    if (DEFS[e.def].inert) return [COLORS.dummy, COLORS.dummyDark];
    if (e.team === PLAYER) return [COLORS.player, COLORS.playerDark];
    if (e.team === ENEMY) return [COLORS.enemy, COLORS.enemyDark];
    return [COLORS.text, '#333'];
  }

  private drawResource(e: Entity): void {
    const { ctx } = this;
    const d = DEFS[e.def];
    const z = this.game.camera.zoom;
    const fullness = 0.55 + 0.45 * (e.remaining / (d.resource?.amount ?? 1));
    if (d.resource?.type === 'minerals') {
      const s = d.radius * fullness;
      const crystals: [number, number, number][] = [
        [-0.45, 0.2, 0.8],
        [0.42, 0.25, 0.7],
        [0, -0.15, 1.05],
      ];
      for (const [ox, oy, k] of crystals) {
        const cx = e.x + ox * d.radius;
        const cy = e.y + oy * d.radius;
        const w = s * 0.55 * k;
        const h = s * 1.1 * k;
        ctx.beginPath();
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx + w, cy - h * 0.2);
        ctx.lineTo(cx + w * 0.6, cy + h * 0.55);
        ctx.lineTo(cx - w * 0.6, cy + h * 0.55);
        ctx.lineTo(cx - w, cy - h * 0.2);
        ctx.closePath();
        ctx.fillStyle = COLORS.minerals;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.mineralsDark;
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
      }
    } else {
      const r = d.radius;
      ctx.fillStyle = COLORS.gasDark;
      roundRect(ctx, e.x - r, e.y - r, r * 2, r * 2, r * 0.35);
      ctx.fill();
      ctx.strokeStyle = COLORS.gas;
      ctx.lineWidth = 1.5 / z;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.55 * fullness, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.gas;
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.game.time * 2 + e.id);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }

  private drawBuilding(e: Entity): void {
    const { ctx } = this;
    const z = this.game.camera.zoom;
    const full = DEFS[e.def].radius;
    const [fill, dark] = this.teamColors(e);

    if (!e.complete) {
      // Footprint outline + growing blueprint (Unity: BuildingUnderConstruction material + UpdateScale).
      ctx.setLineDash([0.35, 0.25]);
      ctx.strokeStyle = fill;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5 / z;
      ctx.strokeRect(e.x - full, e.y - full, full * 2, full * 2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const h = full * constructionScale(e);
      ctx.fillStyle = dark;
      ctx.globalAlpha = 0.75;
      roundRect(ctx, e.x - h, e.y - h, h * 2, h * 2, h * 0.15);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = fill;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      for (let k = -2 * h; k < 2 * h; k += 0.45) {
        ctx.moveTo(e.x - h + k, e.y + h);
        ctx.lineTo(e.x - h + k + 2 * h, e.y - h);
      }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 2 / z;
      roundRect(ctx, e.x - h, e.y - h, h * 2, h * 2, h * 0.15);
      ctx.stroke();
      return;
    }

    const h = full;
    ctx.fillStyle = dark;
    roundRect(ctx, e.x - h, e.y - h, h * 2, h * 2, h * 0.18);
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2.5 / z;
    ctx.stroke();
    this.drawBuildingGlyph(e.def, e.x, e.y, h, fill, z);

    // Production progress ring.
    const item = e.queue[0];
    if (item) {
      const t = item.elapsed / (DEFS[item.def].buildTime ?? 1);
      ctx.beginPath();
      ctx.arc(e.x, e.y, h * 0.32, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ctx.strokeStyle = COLORS.selectOwn;
      ctx.lineWidth = 3 / z;
      ctx.stroke();
    }
  }

  private drawBuildingGlyph(def: DefId, x: number, y: number, h: number, color: string, z: number): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2 / z;
    switch (def) {
      case 'home': {
        const a = h * 0.55;
        roundRect(ctx, x - a, y - a, a * 2, a * 2, a * 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - a * 0.55, y + a * 0.2);
        ctx.lineTo(x, y - a * 0.45);
        ctx.lineTo(x + a * 0.55, y + a * 0.2);
        ctx.moveTo(x - a * 0.35, y + a * 0.05);
        ctx.lineTo(x - a * 0.35, y + a * 0.55);
        ctx.lineTo(x + a * 0.35, y + a * 0.55);
        ctx.lineTo(x + a * 0.35, y + a * 0.05);
        ctx.stroke();
        break;
      }
      case 'infantryTraining':
        for (const k of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.arc(x + k * h * 0.42, y - h * 0.12, h * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(x + k * h * 0.42 - h * 0.09, y + h * 0.05, h * 0.18, h * 0.35);
        }
        break;
      case 'mechFactory': {
        const r = h * 0.42;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.78;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'port': {
        const r = h * 0.55;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - r * 0.45, y - r * 0.5);
        ctx.lineTo(x - r * 0.45, y + r * 0.5);
        ctx.moveTo(x + r * 0.45, y - r * 0.5);
        ctx.lineTo(x + r * 0.45, y + r * 0.5);
        ctx.moveTo(x - r * 0.45, y);
        ctx.lineTo(x + r * 0.45, y);
        ctx.stroke();
        break;
      }
      case 'dummyBunker': {
        ctx.save();
        roundRect(ctx, x - h * 0.8, y - h * 0.8, h * 1.6, h * 1.6, h * 0.1);
        ctx.clip();
        ctx.strokeStyle = COLORS.enemy;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = h * 0.16;
        ctx.beginPath();
        for (let k = -2 * h; k < 2 * h; k += h * 0.5) {
          ctx.moveTo(x - h + k, y + h);
          ctx.lineTo(x - h + k + 2 * h, y - h);
        }
        ctx.stroke();
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }

  private drawUnit(e: Entity, p: { x: number; y: number }): void {
    const { ctx } = this;
    const z = this.game.camera.zoom;
    const d = DEFS[e.def];
    const r = d.radius;
    const [fill, dark] = this.teamColors(e);
    const cos = Math.cos(e.facing);
    const sin = Math.sin(e.facing);

    switch (e.def) {
      case 'gatherer': {
        circle(ctx, p.x, p.y, r);
        ctx.fillStyle = dark;
        ctx.fill();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        // Tool arm.
        ctx.beginPath();
        ctx.moveTo(p.x + cos * r * 0.3, p.y + sin * r * 0.3);
        ctx.lineTo(p.x + cos * r * 1.25, p.y + sin * r * 1.25);
        ctx.stroke();
        if (e.cargo) {
          const cx = p.x + cos * r * 1.25;
          const cy = p.y + sin * r * 1.25;
          ctx.fillStyle = e.cargo.type === 'minerals' ? COLORS.minerals : COLORS.gas;
          if (e.cargo.type === 'minerals') {
            ctx.beginPath();
            ctx.moveTo(cx, cy - r * 0.45);
            ctx.lineTo(cx + r * 0.3, cy);
            ctx.lineTo(cx, cy + r * 0.45);
            ctx.lineTo(cx - r * 0.3, cy);
            ctx.closePath();
            ctx.fill();
          } else {
            circle(ctx, cx, cy, r * 0.35);
            ctx.fill();
          }
        }
        const src = this.game.world.get(e.sourceId);
        const res = src && DEFS[src.def].resource;
        if (e.order.type === 'gather' && e.order.phase === 'harvesting' && res) {
          const total = d.gather!.seconds[res.type];
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - Math.max(0, e.order.timer) / total));
          ctx.strokeStyle = res.type === 'minerals' ? COLORS.minerals : COLORS.gas;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1.5 / z;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'lightInfantry':
      case 'heavyInfantry': {
        const heavy = e.def === 'heavyInfantry';
        ctx.strokeStyle = fill;
        ctx.lineWidth = (heavy ? 3.5 : 2.5) / z;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + cos * r * 1.6, p.y + sin * r * 1.6);
        ctx.stroke();
        circle(ctx, p.x, p.y, r);
        ctx.fillStyle = heavy ? dark : fill;
        ctx.fill();
        ctx.lineWidth = (heavy ? 3 : 1.5) / z;
        ctx.strokeStyle = heavy ? fill : dark;
        ctx.stroke();
        if (heavy) {
          circle(ctx, p.x, p.y, r * 0.45);
          ctx.fillStyle = fill;
          ctx.fill();
        }
        break;
      }
      case 'tank': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(e.facing);
        ctx.fillStyle = dark;
        roundRect(ctx, -r * 1.1, -r * 0.85, r * 2.2, r * 1.7, r * 0.25);
        ctx.fill();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        // Treads.
        ctx.fillStyle = fill;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-r * 1.1, -r * 0.85, r * 2.2, r * 0.3);
        ctx.fillRect(-r * 1.1, r * 0.55, r * 2.2, r * 0.3);
        ctx.globalAlpha = 1;
        // Turret.
        ctx.lineWidth = 4 / z;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(r * 1.6, 0);
        ctx.stroke();
        circle(ctx, 0, 0, r * 0.45);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'ship': {
        // Shadow on the ground, hull drawn "above" it.
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(p.x + 0.15, p.y + 0.55, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        const hy = p.y - 0.25;
        ctx.save();
        ctx.translate(p.x, hy);
        ctx.rotate(e.facing);
        ctx.beginPath();
        ctx.moveTo(r * 1.3, 0);
        ctx.lineTo(-r * 0.9, -r * 0.85);
        ctx.lineTo(-r * 0.45, 0);
        ctx.lineTo(-r * 0.9, r * 0.85);
        ctx.closePath();
        ctx.fillStyle = dark;
        ctx.fill();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        circle(ctx, r * 0.2, 0, r * 0.22);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'dummy': {
        circle(ctx, p.x, p.y, r);
        ctx.fillStyle = COLORS.dummyDark;
        ctx.fill();
        ctx.strokeStyle = COLORS.dummy;
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        circle(ctx, p.x, p.y, r * 0.55);
        ctx.strokeStyle = COLORS.enemy;
        ctx.stroke();
        circle(ctx, p.x, p.y, r * 0.15);
        ctx.fillStyle = COLORS.enemy;
        ctx.fill();
        break;
      }
      default: {
        circle(ctx, p.x, p.y, r);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
  }

  private drawSelection(e: Entity, p: { x: number; y: number }): void {
    const { ctx } = this;
    const z = this.game.camera.zoom;
    const d = DEFS[e.def];
    ctx.strokeStyle =
      e.team === PLAYER && !d.inert ? COLORS.selectOwn : e.team === ENEMY ? COLORS.selectEnemy : COLORS.selectOther;
    ctx.lineWidth = 2 / z;
    if (d.category === 'unit') {
      const y = d.flying ? p.y + 0.55 : p.y;
      ctx.beginPath();
      ctx.ellipse(p.x, y + d.radius * 0.15, d.radius + 0.18, (d.radius + 0.18) * (d.flying ? 0.55 : 0.9), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const h = d.radius + 0.2;
      // Corner brackets.
      const c = Math.min(0.6, h * 0.4);
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        ctx.moveTo(e.x + sx * h, e.y + sy * (h - c));
        ctx.lineTo(e.x + sx * h, e.y + sy * h);
        ctx.lineTo(e.x + sx * (h - c), e.y + sy * h);
      }
      ctx.stroke();
    }
  }

  private drawBars(e: Entity, p: { x: number; y: number }): void {
    const d = DEFS[e.def];
    if (d.category === 'resource') return;
    const selected = this.game.selection.has(e.id);
    const damaged = e.hp < d.hp;
    if (!selected && !damaged) return;
    const { ctx } = this;
    const frac = Math.max(0, e.hp / d.hp);
    const w = Math.max(0.9, d.radius * 2);
    const y = (d.category === 'unit' ? p.y : e.y) - d.radius - (d.flying ? 0.75 : 0.35);
    const x = (d.category === 'unit' ? p.x : e.x) - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 0.03, y - 0.03, w + 0.06, 0.18);
    ctx.fillStyle = frac > 0.6 ? COLORS.hpHigh : frac > 0.3 ? COLORS.hpMid : COLORS.hpLow;
    ctx.fillRect(x, y, w * frac, 0.12);
  }

  /** Where selected units are headed / where buildings rally to. */
  private drawIntent(e: Entity, p: { x: number; y: number }): void {
    const { ctx } = this;
    const { world } = this.game;
    const z = this.game.camera.zoom;
    let target: { x: number; y: number } | undefined;
    let color: string = COLORS.selectOwn;

    if (isBuilding(e) && e.rally) {
      target = e.rally.kind === 'point' ? e.rally : world.get(e.rally.id);
      color = COLORS.rally;
    } else {
      const o = e.order;
      if (o.type === 'move' || o.type === 'build') target = o;
      else if (o.type === 'attackMove') {
        target = o;
        color = COLORS.selectEnemy;
      } else if (o.type === 'attack' || o.type === 'follow') {
        target = world.get(o.targetId);
        if (o.type === 'attack') color = COLORS.selectEnemy;
      } else if (o.type === 'gather') {
        target = o.phase === 'toDeposit' ? world.get(e.depositId) : world.get(e.sourceId);
        color = 'rgba(111,220,255,0.6)';
      }
    }
    if (!target || e.team !== PLAYER) return;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([0.25, 0.2]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (isBuilding(e)) {
      // Little flag.
      ctx.strokeStyle = COLORS.rally;
      ctx.fillStyle = COLORS.rally;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.lineTo(target.x, target.y - 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(target.x, target.y - 0.9);
      ctx.lineTo(target.x + 0.5, target.y - 0.72);
      ctx.lineTo(target.x, target.y - 0.55);
      ctx.fill();
    }
  }

  // ---- Effects & overlays -------------------------------------------------------------

  private drawEffects(alpha: number): void {
    const { ctx, game } = this;
    const z = game.camera.zoom;
    const now = game.world.tick + alpha;
    for (const fx of game.world.effects) {
      const age = (now - fx.tick) / TICK_RATE;
      if (fx.type === 'shot') {
        const life = 0.12;
        if (age > life) continue;
        ctx.globalAlpha = 1 - age / life;
        ctx.strokeStyle = fx.heavy ? '#ffb15a' : '#fff2b0';
        ctx.lineWidth = (fx.heavy ? 3.5 : 1.8) / z;
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();
        circle(ctx, fx.x2, fx.y2, fx.heavy ? 0.22 : 0.12);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else if (fx.type === 'death') {
        const life = 0.55;
        if (age > life) continue;
        const t = age / life;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffb15a';
        ctx.lineWidth = 3 / z;
        circle(ctx, fx.x, fx.y, fx.radius * (0.6 + t * 1.4));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPings(): void {
    const { ctx, game } = this;
    const z = game.camera.zoom;
    for (const p of game.pings) {
      const t = (game.time - p.t) / 0.6;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.kind === 'attack' ? COLORS.selectEnemy : p.kind === 'rally' ? COLORS.rally : COLORS.selectOwn;
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 0.25 + t * 0.6, (0.25 + t * 0.6) * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Program layout slots + muster point (when editing the base or the layout). */
  private drawLayout(): void {
    const { game, ctx } = this;
    const show = game.mode.type === 'layout' || (game.programsOpen && game.scope === 'base');
    if (!show) return;
    const a = anchorOf(game.world, PLAYER);
    if (!a) return;
    const z = game.camera.zoom;
    const lay = game.program.layout;
    const editing = game.mode.type === 'layout';
    const seen = new Map<DefId, number>();
    ctx.font = `600 ${11 / z}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const slot of lay.slots) {
      const n = (seen.get(slot.def) ?? 0) + 1;
      seen.set(slot.def, n);
      const h = DEFS[slot.def].radius;
      const x = a.x + slot.dx;
      const y = a.y + slot.dy;
      const taken = game.world.list((e) => e.def === slot.def && Math.abs(e.x - x) < 0.6 && Math.abs(e.y - y) < 0.6).length > 0;
      ctx.globalAlpha = taken ? 0.25 : editing ? 0.85 : 0.55;
      ctx.setLineDash([0.3, 0.22]);
      ctx.strokeStyle = COLORS.rally;
      ctx.lineWidth = 1.5 / z;
      ctx.strokeRect(x - h, y - h, h * 2, h * 2);
      ctx.setLineDash([]);
      if (!taken) {
        ctx.globalAlpha *= 0.5;
        this.drawBuildingGlyph(slot.def, x, y, h, COLORS.rally, z);
        ctx.globalAlpha = editing ? 0.9 : 0.6;
        ctx.fillStyle = COLORS.rally;
        ctx.fillText(`${SHORT[slot.def] ?? ''}${n}`, x, y + h - 0.35);
      }
    }
    // Muster flag.
    const m = { x: a.x + lay.muster.dx, y: a.y + lay.muster.dy };
    ctx.globalAlpha = editing ? 1 : 0.75;
    ctx.strokeStyle = COLORS.selectEnemy;
    ctx.fillStyle = COLORS.selectEnemy;
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 0.9, 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x, m.y - 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - 1.3);
    ctx.lineTo(m.x + 0.7, m.y - 1.05);
    ctx.lineTo(m.x, m.y - 0.8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawPlacementGhost(): void {
    const { game, ctx } = this;
    const mode = game.mode;
    if (mode.type === 'layout' && mode.def !== 'muster' && game.hoverScreen.x >= 0) {
      const z = game.camera.zoom;
      const h = DEFS[mode.def].radius;
      const { x, y } = snapToGrid(mode.def, game.hover.x, game.hover.y);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = COLORS.rally;
      ctx.lineWidth = 2 / z;
      ctx.strokeRect(x - h, y - h, h * 2, h * 2);
      this.drawBuildingGlyph(mode.def, x, y, h, COLORS.rally, z);
      ctx.globalAlpha = 1;
      return;
    }
    if (mode.type !== 'place' || game.hoverScreen.x < 0) return;
    const z = game.camera.zoom;
    const h = DEFS[mode.def].radius;
    const { x, y } = snapToGrid(mode.def, game.hover.x, game.hover.y);
    const valid = checkPlacement(game.world, mode.def, x, y).ok;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = valid ? COLORS.selectOwn : COLORS.hpLow;
    ctx.fillRect(x - h, y - h, h * 2, h * 2);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = valid ? COLORS.selectOwn : COLORS.hpLow;
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(x - h, y - h, h * 2, h * 2);
    ctx.globalAlpha = 0.6;
    this.drawBuildingGlyph(mode.def, x, y, h, valid ? COLORS.selectOwn : COLORS.hpLow, z);
    ctx.globalAlpha = 1;
  }

  private drawWorldLabels(entities: Entity[], pos: (e: Entity) => { x: number; y: number }): void {
    const { ctx, game } = this;
    const cam = game.camera;
    if (cam.zoom < 14) return;
    ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const e of entities) {
      const d = DEFS[e.def];
      let label = '';
      if (isBuilding(e) && !e.complete) label = `${Math.round(constructionProgress(e) * 100)}%`;
      else if (isResource(e) && game.selection.has(e.id)) label = `${e.remaining}`;
      if (!label) continue;
      const p = d.category === 'unit' ? pos(e) : e;
      const s = cam.toScreen(p.x, p.y + d.radius + 0.25);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const w = ctx.measureText(label).width + 8;
      ctx.fillRect(s.x - w / 2, s.y - 1, w, 15);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(label, s.x, s.y + 1);
    }

    // Floating "+25" on deliveries.
    const now = game.world.tick;
    for (const fx of game.world.effects) {
      if (fx.type !== 'deposit') continue;
      const age = (now - fx.tick) / TICK_RATE;
      if (age > 0.55) continue;
      const s = cam.toScreen(fx.x, fx.y);
      ctx.globalAlpha = 1 - age / 0.55;
      ctx.fillStyle = fx.resource === 'minerals' ? COLORS.minerals : COLORS.gas;
      ctx.fillText(`+${fx.amount}`, s.x, s.y - age * 40);
    }
    ctx.globalAlpha = 1;
  }

  private drawDragBox(): void {
    const { ctx, game } = this;
    const d = game.drag;
    if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 5) return;
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const w = Math.abs(d.x1 - d.x0);
    const h = Math.abs(d.y1 - d.y0);
    ctx.fillStyle = 'rgba(157,255,184,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.selectOwn;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
}

const SHORT: Partial<Record<DefId, string>> = { home: 'H', infantryTraining: 'IT', mechFactory: 'MF', port: 'P' };

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
