# DAM DEFENDER

### *The dam is leaking. The fish are unionized. You have a cement gun and 60 seconds.*

![built with](https://img.shields.io/badge/built%20with-vanilla%20JS%20%26%20spite-f7b32b)
![dependencies](https://img.shields.io/badge/dependencies-0-success)
![fish harmed](https://img.shields.io/badge/fish%20harmed-0%20(they%20harm%20you)-ff4d2e)
![engineering degree](https://img.shields.io/badge/civil%20engineering-finally%20useful-38e0b0)

A self-contained browser arcade game about underwater structural engineering —
which is a real job, we checked. Vanilla JS + Canvas. No installs, no build
step, no mercy.

**Inspired by [Athiradi (2026)](https://en.wikipedia.org/wiki/Athiradi_(2026_film))**
— the Malayalam masala epic where a civil engineering student's greatest weapon
was always going to be cement.

![Gameplay](docs/media/gameplay-preview.png)

<details>
<summary><b>🎬 Full gameplay video (40s, with sound-free existential dread)</b></summary>
<br>
<video src="docs/media/gameplay.webm" controls width="800"></video>

[Direct link if the embed doesn't load](docs/media/gameplay.webm)
</details>

---

## 🚰 The Situation

Sector 07, North Face, 84 meters down. The dam has sprung **5 structural
breaches** and the countdown to catastrophic failure is **60 seconds**. You are
the operator of the Subsea Hydro-Pneumatic Concrete Injection System — a cement
gun mounted on the seafloor, aimed by a very nervous person (you).

There is one complication. The local fish have decided that your repair beam
is, scientifically speaking, a great place to be. Every fish that crosses your
firing line costs you **10 seconds** you absolutely do not have.

## 🎬 The Lore

In **[Athiradi](https://en.wikipedia.org/wiki/Athiradi_(2026_film))** (2026),
Samkutty "Sam Boy" Oommen — civil engineering student and BCET's most
persistent son — spends four years fighting a college committee to revive the
banned Aarohan fest, armed with nothing but delusion, a loyal friend, and one
(1) Vineeth Sreenivasan cameo. Meanwhile, Thotta Kuttan — retired goon,
aspiring playback singer, professional path-blocker — dedicates his life to
ensuring the fest collapses.

This game asks the question the movie was too busy being awesome to answer:
**what if Sam Boy's degree actually did something?**

The answer is the **Cement Thrower** — the Subsea Hydro-Pneumatic Concrete
Injection System, an improvised instrument of structural chaos that launches
wet concrete at the face of physics. In the film's universe it would have been
the greatest masala prop since the robot Kuttan beheaded. Here, it is mounted
on the seafloor at −84m and it is your only hope.

The strikes write themselves: *athiradi* literally translates to **strike**,
which is exactly what you take every time a fish drifts into your firing line.
And the fish move like Kuttan's temple-festival entourage — uninvited,
unbothered, and somehow always in the way when something important is
happening. They cannot be reasoned with. Every −10s flash is Kuttan collecting
on a grudge.

The 60-second clock is the college committee deciding your fate. The five
breaches are the five obstacles standing between Samkutty and Aarohan. And when
you finally seal the dam — Vivi, self-appointed alpha male, will still claim he
held the cement gun.

Seal the dam. Conduct the fest. Make Joppan proud.

## 🎮 Play It

```bash
node server.js        # then open http://127.0.0.1:3000
```

Or just open `index.html` in a browser. It literally cannot get easier.

## 📜 The Rules (read these, the dam won't)

| Rule | Consequence |
|------|-------------|
| Seal **5 breaches**, ~6s of aimed cement each (**30u total**) | The dam lives |
| Beat the **60 second** clock | The valley lives |
| Fire at empty wall | Nothing repairs. The cement judges you |
| Fish crosses your firing line | **MARINE IMPACT −10s** + a strike (athiradi) |
| Shoot an already-sealed patch | Nothing. It's done. Let it go |
| Hit **POLYMER BOOST** (`B`) | 2× repair speed for 5s — your Vineeth Sreenivasan cameo (20s recharge) |

**Accuracy** = on-breach time ÷ total trigger time. Missing is expensive —
morally *and* statistically.

## 🕹️ Controls

| Input | Action |
|-------|--------|
| `MOUSE` / `TOUCH` / `SPACE` | Aim + hold to inject cement |
| `B` | Polymer boost |
| HUD buttons | Pause · Mute · Fullscreen |

## 🐟 Know Your Enemy

The fish are not smart. They are *numerous*, they are *serene*, and they do not
care about your deadlines. They drift across the dam face at exactly the height
of your firing line, because of course they do — like temple-festival organisers
who found out a car stunt show just blocked the circumambulation route. The
engine predicts their wrap-around paths — watch the line, lift off the trigger
when one waddles through, and save your profanity for the -10s flash.

They cannot be reasoned with. They cannot be negotiated with. They are,
however, excellent singers.

<details>
<summary><b>📸 Screenshot gallery — moments of triumph and damp</b></summary>
<br>

| Briefing | On the job |
|----------|-----------|
| ![Start screen](tests/shots/desktop-start.png) | ![Gameplay](docs/media/shot-end.png) |

| Cement injection | Sealed patch |
|------------------|--------------|
| ![Firing](tests/shots/desktop-firing.png) | ![Patch](tests/shots/desktop-patch.png) |

| Victory | Defeat |
|---------|--------|
| ![Win](tests/shots/desktop-win.png) | ![Loss](tests/shots/desktop-loss.png) |

| Mobile briefing | Mobile repairs |
|-----------------|----------------|
| ![Mobile start](tests/shots/mobile-start.png) | ![Mobile game](tests/shots/mobile-game.png) |

</details>

<details>
<summary><b>🔧 How it works (for the engineers in the back)</b></summary>
<br>

| File | Role |
|------|------|
| `game-core.js` | Pure deterministic engine — 5-crack repair model, boost, fish/strikes, layout. Runs in Node, fully unit-testable. |
| `game-audio.js` | `window.DamAudio` — procedural WebAudio synth score + SFX, with override slots for licensed tracks. |
| `game.js` | Canvas renderer, input smoothing, particles, HUD wiring. |
| `index.html` / `styles.css` | Layout + editorial-industrial HUD and overlays. |
| `server.js` | Loopback static server. No dependencies, obviously. |
| `tests/run-tests.js` | Engine unit tests. |
| `tests/browser-test.js` | Playwright-core acceptance test (needs local Chrome). Drives the game with a fish-prediction autopilot — the same one that recorded the video above. |
| `tools/record-gameplay.js` | Records real gameplay to `.webm` + dumps preview frames. |
| `tools/make-apng.js` | Turns those frames into the animated preview PNG. Dependency-free. |

</details>

<details>
<summary><b>🎵 Soundtrack & swapping in your own tracks</b></summary>
<br>

All music/SFX is procedurally synthesized via WebAudio — three original synth
scores (`playing`, `won`, `lost`) plus silence when paused. `assets/bg.mp3` is
wired into the `playing` slot in `index.html`.

The audio slots were born with Athiradi on the mind: **"Athiradi Khol De"**
while you play, **"Ammaputhappe"** when you win, and **"Avarohanam"** when you
lose — avarohanam, the descent. Like the fest. Like your GPA. Like the water
level when the dam gives up.

To use your own licensed tracks, map the slots in a `<script>` that runs
**before** `game-audio.js`/`game.js`:

```html
<script>
window.DAM_AUDIO_TRACKS = {
  playing: 'audio/athiradi-khol-de.ogg',
  won:     'audio/ammaputhappe.ogg',
  lost:    'audio/avarohanam.ogg'
};
</script>
```

Missing files or rejected playback automatically fall back to the built-in
synth score for that mode.

</details>

## ❓ FAQ

**Q: Is this game based on Athiradi?**
A: Spiritually? Yes. Legally? This is a civil engineering simulator and any
resemblance to BCET's civil department is entirely deserved.

**Q: Why is the penalty called a strike?**
A: Because athiradi. That's the whole bit. Next question.

**Q: Can I shoot the fish?**
A: No. This is a civil engineering simulator, not a fishing simulator. The fish
are protected — possibly by a retired goon with a recording contract.

**Q: I sealed all 5 breaches with 0.6 seconds left. Is that good?**
A: That's the intended experience. Aarohan is conducted. Your cardiologist
disagrees.

**Q: Why does missing cost me accuracy but not cement?**
A: The cement is infinite. Your dignity is not.

**Q: The autopilot in the recording got 88% accuracy and still nearly lost.**
A: Correct. Even a Sam Boy with aim assist nearly failed the course. The dam
does not grade on a curve.

**Q: What did it cost to make this game?**
A: Everything. The fish took the rest.

---

*Built with concrete, canvas, and a healthy fear of water.*
*Athiradi khol de — but please, aim carefully.*
