import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createSandbox } from '../src/sim/scenario';
import { constructionProgress, constructionScale } from '../src/sim/actions';
import { CONSTRUCTION_START_SCALE, DEFS } from '../src/sim/defs';
import { ENEMY, NEUTRAL, PLAYER, type Entity } from '../src/sim/types';

/** A tiny map: a home, one mineral field, one gas source. */
function basicWorld() {
  const world = new World({ width: 40, height: 30 });
  const home = world.spawn('commandCenter', PLAYER, 10, 15);
  const minerals = world.spawn('mineralSource', NEUTRAL, 4, 15);
  const gas = world.spawn('gasSource', NEUTRAL, 10, 9);
  const g = world.spawn('scv', PLAYER, 7, 15);
  return { world, home, minerals, gas, g };
}

const count = (world: World, def: Entity['def']) => world.list((e) => e.def === def).length;

describe('gathering', () => {
  it('right-clicking minerals starts a gather -> deliver loop into the nearest Home', () => {
    const { world, home, minerals, g } = basicWorld();
    expect(world.issue({ type: 'target', ids: [g.id], targetId: minerals.id }).ok).toBe(true);
    world.stepSeconds(20);
    expect(home.stock.minerals).toBeGreaterThanOrEqual(100);
    expect(home.stock.minerals % DEFS.mineralSource.resource!.pieceSize).toBe(0);
    expect(minerals.remaining).toBe(1000 - home.stock.minerals - (g.cargo?.amount ?? 0));
    expect(g.order.type).toBe('gather');
  });

  it('regression: a move order before gathering does not cause the instant gather/deposit loop', () => {
    // Unity bug (c2e443b): TargetPosition was never cleared, so after one ground move the
    // gatherer "arrived" at every later target instantly and looped deposit/harvest in place.
    const { world, home, minerals, g } = basicWorld();
    world.issue({ type: 'move', ids: [g.id], x: 20, y: 20 });
    world.stepSeconds(5);
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    world.step();
    expect(home.stock.minerals).toBe(0);
    // It has to actually walk to the minerals (~16 units at 3.5 u/s) and back before anything lands.
    world.stepSeconds(3);
    expect(home.stock.minerals).toBe(0);
    world.stepSeconds(20);
    expect(home.stock.minerals).toBeGreaterThan(0);
    // ~1 trip per 2.8s here; the instant loop would deliver every tick (thousands).
    expect(home.stock.minerals).toBeLessThanOrEqual(250);
  });

  it('right-clicking a building with a gatherer redirects its deliveries there (per-building stockpiles)', () => {
    const { world, home, minerals, g } = basicWorld();
    const barracks = world.spawn('barracks', PLAYER, 10, 22);
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    world.issue({ type: 'target', ids: [g.id], targetId: barracks.id });
    world.stepSeconds(20);
    expect(barracks.stock.minerals).toBeGreaterThan(0);
    expect(home.stock.minerals).toBe(0);
  });

  it('a group sent to one mineral field spreads over neighbouring fields', () => {
    const world = new World({ width: 40, height: 30 });
    world.spawn('commandCenter', PLAYER, 10, 15);
    const fields = [13, 15, 17].map((y) => world.spawn('mineralSource', NEUTRAL, 4, y));
    const gs = [0, 1, 2].map((i) => world.spawn('scv', PLAYER, 7, 14 + i));
    world.issue({ type: 'target', ids: gs.map((g) => g.id), targetId: fields[1].id });
    expect(new Set(gs.map((g) => g.sourceId)).size).toBe(3);
    expect(gs[0].sourceId).toBe(fields[1].id);
  });

  it('moves on to a nearby field of the same type when a source runs dry', () => {
    const world = new World({ width: 40, height: 30 });
    const home = world.spawn('commandCenter', PLAYER, 10, 15);
    const a = world.spawn('mineralSource', NEUTRAL, 4, 15, { remaining: 25 });
    const b = world.spawn('mineralSource', NEUTRAL, 4, 17);
    const g = world.spawn('scv', PLAYER, 7, 15);
    world.issue({ type: 'target', ids: [g.id], targetId: a.id });
    world.stepSeconds(25);
    expect(world.get(a.id)).toBeUndefined();
    expect(b.remaining).toBeLessThan(1000);
    expect(home.stock.minerals).toBeGreaterThan(25);
  });
});

describe('construction by delivery', () => {
  it('a blueprint starts small, grows as resources arrive, and completes when its debt is paid', () => {
    const { world, minerals, g } = basicWorld();
    world.issue({ type: 'target', ids: [g.id], targetId: minerals.id });
    expect(world.issue({ type: 'build', builderId: g.id, def: 'barracks', x: 6, y: 22 }).ok).toBe(true);

    world.stepSeconds(4);
    const site = world.list((e) => e.def === 'barracks')[0];
    expect(site).toBeDefined();
    expect(site.complete).toBe(false);
    expect(site.stock.minerals).toBeLessThan(0);
    expect(constructionScale(site)).toBeGreaterThanOrEqual(CONSTRUCTION_START_SCALE);
    expect(g.depositId).toBe(site.id);

    let lastProgress = constructionProgress(site);
    for (let i = 0; i < 12 && !site.complete; i++) {
      world.stepSeconds(5);
      const p = constructionProgress(site);
      expect(p).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = p;
    }
    expect(site.complete).toBe(true);
    expect(site.hp).toBe(DEFS.barracks.hp);
    expect(constructionScale(site)).toBe(1);
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
    world.issue({ type: 'target', ids: [g.id], targetId: gas.id });
    world.stepSeconds(120);
    expect(site.complete).toBe(true);
  });

  it('rejects placement on top of another building and enforces tech requirements', () => {
    const { world, g } = basicWorld();
    expect(world.issue({ type: 'build', builderId: g.id, def: 'barracks', x: 10, y: 15 }).ok).toBe(false);
    const r = world.issue({ type: 'build', builderId: g.id, def: 'factory', x: 20, y: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Infantry Training');
  });
});

describe('production', () => {
  it('training spends the building’s own stock and spawns the unit after its build time', () => {
    const { world, home } = basicWorld();
    home.stock.minerals = 120;
    expect(world.issue({ type: 'train', buildingId: home.id, def: 'scv' }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: home.id, def: 'scv' }).ok).toBe(true);
    expect(home.stock.minerals).toBe(20);
    const r = world.issue({ type: 'train', buildingId: home.id, def: 'scv' });
    expect(r.ok).toBe(false);

    world.stepSeconds(DEFS.scv.buildTime! - 0.5);
    expect(count(world, 'scv')).toBe(1);
    world.stepSeconds(1);
    expect(count(world, 'scv')).toBe(2);
    world.stepSeconds(DEFS.scv.buildTime!);
    expect(count(world, 'scv')).toBe(3);
  });

  it('cancel refunds', () => {
    const { world, home } = basicWorld();
    home.stock.minerals = 50;
    world.issue({ type: 'train', buildingId: home.id, def: 'scv' });
    expect(home.stock.minerals).toBe(0);
    world.issue({ type: 'cancelTrain', buildingId: home.id, index: 0 });
    expect(home.stock.minerals).toBe(50);
    expect(home.queue.length).toBe(0);
  });

  it('a building under construction cannot train', () => {
    const { world } = basicWorld();
    const site = world.spawn('commandCenter', PLAYER, 25, 15, { complete: false, stock: { minerals: 100, gas: 0 } });
    expect(world.issue({ type: 'train', buildingId: site.id, def: 'scv' }).ok).toBe(false);
  });

  it('each family trains from its building: infantry, mech, port', () => {
    const world = new World({ width: 50, height: 40 });
    const rich = { minerals: 1000, gas: 1000 };
    const it_ = world.spawn('barracks', PLAYER, 10, 10, { stock: { ...rich } });
    const mf = world.spawn('factory', PLAYER, 20, 10, { stock: { ...rich } });
    const port = world.spawn('starport', PLAYER, 30, 10, { stock: { ...rich } });
    expect(world.issue({ type: 'train', buildingId: it_.id, def: 'marine' }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: it_.id, def: 'marauder' }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: mf.id, def: 'siegeTank' }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: port.id, def: 'banshee' }).ok).toBe(true);
    expect(world.issue({ type: 'train', buildingId: mf.id, def: 'banshee' }).ok).toBe(false);
    world.stepSeconds(30);
    for (const d of ['marine', 'marauder', 'siegeTank', 'banshee'] as const) expect(count(world, d)).toBe(1);
  });

  it('a rally point on a mineral field sends new gatherers straight to work', () => {
    const { world, home, minerals } = basicWorld();
    home.stock.minerals = 50;
    world.issue({ type: 'rally', buildingIds: [home.id], x: minerals.x, y: minerals.y, targetId: minerals.id });
    world.issue({ type: 'train', buildingId: home.id, def: 'scv' });
    world.stepSeconds(DEFS.scv.buildTime! + 0.2);
    const fresh = world.list((e) => e.def === 'scv').at(-1)!;
    expect(fresh.order.type).toBe('gather');
  });
});

describe('combat', () => {
  it('right-click attack kills a dummy; dummies never fight back', () => {
    const world = new World({ width: 40, height: 30 });
    const marine = world.spawn('marine', PLAYER, 5, 15);
    const dummy = world.spawn('dummy', ENEMY, 25, 15);
    world.issue({ type: 'target', ids: [marine.id], targetId: dummy.id });
    world.stepSeconds(30);
    expect(world.get(dummy.id)).toBeUndefined();
    expect(marine.hp).toBe(DEFS.marine.hp);
    expect(marine.order.type).toBe('idle');
  });

  it('attack-move engages targets met along the way, then continues', () => {
    const world = new World({ width: 60, height: 30 });
    const tank = world.spawn('siegeTank', PLAYER, 5, 15);
    const dummy = world.spawn('dummy', ENEMY, 20, 16);
    world.issue({ type: 'attackMove', ids: [tank.id], x: 50, y: 15 });
    world.stepSeconds(40);
    expect(world.get(dummy.id)).toBeUndefined();
    expect(Math.abs(tank.x - 50)).toBeLessThan(0.5);
  });

  it('a plain move ignores enemies', () => {
    const world = new World({ width: 60, height: 30 });
    const inf = world.spawn('marauder', PLAYER, 5, 15);
    const dummy = world.spawn('dummy', ENEMY, 20, 17);
    world.issue({ type: 'move', ids: [inf.id], x: 40, y: 15 });
    world.stepSeconds(12);
    expect(dummy.hp).toBe(DEFS.dummy.hp);
  });

  it('idle units auto-acquire nearby enemies', () => {
    const world = new World({ width: 40, height: 30 });
    const ship = world.spawn('banshee', PLAYER, 10, 15);
    const dummy = world.spawn('dummy', ENEMY, 16, 15);
    world.stepSeconds(25);
    expect(world.get(dummy.id)).toBeUndefined();
    expect(ship.hp).toBe(DEFS.banshee.hp);
  });

  it('ground-only weapons cannot target flyers', () => {
    const world = new World({ width: 40, height: 30 });
    const tank = world.spawn('siegeTank', PLAYER, 10, 15);
    const enemyShip = world.spawn('banshee', ENEMY, 13, 15, { order: { type: 'idle' } });
    world.issue({ type: 'target', ids: [tank.id], targetId: enemyShip.id });
    expect(tank.order.type).toBe('follow');
  });
});

describe('simulation', () => {
  it('is deterministic for the same commands', () => {
    const run = () => {
      const w = createSandbox();
      const gatherers = w.list((e) => e.def === 'scv');
      const minerals = w.list((e) => e.def === 'mineralSource');
      gatherers.forEach((g, i) => w.issue({ type: 'target', ids: [g.id], targetId: minerals[i % 3].id }));
      w.stepSeconds(30);
      w.issue({ type: 'build', builderId: gatherers[0].id, def: 'barracks', x: 16, y: 16 });
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

  it('the sandbox economy can reach every unit family from scratch (scripted build)', () => {
    const w = createSandbox();
    const home = w.list((e) => e.def === 'commandCenter')[0];
    const [g1, g2, g3, g4] = w.list((e) => e.def === 'scv');
    const fields = w.list((e) => e.def === 'mineralSource');
    const gases = w.list((e) => e.def === 'gasSource');
    for (const g of [g1, g2, g3, g4]) w.issue({ type: 'target', ids: [g.id], targetId: fields[g.id % 4].id });

    const until = (cond: () => boolean, maxSeconds: number) => {
      for (let t = 0; t < maxSeconds * 20 && !cond(); t++) w.step();
      expect(cond()).toBe(true);
    };
    const done = (def: Entity['def']) => () => w.hasCompleted(PLAYER, def);

    w.issue({ type: 'build', builderId: g1.id, def: 'barracks', x: 17, y: 17 });
    until(done('barracks'), 200);
    w.issue({ type: 'build', builderId: g1.id, def: 'factory', x: 17, y: 27 });
    w.issue({ type: 'target', ids: [g2.id], targetId: gases[0].id });
    w.stepSeconds(5);
    const mf = w.list((e) => e.def === 'factory')[0];
    w.issue({ type: 'target', ids: [g2.id], targetId: mf.id });
    until(done('factory'), 400);
    expect(home.stock.minerals).toBeGreaterThan(0);
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
