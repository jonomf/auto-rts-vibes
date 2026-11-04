import { DEFS, HAUL_LOAD, STIM_FACTOR } from '../defs';
import { edgeDist, pointToSquare } from '../geometry';
import {
  canAttack,
  canHit,
  checkPlacement,
  dealDamage,
  isUnit,
  placeBlueprint,
  receiveCargo,
  resolveDeposit,
  resolveSource,
  resumeGathering,
  setSource,
  weaponOf,
} from '../actions';
import type { Entity } from '../types';
import type { World } from '../world';

/** Edge gap that counts as "touching" for gathering, delivering and building. */
export const TOUCH = 0.15;
/** Units notice enemies this far beyond their weapon range. */
export const ACQUIRE_BONUS = 2.5;
/** Scenario defenders give up a chase this far from their post. */
export const LEASH = 10;
const POINT_ARRIVE = 0.1;

/** Can this unit walk right now? (Sieged or deploying tanks can't.) */
export const canMove = (u: Entity) => !u.sieged && u.deploying <= 0;

/** Runs every unit's current order for one tick. */
export function unitSystem(world: World, dt: number): void {
  for (const u of world.list(isUnit)) {
    if (u.cooldown > 0) u.cooldown = Math.max(0, u.cooldown - dt);
    if (DEFS[u.def].inert) continue;
    if (u.deploying > 0) continue; // mid siege / unsiege: can't do anything else

    // Defenders return to their post instead of chasing forever.
    if (u.leash && Math.hypot(u.x - u.leash.x, u.y - u.leash.y) > LEASH && u.order.type !== 'move') {
      u.order = { type: 'move', x: u.leash.x, y: u.leash.y };
    }

    const order = u.order;
    // A sieged tank told to go somewhere packs up first (the status system finishes the transition).
    if (u.sieged && wantsToMove(world, u)) {
      startDeploy(u, false);
      continue;
    }

    switch (order.type) {
      case 'idle': {
        if (!canAttack(u)) break;
        const enemy = acquire(world, u);
        if (enemy) {
          u.order = { type: 'attack', targetId: enemy.id };
          engage(world, u, enemy, dt);
        }
        break;
      }

      case 'move':
        if (moveToPoint(u, order.x, order.y, dt)) u.order = { type: 'idle' };
        break;

      case 'follow': {
        const t = world.get(order.targetId);
        if (!t || moveToEntity(u, t, dt, 0.5)) u.order = { type: 'idle' };
        break;
      }

      case 'attack': {
        const t = world.get(order.targetId);
        if (!t || !canHit(u, t)) u.order = { type: 'idle' };
        else engage(world, u, t, dt);
        break;
      }

      case 'attackMove': {
        if (!canAttack(u)) {
          // Healers "attack-move" by walking with the army; the status system heals on the way.
          if (moveToPoint(u, order.x, order.y, dt)) u.order = { type: 'idle' };
          break;
        }
        let t = world.get(order.engagedId);
        if (!t || !canHit(u, t)) {
          t = acquire(world, u);
          order.engagedId = t?.id ?? null;
        }
        if (t) engage(world, u, t, dt);
        else if (moveToPoint(u, order.x, order.y, dt)) u.order = { type: 'idle' };
        break;
      }

      case 'gather':
        gatherStep(world, u, dt);
        break;

      case 'haul':
        haulStep(world, u, dt);
        break;

      case 'build': {
        const half = DEFS[order.def].radius;
        const gap = pointToSquare(u.x, u.y, order.x, order.y, half) - DEFS[u.def].radius;
        if (gap > TOUCH) {
          stepToward(u, order.x, order.y, dt);
          break;
        }
        if (!checkPlacement(world, order.def, order.x, order.y).ok) {
          u.order = { type: 'idle' };
          break;
        }
        // Unity: PlacementIndicator.Realize -> StartConstruction -> SetDepositTargetAndGather.
        const blueprint = placeBlueprint(world, order.def, u.team, order.x, order.y);
        u.depositId = blueprint.id;
        if (!world.get(u.sourceId)) {
          const minerals = world.nearest(u, (e) => e.def === 'mineralSource' && e.remaining > 0);
          if (minerals) setSource(u, minerals);
        }
        resumeGathering(world, u);
        break;
      }
    }
  }
}

/** Does the unit's order need it to walk somewhere it isn't? */
function wantsToMove(world: World, u: Entity): boolean {
  const o = u.order;
  if (o.type === 'move') return Math.hypot(o.x - u.x, o.y - u.y) > 1;
  if (o.type === 'follow') return true;
  // Attack-moving: stay deployed while the siege cannon still has something to shoot.
  if (o.type === 'attackMove') return !acquire(world, u) && Math.hypot(o.x - u.x, o.y - u.y) > 1;
  return false;
}

export function startDeploy(u: Entity, siege: boolean): void {
  const s = DEFS[u.def].siege;
  if (!s || u.deploying > 0 || u.sieged === siege) return;
  // `sieged` flips when the transition ends (status system).
  u.deploying = s.deploySeconds;
}

function gatherStep(world: World, u: Entity, dt: number): void {
  const order = u.order;
  if (order.type !== 'gather') return;

  switch (order.phase) {
    case 'toSource': {
      const s = resolveSource(world, u);
      if (!s) {
        u.order = { type: 'idle' };
        return;
      }
      if (moveToEntity(u, s, dt, TOUCH)) {
        order.phase = 'harvesting';
        order.timer = DEFS[u.def].gather!.seconds[DEFS[s.def].resource!.type];
      }
      return;
    }

    case 'harvesting': {
      const s = world.get(u.sourceId);
      if (!s || s.remaining <= 0) {
        resumeGathering(world, u);
        return;
      }
      order.timer -= dt;
      if (order.timer > 1e-9) return;
      const res = DEFS[s.def].resource!;
      const amount = Math.min(res.pieceSize, s.remaining);
      s.remaining -= amount;
      if (s.remaining <= 0) world.kill(s);
      u.cargo = { type: res.type, amount };
      if (u.team === 0) world.stats.gathered[res.type] += amount;
      order.phase = 'toDeposit';
      return;
    }

    case 'toDeposit': {
      const d = resolveDeposit(world, u);
      if (!d) {
        u.order = { type: 'idle' };
        return;
      }
      if (moveToEntity(u, d, dt, TOUCH)) {
        receiveCargo(world, d, u);
        resumeGathering(world, u);
      }
      return;
    }
  }
}

function haulStep(world: World, u: Entity, dt: number): void {
  const order = u.order;
  if (order.type !== 'haul') return;
  const to = world.get(order.toId);
  if (!to) {
    u.order = { type: 'idle' };
    return;
  }
  if (order.phase === 'toFrom') {
    const from = world.get(order.fromId);
    if (!from) {
      u.order = { type: 'idle' };
      return;
    }
    if (!moveToEntity(u, from, dt, TOUCH)) return;
    const amount = Math.min(HAUL_LOAD[order.res], Math.max(0, from.stock[order.res]));
    if (amount <= 0) {
      u.order = { type: 'idle' };
      return;
    }
    from.stock[order.res] -= amount;
    u.cargo = { type: order.res, amount };
    order.phase = 'toTo';
    return;
  }
  if (moveToEntity(u, to, dt, TOUCH)) {
    receiveCargo(world, to, u);
    u.order = { type: 'idle' };
  }
}

/** Nearest enemy this unit can hit, within weapon range plus the acquire margin. */
export function acquire(world: World, u: Entity): Entity | undefined {
  const atk = weaponOf(u);
  if (!atk) return undefined;
  const min = atk.minRange ?? 0;
  return world.nearest(u, (e) => canHit(u, e) && (min === 0 || edgeDist(u, e) >= min), atk.range + ACQUIRE_BONUS);
}

/** Close to weapon range, then fire on cooldown. */
function engage(world: World, u: Entity, target: Entity, dt: number): void {
  const atk = weaponOf(u)!;
  const gap = edgeDist(u, target);
  if (gap > atk.range) {
    if (canMove(u)) moveToEntity(u, target, dt, atk.range);
    else u.order = { type: 'idle' }; // sieged: can't chase
    return;
  }
  if (atk.minRange && gap < atk.minRange) {
    u.order = { type: 'idle' }; // too close for the siege cannon
    return;
  }
  u.facing = Math.atan2(target.y - u.y, target.x - u.x);
  if (u.cooldown <= 0) {
    dealDamage(world, u, target);
    u.cooldown = atk.cooldown / (u.stimmed > 0 ? STIM_FACTOR : 1);
  }
}

// ---- Movement (straight line, no pathfinding) ---------------------------------------------

export function speedOf(u: Entity): number {
  const base = DEFS[u.def].speed ?? 0;
  return base * (u.stimmed > 0 ? STIM_FACTOR : 1) * (u.slowed > 0 ? 0.5 : 1);
}

function stepToward(u: Entity, tx: number, ty: number, dt: number): number {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return 0;
  if (!canMove(u)) return d;
  const step = Math.min(d, speedOf(u) * dt);
  u.x += (dx / d) * step;
  u.y += (dy / d) * step;
  u.facing = Math.atan2(dy, dx);
  return d - step;
}

/** Move to a point; true once arrived (or wedged next to it by neighbours). */
function moveToPoint(u: Entity, x: number, y: number, dt: number): boolean {
  const before = Math.hypot(x - u.x, y - u.y);
  if (before <= POINT_ARRIVE) return true;
  const after = stepToward(u, x, y, dt);
  if (after <= POINT_ARRIVE) return true;
  // Separation can keep a unit from reaching an exact point in a crowd: give up when close and not progressing.
  const progressed = before - after > speedOf(u) * dt * 0.25;
  u.stuck = !progressed && after < 1.5 ? u.stuck + dt : 0;
  if (u.stuck > 0.5) {
    u.stuck = 0;
    return true;
  }
  return false;
}

/** Move until the edge gap to `target` is at most `gap`; true once there. */
function moveToEntity(u: Entity, target: Entity, dt: number, gap: number): boolean {
  if (edgeDist(u, target) <= gap) return true;
  stepToward(u, target.x, target.y, dt);
  return edgeDist(u, target) <= gap;
}

