/**
 * The strategy-lab experiments behind the prototype write-up.
 *   bun scripts/experiments.ts   -> lab/results.json (+ a summary on stdout)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { runMatch, type LabResult } from '../src/lab/run';
import { PRESETS, type PresetId } from '../src/automation/presets';
import { RULESETS } from '../src/sim/ruleset';
import { SCENARIOS, type ScenarioId } from '../src/sim/scenario';
import type { Program, Rule } from '../src/automation/types';

const LIMIT = 480; // 8 minutes of game time
const fmt = (r: LabResult) =>
  r.clear === null ? `—(${r.enemyLeft} left)` : `${Math.floor(r.clear / 60)}:${String(Math.round(r.clear % 60)).padStart(2, '0')}`;

// 1. The matrix: every program × scenario × ruleset.
const matrix: LabResult[] = [];
for (const rules of Object.values(RULESETS))
  for (const id of Object.keys(PRESETS) as PresetId[])
    for (const scen of Object.keys(SCENARIOS) as ScenarioId[]) matrix.push(runMatch(PRESETS[id].make(), scen, rules, LIMIT, id));
console.log('matrix done');

// 2. Forgetfulness: what each ruleset does when a program leaves something out.
type Variant = { id: string; name: string; tweak: (p: Program) => void };
const dropSupply = (p: Program) => {
  p.rules.base = (p.rules.base ?? []).filter((r) => !(r.act.kind === 'build' && r.act.def === 'supplyDepot'));
};
const dropAbilities = (p: Program) => {
  for (const s of ['siegeTank', 'marine', 'marauder'] as const) delete p.rules[s];
};
const forget: Variant[] = [
  { id: 'full', name: 'Full program', tweak: () => {} },
  { id: 'noSupply', name: 'No supply rule', tweak: dropSupply },
  { id: 'noAbilities', name: 'No siege / stim rules', tweak: dropAbilities },
  { id: 'neither', name: 'Neither', tweak: (p) => (dropSupply(p), dropAbilities(p)) },
];
const forgetful: (LabResult & { variant: string })[] = [];
for (const rules of Object.values(RULESETS))
  for (const id of ['starter', 'bio', 'mech'] as PresetId[])
    for (const scen of ['outpost', 'armor'] as ScenarioId[])
      for (const v of forget) {
        const p = PRESETS[id].make();
        v.tweak(p);
        forgetful.push({ ...runMatch(p, scen, rules, LIMIT, id), variant: v.id });
      }
console.log('forgetfulness done');

// 3. Logistics: how many SCVs haul crates, and whether to deliver straight to production.
const logisticsVariants: Variant[] = [
  { id: 'h2-1', name: 'Haul 2 + 1', tweak: (p) => setHaul(p, 2, 1) },
  { id: 'h3-2', name: 'Haul 3 + 2', tweak: (p) => setHaul(p, 3, 2) },
  { id: 'h6-4', name: 'Haul 6 + 4', tweak: (p) => setHaul(p, 6, 4) },
  { id: 'h10-6', name: 'Haul 10 + 6', tweak: (p) => setHaul(p, 10, 6) },
  { id: 'needy', name: 'Deliver to production (6 + 4)', tweak: (p) => (setHaul(p, 6, 4), deliverNeedy(p)) },
];
function setHaul(p: Program, m: number, g: number) {
  const scv = p.rules.scv!;
  scv[0].max = m;
  scv[1].max = g;
}
function deliverNeedy(p: Program) {
  for (const r of p.rules.scv!) if (r.act.kind === 'gather') (r.act as Extract<Rule['act'], { kind: 'gather' }>).to = 'needy';
}
const logistics: (LabResult & { variant: string })[] = [];
for (const id of ['starter', 'mech', 'bio'] as PresetId[])
  for (const scen of ['range', 'outpost'] as ScenarioId[])
    for (const v of logisticsVariants) {
      const p = PRESETS[id].make();
      v.tweak(p);
      logistics.push({ ...runMatch(p, scen, RULESETS.classic, LIMIT, id), variant: v.id });
    }
console.log('logistics done');

mkdirSync('lab', { recursive: true });
writeFileSync(
  'lab/results.json',
  JSON.stringify(
    {
      limitSeconds: LIMIT,
      scenarios: SCENARIOS,
      rulesets: RULESETS,
      presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { name: v.name, blurb: v.blurb }])),
      forgetVariants: forget.map(({ id, name }) => ({ id, name })),
      logisticsVariants: logisticsVariants.map(({ id, name }) => ({ id, name })),
      matrix,
      forgetful,
      logistics,
    },
    null,
    1,
  ),
);

// Summary.
for (const rules of Object.keys(RULESETS))
  for (const id of Object.keys(PRESETS))
    console.log(
      `${rules.padEnd(11)} ${id.padEnd(8)} ` +
        (Object.keys(SCENARIOS) as ScenarioId[])
          .map((s) => {
            const r = matrix.find((m) => m.rules === rules && m.preset === id && m.scenario === s)!;
            return `${s} ${fmt(r)} (lost ${r.lostUnits})`;
          })
          .join(' | '),
    );
console.log('\nforgetfulness (outpost / armor):');
for (const rules of Object.keys(RULESETS))
  for (const id of ['starter', 'bio', 'mech'])
    console.log(
      `${rules.padEnd(11)} ${id.padEnd(8)} ` +
        forget
          .map((v) => {
            const rs = forgetful.filter((f) => f.rules === rules && f.preset === id && f.variant === v.id);
            return `${v.id}: ${rs.map(fmt).join(' / ')} blocked ${rs.map((x) => x.supplyBlocked).join('/')}s`;
          })
          .join(' | '),
    );
console.log('\nlogistics (range / outpost):');
for (const id of ['starter', 'mech', 'bio'])
  console.log(
    `${id.padEnd(8)} ` +
      logisticsVariants
        .map((v) => {
          const rs = logistics.filter((f) => f.preset === id && f.variant === v.id);
          return `${v.id}: ${rs.map(fmt).join(' / ')} hoard ${rs.map((x) => x.ccHoard).join('/')}`;
        })
        .join(' | '),
  );
