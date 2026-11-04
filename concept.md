# Konzept: Visuelle Code-Canvas-Desktop-App

## Ziel

Entwickle eine Desktop-Anwendung, in der Anwender Berechnungen und Abläufe als verbundene Nodes auf einer freien Canvas-Fläche erstellen. Die Bedienung orientiert sich an Obsidian Canvas: Nodes werden erstellt, verschoben und mit Linien verbunden.

Der Code wird direkt in der Node geschrieben und ausgeführt. Es gibt keinen separaten IDE- oder Workflow-Editor. **Der nutzbare Code in den Nodes ist JavaScript.** TypeScript darf intern für die Entwicklung der App verwendet werden, ist aber nicht die Sprache für Node-Code.

Ein- und Ausgänge machen sichtbar, welche Daten durch die Berechnung fließen. Nodes können außerdem Buttons und andere einfache Bedienelemente enthalten.

## Zielplattform und Technologie

- **Desktop-App:** Tauri 2
- **Oberfläche:** React und TypeScript
- **Canvas und Verbindungen:** React Flow (`@xyflow/react`)
- **JavaScript-Eingabe in Nodes:** CodeMirror 6, mit JavaScript-Modus
- **Build-Tool:** Vite
- **Persistenz:** lokale, versionierte JSON-Projektdateien

Die Anwendung soll unter Windows, macOS und Linux laufen und sich in IntelliJ IDEA öffnen und bearbeiten lassen.

## Bedienkonzept

### Canvas

Die Canvas ist die zentrale Arbeitsfläche. Anwender können:

- Nodes erstellen, auswählen, verschieben und löschen
- Nodes mit Linien verbinden
- hinein- und herauszoomen sowie die Ansicht verschieben
- ein Projekt lokal speichern und wieder öffnen
- einen Workflow ausführen und Ergebnisse ansehen

Die Canvas ist die Hauptansicht. Code wird direkt in den Nodes bearbeitet; ein separater Code-Editor ist nicht erforderlich.

### Nodes

Eine Node ist eine frei platzierbare Karte auf der Canvas. Sie enthält:

- einen editierbaren Titel
- ein eingebettetes JavaScript-Codefeld
- konfigurierbare Eingänge und Ausgänge
- eine Ausführen-Aktion
- den aktuellen Ausführungsstatus
- optional Buttons und Ergebnisanzeigen

Nodes können in der Höhe wachsen oder ihren Codebereich ein- und ausklappen. Der Canvas bleibt dabei die Hauptansicht.

### Ein- und Ausgänge

Ein- und Ausgänge werden in der Node sichtbar dargestellt. Jeder Port besitzt mindestens:

- einen Namen, zum Beispiel `wert` oder `ergebnis`
- einen Datentyp, zum Beispiel `number`, `string`, `boolean` oder `object`
- eine Rolle: Eingang oder Ausgang

Verbindungen führen einen Ausgang einer Node zu einem Eingang einer anderen Node. Inkompatible Verbindungen sollen möglichst früh kenntlich gemacht werden.

## JavaScript-Code in Nodes

Der Anwender schreibt in jeder Code-Node ausführbaren **JavaScript-Code**. Die App stellt die Werte der verbundenen Eingänge als `inputs`-Objekt bereit. Die Node gibt ihre Ausgangswerte als Objekt zurück.

Beispiel für eine Node mit Eingang `wert` und Ausgang `ergebnis`:

```js
async function run(inputs) {
  const ergebnis = Number(inputs.wert) * 2;

  return { ergebnis };
}
```

In diesem Beispiel wird `inputs.wert` mit zwei multipliziert. Der zurückgegebene Wert `ergebnis` steht anschließend für verbundene Nodes zur Verfügung.

Die App soll JavaScript-Syntaxfehler melden und Laufzeitfehler direkt in der betroffenen Node anzeigen. Die Eingabe soll JavaScript-Syntaxhervorhebung und passende Editor-Unterstützung bieten.

## Buttons in Nodes

Node-Code soll kein beliebiges HTML in die Oberfläche einfügen. Stattdessen definiert eine Node ihre Aktionen über eine deklarative Konfiguration. Die App rendert daraus sichere Bedienelemente, zum Beispiel:

- einen Button mit der Beschriftung „Berechnen“
- einen Button mit der Beschriftung „Zurücksetzen“
- ein Eingabefeld für einen Wert

Beim Klick führt die App die zugehörige Node-Aktion aus. Gestaltung und Ereignisbehandlung bleiben unter Kontrolle der Anwendung; Node-JavaScript kann nur die ausdrücklich vorgesehenen Aktionen verwenden.

## Ausführung des Workflows

Ein Workflow besteht aus Nodes und Verbindungen. Beim Ausführen soll die App:

1. prüfen, ob alle Verbindungen gültig sind
2. erkennen, ob eine zyklische Verbindung vorliegt
3. die Ausführungsreihenfolge aus den Verbindungen bestimmen
4. jeder Node ihre verfügbaren Eingangswerte über `inputs` übergeben
5. jede Node ausführen und ihre zurückgegebenen Ausgänge weiterleiten
6. Status, Ergebnisse und Fehler in den Nodes anzeigen

Für den ersten Prototyp genügt eine Ausführung nacheinander. Eine spätere Version kann unabhängige Nodes parallel ausführen.

Mögliche Statusanzeigen pro Node:

- bereit
- läuft
- erfolgreich
- fehlgeschlagen

Fehlermeldungen sollen in der betroffenen Node erscheinen und, wenn möglich, die Zeile im JavaScript-Code nennen.

## Sicherheit der Codeausführung

Node-Code ist ausführbarer Code und muss von den internen App-Funktionen getrennt bleiben.

Für einen Prototyp, in dem Anwender ihren eigenen Code ausführen, kann JavaScript in einem Web Worker laufen. Der Worker darf keinen direkten Zugriff auf Tauri-APIs oder das Dateisystem erhalten.

Ein Web Worker ist **keine vollständige Sicherheitsgrenze**. Fremde oder nicht vertrauenswürdige Workflows dürfen damit nicht als sicher gelten. Wenn solche Workflows ausgeführt werden sollen, ist eine stärker isolierte Umgebung mit begrenzten Berechtigungen und Ressourcenlimits erforderlich.

## Projektformat und Speichern

Ein Projekt wird als versionierte JSON-Datei gespeichert. Sie enthält mindestens:

- Projektname und Formatversion
- Nodes mit IDs, Typen, Titeln, JavaScript-Code, Ports und Positionen
- Verbindungen zwischen Nodes
- optional Node-Einstellungen und UI-Konfiguration

Beispiel für die grobe Struktur:

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "node-1",
      "type": "code",
      "title": "Verdoppeln",
      "position": { "x": 240, "y": 120 },
      "code": "async function run(inputs) { return { ergebnis: Number(inputs.wert) * 2 }; }",
      "inputs": [{ "name": "wert", "type": "number" }],
      "outputs": [{ "name": "ergebnis", "type": "number" }]
    }
  ],
  "edges": []
}
```

Beim Laden soll die App unbekannte oder ungültige Formatversionen verständlich melden und die Datei nicht stillschweigend überschreiben.

## MVP-Umfang

Die erste funktionsfähige Version soll enthalten:

1. Eine Canvas mit Zoomen, Verschieben und frei platzierbaren Nodes
2. Nodes erstellen, umbenennen und löschen
3. JavaScript direkt in einer Node bearbeiten
4. Ein- und Ausgänge konfigurieren und Nodes verbinden
5. Workflow validieren und ausführen
6. Status, Ergebnisse und Fehler in Nodes anzeigen
7. Projekte als JSON speichern und wieder öffnen
8. Einen deklarativen Button in einer Node anzeigen und ausführen

Noch nicht erforderlich sind Teamarbeit, Cloud-Synchronisierung, Plugin-System, parallele Ausführung und ein Node-Marktplatz.

## Abnahmekriterien

Das MVP gilt als funktionsfähig, wenn:

- ein Anwender eine Node auf der Canvas erstellen und darin JavaScript schreiben kann
- Nodes über benannte Ein- und Ausgänge verbunden werden können
- ein Wert von einer Node zur nächsten übertragen wird
- ein kompletter Workflow ausgeführt werden kann
- Ergebnisse und Fehler an der passenden Node sichtbar sind
- ein Button innerhalb einer Node eine definierte Aktion auslöst
- ein gespeicherter Workflow nach dem erneuten Öffnen wieder korrekt dargestellt wird
- fehlerhafte Verbindungen und Zyklen verständlich gemeldet werden

## Umsetzung in IntelliJ IDEA

1. Ein Tauri-Projekt mit React, TypeScript und Vite anlegen.
2. React Flow für Canvas, Nodes und Verbindungslinien einrichten.
3. Eine eigene Node-Komponente erstellen, die Titel, Ports und einen auf JavaScript konfigurierten CodeMirror-Editor enthält.
4. Nodes und Verbindungen in einem zentralen Projektzustand verwalten.
5. Das JSON-Format für Projekte definieren und Speichern/Laden implementieren.
6. Einen Workflow-Runner für Validierung, Ausführungsreihenfolge und Datenweitergabe erstellen.
7. Die JavaScript-Ausführung zunächst über einen isolierten Web Worker anbinden.
8. Button-Konfiguration und Anzeige in Nodes ergänzen.
9. Mit zwei verbundenen Nodes testen: Eingabewert → JavaScript-Berechnung → angezeigtes Ergebnis.
