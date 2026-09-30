# 🫀 Pet Food Factory

A 4-player online party game. You and up to three friends work the organ-sorting line
at the Pawsome Pet Food Co. Organs tumble down your conveyor belt, and you fling each
one into the right bin before it falls into the meat grinder. Highest score after 90
seconds is Employee of the Month.

Built with Three.js (chunky 3D cartoon graphics) and Socket.IO (real-time multiplayer).

## How to play

1. One person clicks **Open a new factory** and gets a 4-letter code.
2. Everyone else enters the code, or opens the **invite link**.
3. The host clicks **Start the shift**.

| Key | Bin |
| --- | --- |
| `A` / `1` | ❤️ Hearts |
| `S` / `2` | 🧠 Brains |
| `D` / `3` | 👁️ Eyeballs |
| `F` / `4` | 🌭 Guts |

You can also click the bins with the mouse. On phones and tablets, tap the big buttons.

The organ you need to sort is the one with the **ring** around it (the one closest to the grinder).

**Scoring**
- Correct bin: **+10**, multiplied by your combo (×2 at 5 in a row, up to ×5)
- ✨ Golden organs: **×3 points**
- Wrong bin: **−5** and your combo resets
- Organ reaches the grinder: **−3** and your combo resets
- The belt speeds up as the shift goes on.

## Run it locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join at
`http://<your-computer's-local-IP>:3000`.

## Put it online for free (Render)

1. Push this repo to GitHub (already done if you're reading this there).
2. Go to https://render.com, sign in with GitHub, and click **New → Blueprint**.
3. Pick this repository. Render reads `render.yaml` and sets everything up.
4. After a couple of minutes you get a URL like `https://pet-food-factory.onrender.com`. Send it to your friends.

> The free tier goes to sleep after about 15 minutes with no visitors. The first person to
> open the link may wait about 30–60 seconds while it wakes up. After that it's instant.

Other Node hosts (Railway, Fly.io, Glitch, etc.) also work: the start command is `npm start`,
and the server listens on the `PORT` environment variable.

## Project layout

```
server.js            Rooms, round timer, scoring (server is the source of truth)
public/index.html    Menus + HUD
public/style.css     Chunky party-game UI styling
public/js/main.js    Game loop, networking, input
public/js/world.js   Factory, conveyor belts, grinders, bins, bean workers, camera
public/js/organs.js  The organ models (heart, brain, eyeball, guts)
public/js/fx.js      Blood particles, floor splatter, floating score text
public/js/audio.js   Synthesized squelches (no sound files needed)
```

Tweak the game feel in `public/js/main.js` (belt speed `V0`/`ACCEL`, `spawnGap`) and
the round length in `server.js` (`ROUND_SECONDS`, or set the `ROUND_SECONDS` env var).
