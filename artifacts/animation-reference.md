# Saber Duel — Animation Reference (key poses, timing, sources)

Purpose: turn film / anime / fighting-game references into poses we can author directly in `src/render/poses.ts`.
Every number is a starting value to tune by eye in the side camera, not a law.

---

## 0. Notation (matches `Pose` in `src/render/poses.ts`)

- Units: metres, degrees, frames at 60 fps (`f7` = frame 7 of the state). Standing `hipY` 0.85, crouch 0.60, head top ~1.75.
- `rootX` + = toward opponent. `spin` = whole-body roll, + = falling backward, − = forward flip.
- `hipLean` / `spine` / `chest`: − = folding **forward**, + = arching **back** (as in `HIT_STAND` = +14/+10/+12).
- `twist` + = sword shoulder forward. `head` + = look up.
- Proposed extra fields (from the brief): `hipYaw` (+ = sword-side hip forward), `hipRoll` (+ = sword-side hip up), `side` (chest side-bend, + = top leans toward camera), `headYaw` (+ = look toward camera), `fz/bz` foot z, `knee` (out/in), `toe` (+ = toes up).
- Grip `g(gx,gy,gz)`; blade `P/Y` = pitch/yaw (pitch 0 fwd, 90 up, 180 back, − down; yaw 0 fwd, 90 toward camera). Write pitch **unwrapped** (200, not −160) so the per-field lerp travels the intended way round.
- Off hand `o(ox,oy,oz)`, `off` 0 = on hilt, 1 = free. For a 2nd blade or staff end add `P2/Y2`.
- Feet `f(x, lift)` / `b(x, lift)`. Δ = relative to that character's STANCE.
- Ease names follow the code (`lin/in/out/io`). We also recommend adding a `hold` (stepped) ease, see 1.1.

---

## 1. Fighting-game animation principles (with numbers)

### 1.1 Key-pose driven, "limited" animation
- Guilty Gear Xrd (Arc System Works, GDC 2015, Junya Motomura) runs at 60 fps but animates 3D models **without in-betweens**: every displayed frame is a hand-placed key, held for several game frames like stop-motion or anime "limited animation". Full interpolation was tried first and rejected because it "looked too 3D". Rigs were ~500 bones, and the meshes were deformed per key to cheat silhouette. (https://gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The , https://videohighlight.com/v/yhGjCzxJV3E , https://en.wikipedia.org/wiki/Blocking_(animation))
- For us (IK + lerped keys) the hybrid is: **Ease strongly into extremes and hold them.** Anticipation extreme, contact pose and follow-through extreme each get a 2–4 f "moving hold" (≤3° drift). Without the drift a pose looks dead. · Use `lin`/`out` only on the 1–2 strike frames between them. · Add a `hold` ease (step to the next key at the end of the segment) for supers and intros. That gives the GG "snap" look.
- Lab Zero (Skullgirls, Mariel Cartwright, GDC 2014): Even **one frame of anticipation** makes a move much more readable. · When frames are scarce, pick the important moments and push them. · Use smears to fill large gaps. A good smear shows start pose, motion and end state. · Hold one **overshoot** frame, then pull back. · "Break" a limb or two for power; players won't notice. · (https://gdcvault.com/play/1020575/Animation-Bootcamp-Fluid-and-Powerful , https://80.lv/articles/tips-on-making-fluid-and-powerful-animations)
- Overgrowth (David Rosen, GDC 2014) builds fluid interactive motion from very few keys, plus procedural layers (breathing, foot IK, look-at). This is exactly our pose + IK model. (https://gamedeveloper.com/design/video-an-indie-approach-to-procedural-animation)

### 1.2 Frame budget per phase (startup / active / recovery)
Rule of thumb from action games:
- ~6–7 f anticipation, ~10 f swing with ~5 active, then follow-through and recovery.
- Player moves must visibly react in 1–2 f. Put the "character" frames into follow-through rather than a long wind-up.
(https://aztez.com/?p=1365 , https://bugnet.io/blog/animation-basics-that-make-your-game-feel-alive)

| Phase | Light 4/3/9 | Heavy 10/4/18 | Sweep 9/4/23 | What the pose does |
|---|---|---|---|---|
| Anticipation extreme | f2 | f6–9 (held) | f6–7 | Opposite direction to the strike: blade cocked, hips coiled, weight on the back foot |
| Smear / acceleration | f3 | f10 | f8 | 1 f in-between, limbs stretched, blade mid-arc (may be foreshortened) |
| **Contact pose** = 1st active | f4 | f11 | f10 | Most readable frame. Hitstop freezes it: blade fully extended in the x–y plane, limbs spread |
| Active continuation | f5–6 | f12–14 | f11–13 | Blade keeps travelling 15–30° with `out` ease |
| Follow-through extreme + overshoot | f7–9 | f15–20 | f14–22 | Blade past target, torso folded, rear heel up, cloth still travelling |
| Settle | f10–16 | f21–32 | f23–36 | Blade returns first, then torso, then feet (reverse breaking of joints) |

Proportions:
- Anticipation ≈ 60–75% of startup.
- Strike ≈ 1–2 f.
- Follow-through ≈ 35% of recovery; settle ≈ 65%.

### 1.3 Hitstop (impact freeze) and shake
Reference values:
- **Guilty Gear Strive.** Hitstop by attack level 0–4 = **11/12/13/14/15 f**. Standing hitstun = 12/14/16/19/21. Counter hits: Mid 21 f hitstop + 25 f slowdown; Large 31 f + 35 f slowdown. (https://www.dustloop.com/w/GGST/Mechanics)
- **SF2.** Hitstop was "~10 f" for both players, and cancels happen on the frame hitstop ends. (https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/)
- **Smash Ultimate.** Hitlag = (dmg×0.65+6)×multipliers, so 15% damage gives 15 f. Cap is 30 f; electric ×1.5. (https://www.ssbwiki.com/Hitlag)

Sakurai's rules (Famitsu column):
- Attacker and victim freeze for the **same** time.
- More damage gives longer hitstop. Per-move modifiers apply (tip of Marth's sword longer), and projectiles get less.
- There is a hard cap.
- Victim **vibrates side-to-side on the ground and up-down in the air**. The amplitude starts large and decays linearly over the freeze, and is bigger when the camera is far.
- Victim shows the first flinch frame, then moves into the "painful" pose **over ~4 frames during the freeze**.
- Attacker creeps forward very slightly.
(https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/)

Our targets:

| Move | Light | crLight | Air | Heavy | Sweep | Special | Super hits / last | Counter | Parry | Clash |
|---|---|---|---|---|---|---|---|---|---|---|
| Hitstop (f) | 9 | 9 | 10 | 13 | 11 | 14 | 6 / 24 | +6 (heavy +10) | 15 (already) | 14 (already) |

- Blocked hits: hit value − 3.
- Shake: victim x ±0.03 m (alternate each frame, decay to 0). Air: y instead of x.
- Attacker: no shake, creep 0.005 m/f.
- Electric (Force Lightning): hitstop ×1.5 and a 2-frame shake period.

### 1.4 Arcs, smears, blade readability
- The blade tip must trace one clean arc. Keep pitch monotonic within a strike, and never reverse direction mid-active.
- Smear = 1–2 f "elongated in-between" along the path. (https://en.wikipedia.org/wiki/Smear_frame) · For sabers this is the trail (`SaberTrail.ts`): lengthen it on the smear frame and on contact. · Optionally stretch the blade glow by 15% along the motion.
- **Side-view rule:** on contact and active frames keep blade yaw within ±25° so the full blade length reads. Yaw ≈ 90 (pointing at the camera) foreshortens the blade to a dot. Only use it on smear frames, where it reads as "turning over".
- **Cheat to camera:** sword hand gz +0.12–0.20 during actives, off hand −z. The blade should never pass behind the torso on a hit frame (GG Xrd deforms poses per frame for the camera for the same reason).

### 1.5 Silhouette clarity
- Exaggerate past real motion. Mocap without exaggeration looks floaty. Poses are "billboards". (https://pixune.com/blog/role-of-exaggerated-animation-in-fighting-games/)
- Each character needs one **signature shape** that reads in solid black: Kael: high blade plus pointing hand. · Vexa: blade over the head plus cape triangle. · Asha: low wide crouch with two back-swept blades. · Thane: diagonal staff across a vertical body.
- Keep negative space between arms and torso on actives. Avoid both arms overlapping the torso in the x–y plane.
- Sakurai: the damaged pose must look **clearly different from the standby pose** and read from far away, and a bigger hit must look bigger. (https://gonintendo.com/contents/25030-masahiro-sakurai-latest-video-talks-about-damage-animation)

### 1.6 Successive breaking of joints (the whip)
Motion starts at the root and travels out the chain: hips → chest → shoulder → elbow → wrist → blade. Each link lags, overshoots and catches up.
(https://brianlemay.com/Pages/animationschool/animation/1stsemesteranimation/successivebreaking.html , https://courses.cs.washington.edu/courses/cse459/12au/assignments/assignment_5/successive_breaking_of_joints.html)

Implementation: offset the keys per field group.
- `rootX/hipLean/hipYaw` reach the strike value at contact −2 f.
- `twist/chest` at contact −1 f.
- `g` at contact.
- `pitch` at contact (+1 f overshoot).
- Recovery runs in reverse: the blade settles first and the hips last.

### 1.7 Weight, feet, landing
- The front foot steps **before** contact: it lands at contact −1 f. The back heel lifts on follow-through (`by` 0.03–0.05, `toe` +25).
- Feet never slide while planted. Pushback moves `rootX` with the feet locked; let them drag only on heavy hits.
- Jump squat: we use 4 f (`JUMP_SQUAT`). Smash ranges 3–8 f per character. (https://www.ssbwiki.com/Jump)
- Landing: SF6 empty-jump landing is 3 f (`LANDING_FRAMES`). (https://wiki.supercombo.gg/w/Street_Fighter_6/Movement) · f0: `hipY` −0.12, `hipLean` −10, blade dips −15°, arms follow 1 f later. · f1–3: return with `out` ease, overshooting to `hipY` +0.01. · Heavy landings (after an air attack) add 3–5 f with a deeper squash (−0.18).

### 1.8 Overlapping action (cloth, hair, cape)
- Secondary chains lag 2–4 f behind the body and overshoot 15–30%. Use springs: stiffness ~0.12–0.2/f, damping ~0.75.
- Cape and robe lag a further +2 f.
- On hitstop, freeze the springs with the body, then release them with an extra impulse. That "whip after freeze" is what sells impact.

### 1.9 Hit reactions by height × strength
Smash taxonomy: ground flinches are **high / centre / low × weak / medium / strong = 9 animations**. High hits rear the head back; low hits buckle to a kneel. Thresholds:
- Medium ≥ 15 f hitstun.
- Strong ≥ 21 f.
- Tumble ≥ 32 f.
(https://www.ssbwiki.com/Flinch)

Capcom: pushback grows with attack strength.
(https://game.capcom.com/cfn/sfv/column/131545?lang=ja)

Shared base, as Δ from GUARD. Peak at f2–4 (inside hitstop), then recover with `in` ease over the hitstun:

| Reaction | Peak pose | Pushback |
|---|---|---|
| **High light** (head snap) | head +25, headYaw −10, chest +8, hipLean +6. Blade lifts +25°. Off hand flinches up to `o(0.12,1.5)` | −0.06 |
| **High heavy** | head +40, chest +20, spine +12, hipLean +14, hipY −0.03. Front heel up (`fy` 0.05, toe +20), back foot steps −0.15. Blade thrown to P150. Off hand flung back `o(−0.4,1.4)` | −0.18 |
| **Body light** (gut fold, "C" curve) | chest −18, spine −10, **hipLean +8** (hips pushed back as torso folds), head −10, hipY −0.05. Off hand to belly `o(0.12,1.0,0.1)`. Blade dips to P20 | −0.08 |
| **Body heavy** | chest −30, spine −16, hipLean +18, hipY −0.12. Both feet drag (toe +15). Blade drops to −30. Head whips up 2 f before recovery ends | −0.25 |
| **Low light** (leg buckle) | Front foot kicked back (fx −0.10, fy 0.08), hipRoll +6 toward the hit leg, hipY −0.06. Torso counter-leans −10. Off arm out for balance `o(−0.3,1.2,−0.2)` | −0.05 |
| **Low heavy** | Front knee drops toward the floor (hipY 0.58, back knee nearly down). Torso −18. Blade plants low P−60 like a crutch | −0.12 |
| **Crouch hit** | Whole crouch compresses hipY −0.06. Head +20 (top hit) or chest −15 (mid). hipRoll ±5 | −0.10 |
| **Spin-out / stagger** (heavy, counter, parried) | Over 10 f: twist −50, hipYaw −40, headYaw away, off arm flung wide. Then 2 stumbling steps back (b −0.2 every 8 f), 30–40 f total. VF "stagger: a few small steps back" | — |

(VF definitions: https://virtuafighter.com/wiki/hit-effects/)

### 1.10 Launch, blowback, ground bounce, slide
Virtua Fighter's knockdown vocabulary (copy these silhouettes):
- **Blast Back:** skids on the back, legs flopping over the head.
- **Spinning Knockdown:** spins through the air, lands face up.
- **Head-over-heels:** rolls end over end.
- **Bound:** driven into the ground, bounces back up.
- **Slam:** legs fold over the head and come back down.
(https://virtuafighter.com/wiki/hit-effects/)

GGST adds launch "float" vs "blowback", **spinning blowback** (fully charged Dust) and rolling tumble.
(https://www.dustloop.com/w/GGST/Damage)

Our shared **blowback arc** (launch 30–45° back, 30–40 f airborne):
- **f0 impact:** the high-heavy pose. hipLean +20, head +35.
- **f2–12 rise:** spin 20→55. Legs swing forward and up (`fx` 0.4, `fy` 0.25) as the torso goes back. Arms flung overhead `g(0.0,1.8)`, blade trailing P170–190. This is the "starfish" silhouette.
- **Apex:** spin ~70. Limbs at maximum spread.
- **Descent:** spin 85–100, so the **back lands first**. Legs lag 2 f.
- A wall nearby makes a **wall splat**: flat against the wall, limbs spread. GGST holds it 59 f before an automatic recovery (see §4).
- Juggle hits during the arc restart a smaller flinch (DamageAir) and add +15 spin.

**Ground impact, bounce and slide** (total 30–40 f, then the lying loop):
- **c0 contact:** spin 90, hipY 0.15. Squash: chest +6, legs flop up 2 f later (VF "legs flop over head"). Dust ring. Camera kick 0.02 m.
- **c1–8 bounce:** hipY +0.22 peak (sin curve), spin 90→72. Limbs lag 2 f. Blade skitters (P−80, Y30).
- **c9–12:** second contact with a small bounce of 0.05.
- **c12–30 slide:** `rootX` keeps moving backward with friction (×0.85/f). Heels drag; one arm trails above the head.
- **Rule:** the bigger the hit, the higher the first bounce and the longer the slide. A light knockdown skips the bounce.

### 1.11 Knockdown and wake-up
- GGST soft knockdown = backward roll, 30 f, invulnerable. Hard knockdown = lie, then rise, 55 f. (https://www.dustloop.com/w/GGST/Mechanics)
- Get-up structure, as a fraction of `GETUP_FRAMES`: 0–35%: roll or tuck. The silhouette changes most here. · 35–70%: kneel or crouch beat. Blade comes back to guard here. · 70–100%: rise into STANCE with overshoot.
- Give each character a different get-up (see the sheets in §3) so wake-ups are recognisable.
- Stagger before the fall: KI, MKXL and DOA play a stagger beat before a fighter goes down, which adds weight. Use it for heavy, non-launching hits. (https://www.ufe3d.com/forum/viewtopic.php?id=972)

### 1.12 KO
- Sakurai zooms and slows the action on the finishing blow to build tension. (https://gonintendo.com/contents/25030-masahiro-sakurai-latest-video-talks-about-damage-animation)
- Ours: final-hit hitstop 24 f. Then time scale 0.3 for 40 f and a camera push-in. Return to 1.0 on the first ground contact.
- Final blowback gets +30% height and +40 spin. The blade fades on floor contact (`blade` 1→0 over 14 f — already in code).
- If the final hit was light, use the **crumple KO** instead of blowback: Knees buckle, then kneel (hipY 0.48) at f12. Head lolls −30. · f30: tip forward or sideways onto the floor.

### 1.13 Turnaround, idle
- **Turnaround** (6 f): f0–2 hips pivot on the front foot (hipYaw 0→90). f3 the chest faces the camera and the blade passes **over the head** (P90) so it never crosses the body. f4–6 the mirror completes.
- **Idle breathing:** inhale is 40% of the cycle, exhale 60%. Chest +1.5 and gy +0.012 on the inhale. The code uses 2.3 rad/s (≈2.7 s). · Per character: Kael 3.2 s, Vexa 4.0 s (respirator-like held inhale), Asha 1.0 s bounce, Thane 3.5 s.

### 1.14 Run and walk timing
- Animation rule of thumb: realistic adult run ≈ 12–14 frames per step at 24 fps, fast cartoony run 6–8. (https://www.awn.com/comment/1008092)
- Real sprint ≈ 0.2–0.4 s per step. (https://cgcookie.com/community/21098-24-frames-for-a-walk-cycle)
- At 60 fps: sprint **11–14 f per step (22–28 f cycle)**, walk 20–40 f per step. Hip low point at contact +2 f. Add a flight phase only on runs.

---

## 2. Lightsaber forms reference

Lore sources (Wookieepedia mirrors, Ultrasabers) give philosophy more than geometry. The geometry below comes from the named scenes.

### 2.1 Form III Soresu (Kael defence)
- **Lore:** Tight, controlled motion with strict economy. · The blade is kept close to the body. · Stances present a minimal target. · Built for blaster deflection. · Wins by outlasting the opponent until they open up through fatigue or frustration. · (https://starwars.archivum.wiki/article/Form_III , https://ultrasabers.com/?p=1259954)
- **Stance** (the Obi-Wan "two-finger" pose): sword hand high near the head, blade angled forward and down at the opponent, off hand extended with two fingers or the palm pointing. Body bladed, side-on. (https://legacy.tfff.org/?p=30794 , https://frontlinegaming.org/?p=114104) · Pose: `g(0.08,1.62,0.14)` P−25 Y8. `o(0.42,1.34,−0.06)`. twist −8. hipY 0.80. Front foot points at the opponent; back foot turned out 70–90° (knee out). Weight 60% back.
- **Motion:** Small wrist-driven circles. The tip moves more than the hand. · Parries rotate the blade around the body's outline. · Feet shuffle (front first, back follows) and never cross.
- **Scenes:** ROTS: Utapau "Hello there", Obi-Wan facing Grievous's guards. Mustafar opening on the landing platform. · Obi-Wan Kenobi Part VI rematch. · Rebels S3 "Twin Suns": stance switch, block, two cuts, over. · Rebels "Rise of the Old Masters": Kanan vs the Grand Inquisitor.

### 2.2 Form V Djem So / Shien (Kael counters, Vexa power, Asha's reverse grip)
- **Djem So:** Firm blocks, then powerful ripostes. Minimal footwork beyond pressing the opponent. · Opening stance holds the saber **above the head, angled back and down ~45°**. · Signature "Falling Avalanche": an overhand power blow. · Strikes are overhead and diagonal, two-handed, with power from the upper body. · (https://starwars.archivum.wiki/article/Form_V , https://ultrasabers.com/holocron/a-deeper-look-lightsaber-combat-forms-form-v-shien-djem-so , https://www.worldanvil.com/w/atrox-ultrix-ehoc/a/form-v---shien-2F-djem-so-article) · Pose: `g(0.10,1.72)` both hands, P190–225 (behind and down), chest +6. Wide rooted feet.
- **Shien:** Deflect, then counter-offensive. · **Reverse grip** (thumb toward the pommel) favoured by Ahsoka, described as giving more leverage. It was considered outdated by the Clone Wars. · Open, angled posture; mostly stationary. · (https://starwars.archivum.wiki/article/Form_V , https://fictionhorizon.com/star-wars-what-lightsaber-combat-form-does-ahsoka-use)
- **Scenes:** ESB Bespin: Vader's heavy downward strikes on Luke, then the hand cut. · ROTJ throne room: Luke's rage. Repeated hammering overheads drive Vader down onto the stairs. · ROTS opening: Anakin vs Dooku, ending in the scissor cut with two blades. · Rebels "Twilight of the Apprentice": Ahsoka vs Vader on Malachor.

### 2.3 Form VII Juyo / Vaapad (Vexa aggression)
- **Lore:** "Most volatile and forceful" form. Constant offence fed by emotion. · Staccato swings that seem unlinked. · Erratic angles, sudden bursts, then moments of perfect stillness while waiting for an opening. · (https://starwars.archivum.wiki/article/Form_VII , https://ultrasabers.com/holocron/a-deeper-look-at-lightsaber-combat-forms-form-vii-vapaad-juyo)
- **Animate it as burst / freeze:** 2–3 fast strikes at irregular angles. · A 6–10 f dead-still hold with tremble. · Then the next burst.
- **Kylo Ren** (unofficially read as Juyo-like). Abrams wanted fights "more primitive, aggressive and rougher" than the prequels. The style reads like a claymore: broad arcs, crushing blows, a bludgeon. (https://www.darkhorizons.com/?p=35169 , https://criterionforum.org/forum/viewtopic.php?p=530489)
- **Scenes:** TFA Starkiller forest: wild one-handed swats, a blade lock pushing Rey toward the cliff, Kylo beating his own wound. · ROTS: Windu vs Sidious, ending with the lightning reflected by Windu's blade. · TPM: Maul (Juyo per lore).

### 2.4 Jar'Kai and the reverse grip (Asha)
- Ahsoka keeps the reverse Shien grip with one blade or two. She later pairs a main saber with a shorter shoto. Jar'Kai = one blade guards while the other cuts. (https://dorksideoftheforce.com/2023/08/15/why-does-ahsoka-tano-have-two-white-lightsabers/ , https://www.themarysue.com/why-does-ahsoka-have-two-lightsabers-explained/)
- **Reverse-grip geometry:** The blade leaves the pinky side and runs back along the forearm, so its base pitch is ~180° from a forward grip. · Cuts come from forearm swings, hooks, back-fists and body rotation, with the blade trailing the fist. · Natural moves: backward stab past the ribs; "ice-pick" downward strike; forearm block (raise the forearm and the blade lies along it).
- **Scenes:** Clone Wars S7 "The Phantom Apprentice": Ahsoka vs Maul, with wall runs, flips and spins. · Rebels "Twilight of the Apprentice": Ahsoka slashes Vader's mask. · The Mandalorian S2 "Chapter 13: The Jedi": twin white sabers vs Elsbeth. · Star Wars: The Force Unleashed: Starkiller's reverse grip. · Clone Wars 2003 microseries: Ventress's twin curved sabers. · AOTC Geonosis: Anakin dual-wields against Dooku.

### 2.5 Form IV Ataru (Asha acrobatics)
- **Lore:** Offence through acrobatics and the Force. Abrupt spinning strikes, flips, airborne assaults. · Strikes from many angles, each flowing into the next. · Needs open space; weak in long fights. · (https://starwars.archivum.wiki/article/Form_IV , https://ultrasabers.com/holocron/a-deeper-look-lightsaber-combat-forms-form-iv-ataru/)
- **Scenes:** AOTC Geonosis: Yoda vs Dooku. Yoda bounces off the walls and spins like a top. · ROTS: Yoda vs Sidious. · TPM Tatooine: Qui-Gon vs Maul. · TPM Theed: Obi-Wan's Force-leap out of the pit, over Maul, landing behind and cutting. · (https://ultrasabers.com/?p=768245)
- **Animation:** tuck flips 14–20 f per rotation. Blades stay **tight** to the body during rotation and open only at the strike.

### 2.6 Saberstaff (Thane)
- **Maul:** Ray Park's wushu and kickboxing training shaped the style. He auditioned with cudgel and sword forms. · Nick Gillard choreographed the duel as an "amalgamation of all sword fighting". · Lucas over-cranked the camera (slowed it down) because the fighters were too fast. · Park's signature butterfly kick and staff flourishes. · (https://kungfukingdom.com/profile-of-ray-park/ , https://dorksideoftheforce.com/george-lucas-change-for-phantom-menace-scene , https://www.looper.com/57574/ray-park-becomes-darth-maul-again-at-star-wars-celebration)
- **Temple Guards:** yellow-bladed saber **pikes** (long shaft, short blades), masked and robed, formal and still. (https://www.archivum.wiki/article/double-bladed_lightsaber) · Scenes: Clone Wars S5 Ahsoka-trial arc; Rebels "Shroud of Darkness" (the Sentinel).
- **Inquisitors:** the ring hilt spins the blades for deflection and buzzsaw attacks, and can be thrown. (https://www.d20radio.com/main/inquisitor-lightsabers-unique-modifications/ , https://looper.com/1387306/ahsoka-continues-tradition-inquisitor-lightsaber-duel) · Scenes: Rebels S1 Grand Inquisitor; Obi-Wan Kenobi Part I (Inquisitors). · Also: Grievous's propeller-spinning sabers (ROTS Utapau); Rey's quarterstaff end-strikes on Jakku (TFA).
- **Staff rig:** Sword hand near the centre. The off hand rides 0.30 m back along the staff axis. · Blade B = blade A pitch + 180. · Spins in the x–y plane read as a full wheel; spins in x–z read as an ellipse. Use x–y for hits and x–z for flourishes and deflection.

### 2.7 Force techniques
- **Push:** ROTS Mustafar: mutual palm thrusts collide and both are thrown back. · ROTS: Yoda's push sends Palpatine over his desk.
- **Choke:** ANH: Motti, a finger-thumb pinch across the table. · ESB: Needa. · ROTS: Padmé. · Rogue One hallway: Vader pins a rebel to the ceiling while cutting. · ANH opening: Vader physically lifts Antilles by the throat, one-handed, and tosses him aside. · (https://www.theastromech.com/2023/12/the-force-and-strangulation-in-star.html)
- **Lightning:** ROTJ: Palpatine, both hands, hunched, advancing toward Luke. Luke writhes on the floor. · AOTC: Dooku, one hand; Yoda catches it in his palm. · ROTS: Windu's blade reflects it back.

---

## 3. Per-character choreography sheets

Shared rules:
- Reactions marked "shared ×k" use §1.9–1.11 with amplitude scaled by k.
- Every attack follows the §1.2 phase table.
- Key frames are given as `fA–B: pose`.

### 3.1 KAEL — compact Soresu guardian (blue, Obi-Wan)
**Rhythm:** precise, small, fast settle. The blade returns to the centre line 3 f before the feet do. Holds 2 f max. No wasted spin.

- **STANCE:** Soresu high guard (§2.1). Head −4 (chin down). Robe hem lag +3 f.
- **Idle:** 3.2 s breath. Fingers of the pointing hand drift ±0.01. Every ~6 s a 20 f "re-grip" (pitch −25→−15→−25).
- **Walk:** 28 f/step shuffle. Front foot slides first (fy 0.03 max), back follows. Blade and pointing hand stay fixed in space ("gun-sight"). hipY bob 0.01.
- **Run:** lean −28, blade trailing low behind (`g(−0.15,0.95,0.15)` P−10 Y175), off arm pumping. 24 f cycle. Stop: 9 f skid, lean +10, front toe +25, blade swings forward to stance at f6.
- **Backdash** (18 f): f0–5 low hop back (−0.10, by 0.25), blade snaps to the vertical block P90. f6–18 lands and returns.
- **Jumps:** Neutral: tuck at apex (fy/by 0.30), blade vertical beside the head. · Forward: 360° tuck flip, blade held **close** (`g(0.15,1.2)` relative to the hip), opening at 300°. · Back: arms throw up as anticipation in the squat, then a layout back-flip.
- **Landing:** generic §1.7; ends in stance with the pointing hand re-extending 1 f late.
- **Light 4/3/9:** f0–2: wrist cock, P−25→40, `g(0.04,1.66)`, twist −14. Off hand retracts to ox 0.30. · f3: smear. `g(0.45,1.42)` P−5, front foot +0.08. · f4: contact. `g(0.62,1.28,0.16)` P−20, twist +24, hipLean −10. Off hand pulls back to the chest `o(0.05,1.25)` (counter-rotation). · f5–9: continue to P−40 with a 1 f overshoot of gx +0.04. · f10–16: blade back to the high guard by f12, body by f16.
- **Heavy 10/4/18** (Djem So counter-cut): f0–6: two hands (`off` 0). `g(0.0,1.80,0.10)` P170, twist −18, chest +10. Front heel up (`fy` 0.03, toe +15), rootX −0.04. · f7–9: hold, P170→176. · f10: smear. Front foot lands at fx 0.58. `g(0.40,1.65)` P80. · f11: contact. rootX +0.16, `g(0.66,1.20)` P−30, twist +34, chest −14, hipLean −16, head −10. · f12–14: to P−50. · f15–20: `g(0.58,0.90)` P−60, rear heel up (by 0.04, toe +30). · f21–32: back foot draws in, blade rises low-to-high to the guard.
- **Crouch light:** f0–2: `g(0.20,0.82)` P10 Y30. · f3: smear. · f4: `g(0.62,0.62,0.18)` P−12 Y10, twist +28. Off hand braced on the front knee `o(0.30,0.55)`. · Then 3 f follow-through and 6 f return.
- **Sweep 9/4/23** (kneeling low cut): f0–6: hipY 0.50, back knee almost down (bx −0.55). Blade drawn back low (P−10 Y160), twist −30. · f7–8: smear. · f9: contact. `g(0.66,0.36,0.2)` P−15 Y0, twist +38, hipLean −24. Off-hand fingertips touch the floor `o(0.15,0.05)` — a three-point silhouette. · f13–24: hold low. · f25–36: rise.
- **Air:** f0–4: tuck (fy 0.30, by 0.35), P140, two hands. · f5: smear. · f6–9: active, P→−45 under the feet. spin −10. · Legs extend downward from f10 to prepare the landing.
- **Throw** (34 f, aikido wrist-turn + palm): f0–4: off hand to the opponent's sword wrist `o(0.55,1.25)`. · f5–16: hipYaw 0→−40, pulling the opponent forward and down. · f17–22: hip check, rootX +0.10, hipLean −14. Palm shove at the chest with a small Force ripple. · f23–34: re-raise to Soresu.
- **Special — Force Push:** f0–9: off hand pulled back beside the ear `o(−0.22,1.30,−0.24)`, fingers curled. Blade swung low behind (P−55 Y170) as counterweight. Weight back (rootX −0.06). · f10–12: thrust. Back foot drives, front steps +0.25 (lands f12). Arm locks straight `o(0.86,1.38)`, palm open with the wrist bent up and the fingers spread. chest −10, hipLean −16. · f13–20: moving hold (arm creeps +0.02) while the wave travels. · f21–38: recover. · Ref: ROTS Mustafar push collision.
- **Super — multi-cut lunge:** Freeze pose (`SUPER_FREEZE` 42): blade lowered to point straight at the opponent, two-finger point, head down. · Lunge 0.6 in 3 f (lean −35, Naruto-style). · 6 alternating cuts at 3 f each, each with a smear frame: high-to-low diagonal, rising backhand, horizontal, and so on. · Finisher f32: hop (fy/by 0.12) to an overhead P176. · f35: Falling Avalanche into a kneel (hipY 0.62, back knee down), P−66. **Hold 13 f.** The last hit gets 24 f hitstop. · Ref: Rebels "Twin Suns" decisiveness; Star Wars: Visions "The Duel".
- **Parry stance:** f0–1: snap to `g(0.38,1.30,0.18)` P95 Y20, two hands. hipY −0.03. · Active window: blade "searches" ±4° on a 2 f period. · Whiff: drift back to stance over 12 f, head tilting.
- **Parry success:** During the 15 f freeze: a small outward beat (P95→60), the tip pushing out, twist +12. Flash at the contact point. · After: in 4 f the blade circles over the head back to the high guard (Twin Suns: block, then cut).
- **Being parried:** the smallest stagger of the cast. Blade knocked to P140, chest +12, head +14, off hand flung back. Front foot lifts (fy 0.05). · One step back, then catches himself at f22 and re-raises the blade first.
- **Block:** High: `g(0.40,1.30)` P100, two hands. · Crouch: hanging guard `g(0.40,0.86)` P−75 Y15. · Impact: 2 f pushback −0.07, blade jolt +10°, `out` recovery. · Ref: ROTS opening, Obi-Wan deflecting droid fire.
- **Hit high / body / low / crouch:** shared ×1.0. The off hand reflexively shields the face on high hits. Recovery goes blade-first into the high guard.
- **Blowback / knockdown / bounce:** shared ×1.0. The robe hem flips over the legs on impact (+3 f lag).
- **Get-up** (backward shoulder roll): 0–35%: spin 84→270→360 tucked. · 35–70%: kneel (hipY 0.48) with the blade already in the high guard. · 70–100%: rise, pointing hand last.
- **KO:** light finisher → the Qui-Gon collapse (TPM: struck, drops to his knees, then topples back). Heavy finisher → shared blowback ×1.0.
- **Intro ignition:** f0–22: hilt at the belt. · f22: draw and ignite pointing down-back (P−100 Y160). · f30–42: half-circle up in front to a vertical salute (P90). · f60–70: settle into Soresu with the two-finger point. · Ref: ROTS Utapau / Kenobi Part VI.
- **Victory:** Vertical salute in front of the face `g(0.25,1.40)` P90, head −15 (bow). · Extinguish at f20. · Hilt to the belt, hands folded at the waist.

### 3.2 VEXA — heavy dark marauder (red, cape; Vader / Kylo / Anakin)
**Rhythm:** slow, readable anticipation → explosive release → long follow-through holds (3–4 f). Stomps drop the root and shake the camera (0.015 m, 3 f). Juyo bursts, then dead stillness. Cape lags 4–6 f with 1.3× overshoot.

- **STANCE** (Djem So high guard): Two hands `g(0.10,1.70,0.10)` P195 Y10 (blade back over the head, tip slightly low). · hipY 0.78, wide feet `f(0.40,0)` `b(−0.48,0)`, knees out. · hipLean −8, twist +6 (square, aggressive), head −8 (glare). · Ref: Anakin's two-handed overhead (ROTS Mustafar).
- **Idle:** 4.0 s respirator rhythm. Inhale 1.6 s with chest +3 and shoulders up; hold 0.4 s; slow exhale. Blade tremble ±1.5°. Cape sways.
- **Walk:** Forward: 40 f/step **stomp**. Foot lands flat (toe 0), hipY −0.03 dip and a micro shake on contact. Blade dead still. Ref: Vader's measured walk (Rogue One hallway). · Back-walk: 48 f/step, hips higher, blade drifting forward (wary).
- **Run** (charge): Lean −22. One hand; blade low beside the body P−30 Y160, tip skimming 0.05 m above the floor (spark trail). · Off hand a clenched fist pumping. 26 f cycle. · Heavy footfalls: hipY −0.03 at each contact.
- **Backdash:** short and low (−0.25, by 0.12). Lands flat-footed with a stomp. Blade stays overhead. The cape billows forward (overlap).
- **Jumps:** Neutral: heavy squat (hipY −0.14), knees stay bent in the air, blade overhead. · Forward: **no flip**. An arcing leap with the body pitched forward −15 and the blade cocked P210, ready to cleave. · Back: a drifting hop with the cape thrown forward, no flip. · (Contrast: Kael and Asha flip; Vexa never does.)
- **Landing:** 1 f squash to hipY −0.16. Dust ring and shake. Cape lands 3 f later.
- **Light 4/3/9** (one-handed swat; Vader ESB / Kylo): f0–2: release the off hand, P195→215, twist −10. · f3: smear. · f4: contact. `g(0.62,1.25)` P−10 Y15, twist +30. Off hand flung back as an open claw `o(−0.35,1.10)`. · f5–7: to P−30. · f8–13: hold low at P−45. · f14–16: both hands back to the high guard.
- **Heavy 10/4/18** (Falling Avalanche): f0–6: stand tall. `g(−0.02,1.86)` P205, chest +16, spine +6, head +8. **Front knee lifts** (fy 0.18) to prepare the stomp. rootX −0.04. · f7–9: hold with tremble ±2°. · f10: smear. Foot slams down at fx 0.62, hipY 0.70, shake. `g(0.40,1.70)` P90. · f11: contact. `g(0.68,1.10)` P−35, chest −18, spine −8, hipLean −22, twist +20, head −14. · f12–14: to P−70. The blade strikes the floor (spark burst). · f15–20: blade buried in a hold. `g(0.60,0.70)` P−75, hipY 0.66. · f21–32: shoulders heave up first; the blade lags 3 f, as if dragging weight. · Ref: ROTJ Luke's rage blows; ESB Vader.
- **Crouch light:** f0–2: blade pulled to the hip, P0 Y150. · f3: smear. · f4: one-handed low stab `g(0.66,0.55)` P−20 Y0. Off hand on the thigh. · Then 2 f hold and a 7 f return.
- **Sweep 9/4/23** (Juyo wild arc): f0–6: twist −40, blade back low (P−15 Y190), hipY 0.56, back foot pivots. · f7–8: smear. · f9: contact. Ankle-height arc `g(0.62,0.32)` P−10 Y0, twist +44, back heel up and pivoting (by 0.05, toe +30). · f13–24: **overswing** to Y−40 across the body. · f25–36: catches her balance with a hand on the thigh.
- **Air:** f0–4: blade P210 behind the head, knees tucked. · f5: smear. · f6–9: hammer down to P−60, legs extend. · Whiff landing: +4 f heavy squash.
- **Throw** (choke-slam; Vader lifting Antilles, ANH): f0–4: claw to the throat `o(0.55,1.45)`. · f5–16: lift (oy 1.45→1.70, victim feet +0.25). Head tilts −8, curious. Blade lowered to the side (P−60 Y40). · f17–22: drive the arm down and forward `o(0.80,0.60)`, slamming the victim to the floor in front. chest −14, hipLean −18. · f23–34: recover.
- **Special — Force Grip** (`GRIP_SEQUENCE` 64, release 46): f0–10: off arm extends slowly to `o(0.70,1.45)`. The hand opens, then curls into a claw at f10. Blade lowered at the side P−70 Y30 (contempt). · f10–40: arm rises with the victim (oy 1.45→1.85), slight wrist twist. Head tilt −5→+5, chest +4. · f40–46: hurl. The arm whips forward and down `o(0.95,1.30)` in 4 f, fingers splayed, hipLean −14. · f46–64: recover to the high guard. · **Victim:** · Both hands at the throat, head +25, toes pointed (toe −50). · Feet kick alternately ±0.08 on a 6 f period. Hold the hitstop shake vertical (airborne). · Release → shared blowback ×1.2. · Ref: ESB Needa, Rogue One hallway.
- **Super — Force Lightning:** Blade off (`blade` 1→0 over 6 f); the hilt stays in the sword hand. · f0–12: gather. Both hands pulled to the chest, fingers curled, Palpatine hunch (spine −12, chest −10, head −15, hipY 0.74). · f13–15: release. Both arms thrust out at shoulder height `g(0.62,1.35)` `o(0.62,1.30,−0.08)`, fingers spread into claws, hipLean −12. · f16–70: sustain. · Hands tremble ±0.015 on a 3 f period; chest pulses ±2. · **Advance two slow steps** (Palpatine walking toward Luke, ROTJ). Robes flutter. · f70–80: final surge. Arms +0.08 further, back arches (chest +8), head +12 (cackle). · f80–100: re-ignite with a flourish. · **Victim:** · Arched (chest +25, head +35), arms clawing. · Knees buckle 0.85→0.5 over 60 f. 2 f shake period. Hitstop ×1.5 (electric rule). · Final launch.
- **Parry stance:** high slant `g(0.32,1.62)` P130, two hands, weight forward (absorb, then counter).
- **Parry success:** During the freeze: beats the blade down and away (P130→40), `g(0.50,1.40)`, chest −8. · Post: stomp in (rootX +0.06), blade straight back to P195.
- **Being parried:** the biggest stagger. Blade flung past vertical to P205. Both arms overhead `g(−0.05,1.85)`. chest +22, spine +10, hipLean +16, head +25. · Front foot kicks up (fy 0.15). Two heavy stomps back (−0.2 each). The cape whips forward over the shoulders.
- **Block:** High: two-handed slant P120. · Low: P−60. · Feet planted. Visual pushback ×0.7; blade jolt only 6°. She absorbs.
- **Hits:** shared ×0.8 amplitude with a longer `in` recovery (heavy). Head snap −30%; gut fold full. Cape overshoot 1.3×.
- **Blowback / knockdown:** lower arc, spin only 20→70, lands early. Big dust, small bounce (0.12), short slide. The cape drapes over her after rest.
- **Get-up:** "Nosferatu rise". The body stays rigid and pivots up from the heels with the feet fixed (spin 84→0 over 70% of the get-up). Arms at the sides; no hands used. · The blade re-ignites with a snap at 75%. · Alternative: roll to the front, fist plants, rises to one knee, stands with a stomp.
- **KO:** crumple to the knees, then falls forward onto one fist, then face down. The cape settles 6 f later. The blade sputters out (3 flickers).
- **Intro:** f0–30: stands in shadow, breathing. · f30: ignition pointing down-forward (P−45). The red light reveals her (Rogue One hallway). · f30–60: slow raise to the high guard. · 2 f crackle flickers (Kylo's unstable blade).
- **Victory:** blade lowered (P−60) at her side. The off fist rises slowly and squeezes (grip gesture) at f20. Then a cape-swirl turn away and the blade goes off at f50.

### 3.3 ASHA — acrobatic reverse-grip duelist (two green; Ahsoka / Yoda / Qui-Gon)
**Rhythm:** springy and low, with constant micro-bounce. Attacks chain through rotation. Holds of 1–2 f only. Follow-throughs flow into the next pose. Everything about 15% quicker in feel than Kael.

- **STANCE:** hipY 0.62 (deep). Wide `f(0.42,0)` `b(−0.46,0)`, back heel up 0.03. · hipLean −16, chest −4, twist −10, head −6. · Main (sword) hand high: `g(0.10,1.18,0.16)` P200 (reverse: back and slightly down along the forearm). · Shoto hand forward and low: `o(0.40,0.95,−0.10)` P2 210. · Silhouette = two bright back-swept diagonals.
- **Idle:** 1.0 s bounce (hipY ±0.025, heels lift). Blades sway ±6° in counter-phase. Fighting-game "bounce idle", like SF6 Jamie, whose mocap was a real breakdancer. (https://www.eventhubs.com/news/2022/sep/17/jamie-motion-capture-sf6-breakdancer)
- **Walk:** 24 f/step, cat-like on the toes, hipY 0.64. Hips sway ±4 hipRoll. Blades steady (predatory).
- **Run** (Naruto run): Lean −40, spine −10, head +25. · Both arms trailing straight back: `g(−0.35,0.95,0.15)` `o(−0.35,0.90,−0.15)`. Blades pointing back and up (P165) like exhaust. · 20 f cycle with a 4 f flight phase per step.
- **Backdash** (12 f): tucked back-hop, blades crossed in front (X). Lands on the toes with a 2 f bounce.
- **Jumps:** Neutral: hipYaw 360 corkscrew over 24 f, arms tight. · Forward: 360° flip tucked **tighter and faster** (complete by f24) with blades **out** like a pinwheel (Yoda AOTC). · Back: layout back handspring, arms overhead.
- **Landing:** three-point superhero landing. hipY 0.45, off hand touches the floor `o(0.30,0.05)`, head up. Springs back with a +0.03 overshoot.
- **Light 4/3/9** (reverse jab-cut): f0–1: fist chambers to the chest `g(0.05,1.0)` P180 Y180. · f2–3: punch out to `g(0.55,1.20,0.20)`. The wrist rolls the blade Y180→90→20 (smear at f3). · f4: contact. P−25 Y20, twist +34, front foot +0.06. · f5–7: to P−50. · f8–10: snap back (`out`). · f11–16: hop-step to stance.
- **Heavy 10/4/18** (spinning double cut): f0–6: coil. twist −50, hipYaw −35, hipY 0.56. Blades across the body. headYaw +30 (spotting like a dancer). · f7–9: unwind, **back to the camera at f9**. · f10: smear past 180°. · f11: main blade sweeps `g(0.60,1.25)` P0 Y10 (hit 1). · f13: shoto `o(0.55,1.0)` P2 −10 (hit 2). · f15–20: completes 360°, blades flared into an X (main high-back, shoto low-front). · f21–32: bounce-settle. · Ref: Clone Wars S7 Ahsoka vs Maul.
- **Crouch light:** shoto flick. f0–2: chamber. · f3: smear. · f4: shoto whips P2 210→−20 to `o(0.55,0.40)`. The main blade stays high. · Then 3 f hold and a 6 f return.
- **Sweep 9/4/23** (spinning low sweep): f0–6: Cossack squat on the back leg (hipY 0.35), front leg extended. · f7–8: hipYaw spin begins. · f9–12: active. The low blade circles at ankle height (Y180→0, P−20); the front leg sweeps with it (fx 0.70, fy 0.02). · f13–24: spin completes. · f25–36: pops up.
- **Air** (pinwheel, Demon Slayer "Water Wheel"): f0–3: tuck. · f4–13: forward body spin −360 with both blades extended outward. Active during 180–330°, when the blades pass in front and below. · f14+: legs open toward the floor.
- **Throw** (vault and back-stab): f0–4: both hands on the opponent's shoulders. · f5–16: handspring **over** the opponent (spin −180, rootX +1.0, hipY up to 1.7). Sides swap. · f17–20: lands behind, back to them. · f21–24: double reverse-grip **backward stab** past her own ribs, without looking. · f25–34: spins to face them.
- **Special — Ataru leap strike:** f0–5: crouch (hipY 0.5), blades swept back like wings (P170/P2 170). · f6: launch (travel 1.6 over 22 f, peak +0.9). · f6–20: forward tuck flip, spin 0→−360. Blades tight. · f20–23: opens at the apex. Arms overhead `g(0.20,1.90)` `o(0.10,1.85)`. · f24: smear. · f25–28: double "ice-pick" drive. Blades P200→−80 in front, hipLean −20. · f29: three-point landing (hipY 0.40), blades crossed low in an X. **Hold 4 f.** · f33–48: springs up. · Ref: Yoda AOTC; Obi-Wan's leap over Maul (TPM).
- **Super — dash-through flurry** (Zenitsu "Thunderclap and Flash"): Freeze pose: hipY 0.45, lean −35, both blades swept back (P175, like a drawn-back iaido sheath), head down. · f0–6: dash 2.5 m with afterimages, **passing through** the opponent. · During the pass: 3 spinning double slashes (hipYaw 360 per 4 f). · f20: arrives behind in a frozen low lunge, back to the opponent, blades out to the sides (P−30 / P2 −40). **Hold 18 f in silence.** · Then the delayed hits detonate on the opponent, she flicks the blades, and the turnaround takes 6 f.
- **Parry stance** (Shien forearm X): Both forearms up in front, blades lying along them: `g(0.40,1.30)` P120 Y15, `o(0.40,1.20)` P2 60. · Knees pulse ±0.01.
- **Parry success:** During the freeze: the attacker's blade is trapped in the X. · Post: wrists roll outward, splitting the X (P120→170, P2 60→−10) and throwing the blade wide. A half spin into ready (twist −30).
- **Being parried:** arms flung apart into a spread eagle (main up-back, shoto down-back). Spins out half a turn (hipYaw −70, back partly to the camera). Two stumbling hops.
- **Block:** High: X-guard. · Crouch: low X with the forearms over the front knee. · Pushback skids on the toes.
- **Hits:** shared ×1.25 amplitude (light body). Less hip drop, more rotation. Spin-out on heavy hits.
- **Blowback:** higher arc, with spin continuing to 200 (VF head-over-heels). Limbs flail and the blades draw rings. First bounce 0.30.
- **Get-up** (kip-up): 0–25%: roll back onto the shoulders, knees to the chest, hands by the ears. · 25–35%: explosive snap. Legs whip down, spin 84→10 in 4 f. · Lands crouched with the blades re-flared, then bounces into stance.
- **KO:** spin-out collapse. 270° hipYaw while the knees buckle. Blades go out mid-spin. Falls onto her side.
- **Intro:** a back-flip into frame, landing in the three-point pose. Both blades ignite on landing with an outward flick, shooting back along the forearms. They cross in front, then she slides into stance.
- **Victory:** twirls both hilts (blade yaw 720° over 20 f), blades off, hilts to the hips. Head tilt +10 and a small bounce.

### 3.4 THANE — temple warden saberstaff (yellow, masked; Temple Guard / Maul / Inquisitor)
**Rhythm:** formal stillness in neutral, then continuous circular momentum when attacking. The staff almost never stops: idle has a slow ±8° figure-8. Attacks hit with end A, then end B, mixed with kicks. Robes flare radially on spins. The mask means the **body** (chest/hips) must carry the emotion, not the head.

- **STANCE** (Temple Guard): hipY 0.82, feet `f(0.30,0)` `b(−0.36,0)`. Upright (hipLean −2), square (twist 0), head 0. · Staff diagonal across the body: `g(0.30,1.15)` P55 (A up-forward, B down-back). Off hand 0.30 m down the shaft.
- **Idle:** 3.5 s breath. Staff pitch ±8° figure-8 locked to the breath. Robes sway. Otherwise statue-still (Temple Guards, Clone Wars S5).
- **Walk:** gliding heel-toe, 30 f/step, bob 0.01. Staff steady. A procession feel.
- **Run:** lean −25. Staff in the sword hand only, trailing back like a spear (P160 Y175). Off arm pumping. 22 f cycle.
- **Backdash:** back-hop while the staff spins one full turn in front in the x–y plane over 12 f. That makes a disc shield (Inquisitor spin deflection; Grievous's propeller sabers in ROTS).
- **Jumps:** Neutral: tuck, staff vertical at the side (P90). · Forward: layout front flip with the staff counter-rotating against the body. · Back: Maul-style layout back-flip, staff vertical.
- **Landing:** knees −0.12. Staff swings horizontal overhead (P0, hands wide) like a balance pole.
- **Light 4/3/9** (pike jab): f0–2: pull back (g x −0.10, P20). · f3: smear. · f4: spear thrust `g(0.62,1.20)` P5, both hands pushing, twist +10. Long, straight reach — unlike everyone else's arcs. · f5–7: active. · f8–16: retract.
- **Heavy 10/4/18** (double-end windmill; Maul TPM, Rey's staff TFA): f0–7: cock. End A up-back (P130), twist −20, weight back. · f10: smear. · f11–12: end A sweeps 130→−30 in front (hit 1). · f13–14: the rotation continues (−30→−210); end B rises from behind and comes over (hit 2). · f15–20: staff horizontal at the waist. Deep lunge (hipY 0.70, bx −0.65). · f21–32: recover.
- **Crouch light** (rear-end poke): f0–3: wrist roll flips the staff 180°. · f4: end B jabs low `g(0.55,0.55)` P−10. · Then 2 f hold and a 7 f return.
- **Sweep 9/4/23** (wushu sweep): f0–6: crouch, staff horizontal and low. · f7–8: hipYaw spin starts. · f9: front leg extended along the floor (fx 0.75) plus the low blade at P−15 (two hit sources). · f13–36: spin completes and he rises. · Ref: Ray Park's wushu.
- **Air** (Maul's kick): f0–4: knee chambered (fy 0.45), staff spinning behind. · f5–9: front foot snaps out at head height, then end A follows (two-part hit). · Ref: TPM Theed, Maul's kicks to Obi-Wan.
- **Throw:** f0–4: collar grab. · f5–14: knee to the gut (fy 0.5, fx 0.4). · f15–22: spinning back kick (hipYaw 180, back foot drives out at chest height). · f23–34: staff twirl back to stance.
- **Special — spinning staff throw** (Inquisitor boomerang): f0–8: overhead helicopter spin of the staff (x–z plane, reads as an ellipse) while the body coils (twist −40). · f9–12: sidearm release at chest height `g(0.70,1.30)`. The arm crosses the body, twist +40, front foot steps +0.25. · f13–40: guiding pose. Off palm out `o(0.55,1.40)` (Force control), weight forward. · Catch: the hand snaps to `g(0.40,1.30)` with a 2 f elbow absorb, then the spin decays over 6 f. · Ref: Rebels Grand Inquisitor; Obi-Wan Kenobi Inquisitors.
- **Super — whirlwind into an overhead slam:** Freeze pose: formal bow. Staff vertical in front of the mask (P90), feet together, head −10. · Then 5 advancing spins of 8 f each. Body hipYaw +360 per spin, staff +540 in the x–y plane in the opposite direction. Root +0.35 per spin, step-pivot-step. Robes radial. · f50: leap (+0.6), staff overhead (end A at P170). · f54: slam to P−80 into the floor. Deep horse stance (hipY 0.55), chest −20, floor crack. **Hold 12 f.** · Ref: Demon Slayer's "Constant Flux" (continuous flowing cuts) and Maul's spins.
- **Parry stance:** staff vertical in front (P90, centre at `g(0.40,1.20)`), guarding high and low at once. Rotation ±5°.
- **Parry success:** During the freeze: caught at 45° into the turn. · Post: a 180° spin-deflect in 4 f sweeps the attacker's blade up and over, ending in stance.
- **Being parried:** the staff spins loose in the hand (pitch +270 in 8 f, uncontrolled). Body twisted, mask tilted up (head +15).
- **Block:** High: horizontal bar overhead `g(0.30,1.55)` P0, hands wide (reads as a long line in side view). · Mid: vertical. · Low: diagonal down.
- **Hits:** shared ×1.0. Head values ×0.6, chest values ×1.2 (the mask can't emote). On heavy hits the staff spins loose by 90°. Robes overlap +3 f.
- **Blowback:** body pinwheels while the staff spins away from the hand like a propeller, then is caught on landing (or lands beside him and is Force-pulled back during the get-up).
- **Get-up** (breakdance windmill): 0–40%: legs sweep a circle along the floor (hipRoll + spin). · 40–70%: rise to one knee with a staff twirl. · 70–100%: Temple Guard stance.
- **KO:** sinks to the knees, kneeling formally. Head bows, blades retract, the hilt rolls from the hand.
- **Intro:** f0–30: hilt held vertical before the mask, unlit. · f30: top blade ignites. · f42: **second blade ignites** with a twirl (Maul's reveal, TPM Theed hangar). · f50–70: settles into stance.
- **Victory:** two staff twirls in the x–y plane, staff planted vertical (blades off), formal 15° bow.

---

## 4. Anime and fighting-game references as key poses

- **SF3 Third Strike parry:** Ground parry window 10 f (6 if the direction is held). Anti-air 5 f. Re-parry cooldown 23 f. · Red parry (during blockstun) has a ~2 f window. · A parry produces a freeze-frame with a signature "shing" sound. Blockstun and chip damage are removed, so the parrier acts first. · Daigo parried all 15 hits of Chun-Li's super at EVO 2004 with a 2 f first window. · (https://wiki.supercombo.gg/w/Street_Fighter_3:_3rd_Strike/System , https://retroxp.beehiiv.com/p/guest-feature-street-fighter-iii-3rd-strike) · **Key poses:** · Defender: snap into a forward intercept (blade moving to meet the hit) with a blue-white flash at contact. Both freeze. · Defender's freeze pose = the deflection extreme. Attacker = the contact pose. · After the freeze the defender returns to ready in ≤4 f; the attacker stays in recovery.
- **SF6 Drive Parry / Perfect Parry:** Drive Parry is a held guard wrapped in a green energy aura. Active 8 f in Season 1, 12 f in Season 2. Whiff recovery 29→33 f. · **Perfect Parry** (~2 f window, press on or 1 f before the hit) triggers a freeze, a zoom-in and **slow motion** for the attacker. Follow-up damage is scaled. · (https://eventhubs.com/news/2024/may/20/frame-data-parry-sf6-s2 , https://esports.gg/guides/street-fighter-6/how-to-recreate-evo-moment-37-in-street-fighter-6) · **For us:** · Normal parry = 15 f freeze + attacker stagger (the "being parried" poses above). · A "perfect" parry in the first 2 f of the window could add a 0.4× time-scale on the attacker for 30 f, a 6% camera zoom, and a white rim flash on the parrier.
- **Guilty Gear Strive:** **Wall splat:** flat on the wall, limbs spread, head turned. Auto-recovers after 59 f (invulnerable f1–24). · **Wall break:** shatter, then both fly into the next area. · **Counter hit:** big text and slowdown (Mid 25 f / Large 35 f). · **Spinning blowback** after a fully charged Dust: horizontal log-roll through the air. · **Floating crumple:** brief float, then a crumple on landing. · (https://www.dustloop.com/w/GGST/Mechanics , https://www.dustloop.com/w/GGST/Damage) · **Splat key pose:** spin 0, hipLean +10, back flat at the wall x, arms out at shoulder height (`o(−0.1,1.4,−0.3)`, sword hand mirrored), head +10, feet 0.15 off the ground, sliding down 0.2 over the hold.
- **Tekken / VF crumples:** Tekken crumple stun (CS) and crumple fall stun (CFS): a slow collapse to the floor. · (https://srk.shib.live/w/Tekken_5:_Dark_Resurrection/Mechanics , https://fightpedia.fandom.com/wiki/Stun) · VF stomach crumple: keels over clutching the stomach, drops to the knees, falls face down. Chin crumple: one knee, then recovers. · (https://virtuafighter.com/wiki/hit-effects/) · **Key poses:** c0 gut fold; c6 knees inward, hipY 0.70, off hand on the belly, blade drooping P−70; c18 kneel (hipY 0.48), head −30; c30 falls forward (spin −80). Use for the Vexa-grip release on a counter-hit, or a super finisher.
- **Smash hit reactions:** 9 ground flinches (height × strength) plus 3 air flinches. Tumble ≥ 80 knockback. · Launch angle 70–110° uses a "top" flail animation. · Victim shakes during hitlag: horizontally on the ground, vertically in the air. · (https://www.ssbwiki.com/Flinch , https://www.ssbwiki.com/Hitlag) · Brawl used 9 attack-hit animations per character plus knockback variants, at least 12 hit animations per character. · (https://gameranx.com/updates/id/474375/article/masahiro-sakurai-reveals-insane-details-put-into-hit-animations-for-smash-bros/)
- **Naruto run:** upper body pitched far forward, both arms stretched straight back like airplane wings, head up. It's easy to animate because only the legs cycle. (https://www.sportskeeda.com/anime/why-naruto-run-arms-back-the-physics-behind-it-explained , https://knowyourmeme.com/memes/naruto-run) · Keys: lean −35 to −45, head +25. Arms `(−0.35,0.9)` and fixed. Legs cycle with high knee drive (fy 0.35) and heel kick-up (by 0.4). 20–24 f cycle. Saber trails as a light streak.
- **Demon Slayer:** Zenitsu, Thunderclap and Flash: an iaido-like single forward slash from a very low stance, as an instant dash with a lightning trail. First shown in season 1 around episode 12 (primary source: the anime; web write-ups are low quality). · Key structure: a still, low coil → the dash happens in ≤6 f → the attacker frozen past the target → delayed impact on the victim. · Tanjiro's "Water Wheel": a forward vertical somersault with the sword tracing a full circle (Asha's air attack). · "Constant Flux": continuous flowing slashes that build momentum (Thane's super).
- **Star Wars: The Clone Wars (2003, Tartakovsky) and Visions "The Duel" (2021):** the best "limited animation" lightsaber references. Long still holds, then 2–4 frame explosive cuts, with silhouette-first posing. Copy the hold-then-snap rhythm for supers.
- **Jedi: Survivor** ships 5 stances (single, double-bladed, dual, crossguard, blaster) as fully separate movesets. That validates fully separate per-character animation sets rather than shared clips. (https://www.brickfanatics.com/public/index.php/star-wars-jedi-survivor-lightsaber-stances)

---

## 5. Implementation checklist

1. Add a `hold` ease and per-field-group key offsets (hips −2 f, chest −1 f, grip 0, blade +1 f overshoot) to `sampleKeys`. Successive breaking of joints then comes for free.
2. Hitstop table (§1.3) per move, plus decaying victim shake: x on the ground, y in the air, ±0.03 m. The victim enters the reaction peak over 4 f inside the freeze.
3. Replace the single `HIT_STAND`/`HIT_CROUCH` with the 9-cell height × strength grid, plus stagger, crumple and spin-out (§1.9). Scale per character: Kael 1.0, Vexa 0.8, Asha 1.25, Thane 1.0 (head ×0.6).
4. Blowback = impact → starfish → back-first landing → bounce 0.22 → slide with friction ×0.85 (§1.10). KO adds +30% height, a 0.3× time-scale for 40 f and a push-in.
5. Per-character STANCE, idle period, walk timing and get-up (§3), so silhouettes and rhythms differ before any attack is thrown.
6. On contact frames: blade yaw within ±25° and sword hand gz +0.12–0.2. Lengthen the trail on smear frames.
7. Cloth springs freeze during hitstop and get an impulse when it ends (Vexa's cape lags 4–6 f, Thane's robes 3 f).
8. Parry: 15 f freeze in the deflection-extreme pose, defender back to ready in 4 f, attacker stagger 20–30 f with the blade knocked to P140–205 by character. Optional perfect-parry slow-mo (SF6).
9. Author pitch and yaw unwrapped (e.g. 195→−35 through 90, never 195→325) to stop lerps taking the long way round.
10. For each move, check the contact frame as a black silhouette at gameplay zoom. If you can't tell what the move is, push the pose further.

### Source index (beyond those inline)
- GG Xrd GDC handout: https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf
- Ray Park and Gillard: https://gizmodo.com.au/?p=1214340 , https://en.wikipedia.org/wiki/Nick_Gillard , https://bluescreenreveals.com/nick-gillard-the-lightsaber-duels-of-revenge-of-the-sith/
- Bob Anderson as Vader's sword double (ESB, ROTJ): https://www.npr.org/sections/thetwo-way/2012/01/02/144580276/fencer-who-was-darth-vader-in-famous-light-saber-scenes-has-died
- Screenshake (trauma model, squared or cubed falloff): https://kidscancode.org/godot_recipes/3.x/2d/screen_shake/
- Scene beats (Utapau, Mustafar, Twin Suns, Bespin, throne room, Theed, Geonosis, Malachor, Rogue One hallway, Starkiller forest) come from the films and episodes themselves. The web sources above confirm the form and choreography attributions but rarely describe geometry, so the poses are our translation.
