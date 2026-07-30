# 🎮 Tims Game Library

Eine browserbasierte Spielesammlung mit **Landing-Page, Login und
Multiplayer-Vorbereitung**. Alles läuft komplett im Browser
(HTML5 Canvas, Vanilla JS, keine Build-Tools) und wird als
Docker-Container deployt.

- **`index.html` – 🎮 Landing-Page „Tims Game Library"**: Login
  (Registrieren/Anmelden), Spielekacheln, aggregierte **Highscores** aus
  allen Spielen und der **Caterpillars-Multiplayer**-Bereich (Session
  erstellen/beitreten). Login, Sessions und Highscores laufen **vorerst
  komplett lokal** (localStorage) – die Logik ist in `js/lib.js`
  (`Auth`, `Scores`, `Net`) gekapselt, sodass später ein echter
  Railway-Backend-Dienst (feste Konten, gemeinsame Sessions) eingehängt
  werden kann, ohne die Spiele anzufassen.
- **`sail.html` – ⛵ Segelspiel** (siehe unten): physikalisch plausible
  Segelphysik, acht Boote, Regatta mit Bojen-Rundung.
- **`auto.html` – 🏎 Autorennen**: GTA2-artige Top-Down-Sicht durch eine
  Stadt, Driften über die Bremse, sieben Fahrzeuge (Sportwagen,
  Lamborghini, Motorrad, Muscle-Car, Kleinwagen, Krankenwagen, Feuerwehr),
  zwei Strecken (City-Rundkurs, Drift-Parcours), Rundenzeiten +
  Drift-Punkte, Bestzeit je Strecke/Auto.
- **`mtb.html` – 🚵 Mountainbike**: Top-Down-Parcours mit Rampen; über
  Sprünge Saltos (vor/zurück lehnen) und Spins (lenken) – sauber landen
  oder crashen. Drei Räder (Fully-MTB, BMX, Kinderrad), zwei Parcours
  (Waldstrecke, Jumphalle), Trickscore + Bestzeit, optionaler
  „Annoying-Mode“ (Gas durch Wackeln). Steuerung: linke Hälfte lenken +
  lehnen, rechte Hälfte Gas/Bremse.
- **`wurm.html` – 🐛 Raupen · Caterpillars**: rundenbasiertes
  Artillerie-Spiel mit kriechenden Raupen, zerstörbarem Gelände, Wind und
  vielen Waffen (inkl. Baseballschläger, Explosivschaf, Minigun,
  Scharfschütze mit kartenweitem Präzisionsschuss, Kaugummikanone, die
  Gegner für ihren nächsten Zug festklebt, 🍌 Bananenbombe mit fünf
  Filial-Bananen, ✈️ Luftangriff-Bombenteppich auf den anvisierten Punkt,
  🕳️ Maulwurfsbombe – Riesen-Krater, kaum Schaden –, 👉 Schubser für
  den sanften Stoß von der Kante, 🪢 Ninja-Seil zum Schwingen – ←/→
  schaukelt, ▲/▼ kürzt/verlängert, FEUER lässt los, kostet keinen Zug –,
  🥊 Feuerfaust-Uppercut und 🎌 Kamikaze); die 🚀 Panzerfaust segelt mit
  6-fachem Windeinfluss für Trickshots, Streubomben-Bomblets zünden direkt
  beim Aufprall. Dynamit mit 5-s-Lunte,
  4 s Rückzugszeit und manuellem Zünder. Die Raupen richten sich im Stand
  auf wie das Vorbild, kriechen mit Wellen-Gang und tragen Namens- und
  HP-Schilder in Teamfarbe über dem Kopf. Das Land reicht bis an die
  Kartenränder – seitlich prallt man an unsichtbaren Wänden ab, ins Wasser
  fällt nur, wer ein bis unten durchgesprengtes Loch erwischt. 2–6 Teams im
  Hotseat am selben Gerät **oder online** über Lobby/Code (ein Team pro
  Spieler), Querformat-Drehung.
- **`lemminge.html` – 🐭 Lemminge**: Puzzle im Stil des Genre-Klassikers
  (eigenständig umgesetzt). Kleine Kerlchen laufen stur los; per Fähigkeit
  (Kletterer, Schirm, Sprenger, Blocker, Bauer, Graben, Schräg-Graben,
  Buddler) lotst man genug von ihnen zum Ausgang. Zerstörbares Pixel-Gelände,
  vier Level.
- **`gorilla.html` – 🦍 Gorillas**: Bananen-Artillerie über einer
  zerstörbaren Skyline (Hommage an den QBasic-Urahn, eigenständig gebaut).
  Steinschleuder-Steuerung (ziehen &amp; loslassen), Wind, erschrockene
  Sonne; Hotseat oder gegen den Computer, der mit jedem Wurf besser zielt.
  3 Punkte gewinnen, nach jedem Treffer gibt es eine neue Stadt.
- **`mampf.html` – 🟡 Mampf**: Labyrinth-Fresser im Stil des
  Arcade-Urgesteins. Vier Geister mit eigenen Persönlichkeiten (Rufus, Rosa,
  Ziggy, Otto), Kraftpillen mit Geister-Kettenbonus, Tunnel, Level mit
  steigendem Tempo; Highscore zählt für die Bestenliste. Wisch-Steuerung
  auf dem Handy.
- **`maze.html` – 🧩 Super Maze**: prozedural generierte Labyrinthe mit
  Laternen-Nebel (nur die Umgebung ist sichtbar), 3 versteckten Sternen pro
  Level und Zeitlimit. Jedes Level wird größer; Punkte für Ankunft, Sterne
  und Restzeit.
- **`snake.html` – 🐍 Snake**: der Handy-Klassiker. Äpfel fressen, wachsen,
  immer schneller; Bonus-Kirsche alle 5 Äpfel; Modi „Wände tödlich" oder
  „Durchgang" (Wrap). Highscore für die Bestenliste.
- **`td.html` – 🏰 Tower Defense**: endlose Wellen auf einem
  Schlangenlinien-Parcours, drei Schwierigkeitsgrade, einundzwanzig Turmtypen
  (MG, Kanone, Granatkanone, Laser, Flammenwerfer mit Feuerkegel, Raketen,
  Vereiser, Blitzturm, Bestrahlungsturm mit permanenter panzerignorierender
  Verstrahlung, Anti-Boss-Railgun, Hypnoseturm, Fernsehturm (lenkt Zuschauer
  ab und hält sie fest, danach kurz immun), vier passive Buff-Türme
  (Auto-Lader mit Uranmunition/Treibladung, Starkstromaggregat für
  Blitz/Railgun/Laser, Chemiefabrik für Gift/Flammen, Sprengstofffabrik
  für Granaten/Raketen – je der beste Nachbar zählt; geboostete Türme
  tragen sichtbare Buff-Plaketten, gewählte Buff-Türme zeigen ihren
  3×3-Wirkungsbereich), Blitzturm lädt Getroffene statisch auf
  (3 s langsamer, +30% Kinetik-Schaden),
  Unwahrscheinlichkeitskanone, Giftschleuder, Windmaschine, Goldmine,
  Kommandozentrale),
  je vier Ausbaustufen – die letzte sündhaft teuer als Endgame-Goldsink.
  Nur die Kommandozentrale ist **endlos ausbaubar** (jede weitere Stufe
  wird extrem teuer, Nuke + Orbital-Laser wachsen mit); beide Superwaffen
  treffen Bosse 3-fach und ignorieren jede Panzerung.
  🧸 **Kids-Modus** (☰-Menü, gespeichert): alle Türme werden zu Spielzeug –
  Kartoffelkanone, Pupsmaschine, Riesenflitsche, Juckpulver-Werfer,
  Oma-Parfüm-Zerstäuber & Co., inklusive Spezialisierungen (aus der
  Taktischen Nuke wird die 🎊 Mega-Konfettibombe) und Hilfe-Tipps –
  reine Optik, identische Spielwerte.
  Abschüsse (Todesstoß-Regel) und Schaden werden pro Turm und Turmart
  gezählt; die 📊-Statistik im Menü zeigt den Turmarten-Vergleich, wer
  welche Monsterart erlegt hat und die Spiel-Historie: jedes Ergebnis
  (Game Over oder aufgegeben) wird mit Welle, Kills, Schaden und Top-Turm
  gespeichert – lokal und eingeloggt in der Datenbank (Slot td_history).
  Die jüngsten 12 Partien tragen ihre komplette Statistik mit sich
  (Turmarten-Tabelle + Kill-Matrix) und lassen sich in der Historie per
  Antippen aufklappen.
  Späte Wellen bringen Resistenzler (Feuer-, Laser- und Blitz-resistent),
  die einen Waffen-Mix erzwingen. Schadensarten + **Panzerung** (Kinetik/Laser
  knacken sie, Säurepfützen der Giftschleuder ätzen sie aktiv weg, die
  Kanonen-Hohlladung trifft sie ×4), pro Turm einmalige **Spezialisierungen** (Spezialmunition,
  Schaden-oder-Reichweite, mehr Kettenziele, breiterer Feuerkegel) und die
  Kommandozentrale (3 Stufen) schaltet **☢️ Nuke** und **🛰️ Orbital-Laser**
  frei (je 1× pro Welle, Upgrades machen beide stärker). Der Spielstand wird
  zwischen den Wellen automatisch gespeichert (eingeloggt auch in der
  Datenbank). Höchste Welle zählt für die Bestenliste.

Gemeinsame Struktur: jedes Spiel hat sein `js/<spiel>.js` und seine
`<spiel>.html`, teilt sich `style.css` und die „Spiel wechseln“-Navigation
(🏠 führt zurück zur Landing-Page). Neue Spiele lassen sich analog ergänzen.

---

## ⛵ Segelspiel

Ein browserbasiertes 2D-Segelspiel mit vereinfachter, aber physikalisch
plausibler Segelphysik.

## Spielprinzip

- Der Wind kommt aus einer Himmelsrichtung – einstellbar über die **Windrose**
  oben rechts (ziehen = Richtung, Abstand von der Mitte = Stärke). Optional
  wandert der Wind langsam von selbst.
- Das Boot ist in der Bildschirmmitte, die Welt bewegt sich darunter.
- Das Gewässer wird **prozedural generiert**. Im ☰-Menü wählbar: **See**
  (geschlossenes Ufer, einstellbare Seegröße) oder **offenes Meer**, jeweils
  mit Reglern für **Inseldichte** und **Inselgröße**; „Neue Karte“ erzeugt
  damit eine neue Welt. Mit Land kann man kollidieren – wer aufläuft, kommt
  über „⚓ Freikommen“ ein paar Bootslängen vor der Küste wieder frei
  (im Rennen kostet das 10 Strafsekunden, die auch das Geisterboot nach
  vorn springen lassen).
- **Sieben Bootstypen** (Dropdown im ☰-Menü): wendige, kipplige **Jolle**,
  ein großes, träges, schnelles **Kielboot** mit wenig Abdrift, eine
  gemütliche **Ketsch** (Zweimaster-Cruiser mit Kajüte; Besan läuft auf
  der Großschot, gutmütig steif und kentersicher), ein
  pfeilschneller **Katamaran**, der nur widerwillig wendet, die foilende
  **Moth** (hebt ab ~3 kn aus dem Wasser, Widerstand bricht ein – kentert
  aber blitzschnell nach Lee *und*, wenn beim Foilen der Segeldruck fehlt,
  nach Luv), ein **Piratenschiff** (Dreimaster mit 3×3 Rahsegeln und
  Vorsegeln; Rahen lassen sich nur begrenzt brassen – am Wind chancenlos,
  auf raumen Kursen majestätisch; **jedes der elf Segel wird einzeln
  getrimmt**, und statt Spinnaker gibt es „💥 Breitseite“: Kanonen nach
  beiden Seiten, deren Treffer **Krater in die Inseln sprengen**) und ein
  **Floß** mit absichtlich katastrophalen Segeleigenschaften.
- **Kentern**: Jolle, Katamaran und Moth gehen bei zu viel Krängung
  (Starkwind + zu dichte Schoten) um. „🔄 Aufrichten“ bringt das Boot
  wieder hoch – im Rennen für 10 Strafsekunden.
- **Spinnaker** (außer Floß): über den **Spi-Regler** neben den Schoten
  stufenlos setzen (hochziehen) und bergen (runterziehen); er steht nur bei
  achterlichem Wind. **Autotrim** stellt Schoten optimal und fährt den Spi
  automatisch je nach Kurs aus bzw. ein (mit Hysterese); manuelles Trimmen
  schaltet Autotrim ab.
- **Regattamodus** (🏁): über die Startlinie, drei nummerierte Bojen in
  Reihenfolge **umrunden** (echte Rundung über den überstrichenen
  Peilwinkel – geradeaus durch die Zone reicht nicht; ein goldener
  Fortschrittsbogen zeigt, wie viel Umlauf noch fehlt), zurück über die
  Ziellinie. Die Uhr startet beim
  Startlinien-Durchgang und stoppt im Ziel; **Bestzeiten** werden pro Karte
  und Bootstyp im Browser gespeichert. Der Kurs wird deterministisch aus dem
  Karten-Seed erzeugt (Bojen liegen immer im Wasser). Nummerierte **Pfeile am
  Bildschirmrand** zeigen zu allen ausstehenden Bojen; die Bestzeit-Fahrt
  wird aufgezeichnet und segelt beim nächsten Versuch als halbtransparentes
  **Geisterboot** mit.
- **Zoom** (＋/－ links bzw. Tasten `+`/`-`): herauszoomen, um Kurs, Ufer
  und Inseln zu überblicken.

## Steuerung (Touch, zwei Finger gleichzeitig möglich)

| Bereich | Geste | Wirkung |
|---|---|---|
| Linke Bildschirmhälfte | horizontal ziehen | Ruder (loslassen = mittschiffs) |
| Rechte Bildschirmhälfte | vertikal ziehen | beide Schoten: hoch = dichtholen, runter = fieren |
| Schot-Regler (unten rechts) | ziehen | Groß- und Fockschot einzeln trimmen |
| Windrose (oben rechts) | ziehen | Windrichtung + Windstärke |

Desktop: Pfeiltasten `←`/`→` Ruder, `↑`/`↓` beide Schoten; Maus funktioniert wie ein Finger.

## Physikmodell

Vereinfachtes, aber real begründetes Modell (siehe z. B. die üblichen
Lift/Drag-Ansätze für Segelphysik):

- **Scheinbarer Wind** = wahrer Wind − Bootsgeschwindigkeit; er treibt die Segel an.
- Groß- und Vorsegel stellen sich frei in die Anströmung, die **Schot begrenzt
  den Baumwinkel**. Aus dem Anstellwinkel α folgen Auftrieb `CL ≈ c·sin(2α)`
  (mit Strömungsabriss) und Widerstand `CD ≈ CD0 + k·sin²(α)`,
  Kraft = `½·ρ·A·C·v²`.
- Der Rumpf hat **geringen Längs- und hohen Querwiderstand** (Kielwirkung) –
  daraus ergeben sich Vortrieb und eine kleine realistische Abdrift.
- Direkt gegen den Wind gibt es keinen Vortrieb („im Wind“) – man muss kreuzen.
  Vor dem Wind treibt hauptsächlich der Widerstand das Boot (Segel weit fieren!).
- Krängung wird aus der Querkraft berechnet (aktuell nur visuell).

## Lokal starten

Der Node-Dienst liefert die Spiele **und** die API/WebSocket aus:

```bash
npm install
npm start
# -> http://localhost:8080
```

Ohne Datenbank läuft der Server im **In-Memory-Modus** (Konten/Highscores
gehen bei Neustart verloren), sonst sagt man ihm per `DATABASE_URL` eine
Postgres-Datenbank. Mit Docker:

```bash
docker build -t tims-game-library .
docker run --rm -p 8080:8080 tims-game-library
# -> http://localhost:8080
```

Rein statisch (nur die Spiele, ohne Login/Online) geht weiterhin, z. B.
`python3 -m http.server 8080 --directory public` – die Seite fällt dann
automatisch in den lokalen Offline-Modus (localStorage, Hotseat).

## Deployment auf Railway (sailinggame.conut.de)

1. Repo auf GitHub pushen (dieser Stand).
2. Auf [railway.com](https://railway.com): **New Project → Deploy from GitHub repo**
   → dieses Repo wählen. Railway erkennt das `Dockerfile` automatisch
   (zusätzlich per `railway.json` festgelegt) und startet den Node-Dienst.
3. **Postgres hinzufügen:** im Projekt **New → Database → Add PostgreSQL**.
   Railway legt die Variable `DATABASE_URL` an. Im Web-Service unter
   **Variables** sicherstellen, dass `DATABASE_URL` referenziert ist
   (`${{Postgres.DATABASE_URL}}`) – dann speichert der Server Konten,
   Tokens und Highscores dauerhaft. Die Tabellen legt er beim Start selbst an.
4. Im Service unter **Settings → Networking → Public Networking** eine Domain
   erzeugen (zum Testen) und dann **Custom Domain** `sailinggame.conut.de`
   hinzufügen.
5. Beim DNS-Anbieter von `conut.de` einen **CNAME**-Eintrag anlegen:
   `sailinggame` → auf den von Railway angezeigten Zielhost
   (z. B. `xyz.up.railway.app`). Railway stellt das TLS-Zertifikat automatisch aus.
6. `PORT` setzt Railway selbst; der Server liest sie. Solange keine
   `DATABASE_URL` gesetzt ist, läuft alles trotzdem (nur nicht persistent).

## Struktur

```
server/            Node-Backend (Express + ws + pg)
  index.js         HTTP/REST, statische Dateien, WebSocket-Aufhängung
  db.js            Speicher: Postgres oder In-Memory (Konten, Tokens, Scores)
  rooms.js         Caterpillar-Sessions: Lobby + Relay (host-autoritativ)
package.json       Node-Manifest (npm start -> server/index.js)
public/            statische Spielesammlung
  index.html       🎮 Landing-Page (Login, Highscores, Multiplayer)
  sail.html        ⛵ Segeln
  auto.html        🏎 Autorennen
  mtb.html         🚵 Mountainbike
  wurm.html        🐛 Raupen · Caterpillars (inkl. Online-Lobby)
  lemminge.html    🐭 Lemminge (Puzzle)
  gorilla.html     🦍 Gorillas (Bananen-Artillerie)
  mampf.html       🟡 Mampf (Labyrinth-Arcade)
  maze.html        🧩 Super Maze (prozedurale Labyrinthe)
  snake.html       🐍 Snake (Klassiker)
  style.css
  js/
    lib.js         Auth + Scores (Server mit localStorage-Fallback)
    landing.js     Landing-Page: Login-UI, Highscores/Bestenliste
    netclient.js   kleiner WebSocket-Client für Online-Sessions
    main.js        Segeln: Spielschleife, Eingabe, Kollision
    boat.js        Segeln: Bootsphysik + Windmodell + Bootstypen
    race.js        Segeln: Regattakurs, Zeitnahme, Bestzeiten
    terrain.js     Segeln: prozedurales Gelände (Value-Noise)
    render.js      Segeln: Canvas-Rendering, Windrose, HUD
    util.js        Segeln: Vektor-/Winkel-Helfer
    auto.js        Autorennen (komplett in einer Datei)
    mtb.js         Mountainbike (komplett in einer Datei)
    wurm.js        Raupen · Caterpillars + Online-Netzcode
    lemminge.js    Lemminge (Pixel-Gelände, Lauf-KI, Fähigkeiten, Level)
    gorilla.js     Gorillas (Skyline-Maske, Wurfphysik, Computer-Gegner)
    mampf.js       Mampf (Labyrinth, Geister-KI, Highscore)
    maze.js        Super Maze (Backtracker-Generator, Nebel, Sterne)
    snake.js       Snake (Grid, Wachstum, Bonus, zwei Modi)
Dockerfile
railway.json
```

## Tests

`npm test` führt die komplette Suite aus (`test/run-all.mjs`):

- **`test/api.test.mjs`** – Backend-API: Konten (Registrierung mit
  Proof-of-Work, Login, Honeypot), Scores + Top-10-Bestenliste,
  Spielstand- und Historien-Slots, Auth-/Validierungs-Wächter.
- **`test/landing.test.mjs`** – Landing-Page im Headless-Browser:
  Datenbank-Warnbanner im In-Memory-Modus, aufklappbare Top-10-Liste.
- **`test/td.test.mjs`** – Tower Defense komplett (95+ Checks) über den
  Test-Hook `window.__td`: Spezialisierungen, Flammen-/Strahlenkegel,
  Superwaffen, Windmaschinen-Regel, Querformat-Eingaben, Stufe-4-Ausbau,
  Resistenzen, Railgun/Hypnose, Fernsehturm, Kids-Modus,
  Abschuss-/Schadenszähler, Statistik, Spiel-Historie und der
  Spielstand-Roundtrip über einen Seiten-Reload.

Jede Datei startet ihren eigenen Server (In-Memory, `POW_BITS=4`) auf einem
zufälligen Port und einen Headless-Chromium via Playwright. Playwright wird
als npm-Paket aufgelöst; ist keines installiert, greifen die Systempfade der
Entwicklungs-Umgebung. Eigener Browser-Pfad: `TEST_CHROMIUM=/pfad/zu/chromium`.

## Persistenz auf Railway (wichtig!)

Der Server speichert **nur dann dauerhaft**, wenn die Umgebungsvariable
`DATABASE_URL` gesetzt ist. Ohne sie läuft er im **In-Memory-Modus**: alles
Serverseitige (Konten, Logins, Server-Spielstände, Spiel-Historie, Forum,
Bestenliste) geht bei **jedem Deploy oder Neustart verloren** – die
Landing-Page zeigt dann ein ⚠️-Warnbanner, und `/api/health` antwortet mit
`"store": "memory"` statt `"store": "postgres"`.

Einrichtung auf Railway:

1. Im Projekt **„+ New“ → „Database“ → „Add PostgreSQL“** hinzufügen.
2. Im Spiel-Service unter **Variables** eine Variable `DATABASE_URL` anlegen
   und als Wert die Referenz `${{Postgres.DATABASE_URL}}` eintragen (Railway
   bietet die Referenz beim Tippen an).
3. Redeploy. Im Deploy-Log muss `Speicher: postgres` stehen, und
   `https://<domain>/api/health` liefert `{"ok":true,"store":"postgres"}`.

Die Tabellen legt der Server beim Start selbst an (`CREATE TABLE IF NOT
EXISTS`), eine Migration ist nicht nötig. Lokale Browser-Daten (eigene
Bestwerte, lokaler Spielstand) sind davon unabhängig und bleiben immer.

## Multiplayer / Backend

Der Node-Dienst bietet:

- **Konten** (`/api/register`, `/api/login`, `/api/me`, `/api/logout`):
  feste Benutzerkonten, Passwörter mit scrypt gehasht, Bearer-Token.
- **Community** (`/api/forum/*`, `/api/feedback`, Seite `forum.html`):
  Forum (Themen + Antworten) und Feedback-Formular, beides **nur für
  eingeloggte Nutzer** (401 ohne Token) und mit Schreib-Rate-Limit.
  Feedback sieht jeder Nutzer nur von sich selbst; Admins (Namen in der
  Env-Variable `ADMIN_USERS`, kommasepariert) sehen alle Einsendungen.
  Rendering strikt über textContent -> kein XSS über Beiträge.
- **Spam-/Bot-Schutz** (`server/security.js`): Die Registrierung verlangt einen
  **Proof-of-Work** (SHA-256 mit führenden Null-Bits – im Browser < 1 s, für
  Massen-Bots teuer; per `POW_BITS` einstellbar), plus ein **Honeypot**-Feld
  und **Rate-Limits pro IP** (Registrieren 6/10 min, Login 12/5 min,
  Challenge 40/5 min). Login gleicht die Antwortzeit für unbekannte Namen an
  (kein User-Enumeration), der Chat und das Eröffnen von Runden haben eine
  Flut-Bremse. Dazu ein paar Sicherheits-Header (`nosniff`, `X-Frame-Options`
  usw.). Für stabile Challenges über Neustarts hinweg optional `APP_SECRET`
  als Env setzen.
- **Highscores** (`/api/scores`, `/api/leaderboard`): die Spiele speichern
  ihre Bestwerte weiterhin lokal; nach dem Login lädt die Landing-Page sie
  hoch und zeigt eine globale Bestenliste.
- **Spielstände** (`/api/save/:game`, ein Slot pro Nutzer und Spiel, nur
  eingeloggt): Tower Defense sichert zwischen den Wellen automatisch –
  immer lokal (localStorage) und zusätzlich in der Datenbank, sodass der
  Spielstand auf anderen Geräten weiterläuft. `data: null` löscht den Slot
  („Neues Spiel"/Game Over).
- **Caterpillar-Online-Sessions** über WebSocket (`/ws`): der **Host
  simuliert autoritativ** und schickt ~20×/s Snapshots (Würmer, Projektile,
  Wind, Zug, sowie Krater-Ereignisse fürs zerstörbare Gelände). Gäste
  erzeugen aus dem gemeinsamen Seed dasselbe Gelände und schicken nur ihre
  Eingaben, wenn sie am Zug sind. Der Server ist dabei reiner Relay +
  Session-Register (Räume sind flüchtig).
- **Open-Games-Browser & Chat**: eingeloggte Spieler sehen offene Runden
  live, eröffnen selbst welche (mit oder ohne **Passwort**) und treten per
  Klick oder Code bei. Ein kleiner **Ingame-Chat** (WebSocket-Relay) läuft in
  Lobby und Match; eingehende Nachrichten erscheinen als kurze Toasts.
- **Robuste Verbindung**: Ein App-Ping alle 20 s hält die WebSocket-Verbindung
  frisch (Proxys kappen sie sonst bei Inaktivität, z. B. während ein Mitspieler
  überlegt). Räume **überleben kurze Abbrüche** – wer rausfliegt (auch der Host)
  verbindet sich automatisch neu und bekommt Platz und Host-Rolle zurück; eine
  verwaiste Runde wird erst nach 30 min entsorgt. So kann eine Partie über
  Stunden laufen.

Der Ablauf: Auf der Landing-Page **Online-Lobby öffnen** (nur für angemeldete
Spieler) oder direkt mit **Code beitreten** → die Lobby läuft in `wurm.html`
(eine WebSocket-Verbindung bleibt vom Browser über die Lobby bis ins Match
bestehen). Der Host startet, sobald alle da sind. Ohne erreichbaren Server
fällt alles automatisch auf den lokalen Offline-Modus zurück
(localStorage-Konten, Hotseat am selben Gerät).

## Ideen für später

- Weitere Bootstypen (`BOAT_TYPES` in `boat.js`: Masse, Segelflächen,
  Widerstände, Drehfreudigkeit, Steifigkeit pro Typ).
- Echte Bojen-Rundung (Seite vorgeben), Strafen, Geisterboot der Bestzeit.
- Wenden/Halsen-Feedback, Sound. (Mehrspieler, Login & Bestenlisten sind für
  Caterpillars umgesetzt – als Nächstes ließe sich das auch auf die anderen
  Spiele ausweiten, z. B. Live-Rennen.)
