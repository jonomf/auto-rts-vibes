# Auto-RTS

Starcraft, but very macro. You program your economy and army instead of micro-managing them.
This repo is the web-native port of the Unity prototype in `docs/rts`, with no engine and no runtime dependencies.

**Status: M2, automation.** By default you have no direct control. Your gatherers stand idle until you write a rule like
*always → gather minerals → Home*. The goal is to clear the target field as fast as your program can. See [`.plan`](.plan).

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
- **Base**: a build order (steps run top to bottom with a live status), base-wide rules (posture switches, extra buildings),
  and the **layout**: building slots and a muster point placed on the map.
- **Posture** (economy / defense / offense) is a base-wide variable rules can read and set.
- **Haul** moves a crate (50 minerals / 25 gas) between stockpiles. *Something needs X* means a blueprint's unpaid cost or a
  production building below its reserve (2× its priciest unit), net of loads already on the way.

Programs are plain JSON (`src/automation/types.ts`). **Load starter** gives a complete program that wins in about 2:00.
**JSON** copies or pastes one. The editor saves your program in the browser.

**Hands-on** mode (top bar) restores the M1 mouse controls. Your orders win until the unit finishes them, then the program takes over again.

## How it plays

- **Per-building stockpiles.** There is no global bank. Every building holds its own minerals and gas, and trains only from them.
- **Gathering.** In hands-on mode, right-click minerals or gas with gatherers. They deliver to the nearest Home. Right-click another building to feed that building's stockpile instead.
- **Construction by delivery.** A gatherer places a blueprint (`B`). The blueprint is paid for by gatherers hauling resources to it, and it grows from 25% scale to full size as it fills. Nothing is deducted up front.
- **Tech.** Home → Infantry Training (Light/Heavy Infantry) → Mech Factory (Tank, needs gas) → Port (Ship, flying).
- **Combat.** Right-click to attack. `A` + click does attack-move. Idle units engage enemies in range.
- **Time.** `Space` pauses. `−` and `+` set 0.25×–4×. The sim runs on a fixed 20 Hz tick, independent of frame rate.

Press `?` in game for all controls.

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
