/**
 * Shared game rules used by both commands (player/automation input) and systems.
 */
import { CONSTRUCTION_START_SCALE, DEFS, MAX_QUEUE, costOf, type DefId } from './defs';
import { squaresOverlap } from './geometry';
import type { CommandResult, Entity, Team } from './types';
import { NEUTRAL } from './types';
import type { World } from './world';

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

// ---- Classification ----------------------------------------------------------

export const isUnit = (e: Entity) => DEFS[e.def].category === 'unit';
export const isBuilding = (e: Entity) => DEFS[e.def].category === 'building';
export const isResource = (e: Entity) => DEFS[e.def].category === 'resource';
export const isGatherer = (e: Entity) => DEFS[e.def].gather !== undefined;
export const isFlying = (e: Entity) => DEFS[e.def].flying === true;
export const canAttack = (e: Entity) => DEFS[e.def].attack !== undefined;
export const isEnemyOf = (a: Entity, b: Entity) =>
  a.team !== NEUTRAL && b.team !== NEUTRAL && a.team !== b.team;

export function canHit(attacker: Entity, target: Entity): boolean {
  const atk = DEFS[attacker.def].attack;
  if (!atk || !isEnemyOf(attacker, target)) return false;
  return isFlying(target) ? atk.hitsAir : atk.hitsGround;
}

// ---- Requirements & placement -------------------------------------------------------

export function missingRequirement(world: World, team: Team, def: DefId): DefId | undefined {
  return DEFS[def].requires?.find((req) => !world.hasCompleted(team, req));
}

export function checkPlacement(world: World, def: DefId, x: number, y: number): CommandResult {
  const half = DEFS[def].radius;
  const { width, height } = world.map;
  if (x - half < 0 || y - half < 0 || x + half > width || y + half > height)
    return fail('Outside the map');
  for (const e of world.all()) {
    if (isUnit(e)) continue; // units get out of the way
    if (squaresOverlap(x, y, half, e.x, e.y, DEFS[e.def].radius, 0.3))
      return fail(`Blocked by ${DEFS[e.def].name}`);
  }
  return ok;
}

/** Can this building train `def` right now? Pure check -- spends nothing. */
export function checkTrain(world: World, building: Entity, def: DefId): CommandResult {
  const d = DEFS[building.def];
  if (!d.trains?.includes(def)) return fail(`${d.name} can't train ${DEFS[def].name}`);
  if (!building.complete) return fail(`${d.name} is still under construction`);
  const req = missingRequirement(world, building.team, def);
  if (req) return fail(`Requires ${DEFS[req].name}`);
  if (building.queue.length >= MAX_QUEUE) return fail('Queue is full');
  const c = costOf(def);
  if (building.stock.minerals < c.minerals)
    return fail(`Needs ${c.minerals} minerals in this building (has ${building.stock.minerals})`);
  if (building.stock.gas < c.gas)
    return fail(`Needs ${c.gas} gas in this building (has ${building.stock.gas})`);
  return ok;
}

// ---- Construction by delivery -------------------------------------------------------

/** Remaining construction debt (Unity: Building.TotalResourcesRemaining). */
export const constructionDebt = (b: Entity) =>
  Math.max(0, -b.stock.minerals) + Math.max(0, -b.stock.gas);

/** 0..1 delivered fraction of a blueprint's cost. */
export const constructionProgress = (b: Entity) =>
  b.complete || b.required <= 0 ? 1 : 1 - constructionDebt(b) / b.required;

/** Visual scale of a blueprint (Unity: Building.UpdateScale). */
export const constructionScale = (b: Entity) =>
  CONSTRUCTION_START_SCALE + (1 - CONSTRUCTION_START_SCALE) * constructionProgress(b);

/** Place a blueprint whose cost is paid by gatherers hauling resources to it. */
export function placeBlueprint(world: World, def: DefId, team: Team, x: number, y: number): Entity {
  const c = costOf(def);
  const required = c.minerals + c.gas;
  const b = world.spawn(def, team, x, y, {
    complete: required === 0,
    stock: { minerals: c.minerals ? -c.minerals : 0, gas: c.gas ? -c.gas : 0 },
    required,
  });
  if (!b.complete) b.hp = Math.max(1, Math.round(DEFS[def].hp * 0.1));
  return b;
}

/** Add a delivered resource to a building's stockpile; completes blueprints whose debt is paid. */
export function receiveCargo(world: World, building: Entity, gatherer: Entity): void {
  const cargo = gatherer.cargo;
  if (!cargo) return;
  const before = constructionProgress(building);
  building.stock[cargo.type] += cargo.amount;
  gatherer.cargo = null;
  world.effects.push({
    type: 'deposit',
    tick: world.tick,
    x: building.x,
    y: building.y - DEFS[building.def].radius - 0.2,
    resource: cargo.type,
    amount: cargo.amount,
  });

  if (building.complete) return;
  const maxHp = DEFS[building.def].hp;
  building.hp = Math.min(maxHp, building.hp + (constructionProgress(building) - before) * maxHp * 0.9);
  if (building.stock.minerals >= 0 && building.stock.gas >= 0) {
    building.complete = true;
    building.hp = maxHp;
  }
}

// ---- Gathering --------------------------------------------------------------------

/** Where a gatherer should deliver: its chosen target, else the nearest completed Home. */
export function resolveDeposit(world: World, g: Entity): Entity | undefined {
  const chosen = world.get(g.depositId);
  if (chosen && isBuilding(chosen) && chosen.team === g.team) return chosen;
  const fallback =
    world.nearest(g, (e) => e.team === g.team && e.def === 'home' && e.complete) ??
    world.nearest(g, (e) => e.team === g.team && isBuilding(e) && e.complete && !DEFS[e.def].inert);
  g.depositId = fallback?.id ?? null;
  return fallback;
}

export function setSource(g: Entity, source: Entity): void {
  g.sourceId = source.id;
  g.sourceX = source.x;
  g.sourceY = source.y;
}

/** The gatherer's source, or a nearby one of the same type if it ran dry. */
export function resolveSource(world: World, g: Entity): Entity | undefined {
  const s = world.get(g.sourceId);
  if (s && s.remaining > 0) return s;
  if (g.sourceId == null) return undefined;
  const oldType = s ? DEFS[s.def].resource?.type : undefined;
  let best: Entity | undefined;
  let bestD = 8;
  for (const e of world.all()) {
    const r = DEFS[e.def].resource;
    if (!r || e.remaining <= 0 || (oldType && r.type !== oldType)) continue;
    const d = Math.hypot(e.x - g.sourceX, e.y - g.sourceY);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (best) setSource(g, best);
  else g.sourceId = null;
  return best;
}

/** Resume the gather loop: deliver if carrying, otherwise head to the source. */
export function resumeGathering(world: World, g: Entity): void {
  if (g.cargo) {
    g.order = { type: 'gather', phase: 'toDeposit', timer: 0 };
    return;
  }
  if (resolveSource(world, g)) g.order = { type: 'gather', phase: 'toSource', timer: 0 };
  else g.order = { type: 'idle' };
}

// ---- Rally points -------------------------------------------------------------------

/** Send a freshly trained unit to its building's rally point. */
export function applyRally(world: World, unit: Entity, building: Entity): void {
  const rally = building.rally;
  if (!rally) return;
  if (rally.kind === 'point') {
    unit.order = canAttack(unit)
      ? { type: 'attackMove', x: rally.x, y: rally.y, engagedId: null }
      : { type: 'move', x: rally.x, y: rally.y };
    return;
  }
  const target = world.get(rally.id);
  if (target) targetEntity(world, unit, target);
}

// ---- Contextual right-click -------------------------------------------------------------

/** One unit's response to "right-click on this entity". */
export function targetEntity(world: World, unit: Entity, target: Entity): void {
  if (target.id === unit.id) return;

  if (isGatherer(unit)) {
    if (isResource(target)) {
      setSource(unit, target);
      resumeGathering(world, unit);
      return;
    }
    if (isBuilding(target) && target.team === unit.team && !DEFS[target.def].inert) {
      unit.depositId = target.id;
      if (unit.cargo || world.get(unit.sourceId)) resumeGathering(world, unit);
      else unit.order = { type: 'follow', targetId: target.id };
      return;
    }
  }

  if (canHit(unit, target)) {
    unit.order = { type: 'attack', targetId: target.id };
    return;
  }

  unit.order = { type: 'follow', targetId: target.id };
}

// ---- Damage ---------------------------------------------------------------------------

export function dealDamage(world: World, attacker: Entity, target: Entity): void {
  const atk = DEFS[attacker.def].attack;
  if (!atk) return;
  target.hp -= atk.damage;
  world.effects.push({
    type: 'shot',
    tick: world.tick,
    x1: attacker.x,
    y1: attacker.y,
    x2: target.x,
    y2: target.y,
    heavy: atk.damage >= 14,
  });
  if (target.hp <= 0) world.kill(target);
}
