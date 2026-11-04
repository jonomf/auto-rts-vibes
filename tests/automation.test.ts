import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createScenario } from '../src/sim/scenario';
import { RULESETS } from '../src/sim/ruleset';
import { DEFS } from '../src/sim/defs';
import { ENEMY, NEUTRAL, PLAYER, type Entity } from '../src/sim/types';
import { airProgram, bioProgram, mechProgram, starterProgram } from '../src/automation/presets';
import { describeRule, emptyProgram, nodeCount, sanitizeProgram } from '../src/automation/blocks';
import { getAddon, getKeep, setAddon, setKeep, findKeep, stepFor } from '../src/automation/production';
import type { Program, Rule } from '../src/automation/types';
import { runMatch } from '../src/lab/run';

let n = 0;
const rule = (r: Partial<Rule> & Pick<Rule, 'act'>): Rule => ({ id: `t${n++}`, on: true, max: null, conds: [], ...r });

/** CC, a Supply Depot, five mineral fields, a geyser with a finished Refinery, six SCVs. */
function base(program: Partial<Program> = {}, rules = RULESETS.classic) {
  const world = new World({ width: 50, height: 36 }, rules);
  const cc = world.spawn('commandCenter', PLAYER, 12, 18);
  world.spawn('supplyDepot', PLAYER, 12, 30);
  for (const y of [14, 16, 18, 20, 22]) world.spawn('mineralSource', NEUTRAL, 5, y);
  const geyser = world.spawn('gasSource', NEUTRAL, 12, 11);
  world.spawn('refinery', PLAYER, geyser.x, geyser.y);
  const gs = [0, 1, 2, 3, 4, 5].map((i) => world.spawn('scv', PLAYER, 9, 15 + i));
  world.program = { ...emptyProgram(), ...program };
  return { world, cc, gs };
}

const of = (w: World, def: Entity['def']) => w.list((e) => e.def === def);

describe('automation: unit rules', () => {
  it('no program rules: nothing happens (the puzzle start)', () => {
    const { world, cc, gs } = base();
    world.stepSeconds(30);
    expect(cc.stock.minerals).toBe(0);
    expect(gs.every((g) => g.order.type === 'idle')).toBe(true);
  });

  it('"always: gather minerals → Command Center" runs the economy, spread over the fields', () => {
    const { world, cc, gs } = base({ rules: { scv: [rule({ act: { kind: 'gather', res: 'minerals', to: 'commandCenter' } })] } });
    world.stepSeconds(30);
    expect(cc.stock.minerals).toBeGreaterThan(300);
    expect(new Set(gs.map((g) => g.sourceId)).size).toBeGreaterThanOrEqual(5);
  });

  it('a rule cap (max 2) limits how many units follow it; the rest fall through', () => {
    const { world, gs } = base({
      rules: {
        scv: [
          rule({ id: 'gas', max: 2, act: { kind: 'gather', res: 'gas', to: 'commandCenter' } }),
          rule({ id: 'min', act: { kind: 'gather', res: 'minerals', to: 'commandCenter' } }),
        ],
      },
    });
    world.stepSeconds(5);
    expect(gs.filter((g) => g.intent === 'scv#gas').length).toBe(2);
    expect(gs.filter((g) => g.intent === 'scv#min').length).toBe(4);
  });

  it('a higher rule interrupts a lower one as soon as its conditions hold', () => {
    const { world, cc, gs } = base({
      rules: {
        scv: [
          rule({ id: 'gas', conds: [{ kind: 'stock', at: 'commandCenter', res: 'minerals', op: '>=', n: 100 }], act: { kind: 'gather', res: 'gas', to: 'commandCenter' } }),
          rule({ id: 'min', act: { kind: 'gather', res: 'minerals', to: 'commandCenter' } }),
        ],
      },
    });
    world.stepSeconds(2);
    expect(gs.every((g) => g.intent === 'scv#min')).toBe(true);
    world.stepSeconds(25);
    expect(cc.stock.minerals).toBeGreaterThanOrEqual(100);
    expect(gs.every((g) => g.intent === 'scv#gas')).toBe(true);
  });

  it('player orders win until the unit finishes them', () => {
    const { world, gs } = base({ rules: { scv: [rule({ act: { kind: 'gather', res: 'minerals', to: 'commandCenter' } })] } });
    world.issue({ type: 'move', ids: [gs[0].id], x: 40, y: 30 });
    world.stepSeconds(3);
    expect(gs[0].manual).toBe(true);
    world.stepSeconds(15);
    expect(gs[0].manual).toBe(false);
    expect(gs[0].order.type).toBe('gather');
  });

  it('haul moves crates out of the Command Center to a blueprint, which completes', () => {
    const { world, cc } = base({
      rules: { scv: [rule({ conds: [{ kind: 'needs', res: 'minerals', where: 'any', not: false }], act: { kind: 'haul', res: 'minerals', from: 'commandCenter', to: 'needy' } })] },
    });
    cc.stock.minerals = 400;
    const site = world.spawn('barracks', PLAYER, 22, 18, { complete: false, stock: { minerals: -150, gas: 0 }, required: 150 });
    world.stepSeconds(20);
    expect(site.complete).toBe(true);
  });

  it('fighters run their own rules then the army rules; "attack nearest enemy" clears dummies', () => {
    const { world } = base({
      rules: {
        army: [
          rule({ conds: [{ kind: 'enemyNear', r: 12, not: false }], act: { kind: 'attack' } }),
          rule({ act: { kind: 'attackMove', to: 'enemy' } }),
        ],
      },
    });
    for (let i = 0; i < 4; i++) world.spawn('marine', PLAYER, 15, 16 + i);
    world.spawn('dummy', ENEMY, 40, 10);
    world.spawn('dummy', ENEMY, 42, 28);
    world.stepSeconds(60);
    expect(world.list((e) => e.team === ENEMY).length).toBe(0);
  });

  it('siege / pack up / stim are rule actions (classic rules need them)', () => {
    const { world } = base({
      rules: {
        siegeTank: [
          rule({ conds: [{ kind: 'enemyNear', r: 13, not: false }, { kind: 'sieged', not: true }], act: { kind: 'siege' } }),
          rule({ conds: [{ kind: 'enemyNear', r: 15, not: true }, { kind: 'sieged', not: false }], act: { kind: 'unsiege' } }),
        ],
        marine: [rule({ conds: [{ kind: 'enemyNear', r: 8, not: false }], act: { kind: 'stim' } })],
      },
    });
    const tank = world.spawn('siegeTank', PLAYER, 20, 18);
    const marine = world.spawn('marine', PLAYER, 20, 22);
    const dummy = world.spawn('dummy', ENEMY, 31, 18);
    world.stepSeconds(3);
    expect(tank.sieged).toBe(true);
    expect(marine.stimmed).toBe(0); // dummy is 11 away
    world.kill(dummy);
    world.stepSeconds(4);
    expect(tank.sieged).toBe(false);
    world.spawn('dummy', ENEMY, 25, 22);
    world.stepSeconds(0.5);
    expect(marine.stimmed).toBeGreaterThan(0);
  });

  it('streamlined rules: tanks siege by themselves', () => {
    const { world } = base({}, RULESETS.streamlined);
    const tank = world.spawn('siegeTank', PLAYER, 20, 18);
    world.spawn('dummy', ENEMY, 31, 18);
    world.stepSeconds(3);
    expect(tank.sieged).toBe(true);
  });
});

describe('automation: buildings, base rules, build order', () => {
  it('buildings train through their rules and fall through when they cannot', () => {
    const { world } = base({
      rules: {
        barracks: [rule({ act: { kind: 'train', def: 'marauder' } }), rule({ act: { kind: 'train', def: 'marine' } })],
      },
    });
    world.spawn('barracks', PLAYER, 22, 12, { stock: { minerals: 100, gas: 0 } });
    world.stepSeconds(DEFS.marine.buildTime! * 2 + 1);
    expect(of(world, 'marauder').length).toBe(0); // no Tech Lab
    expect(of(world, 'marine').length).toBe(2);
  });

  it('an add-on rule saves up for the add-on instead of falling through to training', () => {
    const { world } = base({
      rules: {
        barracks: [rule({ act: { kind: 'addon', def: 'techLab' } }), rule({ act: { kind: 'train', def: 'marine' } })],
      },
    });
    const b = world.spawn('barracks', PLAYER, 22, 12, { stock: { minerals: 100, gas: 0 } });
    world.stepSeconds(10);
    expect(of(world, 'marine').length).toBe(0); // saving for the Tech Lab (needs 25 gas)
    b.stock.gas = 25;
    world.stepSeconds(DEFS.techLab.buildTime! + 1);
    expect(b.addon).toBe('techLab');
  });

  it('the build order places blueprints at layout slots, Refineries on geysers, and add-ons', () => {
    const { world, cc } = base({
      order: [
        { id: 'a', kind: 'build', def: 'barracks' },
        { id: 'b', kind: 'build', def: 'refinery' },
        { id: 'c', kind: 'addon', def: 'reactor', on: 'barracks' },
      ],
      rules: { scv: [rule({ act: { kind: 'gather', res: 'minerals', to: 'needy' } })] },
    });
    world.list((e) => e.def === 'refinery').forEach((r) => world.kill(r));
    world.step();
    world.stepSeconds(5);
    const br = of(world, 'barracks')[0];
    const slot = world.program!.layout.slots.find((s) => s.def === 'barracks')!;
    expect(Math.abs(br.x - (cc.x + slot.dx))).toBeLessThan(0.6);
    const ref = of(world, 'refinery')[0];
    expect(ref).toBeDefined();
    expect(of(world, 'gasSource').some((g) => g.x === ref.x && g.y === ref.y)).toBe(true);
    world.stepSeconds(120);
    br.stock.gas += 50; // nobody mines gas in this test
    world.stepSeconds(30);
    expect(br.addon).toBe('reactor');
    expect(world.auto.step).toBe(3);
  });

  it('classic layouts keep add-on spots free', () => {
    const { world } = base({ order: [1, 2, 3].map((i) => ({ id: `b${i}`, kind: 'build' as const, def: 'supplyDepot' as const })) });
    world.program!.layout.slots = [{ def: 'supplyDepot', dx: 12.75, dy: 0 }]; // right where a Barracks' add-on would go
    world.spawn('barracks', PLAYER, 22.5, 18);
    world.stepSeconds(10);
    for (const d of of(world, 'supplyDepot').filter((e) => !e.complete || e.y !== 30))
      expect(Math.hypot(d.x - 24.75, d.y - 18.75) > 1.5).toBe(true);
  });

  it('base rules: build a depot whenever supply runs low (one at a time)', () => {
    const { world } = base({
      rules: { base: [rule({ conds: [{ kind: 'supply', op: '<', n: 4 }], act: { kind: 'build', def: 'supplyDepot' } })] },
    });
    for (let i = 0; i < 14; i++) world.spawn('marine', PLAYER, 30, 2 + i);
    const depots = () =>
      of(world, 'supplyDepot').length + world.list((u) => u.order.type === 'build' && u.order.def === 'supplyDepot').length;
    world.stepSeconds(2);
    expect(depots()).toBe(2); // the existing one + one on the way
    world.stepSeconds(3);
    expect(depots()).toBe(2); // still one at a time
  });

  it('base rules flip the posture', () => {
    const { world } = base({
      rules: { base: [rule({ conds: [{ kind: 'count', what: 'army', op: '>=', n: 3 }], act: { kind: 'setPosture', to: 'offense' } })] },
    });
    world.stepSeconds(1);
    expect(world.auto.posture).toBe('economy');
    for (let i = 0; i < 3; i++) world.spawn('hellion', PLAYER, 20, 10 + i * 2);
    world.stepSeconds(1);
    expect(world.auto.posture).toBe('offense');
  });
});

describe('automation: example programs (the strategy lab)', () => {
  it('the starter program clears the target range with no player input', () => {
    const r = runMatch(starterProgram(), 'range', RULESETS.classic, 360, 'starter');
    expect(r.clear).not.toBeNull();
    expect(r.army.siegeTank ?? 0).toBeGreaterThan(0);
  });

  it('counters work: mech and air crack the Armor line, bio does not', () => {
    expect(runMatch(mechProgram(), 'armor', RULESETS.classic, 360).clear).not.toBeNull();
    expect(runMatch(airProgram(), 'armor', RULESETS.classic, 360).clear).not.toBeNull();
    expect(runMatch(bioProgram(), 'armor', RULESETS.classic, 360).clear).toBeNull();
  });

  it('forgetting supply stalls a program under classic rules, but not under streamlined', () => {
    const noSupply = () => {
      const p = mechProgram();
      p.rules.base = p.rules.base!.filter((r) => r.act.kind !== 'build');
      return p;
    };
    const classic = runMatch(noSupply(), 'range', RULESETS.classic, 300);
    const streamlined = runMatch(noSupply(), 'range', RULESETS.streamlined, 300);
    expect(classic.clear).toBeNull();
    expect(classic.supplyBlocked).toBeGreaterThan(60);
    expect(streamlined.clear).not.toBeNull();
  });

  it('is deterministic', () => {
    const run = () => {
      const w = createScenario('outpost');
      w.program = starterProgram();
      w.stepSeconds(100);
      return w.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('program data', () => {
  it('sanitize keeps a valid program intact and drops junk', () => {
    const p = starterProgram();
    expect(sanitizeProgram(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const junk = sanitizeProgram({
      rules: { scv: [{ act: { kind: 'train', def: 'siegeTank' } }, { act: { kind: 'gather', res: 'plutonium', to: 'commandCenter' }, conds: [{ kind: 'nope' }] }] },
      order: [{ kind: 'wait', cond: { kind: 'count', what: 'scv', op: '>=', n: 1e9 } }],
    });
    expect(junk.rules.scv?.length).toBe(1);
    expect(junk.rules.scv?.[0].act).toEqual({ kind: 'gather', res: 'minerals', to: 'commandCenter' });
    expect((junk.order[0] as { cond: { n: number } }).cond.n).toBe(200);
  });

  it('programs saved with the old names migrate (gatherer → SCV, Home → Command Center, Ship → Banshee)', () => {
    const old = sanitizeProgram({
      rules: {
        gatherer: [{ id: 'g', act: { kind: 'gather', res: 'minerals', to: 'home' }, conds: [{ kind: 'stock', at: 'home', res: 'minerals', op: '>=', n: 50 }] }],
        port: [{ id: 'p', act: { kind: 'train', def: 'ship' } }],
        lightInfantry: [{ id: 'l', act: { kind: 'move', to: 'home' } }],
      },
      order: [{ id: 's', kind: 'build', def: 'infantryTraining' }],
      layout: { slots: [{ def: 'mechFactory', dx: 3, dy: 4 }], muster: { dx: 1, dy: 2 } },
    });
    expect(old.rules.scv?.[0].act).toEqual({ kind: 'gather', res: 'minerals', to: 'commandCenter' });
    expect(old.rules.scv?.[0].conds[0]).toMatchObject({ at: 'commandCenter' });
    expect(old.rules.starport?.[0].act).toEqual({ kind: 'train', def: 'banshee' });
    expect(old.rules.marine?.[0].act).toEqual({ kind: 'move', to: 'home' }); // "move to Home" is still a place
    expect(old.order[0]).toMatchObject({ kind: 'build', def: 'barracks' });
    expect(old.layout.slots[0].def).toBe('factory');
  });

  it('rules read as sentences', () => {
    const p = starterProgram();
    expect(describeRule(p.rules.scv![0], 'scv')).toBe(
      'if something needs minerals at any building and stock at Command Center minerals ≥ 50 → haul minerals from Command Center to whatever needs it',
    );
    expect(describeRule(p.rules.base![0], 'base')).toBe('if supply left < 5 → build Supply Depot');
    expect(describeRule(p.rules.siegeTank![0], 'siegeTank')).toBe('if enemy within 13 and not sieged → siege up');
    expect(nodeCount(p)).toBeGreaterThan(30);
  });
});

describe('production view: keep targets and add-ons are ordinary rules', () => {
  it('reads keep targets out of the starter program', () => {
    const p = starterProgram();
    expect(getKeep(p, 'scv')).toBe(20);
    expect(getKeep(p, 'marauder')).toBe(4);
    expect(getKeep(p, 'marine')).toBe('always');
    expect(getKeep(p, 'supplyDepot')).toBe(5); // "supply left < 5 → build Supply Depot"
    expect(getKeep(p, 'barracks')).toBe(null); // built by the build order instead
  });

  it('setting a keep edits, adds or removes exactly one rule', () => {
    const p = emptyProgram();
    setKeep(p, 'scv', 7);
    const id = findKeep(p, 'scv')!.rule.id;
    setKeep(p, 'scv', 'always');
    expect(p.rules.commandCenter!.length).toBe(1);
    expect(p.rules.commandCenter![0].id).toBe(id);
    setKeep(p, 'supplyDepot', 6);
    expect(p.rules.base![0].conds).toEqual([{ kind: 'supply', op: '<', n: 6 }]);
    setKeep(p, 'scv', null);
    expect(p.rules.commandCenter).toBeUndefined();
  });

  it('the add-on choice is a rule at the top of the building’s list', () => {
    const p = starterProgram();
    setAddon(p, 'factory', 'reactor');
    expect(p.rules.factory![0].act).toEqual({ kind: 'addon', def: 'reactor' });
    expect(getAddon(p, 'factory')).toBe('reactor');
    setAddon(p, 'factory', null);
    expect(getAddon(p, 'factory')).toBe(null);
    expect(p.rules.factory!.every((r) => r.act.kind === 'train')).toBe(true);
  });

  it('build-order steps continue from earlier ones', () => {
    const p = emptyProgram();
    const a = stepFor(p, 'scv');
    expect(a).toMatchObject({ kind: 'train', def: 'scv', n: 5 });
    p.order.push(a);
    expect(stepFor(p, 'scv')).toMatchObject({ n: 6 });
    expect(stepFor(p, 'starport')).toMatchObject({ kind: 'build', def: 'starport' });
  });
});
