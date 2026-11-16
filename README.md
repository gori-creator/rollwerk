# Rollwerk

Kostenlose Trainings-App für Smart-Trainer. Läuft lokal im Browser auf dem PC.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20 und Chrome oder Edge.

```bash
npm install
```

```bash
npm start
```

Danach http://localhost:5174 in Chrome oder Edge öffnen. Unter Windows erledigt ein Doppelklick auf `start.bat` beide Befehle.

Zum Entwickeln: `npm run dev` (gleiche Adresse, lädt Änderungen sofort neu). Tests: `npm test`.

## Funktionen

- Rolle per Bluetooth (FTMS) verbinden, Daten lesen und Widerstand steuern; Powermeter und ältere Trainer liefern nur Daten
- Pulsgurt per Bluetooth
- GPX-Strecken laden und fahren: die Rolle stellt die Steigung nach, das Tempo wird aus Leistung und Gewicht berechnet
- Workouts im ERG-Modus: eigener Editor, Import von .zwo, .erg und .mrc, FTP-Rampentest
- Aufzeichnung mit Auto-Pause, Wiederverbinden und Rettung nach Absturz
- Verlauf mit Kennzahlen, FIT-Export und Upload zu Strava
- Watt halten, virtuelle Schaltung (Pfeiltasten), Tempomacher mit Windschatten, Ghost der schnellsten eigenen Fahrt
- Wählbare Datenfelder, FTP-Tests (Rampe und 20 Minuten), erzeugte Anstiege, automatischer Strava-Upload
- 3D-Ansicht der Fahrt mit sechs Welten aus den Modellen unter `public/assets` (abschaltbar), Höhenprofil nach Steigung eingefärbt
- Demo-Trainer zum Ausprobieren ohne Hardware

## Aufbau

- `src/ble` – Bluetooth-Protokolle und Geräte
- `src/core` – Physik, GPX, Workouts, FIT-Export, Fahrt-Engine, Speicherung
- `src/ui` – Oberfläche (React)
- `server` – lokaler Server; hält die Strava-Zugangsdaten in `config.local.json`

Alle Fahrten, Strecken und Workouts liegen im Browser (IndexedDB) auf deinem Rechner.
