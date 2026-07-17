# 🎮 Spielesammlung (Segeln · Auto · MTB)

Drei browserbasierte Top-Down-Spiele, umschaltbar über das ☰-Menü
(Abschnitt „Spiel wechseln“). Alles läuft komplett im Browser
(HTML5 Canvas, Vanilla JS, keine Build-Tools) und wird als
Docker-Container deployt. Jedes Spiel ist eine eigene Seite:

- **`index.html` – ⛵ Segelspiel** (siehe unten): physikalisch plausible
  Segelphysik, sieben Boote, Regatta mit Bojen-Rundung.
- **`auto.html` – 🏎 Autorennen**: GTA2-artige Top-Down-Sicht durch eine
  Stadt, Driften über die Bremse, drei Autos (Sportwagen, Muscle-Car,
  Kleinwagen), zwei Strecken (City-Rundkurs, Drift-Parcours),
  Rundenzeiten + Drift-Punkte, Bestzeit je Strecke/Auto.
- **`mtb.html` – 🚵 Mountainbike**: Top-Down-Parcours mit Rampen; über
  Sprünge Saltos (vor/zurück lehnen) und Spins (lenken) – sauber landen
  oder crashen. Drei Räder (Fully-MTB, BMX, Kinderrad), zwei Parcours
  (Waldstrecke, Jumphalle), Trickscore + Bestzeit, optionaler
  „Annoying-Mode“ (Gas durch Wackeln). Steuerung: linke Hälfte lenken +
  lehnen, rechte Hälfte Gas/Bremse.

Gemeinsame Struktur: jedes Spiel hat sein `js/<spiel>.js` und seine
`<spiel>.html`, teilt sich `style.css` und den ☰-Menü-Rahmen. Neue Spiele
lassen sich analog ergänzen und in die „Spiel wechseln“-Navigation
aufnehmen.

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
public/            statische Spielesammlung
  index.html       ⛵ Segeln
  auto.html        🏎 Autorennen
  mtb.html         🚵 Mountainbike
  style.css
  js/
    main.js        Segeln: Spielschleife, Eingabe, Kollision
    boat.js        Segeln: Bootsphysik + Windmodell + Bootstypen
    race.js        Segeln: Regattakurs, Zeitnahme, Bestzeiten
    terrain.js     Segeln: prozedurales Gelände (Value-Noise)
    render.js      Segeln: Canvas-Rendering, Windrose, HUD
    util.js        Segeln: Vektor-/Winkel-Helfer
    auto.js        Autorennen (komplett in einer Datei)
    mtb.js         Mountainbike (komplett in einer Datei)
nginx/             nginx-Template (nutzt $PORT von Railway)
Dockerfile
railway.json
```

## Ideen für später

- Weitere Bootstypen (`BOAT_TYPES` in `boat.js`: Masse, Segelflächen,
  Widerstände, Drehfreudigkeit, Steifigkeit pro Typ).
- Echte Bojen-Rundung (Seite vorgeben), Strafen, Geisterboot der Bestzeit.
- Wenden/Halsen-Feedback, Sound, Mehrspieler, Login & Bestenlisten.
