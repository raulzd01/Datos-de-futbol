"""
Este script se conecta a football-data.org, descarga clasificación,
últimos resultados y máximos goleadores de LaLiga, y los guarda en
data/*.json. La web (index.html / clasificacion.html) lee esos JSON.

No necesitas ejecutar esto a mano: el robot programado en
.github/workflows/update-data.yml lo ejecuta solo cada día.

Requiere una variable de entorno FOOTBALL_API_KEY con tu clave gratuita
de https://www.football-data.org/client/register
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError

API_BASE = "https://api.football-data.org/v4"
COMPETITION = "PD"  # PD = Primera División (LaLiga). Cambia esto para otra liga.
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

API_KEY = os.environ.get("FOOTBALL_API_KEY")


def fetch(path):
    url = f"{API_BASE}/{path}"
    req = Request(url, headers={"X-Auth-Token": API_KEY})
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        print(f"Error llamando a {url}: {e.code} {e.reason}", file=sys.stderr)
        print(e.read().decode(), file=sys.stderr)
        raise


def update_standings():
    data = fetch(f"competitions/{COMPETITION}/standings")
    table = data["standings"][0]["table"]  # tabla general (TOTAL)
    rows = [
        {
            "position": row["position"],
            "club": row["team"]["name"],
            "played": row["playedGames"],
            "goalDiff": row["goalDifference"],
            "points": row["points"],
        }
        for row in table
    ]
    out = {
        "table": rows,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json("standings.json", out)


def update_results():
    # Usamos un rango de fechas en vez de filtrar por estado: así seguimos
    # mostrando partidos aunque sea pretemporada (sin partidos "FINISHED"
    # recientes) o aunque cambie la temporada activa en la API.
    today = datetime.now(timezone.utc).date()
    date_from = (today - timedelta(days=21)).isoformat()
    date_to = (today + timedelta(days=10)).isoformat()
    data = fetch(f"competitions/{COMPETITION}/matches?dateFrom={date_from}&dateTo={date_to}")
    all_matches = data.get("matches", [])
    print(f"La API devolvió {len(all_matches)} partidos en el rango {date_from} a {date_to}")

    all_matches.sort(key=lambda m: m["utcDate"])
    played_or_live = [m for m in all_matches if m["status"] in ("FINISHED", "IN_PLAY", "LIVE")][-10:]
    remaining_slots = max(0, 10 - len(played_or_live))
    upcoming = [m for m in all_matches if m["status"] == "SCHEDULED"][:remaining_slots]
    matches = played_or_live + upcoming

    out_matches = []
    for m in matches:
        home_score = m["score"]["fullTime"]["home"]
        away_score = m["score"]["fullTime"]["away"]
        if m["status"] == "SCHEDULED":
            match_date = datetime.fromisoformat(m["utcDate"].replace("Z", "+00:00"))
            status_text = match_date.strftime("%d/%m %H:%M")
        elif m["status"] in ("IN_PLAY", "LIVE"):
            status_text = "EN JUEGO"
        else:
            status_text = "FINALIZADO"
        out_matches.append({
            "competition": "LaLiga",
            "home": m["homeTeam"]["name"],
            "away": m["awayTeam"]["name"],
            "homeScore": home_score,
            "awayScore": away_score,
            "homeWin": home_score is not None and away_score is not None and home_score > away_score,
            "awayWin": home_score is not None and away_score is not None and away_score > home_score,
            "status": status_text,
        })
    out = {
        "matches": out_matches,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json("results.json", out)


def update_scorers():
    data = fetch(f"competitions/{COMPETITION}/scorers?limit=10")
    raw_scorers = data.get("scorers", [])
    print(f"La API devolvió {len(raw_scorers)} goleadores")
    scorers = [
        {"name": s["player"]["name"], "goals": s["goals"]}
        for s in raw_scorers
    ]
    out = {
        "scorers": scorers,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json("topscorers.json", out)


def write_json(filename, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"Escrito {path}")


if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: falta la variable de entorno FOOTBALL_API_KEY", file=sys.stderr)
        sys.exit(1)

    update_standings()
    update_results()
    update_scorers()
