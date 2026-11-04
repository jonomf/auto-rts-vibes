/** When should the army attack? Sweep the "army ≥ N → offense" threshold. */
import { runMatch } from '../src/lab/run';
import { PRESETS } from '../src/automation/presets';
import { RULESETS } from '../src/sim/ruleset';
import { writeFileSync, mkdirSync } from 'node:fs';
const out: { preset: string; scenario: string; n: number; clear: number | null; lost: number; left: number }[] = [];
for (const preset of ['bio', 'mech'] as const)
  for (const scen of ['outpost', 'swarm'] as const) {
    const line: string[] = [];
    for (const n of [4, 8, 12, 16, 20, 24, 30, 40]) {
      const p = PRESETS[preset].make();
      const r0 = p.rules.base!.find((r) => r.act.kind === 'setPosture')!;
      r0.conds = [{ kind: 'count', what: 'army', op: '>=', n }];
      const r = runMatch(p, scen, RULESETS.classic, 600, preset);
      out.push({ preset, scenario: scen, n, clear: r.clear, lost: r.lostUnits, left: r.enemyLeft });
      line.push(`${n}: ${r.clear === null ? `—(${r.enemyLeft})` : Math.round(r.clear) + 's'} l${r.lostUnits}`);
    }
    console.log(`${preset}/${scen}  ${line.join('  ')}`);
  }
mkdirSync('lab', { recursive: true });
writeFileSync('lab/timing.json', JSON.stringify(out, null, 1));
