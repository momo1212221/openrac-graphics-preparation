# Graphics preparation – Anleitung

Diese Anleitung beschreibt die normale Nutzung von **Graphics preparation 0.21.2** mit dem aktuellen **OpenRAC Dev Launcher**.

Graphics preparation verarbeitet von OpenRAC gespeicherte Spieltexturen lokal mit Real-ESRGAN und erzeugt daraus ein hochauflösendes Texture-Pack. Für den normalen **Texture-AI-Lauf** werden kein eigener Launcher, kein Python-Helper und kein externes Upscaler-Programm benötigt. Der neue optionale **3D Geometry Enhancement**-Pfad nutzt den mitgelieferten Python-Helper ausschließlich für OpenRACs offiziellen glTF-Export/Import über `editor/assets.py`.

Repository: https://github.com/momo1212221/openrac-graphics-preparation

## 1. Voraussetzungen

Du brauchst:

- den aktuellen OpenRAC Dev Launcher;
- den Mod `Graphics preparation`;
- genügend freien Speicherplatz für die erzeugten Texturen;
- optional eine GPU mit WebGPU-Unterstützung für deutlich schnellere AI-Verarbeitung.

Wenn WebGPU nicht verfügbar ist oder fehlschlägt, kann der Mod automatisch auf WASM/CPU zurückfallen.

## 2. Mod installieren

1. Lade die aktuelle Release-ZIP von Graphics preparation herunter.
2. Die Datei heißt ungefähr `graphics-preparation-0.21.2.zip`.
3. Öffne OpenRAC.
4. Gehe zu **Mods -> Add a mod**.
5. Wähle die ZIP-Datei aus.
6. Aktiviere **Graphics preparation**, falls OpenRAC den Mod nicht automatisch aktiviert.

## 3. Spieltexturen erfassen

Bevor der AI-Upscaler arbeiten kann, muss OpenRAC die verwendeten Texturen speichern.

1. Öffne **Models and textures**.
2. Aktiviere **Save the game's textures while you play**.
3. Starte das Spiel.
4. Spiele die Level und Bereiche, deren Texturen du verbessern möchtest.

Nur Texturen, die OpenRAC tatsächlich gesehen und gespeichert hat, können anschließend verarbeitet werden. Für einen möglichst vollständigen Planet- oder Level-Pack solltest du den betreffenden Bereich einmal vollständig durchspielen beziehungsweise besuchen.

## 4. Graphics preparation öffnen

Kehre nach dem Erfassen der Texturen zum Launcher zurück und öffne **Graphics preparation**.

Der Mod durchsucht die gespeicherten OpenRAC-Texturen automatisch.

Wenn keine Texturen gefunden werden, prüfe zuerst, ob **Save the game's textures while you play** aktiviert war und ob du danach tatsächlich ein Level gestartet hast.

## 5. Empfohlene Einstellungen

Für die normale Nutzung empfehlen sich:

- **AI Mode:** Balanced
- **Detail reconstruction:** Auto
- **AI Backend:** Auto
- **Detail CNN:** On
- **Source Color Lock:** On
- **Preserve Microdetail:** On
- **Preserve Stars / Tiny Lights:** On
- **Quality Guard:** On
- **8x Internal Master:** On
- **Persistent Cache:** On
- **Cache:** 2–4 GB, wenn genügend Speicher vorhanden ist
- **Material Maps:** Off für normale Stock-Launcher-Texture-Packs

Mit **Auto** wählt der Mod die Detailstufe pro Textur selbst. UI und technische Maps bleiben konservativ, während wichtige Charakter-, Waffen- und Terrain-Texturen bei geeigneter Qualität höher verarbeitet werden können.

## 6. AI-Modi

### Faithful

Behält sich besonders stark an die ursprüngliche Textur. Dieser Modus eignet sich, wenn der originale PS2-Artstyle möglichst unverändert bleiben soll.

### Balanced

Empfohlener Standard. Er versucht zusätzliche sichtbare Struktur zu rekonstruieren, ohne die ursprüngliche Textur unnötig stark zu verändern.

### Maximum Detail

Aggressivere Detailrekonstruktion für wichtige Assets und manuelle Tests. Für komplette Packs ist normalerweise **Balanced + Auto Detail** die bessere Ausgangseinstellung.

## 7. Detailstufen

### Current / Standard

Die konservativste und schnellste Variante. Geeignet für:

- UI;
- kleine oder empfindliche Texturen;
- Tests;
- Texturen, bei denen zusätzliche Rekonstruktion keinen Vorteil bringt.

### High

Guter Kompromiss für normale Welttexturen, beispielsweise:

- Terrain;
- Stein;
- Metall;
- Gebäude;
- Objekte.

### Max

Für besonders wichtige Assets wie:

- Ratchet;
- Clank;
- Charaktere;
- Waffen;
- wichtige Gegner;
- hochwertige Terrain-Assets.

Bei geeigneten Texturen kann Max zusätzlich den internen **8x Master** verwenden. Dabei wird intern mit höherer Auflösung gearbeitet und anschließend hochwertig auf die normale 4x-Pack-Auflösung heruntergerechnet.

### Auto

Für normale Nutzung empfohlen. Auto wählt die Startqualität pro Textur und kann sie nach dem ersten AI-Pass anhand der gemessenen Qualität noch einmal anpassen.

Manuelle Overrides aus dem Quality Lab haben immer Vorrang.

## 8. Dual-CNN-System

Graphics preparation verwendet einen allgemeinen Real-ESRGAN-Rekonstruktionspfad und einen zusätzlichen Detail-/Fidelity-Pfad.

Zusätzliche Detailstruktur wird nur übernommen, wenn die CNN-Ausgaben lokal ausreichend übereinstimmen. Die Fusion berücksichtigt unter anderem:

- Farb-/Pixel-Übereinstimmung;
- lokale Residualstruktur;
- CNN Confidence;
- lokal verworfene Detailbereiche;
- materialabhängige Grenzwerte.

Unsichere Detailbereiche werden lokal gedämpft oder verworfen, statt ungeprüft als zusätzliche Schärfe übernommen zu werden.

## 9. Quality Guard

**Quality Guard sollte normalerweise aktiviert bleiben.**

Nach der Verarbeitung analysiert der Mod unter anderem:

- Farbabweichung;
- Helligkeitsabweichung;
- Alpha-Abweichung und Alpha-Abdeckung;
- ungefähre Strukturähnlichkeit (SSIM);
- Histogrammabweichung;
- Kantenverstärkung;
- CNN Agreement;
- CNN Confidence;
- lokal verworfene CNN-Bereiche;
- Seam-Risiko bei wiederholbaren Texturen;
- Halluzinationsrisiko.

Schwache Ergebnisse können automatisch konservativer erneut verarbeitet werden. Kritisch schlechte Ergebnisse werden nicht als gültiges AI-Ergebnis übernommen, sondern können auf den deterministischen 4x-Fallback zurückfallen.

## 10. Quality Lab

Mit dem **Quality Lab** kannst du einzelne Texturen vor einem vollständigen Export prüfen.

Die Vorschau zeigt je nach Textur unter anderem:

- Original;
- AI Output;
- erkannte Texture Class;
- erkanntes Material;
- geplante und tatsächlich verwendete Qualitätsstufe;
- Quality Score;
- CNN Agreement;
- weitere QA-Metriken;
- verwendetes Backend;
- optionale Material-Maps.

Pro Textur-Hash kannst du Overrides speichern.

### Quality Override

- **Auto** – globale/automatische Entscheidung;
- **Current / Standard** – konservativ;
- **High** – höhere Detailrekonstruktion;
- **Max** – maximale Detailrekonstruktion;
- **No AI** – sicherer normaler 4x-Upscale ohne generativen AI-Pfad.

Wenn ein Logo, eine UI-Textur oder ein empfindliches Asset mit AI schlechter aussieht, setze es auf **No AI** oder **Standard**. Wenn eine wichtige Waffen- oder Charaktertextur nach der Vorschau stabil aussieht, kannst du sie gezielt auf **Max** setzen.

Die gespeicherten Overrides werden auch beim vollständigen Pack-Export berücksichtigt.

## 11. Material-Erkennung

Der Mod kann verschiedene Materialtypen erkennen beziehungsweise über Pfadhinweise und Bildstatistik zuordnen, darunter:

- Weapon;
- Character;
- Terrain;
- Stone;
- Metal;
- Fabric;
- Organic;
- Glass;
- Energy;
- Sky;
- Generic.

Die Detailrekonstruktion wird materialabhängig begrenzt. Beispielsweise darf Stein mehr Oberflächenstruktur übernehmen, während Glas konservativer behandelt wird.

## 12. Material Maps

Optional kann Graphics preparation zusätzliche Material-Sidecars erzeugen, darunter:

- Normal;
- Roughness;
- Height;
- Ambient Occlusion;
- Emissive;
- Specular;
- Metallic;
- Cavity;
- Curvature;
- Edge Wear.

Die Material-Pipeline arbeitet in 0.16.1 über **Albedo Cleanup -> Coarse/Mid/Micro Height -> Height Merge -> Normal -> AO/Roughness**. Im Quality Lab kannst du zusätzlich eine **Lit relief preview** ansehen, die zeigt, wie die erzeugte Normal Map unter synthetischem Licht wirkt. Der Export enthält außerdem Parallax-Authoring-Metadaten für `height.png`; der Stock-Renderer rendert Parallax/Displacement dadurch noch nicht automatisch.

Für normale Texture-Packs im unveränderten Stock-Launcher sollte **Material Maps: Off** bleiben, weil diese Dateien eine neuere beziehungsweise erweiterte Enhanced-Graphics-Integration voraussetzen können.

## 13. AI Backend

### Auto

Empfohlen. Der Mod versucht nacheinander:

1. WebGPU mit Graph Capture;
2. normales WebGPU;
3. WASM/CPU.

### WebGPU

Erzwingt den GPU-Pfad. Nützlich für Tests, wenn du sicher bist, dass die OpenRAC-WebView WebGPU korrekt bereitstellt.

### WASM

Erzwingt CPU/WASM-Verarbeitung. Das ist in der Regel langsamer, dient aber als Kompatibilitäts-Fallback.

## 14. Duplicate Detection

Vor einer AI-Verarbeitung sucht Graphics preparation nach exakt identischen Quelldateien.

Identische Texturen werden nur einmal neural verarbeitet. Das Ergebnis wird anschließend für alle zugehörigen OpenRAC-Texture-Hashes verwendet.

Dadurch können bei großen Sammlungen viele unnötige AI-Durchläufe vermieden werden.

## 15. Persistent Cache

Der Persistent Cache sollte normalerweise aktiviert bleiben.

Erfolgreiche AI-Ergebnisse werden lokal gespeichert und können bei einem späteren Export wiederverwendet werden.

Der Cache-Schlüssel berücksichtigt relevante Ausgabeparameter wie:

- Quelle;
- AI-Modus;
- tatsächliche Detailstufe;
- Texture Scope;
- Detail-CNN;
- Source Color Lock;
- Quality Guard;
- 8x Master;
- manuelle Class-/Material-Overrides;
- spezialisierte Modell-Identität.

Dadurch werden inkompatible alte Ergebnisse nicht einfach unter neuen Einstellungen wiederverwendet.

## 16. AI-Grafik erzeugen

Wenn die Einstellungen stimmen, drücke **Prepare AI graphics**.

Der Mod führt dann automatisch die nötigen Schritte aus, darunter:

1. gespeicherte Texturen sammeln;
2. exakte Duplikate erkennen;
3. wichtige Quellen priorisieren;
4. Texture Class bestimmen;
5. Material bestimmen;
6. AI-Upscaling durchführen;
7. Detail-CNN/Fusion anwenden;
8. Mikrodetails rekonstruieren;
9. Farben stabilisieren;
10. Qualität prüfen;
11. bei Bedarf konservativer neu verarbeiten oder auf einen sicheren Fallback wechseln;
12. Texture-Pack erzeugen.

Große Texture-Sammlungen und Max-/8x-Verarbeitung können entsprechend viel Rechenzeit benötigen. Die Fortschrittsanzeige zeigt Prozent, vergangene Zeit, Restzeit und Texturen pro Minute; Material-Maps, Mipmaps und das Schreiben des Packs zählen dabei mit, bevor eine Textur als abgeschlossen gilt.

## 17. Texture-Pack speichern und installieren

Nach der Verarbeitung fragt OpenRAC nach einem Speicherort für die erzeugte ZIP-Datei.

Speichere die ZIP.

Graphics preparation 0.17.0 enthält seine native Effects Runtime bereits selbst. Für den Effects-Runtime-Code ist daher kein zweiter Mod-Download mehr nötig. Fertige, von dir erzeugte Effekt-/Texture-Packs werden weiterhin bewusst über Mods -> Add a mod hinzugefügt:

1. Gehe zu **Mods -> Add a mod**.
2. Wähle die neu erzeugte Texture-Pack-ZIP.
3. Aktiviere den Pack.
4. Starte OpenRAC.

## 18. Quality Report

Jeder AI-Texture-Pack-Export enthält eine Datei:

`quality-report.json`

Der Bericht hält kompakt unter anderem fest:

- die niedrigsten Quality Scores;
- die höchsten Quality Scores;
- automatisch erkannte Fehler;
- degradierte Fallbacks;
- Texture Hash und Pfad;
- Texture Class;
- Material;
- tatsächlich verwendete Detailstufe;
- Backend;
- Master Scale;
- Cache-Status;
- Qualitätsmetriken;
- Status eines spezialisierten CNN-Passes, wenn relevant.

Damit kannst du problematische Texturen später gezielt im Quality Lab prüfen.

## 19. Spezialisierte Material-CNNs

Version 0.14.x unterstützt zusätzlich validierte, materialspezifische Detailmodelle.

Diese können geeignete Max-Detail-Diffuse-Texturen nach der allgemeinen Rekonstruktion weiter verfeinern.

Der spezialisierte Pfad ist fail-open. Wenn ein Modell fehlt, seine SHA-256-Prüfung scheitert, die Inferenz nicht funktioniert oder die Qualität schlechter wird, bleibt das normale Real-ESRGAN-Ergebnis erhalten.

Nicht validierte spezialisierte Modelle sollen nicht in einen normalen Release-Pack gelangen.

## 20. Empfohlene Konfiguration für einen finalen Pack

Für einen hochwertigen allgemeinen Export:

- **AI Mode:** Balanced
- **Detail reconstruction:** Auto
- **Backend:** Auto
- **Detail CNN:** On
- **Source Color Lock:** On
- **Preserve Microdetail:** On
- **Preserve Stars:** On
- **Quality Guard:** On
- **8x Internal Master:** On
- **Persistent Cache:** On
- **Cache:** 2–4 GB
- **Material Maps:** Off

Danach kannst du besonders wichtige oder auffällige Texturen im Quality Lab prüfen und nur dort gezielte Overrides setzen.

## 21. Fehlerbehebung

### Keine Texturen gefunden

Aktiviere **Models and textures -> Save the game's textures while you play**, starte das Spiel und besuche den betreffenden Level erneut.

### WebGPU funktioniert nicht

Stelle **AI Backend -> Auto** ein. Der Mod kann dann auf normales WebGPU oder WASM zurückfallen.

### Eine einzelne Textur sieht schlechter aus

Öffne sie im Quality Lab und probiere **Standard** oder **No AI**. Der Override gilt anschließend auch für den vollständigen Export.

### Verarbeitung wurde unterbrochen

Starte den Export erneut. Wenn **Persistent Cache** aktiviert war, können bereits erfolgreich verarbeitete Quellen wiederverwendet werden.

### Fehler „a bad key“

Dieser Fehler betraf den Resume-Journal-Key bis einschließlich 0.17.0 beziehungsweise den älteren
0.16.1-Stand. Installiere **Graphics preparation 0.17.1 oder neuer**. Der neue Resume-Key erfüllt
OpenRACs Store-Key-Regel `[a-z0-9_-]` mit maximal 64 Zeichen. Bereits im Persistent Cache
gespeicherte AI-Ergebnisse müssen nicht neu berechnet werden.

### AI ist sehr langsam

- Verwende **AI Backend: Auto**;
- prüfe, ob WebGPU verfügbar ist;
- lasse den Persistent Cache aktiviert;
- verwende **Detail reconstruction: Auto** statt alles manuell auf Max zu setzen;
- lasse Duplicate Detection arbeiten, damit identische Quellen nicht mehrfach verarbeitet werden.

## Kurzfassung

1. OpenRAC Dev Launcher installieren.
2. Graphics preparation installieren.
3. **Save the game's textures while you play** aktivieren.
4. Spiel spielen und Texturen erfassen.
5. Graphics preparation öffnen.
6. **Balanced + Auto** verwenden.
7. Detail CNN, Quality Guard und Cache aktiviert lassen.
8. **Prepare AI graphics** starten.
9. erzeugte ZIP speichern.
10. ZIP über **Mods -> Add a mod** installieren.
11. Texture-Pack aktivieren.
12. OpenRAC starten.

## Effekte platzieren (0.15.0)

Für Sparks, Smoke, Mist, Glow, Energy, Rain und Heat Haze muss vor dem Export eine gültige Position festgelegt werden.

1. Level auswählen.
2. Optional unter **Level instance** eine echte Tie-/Shrub-/Moby-Instanz aus `placements.json` wählen.
3. Effekt hinzufügen.
4. Mit **Place at selected level instance** auf die Instanzposition setzen oder X/Y/Z manuell eintragen.
5. Alte gespeicherte Effekte einmal mit **Confirm X/Y/Z** bestätigen.
6. Erst wenn kein Eintrag mehr **Needs placement** anzeigt, kann der Runtime-Effects-Mod exportiert werden.

**Use player position** bleibt deaktiviert, solange die normale OpenRAC Mod-Tool-Schnittstelle keine Live-Spielerposition an die Mod-Seite liefert. Ab Graphics preparation 0.17.0 ist die native Partikel-/Haze-Runtime bereits im Hauptmod enthalten; ein separater Graphics Effects Runtime Download ist nicht mehr nötig.


## Ein Produkt ab 0.17.0

Ab 0.17.0 installierst du nur noch **Graphics preparation**.

1. `graphics-preparation-0.17.0.zip` über **Mods -> Add a mod** installieren.
2. Graphics preparation aktivieren.
3. Die Tool-Seite über **Open** verwenden.
4. Erzeugte Runtime-Effects-Packs wie gewohnt installieren.

Die native Runtime für Sparks, Smoke, Mist, Glow, Energy, Rain und Heat Haze steckt bereits im Graphics-preparation-ZIP. Der alte separate `graphics-effects-runtime`-Mod ist nur noch für ältere Installationen gedacht.


### Native Release-Datei fehlt

Bei nativen Mods lädt OpenRAC nicht die zusammengeführte ZIP, sondern die Plattformdatei
`<id>-<version>-<platform>.zip`. Graphics preparation 0.17.3 veröffentlicht deshalb zusätzlich
`graphics-preparation-0.17.3-macos-arm64.zip`, `graphics-preparation-0.17.3-macos-x86_64.zip`,
`graphics-preparation-0.17.3-linux-x86_64.zip`, `graphics-preparation-0.17.3-linux-aarch64.zip`
und `graphics-preparation-0.17.3-windows-x86_64.zip`. Auf Apple Silicon ist
`graphics-preparation-0.17.3-macos-arm64.zip` die vom Launcher erwartete Datei.


## 3D Geometry Enhancement

Ab 0.20.0 kann der Mod zusätzlich einen **Geometry Job** mit echtem Height-Micro-Displacement erzeugen.

Im Abschnitt **3D Geometry Enhancement** stehen vier Profile zur Verfügung:

- **Enhanced:** neue Normalen/Tangenten, keine zusätzliche Unterteilung;
- **High:** ein sicherer Subdivision-Durchlauf;
- **Ultra:** bis zu zwei Durchläufe innerhalb des Triangle-Budgets;
- **Experimental:** Ultra plus optionale Formverfeinerung für manuelle Tests.

**3D asset scope** wählt Terrain, Scenery (Ties/Shrubs), Mobys oder alles zusammen.

**Shape refinement** ist standardmäßig aus. Solange es aus bleibt, werden die ursprünglichen
Vertexpositionen nicht verändert. Das ist die sichere erste Stufe: mehr Geometrie und bessere
Tangent-Space-Daten, aber keine Collision-Verschiebung.

Mit **Allow visual/collision mismatch** dürfen im Experimental-Pfad auch Terrain-/Moby-Positionen
leicht verändert werden. Das ist ausdrücklich ein manueller Testmodus; `geometry-report.json`
markiert betroffene Primitive für Collision-Review.

Ablauf:

1. Im Mod **Export Geometry Job** drücken.
2. Die gespeicherte JSON-Datei mit dem Helper ausführen:
   `python3 helper/openrac_graphics_helper.py <job.json> --openrac-root /pfad/zu/OpenRAC`
3. Der Helper exportiert die passenden eigenen Spielmodelle über OpenRAC, verarbeitet die glTFs und
   importiert die Änderungen wieder.
4. Ergebnis sind `geometry-report.json` und ein normales installierbares Override-ZIP.
5. Das ZIP über **Mods -> Add a mod** installieren.

Der Helper verändert keine Disc-Datei. Nicht unterstützte Morph Targets, fehlende UVs, unbekannte
Vertexattribute oder fehlerhafte Primitive werden übersprungen statt still beschädigt zu werden.


## Modern / PS5 target

Ab 0.20.0 gibt es oben im Mod den Knopf **Modern / PS5 target**.

Damit werden die wichtigen Qualitätsoptionen gemeinsam gesetzt, statt Texture-AI und Geometry
einzeln zusammensuchen zu müssen:

- AI Mode: Enhanced;
- Detail reconstruction: Auto;
- Detail CNN: On;
- Source Color Lock: On;
- Quality Guard: On;
- Selective 8x Master: On;
- Material Maps: Key materials;
- Enhanced mipmaps: Key materials;
- Geometry profile: Modern;
- Adaptive subdivision: On;
- Crease preservation: Auto;
- Shape refinement: On für sichere statische Geometrie;
- visual/collision mismatch: Off.

Danach bleibt der Ablauf bewusst in zwei Schritten:

1. **Prepare AI graphics** erzeugt den Texture-/Material-Pack.
2. **Export Geometry Job** erzeugt den Job für den OpenRAC-glTF-Roundtrip.

### Warum adaptive Geometry besser ist

0.20.0 unterteilt nicht mehr einfach überall gleich stark. Der Helper bewertet Kanten nach
Geometriedichte und Krümmung. Lange beziehungsweise stark gekrümmte Bereiche erhalten zuerst neue
Vertices; dichte flache Bereiche verschwenden das Triangle-Budget nicht.

Gemeinsame Kanten werden global behandelt, damit keine T-Junction-Risse zwischen benachbarten
Dreiecken entstehen.

### Crease Preservation

Nach der Unterteilung werden harte geometrische Kanten anhand eines Crease-Winkels geschützt.

- **Auto** ist empfohlen.
- Charaktere/Mobys verwenden einen strengeren Winkel.
- Terrain darf stärker geglättet werden.
- Manuelle 45°/55°/65°/75°-Werte dienen dem Feintuning.

Normalen und Tangenten werden danach winkelgewichtet neu aufgebaut. Das verbessert insbesondere
Specular-Highlights, Normal Maps und Beleuchtung auf unterschiedlich großen Dreiecken.

### Geometry Report v2

`geometry-report.json` zeigt jetzt zusätzlich:

- Adaptive Edges;
- erzeugte Crease-Splits;
- budget-limitierte Primitive;
- übersprungene Primitive und Grund;
- Triangle-Multiplikator;
- Collision-Review-Kandidaten.

Wenn ein Lauf kaum Adaptive Edges meldet, war das Ausgangsmesh bereits relativ dicht oder die
Grenzwerte waren konservativ. Wenn viele Primitive am Budget hängen, sollte zuerst das Auto-Budget
oder der Scope geprüft werden, statt pauschal immer mehr Dreiecke zu erlauben.

### Height Micro-Displacement

0.20.0 koppelt die erzeugten Height Maps an die neue Mesh-Geometrie.

Empfohlen:

- **Height micro-displacement:** On
- **Height source:** Auto
- **Displacement strength:** 80%
- **Allow visual/collision mismatch:** Off

**Auto** versucht zuerst `Materials/<hash>/height.png` aus dem bereits erzeugten Texture-/Material-Pack.
Fehlt der Sidecar, wird nur eine deutlich konservativere relative Height aus der exportierten Diffuse
abgeleitet. Mit **Sidecar only** wird bei fehlender Height Map überhaupt kein Relief geraten.

Für die beste Qualität speicherst du Geometry-Job und AI-Pack im selben Ordner. Wenn dort genau ein
kompatibles Material-Pack liegt, erkennt der Helper es automatisch. Alternativ:

`python3 helper/openrac_graphics_helper.py <job.json> --openrac-root /pfad/zu/OpenRAC --material-pack /pfad/zum/ai-pack.zip`

Die Vertices bewegen sich entlang der rekonstruierten Normalen. Harte Creases und offene Mesh-Ränder
werden festgehalten. Die maximale Bewegung ist pro Material begrenzt; Stone/Terrain dürfen mehr Relief
als Metal/Character, Glass/Sky/UI praktisch keines.

**Wichtig:** Terrain und Mobys bleiben im sicheren Standard trotz aktiviertem Micro-Displacement
positionsgesperrt. Erst **Allow visual/collision mismatch** erlaubt dort Bewegung. Damit verändert der
normale PS5-Preset keine Gameplay-Collision.

### PS5-Ziel

Damit umfasst der automatische Pfad jetzt Texturrekonstruktion, PBR/Height, adaptive Mesh-Dichte,
Crease-Preservation und echte begrenzte Oberflächengeometrie. Das ersetzt trotzdem keine vollständig
von Hand neu modellierten AAA-Assets; besonders Charaktergesichter, Hände und große Silhouetten sollten
weiterhin bewusst geprüft werden.


## Asset-aware Remesh und LOD-Planung

Ab 0.21.0 erweitert **Modern / PS5 target** die Geometry-Pipeline automatisch um:

- **Asset-aware remesh:** On
- **Triangle topology optimization:** On
- **Silhouette refinement:** On
- **Silhouette strength:** 100%
- **LOD planning:** On

Der Helper erkennt pro Primitive eine konservative Rolle: Character, Weapon, Rock, Foliage, Terrain,
Structure oder Prop/Generic.

Dadurch werden die Triangle-Budgets nicht mehr nur nach Terrain/Moby/Scenery verteilt. Charaktere,
Waffen und Felsen bekommen gezielt mehr Dichte an langen, gekrümmten und outline-relevanten Kanten.
Foliage bleibt absichtlich sparsamer, damit transparente Karten nicht unnötig vervielfacht werden.

### Topology Optimization

Nach der adaptiven Unterteilung darf der Helper sichere gemeinsame Diagonalen drehen, wenn:

- die durchschnittliche Triangle-Qualität steigt;
- keine harte Crease überschritten wird;
- die neue Fläche nicht umklappt;
- die UV-Orientierung erhalten bleibt.

Das macht die zusätzlichen Polygone für Normalen, Skinning und Height-Displacement sinnvoller nutzbar.

### Silhouette Refinement

Die Silhouette-Stufe ist keine freie AI-Neumodellierung. Sie verwendet eine kleine,
volumenerhaltende Glättung auf gekrümmten Bereichen und hält harte Kanten sowie offene Mesh-Ränder
fest.

Im sicheren Standard gilt weiterhin:

- statische Rocks/Scenery dürfen leicht verfeinert werden;
- Terrain bleibt positionsgesperrt;
- Mobys/Characters/Weapons bleiben positionsgesperrt;
- erst **Allow visual/collision mismatch** erlaubt bei Terrain/Mobys echte Positionsbewegung.

### LOD Planning

`geometry-report.json` enthält jetzt für jedes Primitive eine LOD-Policy. Zusätzlich schreibt der
Helper:

`geometry-lod-plan.json`

Darin stehen Rolle, LOD0/LOD1/LOD2-Triangle-Ziele und die tatsächlich vorhandenen Subdivision-Stufen.

Wichtig: Der aktuelle Stock-Importer von OpenRAC importiert bei bearbeiteten Klassen genau einen
Replacement-GLB. Deshalb ist die LOD-Datei in 0.21.0 ein vorbereitetes Integrationsformat; das normale
Override-ZIP verwendet bereits das hochwertige LOD0/Remesh, aber automatisches Runtime-Umschalten
zwischen LOD0/1/2 wird noch nicht behauptet.
