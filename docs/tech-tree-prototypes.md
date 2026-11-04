# Tech tree: prototypes and findings

Phases 1 and 2 of the tech tree, built as one codebase with two rulesets, four example
programs and five scenarios. Every combination is playable (New match, or the URL params
below) and every combination was played headless in the strategy lab. Raw numbers live in
`lab/results.json` and `lab/timing.json`; regenerate with `bun scripts/experiments.ts` and
`bun scripts/timing.ts`.

## What was built

**Tree.** Command Center → Supply Depot → Barracks → Factory → Starport, Refinery on a
geyser for gas, Tech Lab and Reactor add-ons built by a production building out of its own
stockpile. Units: SCV, Marine, Marauder, Medic, Hellion, Siege Tank, Viking, Medivac,
Banshee. Starcraft-style armor, attributes (light / armored / biological / mechanical),
bonus damage, splash, slow, siege mode, stim, healing. Supply: CC 15, Depot 8, cap 200.

**Enemies that fight back** (my call on the open question): Bunkers, Missile Turrets,
sieged tanks, bio squads, Zergling and Baneling packs, Banshees and Vikings. Defenders hold
a leash around their post, so they punish an attack but do not march on your base.

**Rulesets** (the prototype axis):

| | Classic | Streamlined |
|---|---|---|
| Supply | Hard cap: training stops at the cap | Soft cap: over-cap units train 3× slower |
| Add-ons | Attached beside the building, need free ground | In place, no footprint |
| Siege / stim | Only when a rule (or you) says so | Units do it by themselves |

**Scenarios:** Target range (inert), Outpost (bunkers, turret, sieged tank, bio), Swarm
(Zerglings + Banelings), Armor line (sieged tanks and Marauders behind bunkers), Air wing
(Banshees and Vikings over turrets).

**Example programs:** Starter (a bit of everything), Bio (Marines, Marauders, Medics,
stim), Mech (Siege Tanks, Hellions), Air (Banshees, Vikings).

**Strategy lab** (in game: Lab button; headless: `scripts/`): plays a program against every
scenario under both rulesets, deterministically, and reports clear time and losses.

## Results (8-minute limit)

| Program / rules | Range | Outpost | Swarm | Armor | Air |
|---|---|---|---|---|---|
| Starter / Classic | 3:38 | 3:48 (12) | 3:43 (2) | — (72) | 3:42 (4) |
| Bio / Classic | 2:33 | 2:48 (25) | 2:36 (2) | — (168) | 2:36 (2) |
| Mech / Classic | 2:59 | 3:18 (10) | 3:22 (8) | 3:53 (23) | 4:25 (31) |
| Air / Classic | 3:56 | 4:20 (13) | 4:10 (2) | 4:08 (6) | 4:05 (10) |
| Starter / Streamlined | 3:55 | 4:08 (16) | 3:58 (1) | 6:09 (44) | 3:57 (2) |
| Bio / Streamlined | 2:41 | 2:51 (22) | 2:44 (3) | — (173) | 2:43 (2) |
| Mech / Streamlined | 3:00 | 3:25 (11) | 3:25 (7) | 3:29 (15) | 3:50 (16) |
| Air / Streamlined | 3:46 | 4:45 (20) | 4:01 (2) | 4:00 (7) | 4:09 (11) |

Clear time, units lost in brackets; "—" = targets still standing at 8:00.

## Observations

1. **The compositions behave like Starcraft without any special-casing.** Bio is fastest
   everywhere except the Armor line, where sieged tanks splash it to pieces (168 lost).
   Mech is the generalist. Air is slowest to start but takes the Armor line with 6 losses,
   because tanks cannot shoot up. Bio beats Swarm because Marines shoot Banelings before
   they connect. Counters fall out of armor, attributes and splash.
2. **Classic punishes a forgotten supply rule completely.** Delete the depot rule and every
   program sits supply-blocked for ~6 of 8 minutes and clears nothing. Under Streamlined
   the same program still wins, just 40–60 s slower (Mech Armor 3:29 → 5:29).
3. **Classic rewards ability rules; Streamlined makes them redundant.** Without siege rules
   Classic Mech goes from 3:18 to 4:10 on Outpost and fails the Armor line. Under
   Streamlined the same omission costs 4–9 s.
4. **Streamlined is not strictly easier.** Auto-stim and in-place add-ons barely change
   Bio's result, and Classic Mech is faster on Outpost (3:18 vs 3:25). Auto-siege makes
   tanks deploy at the first target in range, which helps on the Armor line (3:29) and
   hurts on Air (more stop-start).
5. **Starter on the Armor line is chaotic.** It fails under Classic and wins under
   Streamlined, and flipping either add-on placement or auto-abilities alone flips the
   result. Mixed armies sit near a tipping point there, which is good for a puzzle and bad
   for a teaching scenario.
6. **Logistics has a sweet spot, and it differs by army.** Haulers per resource (minerals +
   gas): Starter 6+4 clears Outpost in 3:48; 3+2 takes 5:42 and 10+6 takes 5:37. Bio does
   best with 3+2 (2:27 vs 2:48). Delivering crates straight to production is slower for
   everyone except Bio, because trips get longer. A hoard building up at the CC is the
   tell that you have too few production buildings, not too few haulers.
7. **When to attack is the biggest single lever.** Bio on Outpost: attacking at army 4 takes
   5:46 and loses 150 units; waiting for 30 takes 2:48 and loses 25. Mech is the opposite:
   attack at 4 → 3:14, at 40 → 5:08, because tanks trade efficiently in small groups.
   Presets now use the best values (Bio 30, Mech 8).

## Recommendation

- **Default to Classic.** Its failures are legible and every one of them is a rule the
  player can write: build depots, siege before engaging, wait for 30. That is the game.
- **Offer Streamlined as an assist mode** for first matches, or as a per-feature toggle
  (soft supply on its own is the most forgiving change and the cheapest to explain).
- **Keep the Armor line as the gate scenario.** It is the only one that separates the
  programs, and it is where siege rules visibly matter.
- **Next:** surface "supply blocked for N seconds" and "CC is hoarding" as warnings in the
  HUD, since they are the two most common silent failures in the lab.

## Play any prototype

`https://jonomf.github.io/auto-rts-vibes/?rules=classic&scenario=armor&program=mech`

- `rules`: `classic`, `streamlined`
- `scenario`: `range`, `outpost`, `swarm`, `armor`, `air`
- `program`: `starter`, `bio`, `mech`, `air`
- `hands=on`: allow direct control too (by default the program plays alone, hands-off)
