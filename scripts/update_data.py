"""
Este script se conecta a football-data.org y descarga, para cada liga
configurada en COMPETITIONS: clasificación, últimos/próximos partidos y
máximos goleadores. Además calcula dos métricas propias (no vienen así de
la API, las calculamos nosotros):

  - "Índice de Forma DDF": una puntuación 0-100 a partir del historial
    reciente de cada equipo (campo "form" que da la API), ponderando más
    los partidos más recientes.
  - "Media de goles por partido": goles a favor / partidos jugados.

Todo se guarda en data/<archivo>-<CODIGO_LIGA>.json. La web lee esos JSON.

No necesitas ejecutar esto a mano: el robot programado en
.github/workflows/update-data.yml lo ejecuta solo cada día.

Requiere una variable de entorno FOOTBALL_API_KEY con tu clave gratuita
de https://www.football-data.org/client/register
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError

API_BASE = "https://api.football-data.org/v4"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# Añade o quita ligas aquí. El código es el que usa football-data.org
# (PD=LaLiga, PL=Premier League, SA=Serie A, FL1=Ligue 1, BL1=Bundesliga...)
COMPETITIONS = {
    "PD": "LaLiga",
    "PL": "Premier League",
    "SA": "Serie A",
    "FL1": "Ligue 1",
}

API_KEY = os.environ.get("FOOTBALL_API_KEY")

# El plan gratuito permite 10 peticiones/minuto. Con 4 ligas x 3 peticiones
# cada una son 12 llamadas por ejecución, así que esperamos entre llamadas
# para no pasarnos del límite.
MIN_SECONDS_BETWEEN_CALLS = 6.5
_last_call_time = 0.0


def fetch(path):
    global _last_call_time
    elapsed = time.time() - _last_call_time
    if elapsed < MIN_SECONDS_BETWEEN_CALLS:
        time.sleep(MIN_SECONDS_BETWEEN_CALLS - elapsed)

    url = f"{API_BASE}/{path}"
    req = Request(url, headers={"X-Auth-Token": API_KEY})
    try:
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
    except HTTPError as e:
        print(f"Error llamando a {url}: {e.code} {e.reason}", file=sys.stderr)
        print(e.read().decode(), file=sys.stderr)
        raise
    finally:
        _last_call_time = time.time()
    return data


def compute_form_index(form_string):
    """
    Convierte el campo "form" de la API (ej. "L,W,W,D,W") en:
      - una puntuación 0-100 (más peso a los partidos más recientes)
      - una etiqueta ("🔥 En racha", "❄️ Bajón", "➖ Irregular")
    Devuelve (None, None) si no hay datos suficientes.
    """
    if not form_string:
        return None, None
    results = [r.strip() for r in form_string.split(",") if r.strip()]
    if not results:
        return None, None

    points_map = {"W": 3, "D": 1, "L": 0}
    # Pesos crecientes: el último partido de la lista pesa más que el primero.
    weights = list(range(1, len(results) + 1))
    weighted_sum = sum(points_map.get(r, 0) * w for r, w in zip(results, weights))
    max_possible = 3 * sum(weights)
    score = round((weighted_sum / max_possible) * 100) if max_possible else 0

    if score >= 70:
        label = "🔥 En racha"
    elif score <= 30:
        label = "❄️ Bajón"
    else:
        label = "➖ Irregular"
    return score, label


def update_standings(code, name):
    data = fetch(f"competitions/{code}/standings")
    table = data["standings"][0]["table"]  # tabla general (TOTAL)
    rows = []
    for row in table:
        played = row["playedGames"] or 0
        goals_for = row.get("goalsFor", 0)
        avg_goals = round(goals_for / played, 2) if played else 0
        form_score, form_label = compute_form_index(row.get("form"))
        rows.append({
            "position": row["position"],
            "club": row["team"]["name"],
            "played": played,
            "goalDiff": row["goalDifference"],
            "points": row["points"],
            "avgGoalsFor": avg_goals,
            "formIndex": form_score,
            "formLabel": form_label,
        })
    out = {
        "competition": name,
        "table": rows,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"standings-{code}.json", out)


def update_results(code, name):
    # Rango de fechas en vez de filtro por estado: así seguimos mostrando
    # partidos aunque sea pretemporada o cambie la temporada activa.
    today = datetime.now(timezone.utc).date()
    date_from = (today - timedelta(days=21)).isoformat()
    date_to = (today + timedelta(days=10)).isoformat()
    data = fetch(f"competitions/{code}/matches?dateFrom={date_from}&dateTo={date_to}")
    all_matches = data.get("matches", [])
    print(f"[{name}] La API devolvió {len(all_matches)} partidos entre {date_from} y {date_to}")

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
            "competition": name,
            "home": m["homeTeam"]["name"],
            "away": m["awayTeam"]["name"],
            "homeScore": home_score,
            "awayScore": away_score,
            "homeWin": home_score is not None and away_score is not None and home_score > away_score,
            "awayWin": home_score is not None and away_score is not None and away_score > home_score,
            "status": status_text,
        })
    out = {
        "competition": name,
        "matches": out_matches,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"results-{code}.json", out)


def update_scorers(code, name):
    data = fetch(f"competitions/{code}/scorers?limit=10")
    raw_scorers = data.get("scorers", [])
    print(f"[{name}] La API devolvió {len(raw_scorers)} goleadores")
    scorers = [
        {"name": s["player"]["name"], "goals": s["goals"]}
        for s in raw_scorers
    ]
    out = {
        "competition": name,
        "scorers": scorers,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"topscorers-{code}.json", out)


def write_json(filename, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"Escrito {path}")


def write_competition_list():
    """Guarda qué ligas hay disponibles, para que la web pueda pintar las pestañas."""
    out = [{"code": code, "name": name} for code, name in COMPETITIONS.items()]
    write_json("competitions.json", out)


if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: falta la variable de entorno FOOTBALL_API_KEY", file=sys.stderr)
        sys.exit(1)

    write_competition_list()
    for code, name in COMPETITIONS.items():
        print(f"--- Actualizando {name} ({code}) ---")
        update_standings(code, name)
        update_results(code, name)
        update_scorers(code, name)
