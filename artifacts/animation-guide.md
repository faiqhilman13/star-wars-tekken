# Saber Duel — Animation Authoring Guide

How to author a fighter's animation set. **`src/render/anim/kael.ts` is the reference implementation.**
Choreography (key poses, timing, film/anime references) is in `artifacts/animation-reference.md`.
§1 covers principles and §3 has a sheet per character.

## Files
- `src/render/anim/pose.ts`: the `Pose` channels; the doc comments are the source of truth.
- `src/render/anim/clip.ts`: `clip(base, keys, opts)`, the easings and lagged sampling.
- `src/render/anim/gait.ts`: walk ("shuffle") and run gaits with planted feet.
- `src/render/anim/shared.ts`: shared reactions (hit grid, blocks, falls, bounce, knockdown, lying, get-up, victims, land, clash). Use `sharedClips()` and override what is unique.
- `src/render/anim/types.ts`: the `AnimSet` contract and every `ClipName` you must provide.
- `src/render/anim/Animator.ts`: how each clip is selected and timed (read `select()`).
- `src/sim/roster.ts`: frame data per fighter (startup, active, total, hitboxes). **Your contact poses must match it.**
- `src/render/characters.ts` + `src/render/rig/costumes.ts`: looks and model (owned by the lead; report requested changes).

## Conventions
- Units: world units (fighter ≈ 1.85 tall), degrees, 60 fps frames.
- Upright frame: x = toward the opponent, y = up from the feet, z = toward the camera.
- **Positions are authored pre-roll.** `spin` (+ = backward, − = forward flip), `tilt` (cartwheel) and `spinY` (turn/corkscrew) rotate the whole body about the hip centre. So a flip is an upright tucked pose plus `spin` going 0 → −360.
- Blade direction: `pitch` 0 = forward, 90 = up, 180 = back, negative = down. `yaw` 0 = forward, 90 = toward the camera.
  - Write angles unwrapped (e.g. 160 → −30 through 90; spin 0 → −360) so lerps travel the intended way.
  - On contact frames keep blade yaw within ±25° so the blade reads full-length from the side camera.
- `twist` + = sword shoulder forward. `hipLean`/`spine`/`chest` − = fold forward. `head` is absolute (+ = look up).
- Feet: `fx/fy/fz` = front (near-side) foot forward / lift / depth. `fPitch` + = toes pointed. `fKnee` + = knee splays outward. `bx…` = back foot.
- `off`: 0 = off hand on the weapon, 1 = free at (`ox,oy,oz`). `palm` 1 = open hand (Force gestures).
- **Dual wield (ASHA):** the far hand always holds saber 2 at (`g2x,g2y,g2z`) with `pitch2/yaw2`, and `off` is ignored. Reverse grip = point the blade back along the forearm (pitch around 180–220 when the fist is forward). `blade2` = second blade extension.
- **Saberstaff (THANE):** `gx,gy,gz` = staff **centre**, and `pitch/yaw` = the staff axis (blade A along +axis, blade B along −axis).
  - `off` 0 = both hands on the staff, 0.15 either side of the centre; `off` 1 = one hand at the centre, off hand free.
  - `blade` and `blade2` are the two ends.
  - Spins are just big pitch sweeps (0 → 720).
- `blade`/`blade2` = 0…1 extension (ignition, KO fade, victory switch-off).

## Clip API
```ts
clip(base, [
  { f: 3, e: 'out', p: { gx: 0.04, pitch: 40 } }, // keys inherit from the previous key
  { f: 5, e: 'snap', p: { ... } },                // ease applies to the segment ENDING here
  { f: 16, e: 'io', reset: true },                // reset: start from `base` again
], { lagTorso: 0.6, lagHead: 1.2 });               // torso/head trail the hips (frames)
```
- Easings: `lin`, `in`, `out`, `io` (default), `snap` (strike: fast start), `expo`, `outBack` (overshoot settle), `inBack` (dips back first), `hold` (stay, then cut on the key frame).
- `clip(...).sample(t)` is what the game calls. `loop: true` for idles.

## How each clip is timed (see `Animator.select`)
| Clip | Time base |
|---|---|
| `intro` | round-intro frame 0…120 (FIGHT is called at 72). Ignite around f22–45, settle into stance by ~f70. |
| `idle` | looping, in frames (ambient time × 60). |
| `jumpUp/Fwd/Back/Run` | frames since takeoff. Airtime ≈ 2·jumpVy/0.0084 (ASHA ≈ 48 f, THANE ≈ 43 f). |
| `jumpSquat` | 4 f. |
| `land` | ~8 f. |
| `backdash` | authored over 18 f (warped to the fighter's backdash frames). |
| `runStop` | 9 f. |
| attacks (`light`, `heavy`, `crLight`, `sweep`) | the move's sim frames (`roster.ts`). **Contact pose = first active frame.** |
| `airLight/airHeavy` | frames since the attack started; ends on landing (author ~60 f, active early). |
| `throwStart` | the throw attempt (26 f, grab active f4–5). |
| `throwing` | 34 f; the victim is launched at f20. |
| `special` | its move frames. ASHA leap: arc f7–30 (sim lifts y), hits f22–30, total 44. THANE staff throw: staff leaves at f14; the clip **holds at f16** while the staff flies (the game hides the staff), then plays f17–34 after the catch. |
| `superCharge` | the 42 f screen freeze before a super. |
| `super` | the super's frames. |
| `parry` | active from f1 to the window end, then whiff recovery to the total. |
| `parrySuccess` | 14 f; the first ~6 f play during the 15 f parry freeze (deflection extreme). |
| `parried` | warped to the stagger length. |
| hits, `block`, `stagger` | warped to the stun. |
| falls | frames since launch. |
| `knockdown` | frames on the floor. |
| `getup` | warped to the get-up frames. |
| `victory` | frames; the last key holds. |

## The pose lab (your feedback loop)
The dev server runs on http://127.0.0.1:5188 (the lead keeps it up; do not start another on 5188).
```bash
export PLAYWRIGHT_BROWSERS_PATH="C:/Users/User/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Local/ms-playwright"
node scripts/pose-sheet.mjs --char asha --clips stance,light,heavy --opp 1.8 --extra "step=1&cols=9&w=220&h=260"
```
- Sheets are written to `artifacts/pose-sheets/<char>-<clip>.png`. **Look at every sheet with the Read tool.**
  - The coloured bar on each cell shows the phase: amber = startup, red = active, blue = recovery.
  - The move's live hitbox is drawn in red.
- Extra params:
  - `oppChar=kael`.
  - `zoom=6`: camera distance.
  - `camY=1.2`.
  - `y=1.2`: force the height.
  - `from=` / `to=` / `step=`.
  - `hit=0`: hide hitboxes.
- Gaits render as `walk`, `walkBack` and `run`; static poses as `stance`, `guard`, `crouch` and `crouchGuard`.
- Run Playwright **outside the tool sandbox**, with the env var above.

## Quality bar (the user asked us to *nail* body animation)
- Strong, readable silhouettes: every contact frame must read as a black shape at gameplay zoom.
- Anticipation opposite the strike. Blade arcs are monotonic within a strike. Follow-through overshoots, then settles. Recovery: blade first, feet last.
- Successive breaking of joints: hips lead, torso and arm follow, the blade whips.
- Weight: the front foot plants on the frame before contact; the rear heel lifts in follow-through; knees absorb landings.
- Each fighter's rhythm must differ (see §3 of the reference).
- Never leave the blade passing through the fighter's own head/torso on key frames. Keep it out of the opponent's body on recovery.
- Iterate: render → look → fix. At least two improvement passes on every attack, special, super, jump, parry, get-up, intro and victory.
