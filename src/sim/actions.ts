/**
 * Shared game rules used by both commands (player/automation input) and systems.
 */
import { CONSTRUCTION_START_SCALE, DEFS, MAX_QUEUE, costOf, isAddon, type AddonId, type Attack, type DefId } from './defs';
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
export const canAttack = (e: Entity) => DEFS[e.def].attack !== undefined && !DEFS[e.def].inert;
export const isHealer = (e: Entity) => DEFS[e.def].heal !== undefined;
export const isEnemyOf = (a: Entity, b: Entity) =>
  a.team !== NEUTRAL && b.team !== NEUTRAL && a.team !== b.team;
export const hasTag = (e: Entity, tag: string) => DEFS[e.def].tags?.includes(tag as never) ?? false;

/** The weapon a unit is using right now (sieged tanks use their siege weapon). */
export function weaponOf(e: Entity): Attack | undefined {
  const d = DEFS[e.def];
  return e.sieged && d.siege ? d.siege : d.attack;
}

export function canHit(attacker: Entity, target: Entity): boolean {
  const atk = weaponOf(attacker);
  if (!atk || DEFS[attacker.def].inert || !isEnemyOf(attacker, target)) return false;
  return isFlying(target) ? atk.hitsAir : atk.hitsGround;
}

/** Damage of one hit after the target's armor (SC2: never below 0.5). */
export function hitDamage(atk: Attack, target: Entity): number {
  const bonus = atk.bonus && hasTag(target, atk.bonus.vs) ? atk.bonus.damage : 0;
  return Math.max(0.5, atk.damage + bonus - (DEFS[target.def].armor ?? 0));
}

// ---- Requirements & placement -------------------------------------------------------

export function missingRequirement(world: World, team: Team, def: DefId): DefId | undefined {
  return DEFS[def].requires?.find((req) => !world.hasCompleted(team, req));
}

/** The geyser under a point, if any (Refineries snap onto it). */
export function geyserAt(world: World, x: number, y: number): Entity | undefined {
  return world.list((e) => e.def === 'gasSource' && Math.abs(e.x - x) < 1 && Math.abs(e.y - y) < 1)[0];
}

/** An own, finished Refinery sitting on this geyser? (Gas can only be harvested through one.) */
export function refineryOn(world: World, geyser: Entity, team: Team): Entity | undefined {
  return world.list((e) => e.def === 'refinery' && e.team === team && e.x === geyser.x && e.y === geyser.y)[0];
}

/** Can `team` harvest this resource now? Minerals: yes. Gas: only through a finished Refinery. */
export function canHarvest(world: World, source: Entity, team: Team): boolean {
  if (DEFS[source.def].resource?.type !== 'gas') return true;
  return refineryOn(world, source, team)?.complete === true;
}

export function checkPlacement(world: World, def: DefId, x: number, y: number, ignore?: Entity): CommandResult {
  const d = DEFS[def];
  if (d.onGeyser) {
    const g = geyserAt(world, x, y);
    if (!g) return fail(`${d.name} must be placed on a Vespene Geyser`);
    const taken = world.list((e) => e.def === def && e.x === g.x && e.y === g.y);
    return taken.length ? fail('That geyser already has a Refinery') : ok;
  }
  const half = d.radius;
  const { width, height } = world.map;
  if (x - half < 0 || y - half < 0 || x + half > width || y + half > height)
    return fail('Outside the map');
  for (const e of world.all()) {
    if (isUnit(e) || e === ignore) continue; // units get out of the way
    if (squaresOverlap(x, y, half, e.x, e.y, DEFS[e.def].radius, 0.3))
      return fail(`Blocked by ${DEFS[e.def].name}`);
  }
  return ok;
}

/** Where an attached add-on goes: right of its building, bottom edges aligned (as in Starcraft). */
export function addonSpot(b: Entity): { x: number; y: number } {
  const r = DEFS[b.def].radius;
  const a = DEFS.techLab.radius;
  return { x: b.x + r + a, y: b.y + r - a };
}

/** Is a building busy building its add-on? */
export const buildingAddon = (b: Entity) => b.queue.some((q) => isAddon(q.def));

export function checkAddon(world: World, b: Entity, def: AddonId, ignoreCost = false): CommandResult {
  const d = DEFS[b.def];
  if (!d.addons?.includes(def)) return fail(`${d.name} can't take a ${DEFS[def].name}`);
  if (!b.complete) return fail(`${d.name} is still under construction`);
  if (b.addon || buildingAddon(b)) return fail(`${d.name} already has an add-on`);
  if (b.queue.length > 0) return fail(`${d.name} is busy training`);
  if (world.ruleset.addons === 'attached') {
    const spot = addonSpot(b);
    const place = checkPlacement(world, def, spot.x, spot.y, b);
    if (!place.ok) return fail(`No room for the ${DEFS[def].name}: ${place.reason.toLowerCase()}`);
  }
  if (ignoreCost) return ok;
  const c = costOf(def);
  if (b.stock.minerals < c.minerals) return fail(`Needs ${c.minerals} minerals in this building (has ${b.stock.minerals})`);
  if (b.stock.gas < c.gas) return fail(`Needs ${c.gas} gas in this building (has ${b.stock.gas})`);
  return ok;
}

/** Can this building train `def` right now? Pure check -- spends nothing. */
export function checkTrain(world: World, building: Entity, def: DefId): CommandResult {
  const d = DEFS[building.def];
  if (!d.trains?.includes(def)) return fail(`${d.name} can't train ${DEFS[def].name}`);
  if (!building.complete) return fail(`${d.name} is still under construction`);
  const req = missingRequirement(world, building.team, def);
  if (req) return fail(`Requires ${DEFS[req].name}`);
  const need = DEFS[def].needsAddon;
  if (need && building.addon !== need) return fail(`Requires a ${DEFS[need].name} on this ${d.name}`);
  if (buildingAddon(building)) return fail(`${d.name} is building its add-on`);
  if (building.queue.length >= MAX_QUEUE) return fail('Queue is full');
  if (world.ruleset.supply === 'hard') {
    const s = world.supply(building.team);
    const want = DEFS[def].supply ?? 0;
    if (want > 0 && s.used + want > s.cap) return fail(`Not enough supply (${s.used}/${s.cap}): build Supply Depots`);
  }
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
    world.nearest(g, (e) => e.team === g.team && e.def === 'commandCenter' && e.complete) ??
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
  if (s && s.remaining > 0 && canHarvest(world, s, g.team)) return s;
  if (g.sourceId == null) return undefined;
  const oldType = s ? DEFS[s.def].resource?.type : undefined;
  let best: Entity | undefined;
  let bestD = 8;
  for (const e of world.all()) {
    const r = DEFS[e.def].resource;
    if (!r || e.remaining <= 0 || (oldType && r.type !== oldType) || !canHarvest(world, e, g.team)) continue;
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
    // Right-clicking a Refinery means "harvest its geyser".
    if (target.def === 'refinery' && target.team === unit.team) {
      const g = geyserAt(world, target.x, target.y);
      if (g && target.complete) {
        setSource(unit, g);
        resumeGathering(world, unit);
        return;
      }
    }
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

/** One volley: every hit pays armor; splash hurts other enemies near the target; some weapons slow. */
export function dealDamage(world: World, attacker: Entity, target: Entity): void {
  const atk = weaponOf(attacker);
  if (!atk) return;
  const hits = atk.hits ?? 1;
  target.hp -= hitDamage(atk, target) * hits;
  if (atk.slow) target.slowed = 1.5;
  world.effects.push({
    type: 'shot',
    tick: world.tick,
    x1: attacker.x,
    y1: attacker.y,
    x2: target.x,
    y2: target.y,
    heavy: atk.damage >= 14 || !!atk.splash,
  });
  if (atk.splash) {
    const { full, radius } = atk.splash;
    world.effects.push({ type: 'splash', tick: world.tick, x: target.x, y: target.y, radius });
    for (const e of world.all()) {
      if (e === target || !isEnemyOf(attacker, e) || isFlying(e) !== isFlying(target)) continue;
      const d = Math.hypot(e.x - target.x, e.y - target.y) - DEFS[e.def].radius;
      if (d > radius) continue;
      e.hp -= hitDamage(atk, e) * hits * (d <= full ? 1 : 0.5);
      if (e.hp <= 0) world.kill(e);
    }
  }
  if (target.hp <= 0) world.kill(target);
  if (atk.suicide) world.kill(attacker);
}
