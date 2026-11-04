import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createScenario, createSandbox } from '../src/sim/scenario';
import { RULESETS } from '../src/sim/ruleset';
import { constructionProgress, constructionScale, hitDamage } from '../src/sim/actions';
import { CONSTRUCTION_START_SCALE, DEFS } from '../src/sim/defs';
import { ENEMY, NEUTRAL, PLAYER, type Entity } from '../src/sim/types';

/** A tiny map: a Command Center, mineral fields, one geyser, one SCV. */
function basicWorld(rules = RULESETS.classic) {
  const world = new World({ width: 40, height: 30 }, rules);
  const cc = world.spawn('commandCenter', PLAYER, 10, 15);
  const minerals = world.spawn('mineralSource', NEUTRAL, 4, 15);
  const gas = world.spawn('gasSource', NEUTRAL, 10, 9);
  const g = world.spawn('scv', PLAYER, 7, 15);
  return { world, cc, minerals, gas, g };
}

const count = (world: World, def: Entity['def']) => world.list((e) => e.def === def).length;
const rich = () => ({ minerals: 2000, gas: 2000 });

describe('gathering', () => {
  it('right-clicking minerals starts a gather -> deliver loop into the nearest Command Center', () => {
    const { world, cc, minerals, g } = basicWorld();
    expect(world.issue({ type: 'target', ids: [g.id], targetId: minerals.id }).ok).toBe(true);
    world.stepSeconds(20);
    expect(cc.stock.minerals).toBeGreaterThanOrEqual(100);
    expect(cc.stock.minerals % DEFS.mineralSource.resource!.pieceSize).toBe(0);
    expect(minerals.remaining).toBe(1000 - cc.stock.minerals - (g.cargo?.amount ?? 0));
    expect(world.stats.gathered.minerals).toBe(1000 - minerals.remaining);
  });

  it('regression: a move order before gathering does not cause the instant gather/deposit loop', () => {
    // Unity bug (c2e443b): TargetPosition was never cleared, so after one ground move the
    // gatherer "arrived" at every later target instantly and looped deposit/harvest in place.
    const { world, cc, minerals, g } = basicWorld();
    world.issue({ type: 'move', ids: [g.id], x: 20, y: 20 });
    world.stepSeconds(5);
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    world.stepSeconds(3);
    expect(cc.stock.minerals).toBe(0);
    world.stepSeconds(20);
    expect(cc.stock.minerals).toBeGreaterThan(0);
    expect(cc.stock.minerals).toBeLessThanOrEqual(250);
  });

  it('right-clicking a building with an SCV redirects its deliveries there (per-building stockpiles)', () => {
    const { world, cc, minerals, g } = basicWorld();
    const barracks = world.spawn('barracks', PLAYER, 10, 22);
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    world.issue({ type: 'target', ids: [g.id], targetId: barracks.id });
    world.stepSeconds(20);
    expect(barracks.stock.minerals).toBeGreaterThan(0);
    expect(cc.stock.minerals).toBe(0);
  });

  it('a group sent to one mineral field spreads over neighbouring fields', () => {
    const world = new World({ width: 40, height: 30 });
    world.spawn('commandCenter', PLAYER, 10, 15);
    const fields = [13, 15, 17].map((y) => world.spawn('mineralSource', NEUTRAL, 4, y));
    const gs = [0, 1, 2].map((i) => world.spawn('scv', PLAYER, 7, 14 + i));
    world.issue({ type: 'target', ids: gs.map((g) => g.id), targetId: fields[1].id });
    expect(new Set(gs.map((g) => g.sourceId)).size).toBe(3);
  });

  it('moves on to a nearby field of the same type when a source runs dry', () => {
    const world = new World({ width: 40, height: 30 });
    const cc = world.spawn('commandCenter', PLAYER, 10, 15);
    const a = world.spawn('mineralSource', NEUTRAL, 4, 15, { remaining: 25 });
    const b = world.spawn('mineralSource', NEUTRAL, 4, 17);
    const g = world.spawn('scv', PLAYER, 7, 15);
    world.issue({ type: 'target', ids: [g.id], targetId: a.id });
    world.stepSeconds(25);
    expect(world.get(a.id)).toBeUndefined();
    expect(b.remaining).toBeLessThan(1000);
    expect(cc.stock.minerals).toBeGreaterThan(25);
  });

  it('gas can only be harvested through a finished Refinery on the geyser', () => {
    const { world, cc, gas, g } = basicWorld();
    world.issue({ type: 'target', ids: [g.id], targetId: gas.id });
    world.stepSeconds(10);
    expect(cc.stock.gas).toBe(0);
    expect(g.order.type).toBe('idle');
    const ref = world.spawn('refinery', PLAYER, gas.x, gas.y);
    world.issue({ type: 'target', ids: [g.id], targetId: ref.id }); // right-click the Refinery
    world.stepSeconds(15);
    expect(cc.stock.gas).toBeGreaterThan(0);
  });
});

describe('construction by delivery', () => {
  it('a blueprint starts small, grows as resources arrive, and completes when its debt is paid', () => {
    const { world, minerals, g } = basicWorld();
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    expect(world.issue({ type: 'build', builderId: g.id, def: 'supplyDepot', x: 6, y: 22 }).ok).toBe(true);
    world.stepSeconds(4);
    const site = world.list((e) => e.def === 'supplyDepot')[0];
    expect(site.complete).toBe(false);
    expect(constructionScale(site)).toBeGreaterThanOrEqual(CONSTRUCTION_START_SCALE);
    let last = constructionProgress(site);
    for (let i = 0; i < 12 && !site.complete; i++) {
      world.stepSeconds(5);
      expect(constructionProgress(site)).toBeGreaterThanOrEqual(last);
      last = constructionProgress(site);
    }
    expect(site.complete).toBe(true);
    expect(world.supply(PLAYER).cap).toBe(15 + 8);
  });

  it('a gas-costing blueprint stays incomplete on minerals alone', () => {
    const { world, minerals, gas, g } = basicWorld();
    world.spawn('barracks', PLAYER, 20, 20);
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    world.issue({ type: 'build', builderId: g.id, def: 'factory', x: 6, y: 22 });
    world.stepSeconds(60);
    const site = world.list((e) => e.def === 'factory')[0];
    expect(site.stock.minerals).toBeGreaterThanOrEqual(0);
    expect(site.complete).toBe(false);
    world.spawn('refinery', PLAYER, gas.x, gas.y);
    world.issue({ type: 'target', ids: [g.id], targetId: gas.id });
    world.stepSeconds(150);
    expect(site.complete).toBe(true);
  });

  it('enforces placement and the tech tree (Barracks needs a Supply Depot; Refineries go on geysers)', () => {
    const { world, g, gas } = basicWorld();
    expect(world.issue({ type: 'build', builderId: g.id, def: 'supplyDepot', x: 10, y: 15 }).ok).toBe(false);
    const r = world.issue({ type: 'build', builderId: g.id, def: 'barracks', x: 20, y: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Supply Depot');
    expect(world.issue({ type: 'build', builderId: g.id, def: 'refinery', x: 20, y: 20 }).ok).toBe(false);
    expect(world.issue({ type: 'build', builderId: g.id, def: 'refinery', x: gas.x, y: gas.y }).ok).toBe(true);
  });
});

describe('supply', () => {
  it('hard cap (classic): training stops at the cap; a depot lifts it', () => {
    const { world, cc } = basicWorld();
    cc.stock = rich();
    for (let i = 0; i < 14; i++) world.spawn('marine', PLAYER, 20, 5 + i);
    expect(world.supply(PLAYER)).toEqual({ used: 15, cap: 15 });
    const r = world.issue({ type: 'train', buildingId: cc.id, def: 'scv' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('supply');
    world.spawn('supplyDepot', PLAYER, 30, 25);
    expect(world.issue({ type: 'train', buildingId: cc.id, def: 'scv' }).ok).toBe(true);
  });

  it('soft cap (streamlined): you can train past it, but 3x slower', () => {
    const { world, cc } = basicWorld(RULESETS.streamlined);
    cc.stock = rich();
    for (let i = 0; i < 15; i++) world.spawn('marine', PLAYER, 20, 5 + i);
    expect(world.issue({ type: 'train', buildingId: cc.id, def: 'scv' }).ok).toBe(true);
    world.stepSeconds(DEFS.scv.buildTime! + 0.5);
    expect(count(world, 'scv')).toBe(1);
    world.stepSeconds(DEFS.scv.buildTime! * 2);
    expect(count(world, 'scv')).toBe(2);
  });
});

describe('add-ons', () => {
  it('a building builds its own add-on from its stockpile; a Tech Lab unlocks Marauders', () => {
    const { world } = basicWorld();
    const b = world.spawn('barracks', PLAYER, 20, 15, { stock: { minerals: 500, gas: 100 } });
    expect(world.issue({ type: 'train', buildingId: b.id, def: 'marauder' }).ok).toBe(false);
    expect(world.issue({ type: 'addon', buildingId: b.id, def: 'techLab' }).ok).toBe(true);
    expect(b.stock).toEqual({ minerals: 450, gas: 75 });
    expect(world.issue({ type: 'train', buildingId: b.id, def: 'marine' }).ok).toBe(false); // busy
    world.stepSeconds(DEFS.techLab.buildTime! + 0.1);
    expect(b.addon).toBe('techLab');
    // Classic rules: the add-on is a real building beside it.
    const lab = world.get(b.linkId)!;
    expect(lab.def).toBe('techLab');
    expect(lab.x).toBeGreaterThan(b.x);
    expect(world.issue({ type: 'train', buildingId: b.id, def: 'marauder' }).ok).toBe(true);
    // Destroying the add-on takes it away again.
    world.kill(lab);
    world.step();
    expect(b.addon).toBe(null);
  });

  it('classic add-ons need free ground beside the building; streamlined ones do not', () => {
    for (const rules of [RULESETS.classic, RULESETS.streamlined]) {
      const { world } = basicWorld(rules);
      const b = world.spawn('barracks', PLAYER, 20, 15, { stock: rich() });
      world.spawn('supplyDepot', PLAYER, 23, 16); // right where the add-on goes
      const r = world.issue({ type: 'addon', buildingId: b.id, def: 'reactor' });
      expect(r.ok).toBe(rules.addons === 'inplace');
    }
  });

  it('a Reactor trains two units at once', () => {
    const { world } = basicWorld();
    const b = world.spawn('barracks', PLAYER, 20, 15, { stock: rich(), addon: 'reactor' });
    world.spawn('supplyDepot', PLAYER, 30, 25);
    world.issue({ type: 'train', buildingId: b.id, def: 'marine' });
    world.issue({ type: 'train', buildingId: b.id, def: 'marine' });
    world.stepSeconds(DEFS.marine.buildTime! + 0.1);
    expect(count(world, 'marine')).toBe(2);
  });
});

describe('production', () => {
  it('every unit trains from its building (Tech Lab units need one)', () => {
    const world = new World({ width: 50, height: 40 });
    world.spawn('commandCenter', PLAYER, 5, 35);
    for (let i = 0; i < 4; i++) world.spawn('supplyDepot', PLAYER, 45, 5 + i * 3);
    const br = world.spawn('barracks', PLAYER, 10, 10, { stock: rich(), addon: 'techLab' });
    const fa = world.spawn('factory', PLAYER, 20, 10, { stock: rich(), addon: 'techLab' });
    const sp = world.spawn('starport', PLAYER, 30, 10, { stock: rich(), addon: 'techLab' });
    const want: [Entity, Entity['def']][] = [
      [br, 'marine'],
      [br, 'marauder'],
      [br, 'medic'],
      [fa, 'hellion'],
      [fa, 'siegeTank'],
      [sp, 'viking'],
      [sp, 'medivac'],
      [sp, 'banshee'],
    ];
    for (const [b, def] of want) expect(world.issue({ type: 'train', buildingId: b.id, def }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: fa.id, def: 'banshee' }).ok).toBe(false);
    world.stepSeconds(60);
    for (const [, def] of want) expect(count(world, def)).toBe(1);
  });

  it('cancel refunds', () => {
    const { world, cc } = basicWorld();
    cc.stock.minerals = 50;
    world.issue({ type: 'train', buildingId: cc.id, def: 'scv' });
    expect(cc.stock.minerals).toBe(0);
    world.issue({ type: 'cancelTrain', buildingId: cc.id, index: 0 });
    expect(cc.stock.minerals).toBe(50);
  });
});

describe('combat', () => {
  it('armor and bonus damage: Marauders hit armored targets twice as hard', () => {
    const world = new World();
    const m = world.spawn('marauder', PLAYER, 1, 1);
    const tank = world.spawn('siegeTank', ENEMY, 5, 5);
    const ling = world.spawn('zergling', ENEMY, 9, 9);
    expect(hitDamage(DEFS.marauder.attack!, tank)).toBe(10 + 10 - 1);
    expect(hitDamage(DEFS.marauder.attack!, ling)).toBe(10);
    expect(hitDamage(DEFS.marine.attack!, world.spawn('bunker', ENEMY, 20, 20))).toBe(5);
    expect(m.def).toBe('marauder');
  });

  it('right-click attack kills a dummy; dummies never fight back', () => {
    const world = new World({ width: 40, height: 30 });
    const marine = world.spawn('marine', PLAYER, 5, 15);
    const dummy = world.spawn('dummy', ENEMY, 25, 15);
    world.issue({ type: 'target', ids: [marine.id], targetId: dummy.id });
    world.stepSeconds(30);
    expect(world.get(dummy.id)).toBeUndefined();
    expect(marine.hp).toBe(DEFS.marine.hp);
  });

  it('splash hurts the enemies around the target', () => {
    const world = new World({ width: 40, height: 30 });
    const hellion = world.spawn('hellion', PLAYER, 5, 15);
    const lings = [0, 1, 2].map((i) => world.spawn('dummy', ENEMY, 9.5, 14.4 + i * 0.6));
    world.issue({ type: 'target', ids: [hellion.id], targetId: lings[1].id });
    world.stepSeconds(0.5);
    expect(lings.every((l) => l.hp < DEFS.dummy.hp)).toBe(true);
  });

  it('siege mode: can not move, out-ranges, can not fire point blank', () => {
    const world = new World({ width: 40, height: 30 });
    const tank = world.spawn('siegeTank', PLAYER, 5, 15);
    world.issue({ type: 'siege', ids: [tank.id], on: true });
    world.stepSeconds(DEFS.siegeTank.siege!.deploySeconds + 0.1);
    expect(tank.sieged).toBe(true);
    const far = world.spawn('dummy', ENEMY, 5 + 12, 15);
    world.stepSeconds(3);
    expect(far.hp).toBeLessThan(DEFS.dummy.hp);
    world.issue({ type: 'move', ids: [tank.id], x: 30, y: 15 });
    world.stepSeconds(0.5);
    expect(tank.x).toBe(5); // packing up first
    world.stepSeconds(5);
    expect(tank.sieged).toBe(false);
    expect(tank.x).toBeGreaterThan(5);
  });

  it('Marauders slow; stim trades HP for speed; Medics heal bio', () => {
    const world = new World({ width: 40, height: 30 });
    const m = world.spawn('marauder', PLAYER, 5, 15);
    const t = world.spawn('zergling', ENEMY, 9, 15, { order: { type: 'move', x: 39, y: 15 } });
    world.issue({ type: 'target', ids: [m.id], targetId: t.id });
    world.stepSeconds(0.3);
    expect(t.slowed).toBeGreaterThan(0);
    const marine = world.spawn('marine', PLAYER, 20, 5);
    expect(world.issue({ type: 'stim', ids: [marine.id] }).ok).toBe(true);
    expect(marine.hp).toBe(DEFS.marine.hp - 10);
    expect(marine.stimmed).toBeGreaterThan(0);
    world.spawn('medic', PLAYER, 21, 5);
    world.stepSeconds(3);
    expect(marine.hp).toBe(DEFS.marine.hp);
  });

  it('ground-only weapons can not target flyers; Vikings only shoot air', () => {
    const world = new World({ width: 40, height: 30 });
    const tank = world.spawn('siegeTank', PLAYER, 10, 15);
    const enemyShip = world.spawn('banshee', ENEMY, 13, 15);
    world.issue({ type: 'target', ids: [tank.id], targetId: enemyShip.id });
    expect(tank.order.type).toBe('follow');
    const v = world.spawn('viking', PLAYER, 10, 20);
    world.issue({ type: 'target', ids: [v.id], targetId: world.spawn('dummy', ENEMY, 14, 20).id });
    expect(v.order.type).toBe('follow');
  });

  it('scenario defenders fight back but return to their post', () => {
    const world = createScenario('outpost');
    const marine = world.spawn('marine', PLAYER, 41, 22);
    world.stepSeconds(10);
    expect(world.get(marine.id)).toBeUndefined();
    const defenders = world.list((e) => e.team === ENEMY && !!e.leash);
    world.stepSeconds(15);
    for (const d of defenders) expect(Math.hypot(d.x - d.leash!.x, d.y - d.leash!.y)).toBeLessThan(11);
  });

  it('Banelings explode on contact, splashing everything light nearby', () => {
    const world = new World({ width: 40, height: 30 });
    // SCVs, because Marines would shoot it before it arrives (which is the point of Marines).
    const scvs = [0, 1, 2].map((i) => world.spawn('scv', PLAYER, 10, 14 + i * 0.7));
    const bane = world.spawn('baneling', ENEMY, 14, 15, { leash: { x: 14, y: 15 } });
    world.stepSeconds(3);
    expect(world.get(bane.id)).toBeUndefined();
    // 16 + 19 vs light = 35 splash: everything light in the blast is hurt.
    expect(scvs.every((m) => m.hp <= DEFS.scv.hp - 35 + 0.01)).toBe(true);
  });
});

describe('simulation', () => {
  it('is deterministic for the same commands', () => {
    const run = () => {
      const w = createSandbox();
      const scvs = w.list((e) => e.def === 'scv');
      const minerals = w.list((e) => e.def === 'mineralSource');
      scvs.forEach((g, i) => w.issue({ type: 'target', ids: [g.id], targetId: minerals[i % 3].id }));
      w.stepSeconds(30);
      w.issue({ type: 'build', builderId: scvs[0].id, def: 'supplyDepot', x: 16, y: 16 });
      w.stepSeconds(90);
      return w.hash();
    };
    expect(run()).toBe(run());
  });

  it('separation spreads a stacked group', () => {
    const world = new World({ width: 40, height: 30 });
    const a = world.spawn('marine', PLAYER, 10, 10);
    const b = world.spawn('marine', PLAYER, 10, 10);
    world.stepSeconds(1);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.6);
  });
});

describe('input: scroll classification', () => {
  it('trackpad swipes pan, mouse wheels zoom, gestures stay together', async () => {
    const { classifyScroll } = await import('../src/input/input');
    const ev = (deltaX: number, deltaY: number, deltaMode = 0, timeStamp = 1000) => ({ deltaX, deltaY, deltaMode, timeStamp });
    expect(classifyScroll(ev(0, 100), 'auto', -Infinity)).toBe('zoom'); // Chrome mouse wheel notch
    expect(classifyScroll(ev(0, 125), 'auto', -Infinity)).toBe('zoom'); // ... at 125% display scaling
    expect(classifyScroll(ev(0, 3, 1), 'auto', -Infinity)).toBe('zoom'); // Firefox line mode
    expect(classifyScroll(ev(4, 0), 'auto', -Infinity)).toBe('pan'); // sideways swipe
    expect(classifyScroll(ev(0, 12), 'auto', -Infinity)).toBe('pan'); // small step
    expect(classifyScroll(ev(0, 57.5), 'auto', -Infinity)).toBe('pan'); // fractional
    expect(classifyScroll(ev(0, 120, 0, 1100), 'auto', 1000)).toBe('pan'); // fast flick mid-gesture
    expect(classifyScroll(ev(0, 120, 0, 2000), 'auto', 1000)).toBe('zoom'); // new gesture after a pause
    expect(classifyScroll(ev(0, 100), 'pan', -Infinity)).toBe('pan');
    expect(classifyScroll(ev(5, 0), 'zoom', -Infinity)).toBe('zoom');
  });
});
