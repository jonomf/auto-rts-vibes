/**
 * Runs the player's Program inside the simulation, a few times a second.
 * It only ever acts through World.issue(cmd, 'auto'), the same commands the mouse issues.
 */
import { DEFS, HAUL_LOAD, costOf, type DefId, type ResourceType } from '../sim/defs';
import { canAttack, canHit, checkTrain, isBuilding, isGatherer, isUnit, missingRequirement } from '../sim/actions';
import { NEUTRAL, PLAYER, type Command, type Entity, type Team } from '../sim/types';
import type { World } from '../sim/world';
import { anchorOf, destPoint, findSite } from './layout';
import {
  ruleKey,
  type Action,
  type AutoState,
  type Condition,
  type CountWhat,
  type Op,
  type Program,
  type Rule,
  type ScopeId,
} from './types';

/** Evaluate the program every this many ticks (20 Hz sim -> 4 Hz). */
export const AUTO_EVERY = 5;
/** How far fighters look for something to attack with the "attack nearest enemy" action. */
export const SIGHT = 12;
/** Units following a "move to" rule count as arrived within this distance. */
const ARRIVED = 4;

export const createAutoState = (): AutoState => ({ posture: 'economy', step: 0, stepStatus: '', fired: {} });

type Ctx = {
  world: World;
  p: Program;
  team: Team;
  counts: Map<CountWhat, number>;
  intents: Map<string, number>;
  /** Move / attack-move commands batched per rule, so groups get a formation. */
  batches: Map<string, { cmd: 'move' | 'attackMove'; x: number; y: number; ids: number[] }>;
};

export function automationSystem(world: World, p: Program, team: Team = PLAYER): void {
  const ctx: Ctx = { world, p, team, counts: countAll(world, team), intents: new Map(), batches: new Map() };
  for (const e of world.all()) if (e.team === team && e.intent) bump(ctx.intents, e.intent, 1);

  runBuildOrder(ctx);
  runBaseRules(ctx);
  runBuildings(ctx);
  runUnits(ctx);

  for (const b of ctx.batches.values())
    world.issue(b.cmd === 'move' ? { type: 'move', ids: b.ids, x: b.x, y: b.y } : { type: 'attackMove', ids: b.ids, x: b.x, y: b.y }, 'auto');
}

// ---- Counting -----------------------------------------------------------------------

const bump = <K>(m: Map<K, number>, k: K, d: number) => m.set(k, (m.get(k) ?? 0) + d);

const isArmy = (def: DefId) => DEFS[def].attack !== undefined && DEFS[def].category === 'unit';

/** Own units and buildings, including queued units, blueprints and builds on the way. */
function countAll(world: World, team: Team): Map<CountWhat, number> {
  const m = new Map<CountWhat, number>();
  const add = (def: DefId) => {
    bump(m, def, 1);
    if (isArmy(def)) bump(m, 'army', 1);
  };
  for (const e of world.all()) {
    if (e.team !== team || DEFS[e.def].inert) continue;
    add(e.def);
    for (const q of e.queue) add(q.def);
    if (e.order.type === 'build') add(e.order.def);
  }
  return m;
}

const count = (ctx: Ctx, what: CountWhat) => ctx.counts.get(what) ?? 0;
const cmp = (v: number, op: Op, n: number) => (op === '<' ? v < n : v >= n);

// ---- Conditions ---------------------------------------------------------------------

function ownBuildings(ctx: Ctx, def: DefId | 'home', completeOnly = true): Entity[] {
  return ctx.world.list((e) => e.team === ctx.team && e.def === def && (!completeOnly || e.complete));
}

export function evalCond(ctx: Ctx, c: Condition, self?: Entity): boolean {
  const { world } = ctx;
  switch (c.kind) {
    case 'posture':
      return world.auto.posture === c.is;
    case 'count':
      return cmp(count(ctx, c.what), c.op, c.n);
    case 'has':
      return world.hasCompleted(ctx.team, c.def) !== c.not;
    case 'stock': {
      const places =
        c.at === 'self' ? (self && isBuilding(self) ? [self] : []) : ownBuildings(ctx, c.at === 'home' ? 'home' : c.at);
      if (places.length === 0) return false;
      const vals = places.map((b) => b.stock[c.res]);
      // "Any building of that type": the lowest one for <, the highest one for >=.
      return cmp(c.op === '<' ? Math.min(...vals) : Math.max(...vals), c.op, c.n);
    }
    case 'needs':
      return needyTargets(ctx, c.res, c.where, undefined, self).length > 0 !== c.not;
    case 'enemyNear': {
      const origin = self ?? anchorOf(world, ctx.team);
      if (!origin) return c.not;
      const found = world.list((e) => e.team !== ctx.team && e.team !== NEUTRAL).some(
        (e) => Math.hypot(e.x - origin.x, e.y - origin.y) <= c.r,
      );
      return found !== c.not;
    }
    case 'hp':
      return self ? cmp((self.hp / DEFS[self.def].hp) * 100, c.op, c.pct) : false;
    case 'carrying':
      return self ? !!self.cargo !== c.not : false;
    case 'time':
      return cmp(world.seconds, c.op, c.s);
  }
}

// ---- Logistics: who needs what --------------------------------------------------------

/** Production buildings keep a reserve of twice their most expensive unit. */
export function reserveFor(def: DefId, res: ResourceType): number {
  const trains = def === 'home' ? [] : (DEFS[def].trains ?? []);
  return 2 * Math.max(0, ...trains.map((t) => costOf(t)[res]));
}

/** Resources already on their way to `b` (excluding `self`'s own load). */
function inflight(ctx: Ctx, b: Entity, res: ResourceType, self?: Entity): number {
  let sum = 0;
  for (const u of ctx.world.all()) {
    if (u.team !== ctx.team || u === self || !isGatherer(u)) continue;
    const o = u.order;
    if (o.type === 'haul' && o.toId === b.id && o.res === res)
      sum += u.cargo?.type === res ? u.cargo.amount : HAUL_LOAD[res];
    else if (o.type === 'gather' && o.phase === 'toDeposit' && u.depositId === b.id && u.cargo?.type === res)
      sum += u.cargo.amount;
  }
  return sum;
}

/** How much more of `res` building `b` wants: blueprint debt, or a production building's reserve. */
export function needOf(ctx: Ctx, b: Entity, res: ResourceType, self?: Entity): number {
  if (DEFS[b.def].inert) return 0;
  const want = !b.complete ? Math.max(0, -b.stock[res]) : Math.max(0, reserveFor(b.def, res) - b.stock[res]);
  if (want <= 0) return 0;
  return want - inflight(ctx, b, res, self);
}

/** Buildings that need `res`, blueprints first, then the emptiest. */
function needyTargets(ctx: Ctx, res: ResourceType, where: string, exclude?: Entity, self?: Entity): Entity[] {
  const list: { b: Entity; fill: number }[] = [];
  for (const b of ctx.world.all()) {
    if (b.team !== ctx.team || !isBuilding(b) || b === exclude) continue;
    if (where === 'blueprint' && b.complete) continue;
    if (where !== 'any' && where !== 'blueprint' && b.def !== where) continue;
    const need = needOf(ctx, b, res, self);
    if (need <= 0) continue;
    // Blueprints first; then the production building that is emptiest relative to its reserve.
    const fill = b.complete ? 1 - need / reserveFor(b.def, res) : -1;
    list.push({ b, fill });
  }
  const origin = self ?? anchorOf(ctx.world, ctx.team);
  const d = (e: Entity) => (origin ? Math.hypot(e.x - origin.x, e.y - origin.y) : 0);
  list.sort((a, b) => a.fill - b.fill || d(a.b) - d(b.b) || a.b.id - b.b.id);
  return list.map((x) => x.b);
}

function nearest(list: Entity[], from: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - from.x, e.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function resolveDeliver(ctx: Ctx, u: Entity, res: ResourceType, to: string): Entity | undefined {
  const homes = () => nearest(ownBuildings(ctx, 'home'), u);
  if (to === 'home') return homes();
  if (to === 'needy') return needyTargets(ctx, res, 'any', undefined, u)[0] ?? homes();
  return nearest(ownBuildings(ctx, to as DefId), u) ?? homes();
}

/** A field of `res` near the deposit with the fewest gatherers already on it. */
function pickSource(ctx: Ctx, u: Entity, res: ResourceType, deposit: Entity): Entity | undefined {
  const fields = ctx.world.list((e) => DEFS[e.def].resource?.type === res && e.remaining > 0);
  if (fields.length === 0) return undefined;
  const workers = new Map<number, number>();
  for (const g of ctx.world.all())
    if (g !== u && g.team === ctx.team && isGatherer(g) && g.sourceId != null) bump(workers, g.sourceId, 1);
  const score = (f: Entity) => {
    const d = Math.hypot(f.x - deposit.x, f.y - deposit.y);
    return (d > 14 ? 1e4 : 0) + (workers.get(f.id) ?? 0) * 100 + d;
  };
  return fields.reduce((best, f) => (score(f) < score(best) ? f : best));
}

// ---- Actions ----------------------------------------------------------------------

/** Turn a unit action into commands, or null if it can't be done right now. */
function planUnit(ctx: Ctx, act: Action, u: Entity): Command[] | 'move' | null {
  const { world, team } = ctx;
  switch (act.kind) {
    case 'gather': {
      if (!isGatherer(u)) return null;
      const deposit = resolveDeliver(ctx, u, act.res, act.to);
      if (!deposit) return null;
      const source = pickSource(ctx, u, act.res, deposit);
      if (!source) return null;
      return [
        { type: 'target', ids: [u.id], targetId: source.id },
        { type: 'target', ids: [u.id], targetId: deposit.id },
      ];
    }
    case 'haul': {
      if (!isGatherer(u)) return null;
      const sources =
        act.from === 'home' ? ownBuildings(ctx, 'home') : ownBuildings(ctx, act.from);
      const carrying = u.cargo?.type === act.res;
      const from = sources
        .filter((b) => carrying || b.stock[act.res] >= HAUL_LOAD[act.res] / 2)
        .sort((a, b) => b.stock[act.res] - a.stock[act.res] || a.id - b.id)[0];
      if (!from) return null;
      const to = needyTargets(ctx, act.res, act.to === 'needy' ? 'any' : act.to, from, u)[0];
      if (!to) return null;
      return [{ type: 'haul', ids: [u.id], res: act.res, fromId: from.id, toId: to.id }];
    }
    case 'attack': {
      if (!canAttack(u)) return null;
      const t = world.nearest(u, (e) => canHit(u, e), SIGHT);
      return t ? [{ type: 'target', ids: [u.id], targetId: t.id }] : null;
    }
    case 'attackMove':
    case 'move': {
      if (act.kind === 'attackMove' && !canAttack(u)) return null;
      return destPoint(world, team, ctx.p.layout, act.to) ? 'move' : null;
    }
    case 'hold':
      return [{ type: 'stop', ids: [u.id] }];
    default:
      return null;
  }
}

function tryTrain(ctx: Ctx, def: DefId, only?: Entity): boolean {
  const candidates = only
    ? [only]
    : ctx.world
        .list((b) => b.team === ctx.team && isBuilding(b) && b.complete && !!DEFS[b.def].trains?.includes(def))
        .sort((a, b) => a.queue.length - b.queue.length || a.id - b.id);
  for (const b of candidates) {
    if (!checkTrain(ctx.world, b, def).ok) continue;
    if (ctx.world.issue({ type: 'train', buildingId: b.id, def }, 'auto').ok) {
      bump(ctx.counts, def, 1);
      if (isArmy(def)) bump(ctx.counts, 'army', 1);
      return true;
    }
  }
  return false;
}

/** Send a free gatherer to place `def`. Returns a reason when it can't. */
function tryBuild(ctx: Ctx, def: DefId): string | null {
  const { world, team } = ctx;
  const req = missingRequirement(world, team, def);
  if (req) return `needs ${DEFS[req].name}`;
  const site = findSite(world, team, ctx.p.layout, def);
  if (!site) return 'no room in the layout';
  const builders = world.list(
    (u) => u.team === team && isGatherer(u) && u.order.type !== 'build' && !(u.manual && u.order.type !== 'idle'),
  );
  if (builders.length === 0) return 'no free gatherer';
  const score = (u: Entity) => (u.cargo ? 1000 : 0) + Math.hypot(u.x - site.x, u.y - site.y);
  const builder = builders.reduce((best, u) => (score(u) < score(best) ? u : best));
  const r = world.issue({ type: 'build', builderId: builder.id, def, x: site.x, y: site.y }, 'auto');
  if (!r.ok) return r.reason;
  if (builder.intent) bump(ctx.intents, builder.intent, -1);
  builder.intent = 'base#build';
  bump(ctx.counts, def, 1);
  return null;
}

// ---- Runners ----------------------------------------------------------------------

function runBuildOrder(ctx: Ctx): void {
  const { world, p } = ctx;
  const a = world.auto;
  for (let guard = 0; guard < 8 && a.step < p.order.length; guard++) {
    const s = p.order[a.step];
    switch (s.kind) {
      case 'build': {
        const why = tryBuild(ctx, s.def);
        if (why) {
          a.stepStatus = `waiting: ${why}`;
          return;
        }
        break;
      }
      case 'train': {
        if (count(ctx, s.def) < s.n) tryTrain(ctx, s.def);
        if (count(ctx, s.def) < s.n) {
          a.stepStatus = `${count(ctx, s.def)}/${s.n}`;
          return;
        }
        break;
      }
      case 'wait':
        if (!evalCond(ctx, s.cond)) {
          a.stepStatus = 'waiting';
          return;
        }
        break;
      case 'setPosture':
        a.posture = s.to;
        break;
    }
    a.step++;
    a.stepStatus = '';
  }
  if (a.step >= p.order.length) a.stepStatus = 'done';
}

function runBaseRules(ctx: Ctx): void {
  const { world } = ctx;
  for (const r of ctx.p.rules.base ?? []) {
    if (!r.on || !r.conds.every((c) => evalCond(ctx, c))) continue;
    const act = r.act;
    if (act.kind === 'setPosture') {
      if (world.auto.posture === act.to) continue;
      world.auto.posture = act.to;
    } else if (act.kind === 'build') {
      // One blueprint of each type at a time from standing rules, so "if ... build" can't flood the map.
      const pending = world.list(
        (e) => e.team === ctx.team && ((e.def === act.def && !e.complete) || (e.order.type === 'build' && e.order.def === act.def)),
      );
      if (pending.length > 0 || tryBuild(ctx, act.def)) continue;
    } else continue;
    world.auto.fired[ruleKey('base', r)] = world.tick;
  }
}

function runBuildings(ctx: Ctx): void {
  const { world } = ctx;
  for (const b of world.list((e) => e.team === ctx.team && isBuilding(e) && e.complete && !DEFS[e.def].inert)) {
    const rules = ctx.p.rules[b.def];
    if (!rules?.length || b.queue.length > 0) continue;
    for (const r of rules) {
      if (!r.on || r.act.kind !== 'train') continue;
      if (!r.conds.every((c) => evalCond(ctx, c, b))) continue;
      if (tryTrain(ctx, r.act.def, b)) {
        world.auto.fired[ruleKey(b.def, r)] = world.tick;
        break;
      }
    }
  }
}

export function rulesFor(p: Program, u: Entity): { scope: ScopeId; rule: Rule }[] {
  const own = (p.rules[u.def] ?? []).map((rule) => ({ scope: u.def as ScopeId, rule }));
  if (!canAttack(u)) return own;
  return own.concat((p.rules.army ?? []).map((rule) => ({ scope: 'army' as ScopeId, rule })));
}

function runUnits(ctx: Ctx): void {
  const { world, p, team } = ctx;
  for (const u of world.list((e) => e.team === team && isUnit(e) && !DEFS[e.def].inert)) {
    if (u.order.type === 'build') continue;
    if (u.manual) {
      if (u.order.type !== 'idle') continue;
      u.manual = false;
    }
    const rules = rulesFor(p, u);
    const busy = u.order.type !== 'idle';

    let chosen = false;
    for (const { scope, rule } of rules) {
      if (!rule.on) continue;
      const key = ruleKey(scope, rule);
      const current = u.intent === key;
      if (!current && rule.max != null && (ctx.intents.get(key) ?? 0) >= rule.max) continue;
      if (!rule.conds.every((c) => evalCond(ctx, c, u))) continue;

      // Already doing this: keep going (only re-aim gatherers if their best drop-off changed).
      if (current && (busy || arrived(ctx, rule.act, u))) {
        if (rule.act.kind === 'gather') retarget(ctx, rule.act.res, rule.act.to, u);
        chosen = true;
        break;
      }

      const plan = planUnit(ctx, rule.act, u);
      if (!plan) continue;
      if (u.intent) bump(ctx.intents, u.intent, -1);
      u.intent = key;
      bump(ctx.intents, key, 1);
      if (plan === 'move') {
        const act = rule.act as Extract<Action, { kind: 'move' | 'attackMove' }>;
        const pt = destPoint(world, team, p.layout, act.to)!;
        const batch = ctx.batches.get(key) ?? { cmd: act.kind, x: pt.x, y: pt.y, ids: [] };
        batch.ids.push(u.id);
        ctx.batches.set(key, batch);
      } else for (const cmd of plan) world.issue(cmd, 'auto');
      chosen = true;
      break;
    }

    if (!chosen && u.intent) {
      bump(ctx.intents, u.intent, -1);
      u.intent = null;
      if (busy) world.issue({ type: 'stop', ids: [u.id] }, 'auto');
    }
  }
}

/** Is a unit that follows a move rule already standing at its destination? */
function arrived(ctx: Ctx, act: Action, u: Entity): boolean {
  if (act.kind === 'hold') return true;
  if (act.kind !== 'move' && act.kind !== 'attackMove') return false;
  const pt = destPoint(ctx.world, ctx.team, ctx.p.layout, act.to);
  return !!pt && Math.hypot(pt.x - u.x, pt.y - u.y) < ARRIVED;
}

function retarget(ctx: Ctx, res: ResourceType, to: string, u: Entity): void {
  if (u.order.type !== 'gather') return;
  const src = ctx.world.get(u.sourceId);
  if (src && DEFS[src.def].resource?.type !== res) {
    const deposit = resolveDeliver(ctx, u, res, to);
    const s = deposit && pickSource(ctx, u, res, deposit);
    if (s) ctx.world.issue({ type: 'target', ids: [u.id], targetId: s.id }, 'auto');
  }
  // Only re-aim while carrying, so a harvest in progress is never reset.
  if (u.order.phase !== 'toDeposit') return;
  const best = resolveDeliver(ctx, u, res, to);
  if (best && best.id !== u.depositId) ctx.world.issue({ type: 'target', ids: [u.id], targetId: best.id }, 'auto');
}
