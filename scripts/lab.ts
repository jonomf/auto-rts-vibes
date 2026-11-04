/**
 * Strategy lab: every preset program × scenario × ruleset, headless and deterministic.
 *   bun scripts/lab.ts                  -> table on stdout, JSON to lab-results.json
 *   bun scripts/lab.ts --minutes 10     -> longer time limit
 */
import { SCENARIOS, type ScenarioId } from '../src/sim/scenario';
import { RULESETS } from '../src/sim/ruleset';
import { PRESETS, type PresetId } from '../src/automation/presets';
import { runMatch, type LabResult } from '../src/lab/run';
import { writeFileSync } from 'node:fs';

export { runMatch, type LabResult };

if (import.meta.main) {
  const args = process.argv.slice(2);
  const minutes = Number(args[args.indexOf('--minutes') + 1] || 8);
  const only = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  const results: LabResult[] = [];
  const fmt = (s: number | null) => (s === null ? '  —  ' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  for (const rules of Object.values(RULESETS))
    for (const [id, p] of Object.entries(PRESETS)) {
      if (only && only !== id) continue;
      const row: string[] = [];
      for (const scen of Object.keys(SCENARIOS) as ScenarioId[]) {
        const t0 = performance.now();
        const r = runMatch(p.make(), scen, rules, minutes * 60, id);
        results.push(r);
        row.push(`${fmt(r.clear)}${r.clear === null ? `(${r.enemyLeft} left)` : ''} lost ${r.lostUnits} ${Math.round(performance.now() - t0)}ms`);
      }
      console.log(`${rules.id.padEnd(11)} ${(id as PresetId).padEnd(8)} ${row.join(' | ')}`);
    }
  writeFileSync('lab-results.json', JSON.stringify(results, null, 1));
}
