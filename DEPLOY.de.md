# Online-Version: Vercel (Oberfläche) + Ihr eigener Rechner (Backend)

[English](DEPLOY.md) | [简体中文](DEPLOY.zh-CN.md) | [한국어](DEPLOY.ko.md) | **Deutsch**

```
Browser ──► https://sound-network-neuron.vercel.app     frontend/ (Vercel, static files)
              │  HTTP (files / upload / media) + WebSocket (PCM audio)
              ▼
        http://127.0.0.1:8000                            backend/server.py on your own computer
```

Die Seite zeigt nur an. Analyse, Untertitel und Geräusch- / Vogelerkennung laufen im Backend auf **dem eigenen Rechner des Besuchers**; Audio und Dateien werden nie hochgeladen. Ohne Backend öffnet die Seite das Feld „Backend connection" mit einer Startanleitung. (Die Oberfläche gibt es auf Chinesisch, Englisch, Japanisch, Französisch und Spanisch; die Namen unten beziehen sich auf die englische Oberfläche.)

## Nutzer

1. Backend wie im Schnellstart der README starten: unter Windows `start.bat` doppelklicken, unter macOS / Linux `./start.sh`.
2. <https://sound-network-neuron.vercel.app> in Chrome / Edge / Firefox öffnen.
3. Zeigt der Status oben rechts „Connected", ist alles bereit. Ein Klick auf den Status öffnet das Feld:

| Option | Bedeutung |
|---|---|
| Current | verwendetes Backend: diese Seite / eigener Rechner / manuell gesetzt / keins gefunden |
| Backend URL | normalerweise leer lassen, die Automatik entscheidet |
| Local `http://127.0.0.1:8000` | Ihr eigener Rechner (anklicken, falls nicht automatisch erkannt) |
| Auto-select | löscht manuelle Einstellungen |
| Save & reconnect | speichert die Adresse und lädt neu |

Reihenfolge der Automatik: ① manuelle Einstellung (Feld oder `?api=…`) → ② eigene Adresse der Seite (geöffnet über `http://127.0.0.1:8000`) → ③ `http://127.0.0.1:8000` auf Ihrem Rechner → ④ Standard-Backend der Seite (`frontend/config.js`, standardmäßig leer).

## Repository-Eigentümer: Bereitstellung auf Vercel (einmalig)

1. Bei <https://vercel.com> mit GitHub anmelden → **Add New… → Project** → `Sound-network-neuron` → **Import**.
2. Framework Preset: **Other**, Rest unverändert (`vercel.json`: keine Installation, kein Build, `frontend/` veröffentlichen) → **Deploy**.
3. Jeder Push zu GitHub stellt automatisch neu bereit.

Ist die Adresse nicht `sound-network-neuron*.vercel.app` (umbenanntes Projekt oder eigene Domain), vor dem Start des Backends setzen:

```powershell
$env:NEUROSENSE_ALLOWED_ORIGINS = "https://ihre-domain"
.\start.bat
```

## Sicherheit

- Das Backend lauscht nur auf `127.0.0.1` und ist aus dem Internet nicht erreichbar.
- Cross-Origin-Anfragen und WebSockets werden nur von lokalen Seiten und `sound-network-neuron*.vercel.app` (plus `NEUROSENSE_ALLOWED_ORIGINS`) akzeptiert; andere Websites können weder Ihre Medien lesen noch etwas hochladen oder umwandeln.
- Der Browser fragt vor Mikrofon / Kamera; Audio geht nur an das Backend auf Ihrem Rechner.

## Fehlerbehebung

| Symptom | Lösung |
|---|---|
| Dauerhaft „No backend connected" | `start.bat` / `./start.sh` starten, dann neu laden |
| Chrome / Edge fragt nach „Geräten im lokalen Netzwerk" | „Zulassen" klicken |
| Safari verbindet nicht | Chrome / Edge / Firefox verwenden oder `http://127.0.0.1:8000` direkt öffnen |
| Dateiliste da, aber „Disconnected, reconnecting…" | Prüfen, ob `uvicorn[standard]` installiert ist (`pip install -r backend/requirements.txt`) |
| Eigene Domain verbindet nicht | `NEUROSENSE_ALLOWED_ORIGINS` setzen |
| Port 8000 belegt | Nichts zu tun: Das Backend weicht automatisch auf 8001…8010 aus, die Seite findet es selbst; mit `NEUROSENSE_PORT` lässt sich ein Port festlegen |
