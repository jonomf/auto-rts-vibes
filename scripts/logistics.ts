/** Logistics experiment: how should income reach the production buildings? */
import { runMatch } from '../src/lab/run';
import { PRESETS } from '../src/automation/presets';
import { RULESETS } from '../src/sim/ruleset';
import type { Program, Rule } from '../src/automation/types';

type Variant = { name: string; tweak: (p: Program) => void };
const scv = (p: Program) => p.rules.scv!;
const variants: Variant[] = [
  { name: 'haul 3/2 (as is)', tweak: () => {} },
  { name: 'haul 6/4', tweak: (p) => { scv(p)[0].max = 6; scv(p)[1].max = 4; } },
  { name: 'haul 10/6', tweak: (p) => { scv(p)[0].max = 10; scv(p)[1].max = 6; } },
  {
    name: 'deliver to needy',
    tweak: (p) => {
      for (const r of scv(p)) if (r.act.kind === 'gather') (r.act as Extract<Rule['act'], { kind: 'gather' }>).to = 'needy';
    },
  },
  {
    name: 'needy + haul 6/4',
    tweak: (p) => {
      scv(p)[0].max = 6; scv(p)[1].max = 4;
      for (const r of scv(p)) if (r.act.kind === 'gather') (r.act as Extract<Rule['act'], { kind: 'gather' }>).to = 'needy';
    },
  },
];
for (const preset of ['starter', 'mech', 'bio'] as const)
  for (const scen of ['outpost', 'armor'] as const) {
    const line: string[] = [];
    for (const v of variants) {
      const prog = PRESETS[preset].make();
      v.tweak(prog);
      const r = runMatch(prog, scen, RULESETS.classic, 480, preset);
      const t = r.clear === null ? `—(${r.enemyLeft})` : `${Math.floor(r.clear / 60)}:${String(Math.round(r.clear % 60)).padStart(2, '0')}`;
      line.push(`${v.name}: ${t} hoard ${r.ccHoard}`);
    }
    console.log(`${preset}/${scen}\n   ${line.join('\n   ')}`);
  }
