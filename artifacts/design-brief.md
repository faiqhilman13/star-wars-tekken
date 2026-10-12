# Saber Duel — Design Brief, Core Loop, Stage Plan

## Design brief

- **Player promise:** two laser-sword duelists settle it one-on-one, Street Fighter style — footsies, reads, punishes, and a clash of blades when both commit at once.
- **Target feeling:** tense spacing broken by sharp, heavy saber hits; every exchange is readable, every hit sizzles.
- **Primary verb:** slash (light / heavy / low / air).
- **Secondary verbs:** walk and dash in/out, jump, crouch, block (hold back), throw (light + heavy up close), Force Push (projectile, costs one meter bar), Saber Storm super (down + Force at full meter).
- **Repeated every 5–30 s:** approach → poke at max range → block or whiff → punish / get punished → reset to neutral.
- **Across 1–5 min:** rounds (99 s timer, best of 3), Force meter builds from attacking and taking damage so Force Push and the super come online later in a round; the CPU adapts spacing and anti-airs.
- **Lose / learn / restart:** health to zero = K.O.; round intro is under 2 s; a match restart from the results screen is one key.
- **Rewarded:** correct blocks (high vs low vs overhead), whiff punishes, anti-airs, saber clashes won by recovering first, meter management.
- **Risk:** heavy and sweep have long recovery (whiff-punishable); jumping is beaten by heavy anti-air; blocking loses to throws and takes chip damage.
- **A better player:** spaces at the edge of the opponent's reach, blocks low/high correctly, punishes whiffs with heavy, throws turtlers, and saves meter for punishable moments.
- **Next decision communication:** clear anticipation poses (wind-up) before every attack, saber trails while active, block sparks vs hit sparks, meter bars, and the HUD combo counter.
- **Non-goals:** 3D sidestep or depth movement (movement is locked to the x/y fight plane), online play, character roster beyond the two duelists, story mode.

## Core loop contract

Player **slashes** to **drain the opponent's health** while **the opponent's reach, blocks and punishes** create risk; success gives **damage, meter and round wins**, failure costs **health and position (pushed toward the wall)** and invites another exchange.

Proof points in code:
- Verb → real input: J/K/L (P1), , . / or numpad 1/2/3 (P2), gamepad face buttons, or touch buttons drive move starts in `Match`.
- Objective visible: health bars, timer, and round pips in the HUD.
- Pressure in first minute: CPU walks in and attacks within seconds of FIGHT.
- Reward changes state: health/meter/round counts in `Match`; meter unlocks Force Push and the super.
- Failure teaches: hit sparks + hit pose + K.O. slow-motion; blocked lows/overheads show which guard was needed.
- Fast restart: round intro ~1.8 s; rematch from results without reloading.

## Stage / encounter plan

- **Spatial format:** 2.5D side view. Fight plane z = 0, x ∈ [-8.5, 8.5], floor y = 0. Max fighter separation 7 units (camera-limited, like SF).
- **Camera:** perspective, tracks the fighters' midpoint, dollies out as they separate, clamped to the stage; never shows past the stage walls. It sees both fighters, the floor, and the reactor backdrop; it never cuts away mid-exchange.
- **Start:** fighters at x = ±2.6 facing each other; first decision is whether to walk in to poke range (~1.6 units) or hold distance and fish for a Force Push later.
- **Landmarks:** central reactor core glow behind the bridge, bulkhead pylons marking the stage walls, hazard-striped edge plates warning of the corner.
- **Escalation:** within a round, meter rises → Force Push/super threats; across rounds, the CPU gets more aggressive when behind; time-out pressure at < 15 s (timer pulses).
- **Recovery beats:** knockdown + invulnerable get-up, round transitions, clash resets to neutral spacing.
- **Telegraphs:** wind-up frames per move, saber glow brightens on startup, Force Push charge glow on the hand, super flash freezes the screen.
- **Modularity:** move frame data in `src/sim/moves.ts`; poses per move in `src/render/poses.ts`; AI difficulty in `src/sim/Ai.ts`.

## Art direction

"Reactor Gantry": a steel catwalk bridge across a vast reactor chamber. Cool steel-blue metal with warm orange glow rising from the reactor below; haze and drifting embers. The duelists read as silhouettes against it: KAEL (sand/brown robes, blue saber) vs VEXA (black armored robes with crimson trim, red saber). Sabers are the brightest things on screen (bloom on blades only).
