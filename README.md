# Auto-RTS

Starcraft, but very macro. You program your economy and army instead of micro-managing them.
This repo is the web-native port of the Unity prototype in `docs/rts`, with no engine and no runtime dependencies.

**Status: M2 + tech tree.** By default you have no direct control. Your SCVs stand idle until you write a rule like
*always → gather minerals → Command Center*. Pick a scenario (an enemy garrison that fights back) and clear it as fast
as your program can. The Terran tech tree is in: supply, Refineries, Tech Labs and Reactors, Marines through Banshees,
siege mode, stim, healing. See [`.plan`](.plan) and [`docs/tech-tree-prototypes.md`](docs/tech-tree-prototypes.md).

**Play it:** https://jonomf.github.io/auto-rts-vibes/ (built and deployed by GitHub Actions on every push to `main`).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests (Vitest)
npm run build      # typecheck + production build into dist/
```

## Programs

Press `P` for the editor. Every rule is a sentence of word-chips; click a word to change it.

- **Unit rules** (one list per unit type, plus a shared **Army** list for fighters): each unit follows the *first* rule
  whose conditions hold and whose action is possible. A higher rule interrupts a lower one.
  `max N` caps how many units may follow a rule (e.g. *max 3 → gather gas*).
- **Building rules**: when the queue is empty, the first rule that holds *and can be paid for from this building's stock* trains.
- **Build order** tab: one place for everything you build. Ordered steps (top to bottom, with a live status), then the
  whole tech tree with a **+ step** button and a standing **keep N** target per building and unit. A keep target is an
  ordinary rule (*count of X < N → train X* in X's building, or *→ build X* in Base), so it stays in sync with those tabs.
  Unit rows also show and change training priority within their building.
- **Base**: base-wide rules (posture switches, extra buildings) and the **layout**: building slots and a muster point placed on the map.
- Adding a rule or step pauses the game so you can set it up before units act on its defaults. Resume, or delete it.
- **Posture** (economy / defense / offense) is a base-wide variable rules can read and set.
- **Haul** moves a crate (50 minerals / 25 gas) between stockpiles. *Something needs X* means a blueprint's unpaid cost or a
  production building below its reserve (2× its priciest unit), net of loads already on the way.

Programs are plain JSON (`src/automation/types.ts`). **Load starter** gives a complete program that wins in about 2:00.
**JSON** copies or pastes one. The editor saves your program in the browser.

**Hands-on** mode (top bar) restores the M1 mouse controls. Your orders win until the unit finishes them, then the program takes over again.

## How it plays

- **Per-building stockpiles.** There is no global bank. Every building holds its own minerals and gas, and trains only from them.
- **Gathering.** In hands-on mode, right-click minerals or a Refinery with SCVs. They deliver to the nearest Command Center. Right-click another building to feed that building's stockpile instead.
- **Construction by delivery.** An SCV places a blueprint (`B`). The blueprint is paid for by resources hauled to it, and it grows from 25% scale to full size as it fills. Nothing is deducted up front.
- **Tech tree (Terran).** Command Center (SCV) · Supply Depot (+8 supply) · Refinery (gas) · Barracks (Marine; Marauder and Medic with a Tech Lab) · Factory (Hellion; Siege Tank with a Tech Lab) · Starport (Viking, Medivac; Banshee with a Tech Lab). Production buildings build their own Tech Lab / Reactor from their stockpile.
- **Combat.** Starcraft attributes (light, armored, bio, mech), armor, bonus damage, splash (Hellion, sieged tank, Baneling), Marauder slow, Stimpack, Medic/Medivac healing, siege mode (range 13, can't move).
- **Rulesets.** *Classic*: hard supply cap, add-ons need free ground beside their building, siege and stim only when a rule says so. *Streamlined*: soft cap (over-cap units train 3× slower), add-ons have no footprint, tanks siege and bio stims by themselves.
- **Scenarios.** Target range (inert), Outpost (bunkers, turret, sieged tank, bio), Swarm (Zerglings and Banelings), Armor line (sieged tanks, Marauders, bunkers), Air wing (Banshees, Vikings, turrets).
- **Combat.** Right-click to attack. `A` + click does attack-move. Idle units engage enemies in range.
- **Camera.** Trackpad: two-finger swipe pans, pinch zooms. Mouse: wheel zooms. Right- or middle-drag, `Alt`+drag and the arrow keys pan anywhere. If swipe detection guesses wrong, set it in the help sheet (`?`).
- **Time.** `Space` pauses. `−` and `+` set 0.25×–4×. The sim runs on a fixed 20 Hz tick, independent of frame rate.

Press `?` in game for all controls.

## Strategy lab

Every match is deterministic, so programs can be compared exactly. In the game: **Program → Test in lab**.
From the command line (with [Bun](https://bun.sh)):

```sh
bun scripts/lab.ts            # every example program × scenario × ruleset
bun scripts/experiments.ts    # the experiments behind docs/tech-tree-prototypes.md -> lab/results.json
bun scripts/timing.ts         # attack-timing sweep -> lab/timing.json
bun scripts/watch.ts mech armor classic   # timeline of one match
```

## Layout

```
src/
  sim/              pure TypeScript simulation, no DOM, deterministic
    defs.ts         entity catalog: costs, build times, weapons (Unity: prefabs + CreateEntity assets)
    types.ts        Entity, Order, Command
    world.ts        World: entity store, fixed-tick step(), issue(command), hash()
    commands.ts     the only way to change what entities do
    actions.ts      shared rules: placement, training checks, delivery, rally, damage
    systems/        production, units (orders, gathering, combat), separation
    scenario.ts     the sandbox map
  automation/       the program language (pure, runs inside the sim)
    types.ts        Program, Rule, Condition, Action, Step
    blocks.ts       block schema: words, fields, options; sentences; JSON validation
    interpreter.ts  4 Hz system: build order → base rules → buildings → units; issues Commands
    layout.ts       layout slots, site search, muster / enemy destinations
    presets.ts      the starter program
  game.ts           client state: selection, modes, camera, time controls
  render/           Canvas 2D renderer + camera
  input/            mouse/keyboard → selection + commands
  ui/               HUD (DOM): stockpiles, selection panel, command card, program editor
tests/              sim rules + automation (incl. "the starter program wins with zero player commands")
```

**Key design rule:** player input and automation both go through the same `World.issue(command)`.
"No direct unit control" is just the client refusing the mouse's commands (hands-off mode).

## Ported from Unity

| Unity | Here |
|---|---|
| `Entity` / `Unit` / `Building` MonoBehaviours | plain `Entity` records in `World` |
| `GameAction` ScriptableObjects | `defs.ts` + `ui/actions.ts` (command card) |
| Coroutines (`WaitForSeconds`, `WaitForMovedTo`) | tick-based `Order` state machines |
| `UnitSystem` | `systems/units.ts` |
| `InputController` → `Interaction` → `Selection` → `HUD` | `input/input.ts` → `game.ts` → `ui/hud.ts` |
| `PlacementIndicator` | `place` mode + ghost in the renderer |

**Gather-loop bug fix (Unity `c2e443b`):** `Entity.SetTarget(Entity)` never cleared `TargetPosition`, so after one right-click move a gatherer "arrived" at every later target instantly and looped forever.
Here each `Order` carries exactly one target. A regression test covers it.
