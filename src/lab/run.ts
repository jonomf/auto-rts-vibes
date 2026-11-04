/**
 * Headless match runner for the strategy lab (pure TypeScript; runs in tests, scripts and the browser).
 */
import { createScenario, type ScenarioId } from '../sim/scenario';
import type { Ruleset } from '../sim/ruleset';
import type { Program } from '../automation/types';
import { DEFS } from '../sim/defs';

export type LabResult = {
  preset: string;
  scenario: ScenarioId;
  rules: Ruleset['id'];
  /** Seconds to destroy every enemy, or null if not done within the limit. */
  clear: number | null;
  enemyLeft: number;
  lostUnits: number;
  lostValue: number;
  killedValue: number;
  gathered: number;
  supplyBlocked: number;
  /** Resources sitting unused in Command Centers at the end (logistics backlog). */
  ccHoard: number;
  /** Army supply when the match ended. */
  army: Record<string, number>;
  /** Seconds at which the army went on the offense. */
  offenseAt: number | null;
};

/** One headless match that can be advanced a slice at a time (so the browser stays responsive). */
export class LabMatch {
  readonly world;
  private clear: number | null = null;
  private offenseAt: number | null = null;
  private ticks = 0;
  private readonly maxTicks: number;

  constructor(
    program: Program,
    readonly scenario: ScenarioId,
    readonly rules: Ruleset,
    limitSeconds: number,
    readonly presetName = 'custom',
  ) {
    this.world = createScenario(scenario, rules);
    this.world.program = program;
    this.maxTicks = limitSeconds * 20;
  }

  get done(): boolean {
    return this.clear !== null || this.ticks >= this.maxTicks;
  }

  get progress(): number {
    return this.done ? 1 : this.ticks / this.maxTicks;
  }

  /** Run up to `n` ticks. Returns true when the match is over. */
  advance(n: number): boolean {
    const w = this.world;
    for (let i = 0; i < n && !this.done; i++) {
      w.step();
      this.ticks++;
      if (this.offenseAt === null && w.auto.posture === 'offense') this.offenseAt = w.seconds;
      if (this.ticks % 20 === 0 && !w.list((e) => e.team === 1).length) this.clear = w.seconds;
    }
    return this.done;
  }

  result(): LabResult {
    const w = this.world;
    const army: Record<string, number> = {};
    for (const e of w.all()) if (e.team === 0 && DEFS[e.def].category === 'unit' && e.def !== 'scv') army[e.def] = (army[e.def] ?? 0) + 1;
    const cc = w.list((e) => e.team === 0 && e.def === 'commandCenter');
    return {
      preset: this.presetName,
      scenario: this.scenario,
      rules: this.rules.id,
      clear: this.clear,
      enemyLeft: w.list((e) => e.team === 1).length,
      lostUnits: w.stats.lostUnits[0],
      lostValue: w.stats.lostValue[0],
      killedValue: w.stats.lostValue[1],
      gathered: w.stats.gathered.minerals + w.stats.gathered.gas,
      supplyBlocked: Math.round(w.stats.supplyBlocked),
      ccHoard: cc.reduce((s, c) => s + c.stock.minerals + c.stock.gas, 0),
      army,
      offenseAt: this.offenseAt,
    };
  }
}

export function runMatch(program: Program, scenario: ScenarioId, rules: Ruleset, limitSeconds: number, presetName = 'custom'): LabResult {
  const m = new LabMatch(program, scenario, rules, limitSeconds, presetName);
  while (!m.advance(10_000));
  return m.result();
}
