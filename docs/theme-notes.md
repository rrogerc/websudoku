# Theme palettes — the research behind them

Why the extra themes in `src/style.css` look the way they do. Compiled July 2026
from a literature sweep (color-emotion psychology, display ergonomics, and the
palettes of field-tested long-session apps). Confidence labels are honest:
solid / weak / debunked.

## What actually matters (solid findings)

- **Lightness and saturation drive emotion far more than hue.** Valdez &
  Mehrabian (1994, *JEP: General*): pleasure ≈ 0.69·brightness + 0.22·saturation;
  arousal ≈ 0.60·saturation − 0.31·brightness. A soothing background is
  therefore **bright and barely saturated**; which pastel you pick is mostly
  taste. This is the single load-bearing result for the light themes
  (all sit at ~93–95% lightness, ≤ ~30% HSL saturation).
- **Hue preference: blue/blue-green/green peak, yellow-green troughs** —
  cross-culturally stable (Palmer & Schloss 2010 PNAS ecological valence theory,
  ~80% variance explained; Sorokowski et al. 2014). Hence Sage/Sky lead the
  lineup and nothing sits in chartreuse territory.
- **Dark-digits-on-light beats light-on-dark for legibility** at every age
  (Piepenbrock et al. 2013 *Ergonomics*, acuity η²=0.30). Mechanism is pupil
  constriction from overall luminance (Buchner, Mayr & Brandt 2009). Dark
  themes are a low-ambient-light/preference accommodation, not an upgrade.
- **Never pure white, never pure black.** #FFF over-shoots room luminance
  (glare over long sessions; Kwallek's office studies also found more errors in
  stark white rooms); #000 gives OLED scroll-smear and halation. Industry
  convergence agrees: Kindle sepia #FBF0D9, Apple Books sepia #F8F1E3, Solarized
  #FDF6E3, Gruvbox #FBF1C7 — four independent "stare at it all day" palettes
  landed on warm cream at 90–92% lightness (that cluster is the Sepia theme);
  Apple Books Night/Material dark landed on #121212-ish charcoal.
- **Evening circadian load is set by melanopic (short-wavelength ~480nm) dose.**
  Warming hue at constant brightness cuts melanopic ~40% (blue-depleted
  spectra: melatonin suppression 56.5% → 24.6%); dimming cuts it ~linearly —
  you need both (Night Shift-style tint-only shows little measured sleep
  benefit). That's Ember: warm near-black everywhere **including the entry
  digits** (amber, not blue — saturated blue is the worst melanopic offender
  and pure blue on near-black also fails contrast at ~2.1:1).

## Weak / context-only (not design drivers)

- "Red = detail, blue = creativity" (Mehta & Zhu 2009 Science): failed to
  cleanly replicate (Xia et al. 2016). Ignored.
- "Green restores attention": the restoration evidence (Lee et al. 2015,
  attention restoration theory) is about *nature scenes*, not flat green fills.
  Sage earns its slot on preference/arousal grounds only.
- Red + fast tempo speeds up gambling (Spenwyn et al. 2010, small pilot):
  arousal-based "engagement" is the opposite of calm long sessions — one more
  reason no theme has a red/orange field.

## Debunked (kept out on purpose)

- **Baker-Miller "drunk-tank" pink calms people** — replications failed
  (Gilliam & Unruh 1988; Genschow et al. 2015). Blush is here because pale
  warm rose is *pleasant* (high lightness, low saturation), not because pink
  is magic.
- **"Red makes you dumber"** (Elliot et al. 2007): meta-analytically null after
  publication-bias correction (Gnambs 2020, 4/4 direct replications null).
  Red backgrounds are avoided for arousal, not IQ.

## Palette rules used (all themes WCAG-checked via script)

- Light themes: page ~93–95% L, ≤ ~30% S; board a near-white of the same hue
  (the tint lives on the page, the reading plane stays bright).
- Dark themes: page ~8–12% L low-chroma (never #000), board one step lighter,
  givens off-white (never #FFF), entries lightened to keep ≥ 7:1.
- Checked pairs (scratchpad script, WCAG relative luminance): givens/board
  ≥ 13:1, entries/board ≥ 5:1 (original light theme is 3.84:1 — every new
  theme beats it), pencil/board ≥ 4.4:1, text/page ≥ 10:1, links/page ≥ 4.4:1,
  box borders/board ≥ 3:1 (SC 1.4.11).
- Auto stays a two-way OS follow between the classic pair; the other themes
  are explicit picks.
