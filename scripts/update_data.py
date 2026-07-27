"""
Este script se conecta a football-data.org y descarga, para cada liga
configurada en COMPETITIONS: clasificación, TODOS los partidos de la
temporada y máximos goleadores. Además calcula dos métricas propias (no
vienen así de la API, las calculamos nosotros):

  - "Índice de Forma DDF": una puntuación 0-100 a partir del historial
    reciente de cada equipo (campo "form" que da la API), ponderando más
    los partidos más recientes.
  - "Media de goles por partido": goles a favor / partidos jugados.

CAMBIOS respecto a la versión anterior:
  1. Ya NO se deja que la API decida sola qué "temporada actual" usar.
     football-data.org a veces rota su puntero de temporada antes de que
     esa temporada tenga partidos reales (esto causaba el bug de Ligue 1
     y Serie A saliendo vacíos: todos en posición 1, 0 partidos jugados).
     Ahora se pide la temporada de forma explícita (?season=YYYY) y, si
     esa temporada aparece con 0 partidos jugados en toda la tabla, se
     cae automáticamente a la temporada anterior.
  2. Los datos ya NO se sobrescriben: se guardan por temporada
     (standings-PD-2025.json, matches-PD-2025.json...), así que cuando
     empiece la temporada 2026-27 los datos de 2025-26 siguen
     disponibles para consultar.
  3. Se guardan TODOS los partidos de la temporada (antes solo se
     guardaba una ventana de -21/+10 días), para poder navegar
     resultado a resultado de toda la temporada.
  4. Se genera data/seasons.json: qué temporadas hay disponibles por
     liga, para que la web pueda pintar un selector de temporada.

NO incluye: tiros, córners, posesión ni tarjetas por partido. El plan
gratuito (ni siquiera el de pago) de football-data.org no ofrece esas
estadísticas. Para eso haría falta otra API (ej. API-Football), que es
de pago — pendiente para la "Fase 2" del proyecto.

No necesitas ejecutar esto a mano: el robot programado en
.github/workflows/update-data.yml lo ejecuta solo cada día.

Requiere una variable de entorno FOOTBALL_API_KEY con tu clave gratuita
de https://www.football-data.org/client/register
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
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

# El plan gratuito permite 10 peticiones/minuto.
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


def get_available_seasons(code):
    """
    Consulta la info de la competición y devuelve la lista de temporadas
    disponibles, ordenadas de más reciente a más antigua. Cada elemento
    es un dict con "year" (año de inicio, sacado de startDate) y "startDate".

    OJO: el campo "id" que devuelve la API es un identificador interno
    de su base de datos (ej. 2518), NO el año de la temporada. El año
    hay que sacarlo de "startDate" (ej. "2025-08-15" -> 2025).
    """
    data = fetch(f"competitions/{code}")
    seasons = data.get("seasons", [])
    for s in seasons:
        s["year"] = int(s["startDate"][:4])
    seasons_sorted = sorted(seasons, key=lambda s: s["startDate"], reverse=True)
    return seasons_sorted


def pick_working_season(code):
    """
    Elige la temporada a usar: la más reciente que YA tenga partidos
    jugados de verdad. Si la más reciente aparece con 0 partidos jugados
    (caso del bug: la API ya apunta a la siguiente temporada pero aún no
    ha arrancado), se prueba con la anterior.

    Devuelve (season_year, standings_table) donde standings_table es la
    tabla ("TOTAL") ya obtenida para esa temporada, para no repetir la
    llamada.
    """
    seasons = get_available_seasons(code)
    MAX_ATTEMPTS = 3  # no tiene sentido seguir probando temporadas muy antiguas
    attempts = 0
    for season in seasons:
        if attempts >= MAX_ATTEMPTS:
            break
        year = season["year"]  # año de inicio, sacado de startDate
        attempts += 1
        try:
            data = fetch(f"competitions/{code}/standings?season={year}")
        except HTTPError as e:
            if e.code in (400, 403, 404):
                # 404: la API no tiene creado el recurso para esta temporada
                #      (típico de temporadas futuras que aún no arrancaron).
                # 400/403: el plan gratuito no permite acceder a esta
                #      temporada (restricción de suscripción, no un bug).
                print(f"[{code}] Temporada {year} no accesible (HTTP {e.code}), probando la anterior...")
                continue
            raise
        table = data["standings"][0]["table"]
        total_played = sum(row.get("playedGames") or 0 for row in table)
        if total_played > 0:
            return year, table
        print(f"[{code}] Temporada {year} sin partidos jugados aún, probando la anterior...")

    raise RuntimeError(
        f"[{code}] No se ha encontrado ninguna temporada utilizable en los "
        f"últimos {MAX_ATTEMPTS} intentos (ni por falta de partidos ni por "
        f"restricciones del plan gratuito de la API)."
    )


def update_standings(code, name, season_year, table):
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
        "season": season_year,
        "table": rows,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"standings-{code}-{season_year}.json", out)
    write_json(f"standings-{code}-latest.json", out)


def update_matches(code, name, season_year):
    """
    Guarda TODOS los partidos de la temporada (jugados y por jugar), no
    solo una ventana de fechas. Esto permite navegar resultado a
    resultado de toda la temporada, no solo lo más reciente.
    """
    data = fetch(f"competitions/{code}/matches?season={season_year}")
    all_matches = data.get("matches", [])
    print(f"[{name}] Temporada {season_year}: {len(all_matches)} partidos en total")

    all_matches.sort(key=lambda m: m["utcDate"])

    out_matches = []
    for m in all_matches:
        home_score = m["score"]["fullTime"]["home"]
        away_score = m["score"]["fullTime"]["away"]
        if m["status"] == "SCHEDULED":
            match_date = datetime.fromisoformat(m["utcDate"].replace("Z", "+00:00"))
            status_text = match_date.strftime("%d/%m %H:%M")
        elif m["status"] in ("IN_PLAY", "LIVE"):
            status_text = "EN JUEGO"
        elif m["status"] == "FINISHED":
            status_text = "FINALIZADO"
        else:
            status_text = m["status"]
        out_matches.append({
            "id": m["id"],
            "matchday": m.get("matchday"),
            "date": m["utcDate"],
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
        "season": season_year,
        "matches": out_matches,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"matches-{code}-{season_year}.json", out)
    write_json(f"matches-{code}-latest.json", out)


def update_scorers(code, name, season_year):
    data = fetch(f"competitions/{code}/scorers?season={season_year}&limit=10")
    raw_scorers = data.get("scorers", [])
    print(f"[{name}] La API devolvió {len(raw_scorers)} goleadores")
    scorers = [
        {"name": s["player"]["name"], "goals": s["goals"]}
        for s in raw_scorers
    ]
    out = {
        "competition": name,
        "season": season_year,
        "scorers": scorers,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    write_json(f"topscorers-{code}-{season_year}.json", out)
    write_json(f"topscorers-{code}-latest.json", out)


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


def load_existing_seasons_index():
    """
    Lee el seasons.json ya existente en el repo (si lo hay), para no
    perder el histórico de temporadas de ejecuciones anteriores. Solo
    listamos aquí las temporadas de las que REALMENTE tenemos archivos
    guardados (standings-{code}-{año}.json), no todas las que existen
    en la API — así el selector de la web nunca apunta a un archivo
    que no existe.
    """
    path = os.path.join(DATA_DIR, "seasons.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    if not API_KEY:
        print("ERROR: falta la variable de entorno FOOTBALL_API_KEY", file=sys.stderr)
        sys.exit(1)

    write_competition_list()

    seasons_by_competition = load_existing_seasons_index()
    failed_competitions = []

    for code, name in COMPETITIONS.items():
        print(f"--- Actualizando {name} ({code}) ---")
        try:
            working_year, table = pick_working_season(code)
            print(f"[{name}] Usando temporada {working_year}")

            update_standings(code, name, working_year, table)
            update_matches(code, name, working_year)
            update_scorers(code, name, working_year)

            existing_years = set(seasons_by_competition.get(code, []))
            existing_years.add(working_year)
            seasons_by_competition[code] = sorted(existing_years, reverse=True)
        except Exception as e:
            # Si una liga falla (temporada bloqueada, error de la API...),
            # que no tumbe la actualización de las demás. Se deja tal cual
            # estaba esa liga y seguimos con la siguiente.
            print(f"[{name}] ERROR, se deja sin actualizar esta vez: {e}", file=sys.stderr)
            failed_competitions.append(name)

    write_json("seasons.json", seasons_by_competition)

    if failed_competitions:
        # Aviso en los logs, pero salimos con código 0 a propósito: si
        # saliéramos con error, GitHub Actions no ejecutaría el siguiente
        # paso (guardar cambios en git) y se perderían también los datos
        # de las ligas que SÍ se actualizaron bien.
        print(f"Terminado con avisos. Ligas no actualizadas: {', '.join(failed_competitions)}", file=sys.stderr)
