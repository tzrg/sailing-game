# Tims Game Library – Hinweise für die Entwicklung

## Tests: vor jedem Push selbst ausführen!

Es gibt keine CI – die Suite muss lokal laufen, bevor gepusht wird:

```
npm test
```

Das startet `test/run-all.mjs` (API, Landing-Page, Tower Defense; jede Datei
fährt ihren eigenen Server + Headless-Chromium hoch, Details im README unter
„Tests“). Erst pushen, wenn alle Dateien grün sind. Neue Features bekommen
ihre Checks in der passenden Datei unter `test/` (Spiellogik von Tower
Defense über den Hook `window.__td` in `test/td.test.mjs`).

## Architektur-Kurzüberblick

- Vanilla-JS-Spiele in `public/` (je `<spiel>.html` + `js/<spiel>.js`,
  gemeinsames `style.css`), keine Build-Tools.
- Backend `server/index.js` (Express + ws): Auth mit Proof-of-Work,
  Highscores/Bestenliste, Spielstand-Slots (`/api/save/:game`), Forum,
  Caterpillar-WebSocket. Speicher: Postgres über `DATABASE_URL`, sonst
  In-Memory (dann warnt die Landing-Page).
- Deployment: Railway (Docker, kopiert nur `server/` + `public/`).

## Konventionen

- Kommentare und UI-Texte auf Deutsch, Codestil wie der Bestand.
- Temporäre Skripte/Screenshots gehören ins Scratchpad, nicht ins Repo.
