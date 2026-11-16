# Knut's Kite Game v1

A small static browser game: steer a kite through the wind window, build board speed, pop off waves, and do tricks in the air. It's plain HTML/CSS/JS on one 2D canvas, with no build step, no dependencies and no network calls.

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

## Controls

| Action | Touch | Keyboard / mouse |
|---|---|---|
| Steer kite | drag anywhere on the sky | mouse drag, arrows, A/D (left/right), W/S (up/down) |
| Pop (jump) | big **POP** button | Space |
| Kiteloop / heliloop | **LOOP** button, or draw a circle while airborne | L |
| Spin | **SPIN** button | S (only while airborne; on water, S steers down) |
| Grab | hold **GRAB** | hold G |
| Mute | speaker button | M |

## Physics (simplified from `physics_v4.md` §0–3)

- True wind W = 8 m/s (15.6 kn). Line = 22 m = window radius.
- Kite position is normalised on the window: x points toward the window centre (power zone, downwind and low), y points up. Power-zone factor `zw = cos(angle from centre) = x`. It is 0 at the zenith or edge and 1 at the centre.
- Kite speed is measured from its motion on the window. Its ceiling is `W·(0.6 + 2.0·zw)` (Loyd: kite speed ∝ cos θ), and acceleration (turn rate) is limited.
- Apparent wind is `Va = √(W² + v_kite² + (0.7·v_board)²)`, capped at `W·√(1+4.5²) ≈ 4.6 W`.
- **PULL R = (Va / W)²**. That gives about 1× parked, 2–4× normal riding, about 6× in a dive and 8–10× in a loop. The meter tops out at 21×, the theoretical limit.
- Board speed: `dv/dt = 1.6·(R−1) − 0.045·v² − 0.6` (capped at 18 m/s). Sweeping the kite builds speed, and parking it slows you down.
- **STALL**: kite slower than 2.5 m/s and low (y < 0.55) for more than 2.5 s. **OVERPOWERED**: R > 14 for more than 0.7 s, which causes a crash.
- **Gusts**: every 6–12 s, W rises to 1.6× for about 2.5 s.
- **Jump**: `vy0 = q·(0.45·v_board + 1.1·√R + 1.0·H_wave) + 1.2`, where q is the timing quality (PERFECT 1, GOOD 0.75, EARLY/LATE 0.2–0.4). While airborne, lift is `min(0.5g, 0.05g·R·y_kite)` and fades with airtime (τ = 2.5 s). A loop adds extra lift for its duration.
- **Score per jump**: `height_m·100 + trick points + pop bonus` (PERFECT +300, GOOD +100). Penalties: stall −150, crash −300, sketchy landing −150, bad landing −300.

## Challenge links and test hooks

- `?h=12.4&s=3400&n=Knut` shows "Beat Knut's 12.4 m jump (3400 pts)". Parameters are parsed as numbers only and clamped, and the name is sanitised.
- The local best is stored in `localStorage['kkg_best']` as `{h, s}`.
- `window.__kite` provides `state()`, `makeCard()` (a Promise that resolves to a 1080×1920 PNG Blob), `startRun()`, `pop()`, `loop()`, `spin()` and `setTarget(x, y)` (normalised window coordinates).

## v2 ideas

- Shared leaderboard on a free tier: Vercel KV / Upstash Redis (sorted set `ZADD`/`ZREVRANGE` behind one serverless function), or Supabase (a Postgres table plus row-level security and the anon key).
- Nicer graphics: a parallax sky, spray particles, an animated canopy, rider poses for each trick.
- More tricks (board-off, handle pass), selectable kite sizes and line lengths (15/22/27 m changes the window size and turn rate), and a wind slider.
- Ghost replay of the best jump, plus a daily challenge seed.
