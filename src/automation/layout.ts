/** Where automated buildings go, and the named points rules can send units to. */
import { DEFS, type DefId } from '../sim/defs';
import { checkPlacement, isBuilding, isResource } from '../sim/actions';
import { squaresOverlap } from '../sim/geometry';
import { NEUTRAL, type Entity, type Team } from '../sim/types';
import type { World } from '../sim/world';
import type { Dest, Layout } from './types';

/** Snap a building center so its footprint edges land on the half-unit grid. */
export function snapFootprint(def: DefId, x: number, y: number): { x: number; y: number } {
  const h = DEFS[def].radius;
  return { x: Math.round((x - h) * 2) / 2 + h, y: Math.round((y - h) * 2) / 2 + h };
}

/** The main base: the team's oldest completed Home (layout offsets are relative to it). */
export function anchorOf(world: World, team: Team): Entity | undefined {
  for (const e of world.all()) if (e.team === team && e.def === 'home' && e.complete) return e;
  return undefined;
}

export function musterPoint(world: World, team: Team, layout: Layout): { x: number; y: number } | undefined {
  const a = anchorOf(world, team);
  if (!a) return undefined;
  return clampToMap(world, a.x + layout.muster.dx, a.y + layout.muster.dy);
}

/** Resolve a named destination to a point. */
export function destPoint(world: World, team: Team, layout: Layout, dest: Dest): { x: number; y: number } | undefined {
  const a = anchorOf(world, team);
  switch (dest) {
    case 'muster':
      return musterPoint(world, team, layout);
    case 'home':
      return a ? { x: a.x, y: a.y + DEFS.home.radius + 1.5 } : undefined;
    case 'enemy': {
      const enemies = world.list((e) => e.team !== team && e.team !== NEUTRAL);
      if (enemies.length === 0) return undefined;
      const ox = a?.x ?? world.map.width / 2;
      const oy = a?.y ?? world.map.height / 2;
      const score = (e: Entity) => (isBuilding(e) ? 0 : 1e6) + Math.hypot(e.x - ox, e.y - oy);
      const t = enemies.reduce((best, e) => (score(e) < score(best) ? e : best));
      return { x: t.x, y: t.y };
    }
  }
}

type Footprint = { x: number; y: number; half: number };

/** Buildings that gatherers are on their way to place (not yet on the map). */
export function pendingFootprints(world: World, team: Team): Footprint[] {
  const out: Footprint[] = [];
  for (const u of world.all())
    if (u.team === team && u.order.type === 'build')
      out.push({ x: u.order.x, y: u.order.y, half: DEFS[u.order.def].radius });
  return out;
}

function siteOk(world: World, def: DefId, x: number, y: number, pending: Footprint[]): boolean {
  if (!checkPlacement(world, def, x, y).ok) return false;
  const half = DEFS[def].radius;
  return !pending.some((p) => squaresOverlap(x, y, half, p.x, p.y, p.half, 0.3));
}

/**
 * Pick a site for `def`: the first free layout slot for that building type, else the
 * nearest open ground around the main Home that keeps clear of resources.
 */
export function findSite(world: World, team: Team, layout: Layout, def: DefId): { x: number; y: number } | undefined {
  const a = anchorOf(world, team);
  if (!a) return undefined;
  const pending = pendingFootprints(world, team);

  for (const slot of layout.slots) {
    if (slot.def !== def) continue;
    const p = snapFootprint(def, a.x + slot.dx, a.y + slot.dy);
    if (siteOk(world, def, p.x, p.y, pending)) return p;
  }

  const half = DEFS[def].radius;
  const resources = world.list(isResource);
  for (let r = 4; r <= 20; r += 1) {
    const steps = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const p = snapFootprint(def, a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
      if (resources.some((res) => Math.hypot(res.x - p.x, res.y - p.y) < half + DEFS[res.def].radius + 2.5)) continue;
      if (siteOk(world, def, p.x, p.y, pending)) return p;
    }
  }
  return undefined;
}

function clampToMap(world: World, x: number, y: number) {
  return { x: Math.min(world.map.width - 1, Math.max(1, x)), y: Math.min(world.map.height - 1, Math.max(1, y)) };
}
