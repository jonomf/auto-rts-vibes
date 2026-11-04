import type { Game } from '../game';
import { SCENARIOS, type ScenarioId } from '../sim/scenario';
import { RULESETS, type Ruleset } from '../sim/ruleset';
import { PRESETS, type PresetId } from '../automation/presets';
import { DEFS, type DefId } from '../sim/defs';
import { LabMatch, type LabResult } from '../lab/run';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

type Who = 'mine' | PresetId | 'all';
type Job = { key: string; who: Exclude<Who, 'all'>; scenario: ScenarioId; rules: Ruleset['id'] };

/**
 * Strategy lab: runs a program headless against every scenario under both rulesets,
 * a slice per animation frame so the page stays responsive.
 */
export class LabPanel {
  private who: Who = 'mine';
  private minutes = 8;
  private jobs: Job[] = [];
  private results = new Map<string, LabResult>();
  private current: { job: Job; match: LabMatch } | null = null;
  private running = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly game: Game,
  ) {
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id === 'lab-who') this.who = t.value as Who;
      if (t.id === 'lab-min') this.minutes = Number(t.value);
      this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('open')) this.close();
    });
  }

  open(): void {
    this.el.classList.add('open');
    this.render();
  }

  private close(): void {
    this.el.classList.remove('open');
  }

  private programs(): Exclude<Who, 'all'>[] {
    return this.who === 'all' ? (Object.keys(PRESETS) as PresetId[]) : [this.who];
  }

  private start(): void {
    this.results.clear();
    this.jobs = [];
    for (const who of this.programs())
      for (const rules of Object.keys(RULESETS) as Ruleset['id'][])
        for (const scenario of Object.keys(SCENARIOS) as ScenarioId[]) this.jobs.push({ key: `${who}/${rules}/${scenario}`, who, scenario, rules });
    this.running = true;
    this.current = null;
    this.render();
    requestAnimationFrame(() => this.pump());
  }

  private pump(): void {
    if (!this.running) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 14) {
      if (!this.current) {
        const job = this.jobs.shift();
        if (!job) {
          this.running = false;
          this.render();
          return;
        }
        const program = job.who === 'mine' ? structuredClone(this.game.program) : PRESETS[job.who].make();
        this.current = { job, match: new LabMatch(program, job.scenario, RULESETS[job.rules], this.minutes * 60, job.who) };
      }
      if (this.current.match.advance(200)) {
        this.results.set(this.current.job.key, this.current.match.result());
        this.current = null;
        this.render();
      }
    }
    this.renderProgress();
    requestAnimationFrame(() => this.pump());
  }

  private renderProgress(): void {
    const bar = this.el.querySelector<HTMLElement>('[data-progress]');
    if (!bar) return;
    const total = this.results.size + this.jobs.length + (this.current ? 1 : 0);
    const done = this.results.size + (this.current?.match.progress ?? 0);
    bar.style.width = `${total ? (done / total) * 100 : 0}%`;
  }

  private render(): void {
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    const whoSel = [
      opt('mine', 'My program', this.who),
      ...Object.entries(PRESETS).map(([id, p]) => opt(id, `${p.name} (example)`, this.who)),
      opt('all', 'All four examples', this.who),
    ].join('');
    const minSel = [4, 6, 8, 10, 12].map((m) => opt(String(m), `${m} min`, String(this.minutes))).join('');
    const scens = Object.keys(SCENARIOS) as ScenarioId[];
    const rows: string[] = [];
    for (const who of this.programs())
      for (const rules of Object.keys(RULESETS) as Ruleset['id'][]) {
        const name = who === 'mine' ? 'My program' : PRESETS[who].name;
        const cells = scens.map((s) => this.cell(`${who}/${rules}/${s}`, who === 'mine', s, rules)).join('');
        rows.push(`<tr><th><b>${esc(name)}</b><small>${esc(RULESETS[rules].name)}</small></th>${cells}</tr>`);
      }
    this.el.innerHTML = `<div class="sheet lab">
      <div class="sheet-head"><h2>Strategy lab</h2><button data-close>✕</button></div>
      <p class="note">Plays whole matches headless (no input, just the program) against every scenario under both rulesets, and reports the clear time. Same program, same result, every time.</p>
      <div class="labbar">
        <label>Program <select id="lab-who">${whoSel}</select></label>
        <label>Time limit <select id="lab-min">${minSel}</select></label>
        <button class="go" data-run>${this.running ? 'Running…' : 'Run'}</button>
        <div class="prog-track"><i data-progress></i></div>
      </div>
      <div class="labtable"><table>
        <thead><tr><th></th>${scens.map((s) => `<th title="${esc(SCENARIOS[s].blurb)}">${esc(SCENARIOS[s].name)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table></div>
      <p class="note">Green: cleared. The number under it is units lost. “—” means targets were still standing at the time limit. ${this.who === 'mine' ? 'Click a cell to play that match yourself.' : ''}</p>
    </div>`;
    this.renderProgress();
  }

  private cell(key: string, playable: boolean, scenario: ScenarioId, rules: Ruleset['id']): string {
    const r = this.results.get(key);
    const live = this.current?.job.key === key;
    const attrs = playable ? ` data-play="${scenario}|${rules}" title="Play this match"` : '';
    if (!r) return `<td class="${live ? 'live' : 'wait'}"${attrs}>${live ? '…' : ''}</td>`;
    const army = Object.entries(r.army)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, n]) => `<span title="${esc(DEFS[d as DefId].name)}">${icon(d as DefId)}${n}</span>`)
      .join('');
    if (r.clear === null)
      return `<td class="fail"${attrs}><b>—</b><small>${r.enemyLeft} left · lost ${r.lostUnits}${r.supplyBlocked > 30 ? ` · supply-blocked ${r.supplyBlocked}s` : ''}</small><div class="army">${army}</div></td>`;
    return `<td class="ok"${attrs}><b>${clock(r.clear)}</b><small>lost ${r.lostUnits}</small><div class="army">${army}</div></td>`;
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t === this.el || t.closest('[data-close]')) return this.close();
    if (t.closest('[data-run]') && !this.running) return this.start();
    const play = t.closest<HTMLElement>('[data-play]');
    if (play) {
      const [scenario, rules] = play.dataset.play!.split('|') as [ScenarioId, Ruleset['id']];
      this.game.newMatchWith(scenario, rules);
      this.close();
    }
  }
}
