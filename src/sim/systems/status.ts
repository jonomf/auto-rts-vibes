import { DEFS } from '../defs';
import { canHit, hasTag, isFlying, isHealer, isUnit, weaponOf } from '../actions';
import { edgeDist } from '../geometry';
import { PLAYER, type Entity } from '../types';
import type { World } from '../world';
import { startDeploy } from './units';

/** Medics look for injured allies this far away when they have nothing else to do. */
const HEAL_SEEK = 7;
/** How far an auto-unsieging tank must be from any enemy before it packs up. */
const UNSIEGE_CLEAR = 15;

/**
 * Timers and passive behaviour: siege transitions, stim and slow wearing off, healing,
 * and (streamlined rules, and always for the enemy) units using abilities by themselves.
 */
export function statusSystem(world: World, dt: number): void {
  const autoPlayer = world.ruleset.abilities === 'auto';
  for (const u of world.list(isUnit)) {
    if (u.stimmed > 0) u.stimmed = Math.max(0, u.stimmed - dt);
    if (u.slowed > 0) u.slowed = Math.max(0, u.slowed - dt);
    if (u.deploying > 0) {
      u.deploying -= dt;
      if (u.deploying <= 1e-9) {
        u.deploying = 0;
        u.sieged = !u.sieged;
      }
    }
    if (isHealer(u)) heal(world, u, dt);
    const auto = u.team !== PLAYER || autoPlayer;
    if (auto && !DEFS[u.def].inert) autoAbilities(world, u);
  }
}

/** Use Stimpack if it can be afforded. Returns true if it took effect. */
export function applyStim(world: World, u: Entity): boolean {
  const st = DEFS[u.def].stim;
  if (!st || u.stimmed > 0 || u.hp <= st.hpCost + 1) return false;
  u.hp -= st.hpCost;
  u.stimmed = st.seconds;
  world.effects.push({ type: 'splash', tick: world.tick, x: u.x, y: u.y, radius: 0.5 });
  return true;
}

function heal(world: World, u: Entity, dt: number): void {
  const h = DEFS[u.def].heal!;
  // Most injured friendly bio unit in range (by missing HP).
  let best: Entity | undefined;
  let bestMissing = 0;
  for (const e of world.all()) {
    if (e === u || e.team !== u.team || !isUnit(e) || !hasTag(e, 'bio')) continue;
    const missing = DEFS[e.def].hp - e.hp;
    if (missing <= 0.01 || edgeDist(u, e) > h.range) continue;
    if (missing > bestMissing) {
      bestMissing = missing;
      best = e;
    }
  }
  if (best) {
    best.hp = Math.min(DEFS[best.def].hp, best.hp + h.rate * dt);
    if (world.tick % 6 === 0)
      world.effects.push({ type: 'heal', tick: world.tick, x1: u.x, y1: u.y, x2: best.x, y2: best.y });
    return;
  }
  // Idle healers walk to the nearest injured ally.
  if (u.order.type === 'idle') {
    const hurt = world.nearest(
      u,
      (e) => e.team === u.team && isUnit(e) && hasTag(e, 'bio') && e.hp < DEFS[e.def].hp - 0.01,
      HEAL_SEEK,
    );
    if (hurt) u.order = { type: 'follow', targetId: hurt.id };
  }
}

function autoAbilities(world: World, u: Entity): void {
  const d = DEFS[u.def];
  // Siege up when a ground enemy is within siege range; pack up when the coast is clear and it wants to move.
  if (d.siege && u.deploying <= 0) {
    if (!u.sieged) {
      const moving = u.order.type === 'move';
      const target = !moving && nearestGroundEnemy(world, u, d.siege.range);
      if (target && edgeDist(u, target) >= (d.siege.minRange ?? 0)) startDeploy(u, true);
    } else if (!nearestGroundEnemy(world, u, UNSIEGE_CLEAR) && u.order.type !== 'idle' && u.order.type !== 'attack') {
      startDeploy(u, false);
    }
  }
  // Stim when a fight is on and there's HP to spare.
  if (d.stim && u.stimmed <= 0 && u.hp > DEFS[u.def].hp * 0.5) {
    const atk = weaponOf(u);
    const fighting = u.order.type === 'attack' || (u.order.type === 'attackMove' && u.order.engagedId != null);
    if (atk && fighting && world.nearest(u, (e) => canHit(u, e), atk.range + 1)) applyStim(world, u);
  }
}

function nearestGroundEnemy(world: World, u: Entity, range: number): Entity | undefined {
  return world.nearest(u, (e) => e.team !== u.team && e.team !== -1 && !isFlying(e), range);
}
