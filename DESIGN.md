---
version: alpha
name: Fleet Console (Nocturne)
description: Kontrollraum-Oberfläche der Fleet Console (Next.js 16, reines CSS). Dunkler Grund, Inter 500, Cyan als Linie und Signal statt Fläche, kompakte Dichte. Prosa-Leitfaden in DESIGNSYSTEM.md, Token-Quelle src/app/nocturne.css.
colors:
  bg: "#061018"
  surface: "#0D1B26"
  text: "#E8F7FB"
  accent: "#32D5FF"
  accent-2: "#6FE7C8"
  accent-300: "#84E9FF"
  accent-600: "#11AFD8"
  neutral-100: "#F1FBFE"
  neutral-300: "#BAD5DD"
  neutral-500: "#6F919D"
  neutral-700: "#38515B"
  neutral-900: "#142730"
  warn: "#C8A06A"
  warn-text: "#E2C79B"
  error: "#B4545A"
  error-text: "#F0C8CA"
  error-soft: "#E08C92"
  ok: "#6F7F6A"
  code-bg: "#050D14"
  section: "#262A60"
  bg-light: "#F2F3F8"
  surface-light: "#FFFFFF"
  text-light: "#23252F"
  accent-light: "#6F61BD"
  warn-light: "#A87B3E"
  ok-light: "#5D7A56"
  code-bg-light: "#EEF0F6"
typography:
  h1:
    fontFamily: Inter
    fontSize: 42px
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: -0.015em
  h2:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.12
  h3:
    fontFamily: Inter
    fontSize: 25px
    fontWeight: 500
  h4:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 500
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
  dense:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
  meta:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 400
  kicker:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 500
    letterSpacing: 0.1em
rounded:
  sm: 4px
  md: 10px
  lg: 18px
spacing:
  1: 2.8px
  2: 5.6px
  3: 8.4px
  4: 11.2px
  6: 16.8px
  8: 22.4px
components:
  btn-primary: { border: accent, color: accent, rounded: md, fontSize: control }
  btn-secondary: { border: neutral-700, color: text, rounded: md }
  btn-ghost: { color: accent }
  card: { background: surface, rounded: md, shadow: sm }
  card-kicker: { color: neutral-500, fontSize: kicker }
  tag-accent: { color: accent-300, fontSize: meta }
  tag-accent-2: { color: accent-2, fontSize: meta }
  input: { background: bg, border: neutral-700, rounded: md, fontSize: control }
  table-head: { color: neutral-500, fontSize: meta }
  dialog: { background: surface, rounded: lg, shadow: lg }
  nav: { background: surface, color: text }
  code: { background: code-bg, fontSize: dense }
  state-warn: { color: warn-text, background: warn }
  state-error: { color: error-text, background: error }
  state-ok: { color: ok }
  section-divider: { background: section }
  focus-ring: { color: accent }
---

## Overview
Interne Kommandozentrale für Agenten-Sessions: Live-Feed, Agenten-Graph,
Rollen-Läufe, Quota. Dark-first, ruhig, dicht (Spacing-Skala mit Dichte
0,7×), Inter durchgehend in Gewicht 500 für Überschriften. Cyan ist Signal
(Linien, Marken, Fokus, Glow), niemals Fläche. Glas-Panels über der Bühne
sind hier Systemvorgabe. Deutsch/Englisch über `next-intl`; Ton knapp,
technisch. Der ausführliche Leitfaden steht in `DESIGNSYSTEM.md`.

## Colors
- **Grund** `bg` → `surface`; Text `text`; Trennlinien `--color-divider`
  (16 % Text). Tonale Rampen 100–900 für neutral, accent, accent-2 in OKLCH
  auf gemeinsamer Helligkeitsskala; dunkle Stufen für Tints/Ränder, Basis für
  Signale, helle Stufen für Text.
- **Akzent** `accent` Cyan für Links, Outline-Buttons, Fokus, HUD-Linien;
  `accent-2` Mint ausschließlich für „online/gesund". Für Fließtext im Akzent
  `accent-300`, weil das Paar accent/bg nur 3:1 erreicht.
- **Zustände** `warn`/`warn-text`, `error`/`error-text`/`error-soft`, `ok`,
  `code-bg`; Overlay/Glass/HUD-Tokens (`--color-overlay`, `--glass-bg`,
  `--glass-border`, `--hud-line`, `--topbar-bg-1/2`, `--shadow-ambient`).
- **Section-Indigo** (`section`, `-glow`, `-ghost`) nur für Deck-Trenner und
  das Stat-Band, nie in der Konsolen-UI.
- **Light Theme** rebindet jedes Token unter `:root[data-theme='light']` und
  identisch unter `@media (prefers-color-scheme: light)`; Rampen kippen,
  Akzent wird Violett `accent-light`. Beide Blöcke müssen identisch bleiben.
  Wahl in `localStorage['fleet.theme']`, vor First Paint gesetzt;
  `AgentGraph` liest Tokens per `getComputedStyle`.
- Kein reines Schwarz/Weiß außer als Schatten-Ambient.

## Typography
- **Inter** 400/500/600/700, Überschriften immer 500 (`--font-heading-weight`);
  Hierarchie über Größe und Raum, nicht über Fettdruck.
- Skala: 42/32/25/20/16/13 px für h1–h6 (h6 versal 0.08em), Body 15/1.55,
  Controls und Tabellen 14, dichte Zeilen 13, Meta 11, Kicker 10 versal.
  In der Konsole selbst dominieren 11–13 px (`globals.css`).
- Versal-Kicker (`card-kicker`, `table th`, `h6`) tragen Rubrik oder
  Spaltenkopf. `.mono` für IDs, Zeiten, Code.
- **Altlast:** `nocturne.css` lädt Inter per Google-Fonts-`@import`. Für
  intern-lokale Nutzung toleriert; vor jeder externen Veröffentlichung auf
  self-hosted Inter (wie FF Erding) umstellen.

## Layout
- Shell: `topbar` (Glas, zwei Tonstufen), `sidebar` (Sessions), `stage`
  (Graph), `split` mit `resizer`, `drawer` rechts für Details. Body
  `overflow: hidden`, jede Region scrollt selbst.
- Linksbündig, asymmetrisch; Weißraum rechts. Abstände nur aus `--space-1…8`.
- Listen dicht als `row`/`feedrow`/`runrow`; Tabellen als `.table` mit
  versalem Kopf. Bühne mit subtilem Raster (4-px-Linien, 1,8 % Text).

## Elevation & Depth
- Drei Stufen `--shadow-sm/md/lg`: Hairline-Kante plus Ambient-Dunkel; im
  Light Theme tintenfarbene Schatten aus `--shadow-ambient` per `color-mix`.
  Keine gestapelten schweren Schatten.
- Glas (`glass-bg` + `glass-border`, `backdrop-filter`) für Topbar, Drawer,
  Node-Panel — transparent genug für Hierarchie, opak genug für Text.
- Freistehende Linien (`.hr`) laufen an beiden Enden aus (48 px), Rahmen
  bleiben solide.

## Shapes
- Radien 4 (Tags, kleine Chips), 10 (Buttons, Inputs, Karten), 18 (Dialoge,
  Panels). Radio-Punkte rund. Kein `rounded-full` auf Buttons.
- Primär-Buttons sind **Outline** (1 px Akzent auf transparent), nie gefüllt.

## Components
Tokens und Systemklassen in `src/app/nocturne.css`, App-Klassen in
`src/app/globals.css`, React in `src/components/`:
- System: `btn` (`-primary|-secondary|-ghost|-icon|-block`), `tag`
  (`-accent|-accent-2|-neutral|-outline`), `field`/`input`/`radio`/`seg`+
  `seg-opt`, `card` (`-kicker|-title|-body|-meta`) + `elev-sm|md|lg`,
  `nav`/`nav-brand`, `table`, `dialog`(`-backdrop|-title|-body|-actions`),
  `hr`, `lighten` (Bild-Blend), `text-muted`.
- App: `shell`, `topbar`, `sidebar`, `stage`, `split`/`resizer`, `drawer`
  (`-backdrop|-links|-rechts`), `toolbar`, `feed`/`feedrow`/`feedagent`/
  `feedtime`, `nodebar`/`nodecard`, `runrow`, `rolerow`, `hud-stat`/`hud-mode`,
  `chip`, `pill`, `switch`/`switchrow`, `banner`, `warnbox`, `codebox`,
  `fragebox`/`antwortzeile`, `core-orb`, `system-online`, `brandmark`, `mono`,
  `muted`, `truncate`, `leer` (Leerzustand).
- React: `Topbar`, `ThemeSwitcher`, `LanguageSwitcher`, `SessionSidebar`,
  `SessionFeed`, `AgentGraph` (Canvas, liest Tokens), `NodeDetailPanel`,
  `RunsView`, `RoleRunCard`, `AnswerView`, `QuotaCard`.
- Icons: Phosphor (Linie, eine Strichstärke). Bilder durch `.lighten`,
  bevorzugt auf dunklem Grund fotografiert.
- Zustände eingebaut: Hover/Pressed aus der Akzent-Rampe, `:focus-visible`
  2 px Akzent, Disabled 45 % Opazität, `::selection` Akzent-Tint. Nicht pro
  Seite neu stylen.

## Do's and Don'ts
- Do: jede Farbe/Größe aus Tokens, Light und Dark parallel pflegen (beide
  Blöcke identisch), Leerzustände (`leer`) mit Handlung, `.mono` für Daten,
  Dichte beibehalten, Screenshot in beiden Themes vor Abnahme.
- Don't: Akzent als Fläche, gefüllte Primär-Buttons, Headings über 500,
  reines Schwarz/Weiß, schwere Schatten, `--color-section` in der UI, Emoji,
  neue Hex-Werte in Komponenten, Glas auf Inhaltskarten (nur Chrome/Panels),
  Bewegung ohne Zustandswechsel (`nfPulse`/`nfBlink` nur für Live-Status).
- Katalog: `~/.claude/skills/design-system/references/anti-ki-look.md`.
  Glas, Cyan-Glow und dichte Versal-Kicker sind hier Systemvorgabe, keine Tells.
