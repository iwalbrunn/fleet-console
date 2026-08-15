# Design-Sync Notizen · fleet-console → „Nocturne Fleet Console"

- App-Repo, keine Komponenten-Library: kein Build-Entry, der Bundle-Entry
  wird aus `src/` synthetisiert (schwächere .d.ts-Verträge sind bekannt und
  akzeptiert). Der eigentliche DS-Wert ist `src/app/nocturne.css`
  (Tokens + Klassenvokabular .btn/.card/.chip/.input/.seg).
- Library-fähig sind nur `AgentGraph` und `AnswerView` (reine Props).
  Ausgeschlossen: `HooksView`, `RunsView` (fetchen ihre Daten von der
  App-API, rendern standalone leer), `LanguageSwitcher` (hängt am
  Next-Router über `@/i18n/routing`).
- Alle Komponenten lesen Texte über next-intl → Previews brauchen den
  `NocturneProvider` (.design-sync/preview-provider.tsx, via `extraEntries`
  ins Bundle, als `cfg.provider` um jede Vorschau gelegt; Sprache de).
- Chromium für den Render-Check: Playwright-Cache Build 1223
  (~/Library/Caches/ms-playwright) — Playwright-Version passend wählen.
