# Knut's Kite Game v2

A small static browser game: pick a kite, lines and wind, steer the kite through the wind window, build board speed, pop off waves, and do tricks in the air. It's plain HTML/CSS/JS on one 2D canvas, with no build step, no dependencies and no network calls.

## Play

Live (unlisted test build): https://kschevik.github.io/kite-game/

## Hosting and updates

The site is served by GitHub Pages from this repo's `main` branch via `.github/workflows/pages.yml`. **Every push to `main` redeploys automatically** (about 1 minute), so Cursor cloud agents (or anyone with access) can change the game just by committing and pushing to `main`. The workflow can also be re-run manually (workflow_dispatch).

## Run locally

```sh
cd kite-game
python3 -m http.server 8000
# open http://localhost:8000/  (on a phone: http://<your-LAN-IP>:8000/)
```

Opening `index.html` straight from disk also works, but the clipboard and share features need http(s).

## Flow

**START** → setup screen (kite size, line length, wind) → **GO!** → 60 s run → results (share card, challenge link, **PLAY AGAIN** with the same setup, or **CHANGE SETUP**). Enter works as START / GO / PLAY AGAIN.

## Controls

| Action | Touch | Keyboard / mouse |
|---|---|---|
| Steer kite | drag anywhere on the sky | mouse drag, arrows, A/D (left/right), W/S (up/down) |
| Pop (jump) | big **POP** button | Space |
| Kiteloop / heliloop | **LOOP** button, or draw a circle while airborne | L |
| Spin | **SPIN** button | S (only while airborne; on water, S steers down) |
| Grab | hold **GRAB** | hold G |
| Board-off | **BOARD OFF**, tap again to catch | B (again to catch) |
| Handle pass | **PASS** | H |
| Mute | speaker button | M |

The trick buttons sit in two rows left of POP, so they fit a 390 px wide phone.

## Setup

| | Options | Effect |
|---|---|---|
| Kite size | 7 / 9 / 12 m | pull ×0.75 / 1.0 / 1.35, turn rate ×1.25 / 1.0 / 0.75 |
| Line length | 15 / 22 / 27 m | window radius = line length (kite m/s = window motion × line), turn rate × 22/line, kite speed ceiling × (line/22)^0.3; the drawn window grows with line length |
| Wind | slider 10–30 kn (default 15.6 kn = 8 m/s) | W = kn / 1.944 m/s |

The last setup is stored in `localStorage['kkg_setup']` (sanitised on load). The HUD shows it (e.g. `9m · 22m · 16kn`), and so do the results screen and the share card.

## Physics (simplified from `physics_v4.md` §0–3)

- True wind W comes from the setup (gusts ×1.6). Line length L = window radius.
- Kite position is normalised on the window: x points toward the window centre (power zone, downwind and low), y points up. Power-zone factor `zw = cos(angle from centre) = x`. It is 0 at the zenith or edge and 1 at the centre.
- Kite speed is measured from its motion on the window (× L, in m/s). Its ceiling is `W·(0.6 + 2.0·zw)·(L/22)^0.3` (Loyd: kite speed ∝ cos θ), and acceleration (turn rate) is limited to `80·k_turn·22/L` m/s².
- Apparent wind is `Va = √(W² + v_kite² + (0.7·v_board)²)`, capped at `W·√(1+4.5²) ≈ 4.6 W`.
- **PULL R = k_kite · (Va / 8 m/s)²**. With the 9 m kite at 15.6 kn this is exactly v1: about 1× parked, 2–4× normal riding, about 6× in a dive and 8–10× in a loop. A big kite in strong wind reaches the overpowered band much sooner; a small kite in light wind needs constant sweeping. The meter shows 1–21×.
- Board speed: `dv/dt = 1.6·(R−1) − 0.045·v² − 0.6` (capped at 18 m/s).
- **STALL**: kite slower than 2.5 m/s and low (y < 0.55) for more than 2.5 s. **OVERPOWERED**: R > 14 for more than 0.7 s, which causes a crash.
- **Gusts**: every 6–12 s, W rises to 1.6× for about 2.5 s.
- **Jump**: `vy0 = q·(0.45·v_board + 1.1·√R + 1.0·H_wave) + 1.2`, where q is the timing quality (PERFECT 1, GOOD 0.75, EARLY/LATE 0.2–0.4). While airborne, lift is `min(0.5g, 0.05g·R·y_kite)` and fades with airtime (τ = 2.5 s). A loop adds extra lift; loop duration scales with `1/√turn rate`.

## Tricks and scoring

- Kiteloop +700 (and +1.5 m/s), heliloop +500, spin +250 per 360°, grab +150/s, perfect pop +300, good pop +100, height ×100 per jump.
- **Board-off** (once per jump): +400, plus up to +400 for the time off (full bonus at the 0.8 s catch window). The board auto-returns after 0.8 s. Landing with the board still off = **bad landing**; catching it less than 0.2 s before touchdown = **sketchy landing**.
- **Handle pass**: a 360° rotation in 0.7 s with the bar behind the back, +600. It needs at least 0.45 s of ballistic airtime left ("TOO LOW" otherwise). Open rotation at landing is judged like an unfinished spin: > 20° sketchy, > 90° bad.
- Penalties: stall −150, crash −300, sketchy landing −150, bad landing −300 (and speed ×0.4).

## Graphics

Parallax sky (clouds and two mountain ridges scrolling at different rates with board distance, horizon haze), spray from the board tail above 7 m/s and a foam burst on every landing (max 140 particles), an animated canopy (leading-edge tube, struts, fluttering/billowing trailing edge, shading that deepens with pull), and rider poses for grab, spin (tucked), kiteloop (stretched toward the kite), board-off (board drifts away) and handle pass (bar behind the back). The palette is navy, cyan, yellow, orange, white and magenta only.

## Challenge links and test hooks

- `?h=12.4&s=3400&n=Knut&k=9&l=22&w=16` shows "Beat Knut's 12.4 m jump (3400 pts) on 9m · 22m · 16kn" and preselects that setup. Parameters are parsed as numbers only: `k` snaps to {7, 9, 12}, `l` to {15, 22, 27}, and `w` is clamped to 10–30. Without `h`, `k/l/w` still preselect the setup. The name is sanitised.
- The local best is stored in `localStorage['kkg_best']` as `{h, s}`.
- `window.__kite`:
  - `state()` returns `pull, speed, height, score, phase` ('start' | 'setup' | 'run' | 'over'), `air, bestH, time, tLip, wind, kite`, plus `boardOff, passing, spinning, looping, grab, lastLanding` ('clean' | 'sketchy' | 'bad' | null), `tricks` (list of trick names landed this run), `trickCounts`, `setup {kite, line, wind}` and `particles`.
  - `makeCard()` is a Promise that resolves to a 1080×1920 PNG Blob.
  - `startRun()` starts immediately with the current setup.
  - `pop()`, `loop()`, `spin()`, `boardOff()`, `handlePass()` and `setTarget(x, y)` (normalised window coordinates).
  - `setSetup({kite, line, wind})` sanitises and saves the setup, then returns it.
- DOM ids used by tests: `#startBtn` (opens setup), `#goBtn` (starts the run), `#results`, `#cardImg`, `#bDl`, `#bCopy`.

## v2 ideas (next)

- Shared leaderboard on a free tier: Vercel KV / Upstash Redis (sorted set `ZADD`/`ZREVRANGE` behind one serverless function), or Supabase (a Postgres table plus row-level security and the anon key).
- Ghost replay of the best jump, plus a daily challenge seed.
- Per-setup local bests, plus more tricks (board-off variations, double handle pass).
