# ⛵ Segelspiel

Ein browserbasiertes 2D-Segelspiel mit vereinfachter, aber physikalisch
plausibler Segelphysik. Läuft komplett im Browser (HTML5 Canvas, Vanilla JS,
keine Build-Tools) und wird als Docker-Container deployt.

## Spielprinzip

- Der Wind kommt aus einer Himmelsrichtung – einstellbar über die **Windrose**
  oben rechts (ziehen = Richtung, Abstand von der Mitte = Stärke). Optional
  wandert der Wind langsam von selbst.
- Das Boot ist in der Bildschirmmitte, die Welt bewegt sich darunter.
- Der See mit Ufer und Inseln wird **prozedural generiert** („Neue Karte“
  erzeugt eine neue Welt). Mit Land kann man kollidieren.
- **Vier Bootstypen** (umschaltbar): wendige, kipplige **Jolle**, ein großes,
  träges, schnelles **Kielboot** mit wenig Abdrift, ein pfeilschneller
  **Katamaran**, der nur widerwillig und unter großem Fahrtverlust wendet,
  und ein **Floß** mit absichtlich katastrophalen Segeleigenschaften
  (driftet quer, geht kaum an den Wind, kein Spinnaker).
- **Spinnaker** (außer Floß): per Button setzen/bergen, steht nur bei
  achterlichem Wind. **Autotrim** stellt Schoten optimal und setzt/birgt
  den Spi automatisch je nach Kurs (mit Hysterese).
- **Regattamodus** (🏁): über die Startlinie, drei nummerierte Bojen in
  Reihenfolge anlaufen, zurück über die Ziellinie. Die Uhr startet beim
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

Ohne Docker (irgendein statischer Server, z. B.):

```bash
npx serve public
# oder: python3 -m http.server 8080 --directory public
```

Mit Docker:

```bash
docker build -t sailing-game .
docker run --rm -p 8080:8080 sailing-game
# -> http://localhost:8080
```

## Deployment auf Railway (sailinggame.conut.de)

1. Repo auf GitHub pushen (dieser Stand).
2. Auf [railway.com](https://railway.com): **New Project → Deploy from GitHub repo**
   → dieses Repo wählen. Railway erkennt das `Dockerfile` automatisch
   (zusätzlich per `railway.json` festgelegt).
3. Im Service unter **Settings → Networking → Public Networking** eine Domain
   erzeugen (zum Testen) und dann **Custom Domain** `sailinggame.conut.de`
   hinzufügen.
4. Beim DNS-Anbieter von `conut.de` einen **CNAME**-Eintrag anlegen:
   `sailinggame` → auf den von Railway angezeigten Zielhost
   (z. B. `xyz.up.railway.app`). Railway stellt das TLS-Zertifikat automatisch aus.
5. Der Container liest die von Railway gesetzte `PORT`-Variable automatisch
   (nginx-Template), es ist keine weitere Konfiguration nötig.

## Struktur

```
public/            statisches Spiel
  index.html
  style.css
  js/
    main.js        Spielschleife, Eingabe, Kollision
    boat.js        Bootsphysik + Windmodell + Bootstypen
    race.js        Regattakurs, Zeitnahme, Bestzeiten
    terrain.js     prozedurales Gelände (Value-Noise)
    render.js      Canvas-Rendering, Windrose, HUD
    util.js        Vektor-/Winkel-Helfer
nginx/             nginx-Template (nutzt $PORT von Railway)
Dockerfile
railway.json
```

## Ideen für später

- Weitere Bootstypen (`BOAT_TYPES` in `boat.js`: Masse, Segelflächen,
  Widerstände, Drehfreudigkeit, Steifigkeit pro Typ).
- Echte Bojen-Rundung (Seite vorgeben), Strafen, Geisterboot der Bestzeit.
- Wenden/Halsen-Feedback, Sound, Mehrspieler, Login & Bestenlisten.
