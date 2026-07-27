// Este script lee los archivos data/*.json (que el robot de GitHub Actions
// actualiza solo cada día) y los pinta en la página. No necesitas tocar
// este archivo para que los datos se actualicen: eso lo hace scripts/update_data.py.

let currentLeague = 'PD';   // liga que se muestra al entrar
let currentSeason = null;   // año de inicio de temporada seleccionado (ej. 2025)
let seasonsIndex = {};      // { PD: [2026, 2025, ...], PL: [...], ... } — data/seasons.json

async function loadJSON(path) {
  try {
    const res = await fetch(path + '?t=' + Date.now()); // evita caché vieja
    if (!res.ok) throw new Error('No se pudo cargar ' + path);
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// --- Ticker de últimos resultados / próximos partidos ---------------------
// Antes venía de un archivo aparte (results-{code}.json). Ahora lo
// calculamos aquí mismo a partir de la temporada completa: así funciona
// igual de bien viendo la temporada actual o una pasada.
function computeTickerMatches(allMatches) {
  if (!allMatches || allMatches.length === 0) return [];
  const now = new Date();
  const played = allMatches.filter(m => m.status === 'FINALIZADO' || m.status === 'EN JUEGO');
  const upcoming = allMatches.filter(m => new Date(m.date) > now && m.status !== 'FINALIZADO' && m.status !== 'EN JUEGO');
  const recentPlayed = played.slice(-10);
  const remainingSlots = Math.max(0, 10 - recentPlayed.length);
  return [...recentPlayed, ...upcoming.slice(0, remainingSlots)];
}

function renderTicker(matches) {
  const el = document.getElementById('ticker');
  if (!el) return;
  const tickerMatches = computeTickerMatches(matches);
  if (tickerMatches.length === 0) {
    el.innerHTML = '<div class="ticker-empty">Aún no hay partidos cargados para esta liga y temporada.</div>';
    return;
  }
  el.innerHTML = tickerMatches.map(m => `
    <div class="match">
      <div class="comp">${m.competition ?? ''}</div>
      <div class="teams">
        <div class="team-row"><span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span><span class="score">${m.homeScore ?? '—'}</span></div>
        <div class="team-row"><span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span><span class="score">${m.awayScore ?? '—'}</span></div>
      </div>
      <div class="status">${m.status}</div>
    </div>
  `).join('');
}

// --- Lista de partidos completa (jornada a jornada) ------------------------
function renderMatchList(matches) {
  const el = document.getElementById('match-list-body');
  if (!el) return; // esta sección solo existe en algunas páginas
  if (!matches || matches.length === 0) {
    el.innerHTML = '<div class="loading-msg">No hay partidos para esta temporada todavía.</div>';
    return;
  }
  // Más reciente primero
  const sorted = [...matches].sort((a, b) => new Date(b.date) - new Date(a.date));
  el.innerHTML = sorted.map(m => `
    <div class="match-row">
      <span class="matchday">${m.matchday ? 'J' + m.matchday : ''}</span>
      <span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span>
      <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
      <span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span>
      <span class="status">${m.status}</span>
    </div>
  `).join('');
}

// --- Calendario (jornada a jornada, agrupado por fecha) --------------------
function renderCalendar(matches, code, season) {
  const el = document.getElementById('calendar-body');
  if (!el) return; // esta sección solo existe en calendario.html
  if (!matches || matches.length === 0) {
    el.innerHTML = '<div class="loading-msg">No hay partidos para esta temporada todavía.</div>';
    return;
  }
  const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Agrupamos por jornada manteniendo el orden de aparición.
  const groups = [];
  let currentGroup = null;
  for (const m of sorted) {
    const label = m.matchday ? `Jornada ${m.matchday}` : 'Sin jornada asignada';
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, matches: [] };
      groups.push(currentGroup);
    }
    currentGroup.matches.push(m);
  }

  // La "jornada actual" es la primera que todavía tiene algún partido sin
  // terminar. Si ya se jugó toda la temporada, nos quedamos en la última.
  let currentIndex = groups.findIndex(g => g.matches.some(m => m.status !== 'FINALIZADO'));
  if (currentIndex === -1) currentIndex = groups.length - 1;

  el.innerHTML = groups.map((g, i) => `
    <div class="matchday-group" id="jornada-group-${i}">
      <h4 class="matchday-title">${g.label}</h4>
      ${g.matches.map(m => {
        const d = new Date(m.date);
        const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
        const href = `partido.html?code=${code}&season=${season}&id=${m.id}`;
        return `
          <a class="match-row match-row-link" href="${href}">
            <span class="matchday">${dateLabel}</span>
            <span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span>
            <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
            <span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span>
            <span class="status">${m.status}</span>
          </a>
        `;
      }).join('')}
    </div>
  `).join('');

  renderMatchdaySelector(groups, currentIndex);

  const target = document.getElementById(`jornada-group-${currentIndex}`);
  if (target) target.scrollIntoView({ block: 'start' });
}

// Desplegable para saltar directamente a una jornada, sin tener que
// desplazarse manualmente por todo el calendario.
function renderMatchdaySelector(groups, currentIndex) {
  const el = document.getElementById('matchday-selector');
  if (!el) return;
  el.innerHTML = groups.map((g, i) => `
    <option value="${i}" ${i === currentIndex ? 'selected' : ''}>${g.label}</option>
  `).join('');
}

function initMatchdaySelector() {
  const el = document.getElementById('matchday-selector');
  if (!el) return;
  el.addEventListener('change', () => {
    const target = document.getElementById(`jornada-group-${el.value}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderStandings(rows) {
  const el = document.getElementById('standings-body');
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<tr><td colspan="6" class="loading-msg">Clasificación no disponible todavía.</td></tr>';
    return;
  }
  el.innerHTML = rows.map(r => `
    <tr class="${r.position <= 4 ? 'top4' : ''} ${r.position >= rows.length - 2 ? 'relegation' : ''}">
      <td class="pos num">${r.position}</td>
      <td class="club">${r.club}</td>
      <td class="num">${r.played}</td>
      <td class="num">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td>
      <td class="num pts">${r.points}</td>
      <td class="num mono">${r.avgGoalsFor ?? '—'}</td>
    </tr>
  `).join('');
}

// Calcula el récord (victorias-empates-derrotas) de un equipo en sus
// últimos N partidos jugados, usando el historial completo de la
// temporada que ya tenemos cargado (no depende de la API externa).
function computeTeamRecord(matches, teamName, n) {
  if (!matches) return null;
  const played = matches
    .filter(m => (m.home === teamName || m.away === teamName) && m.status === 'FINALIZADO')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, n);
  if (played.length === 0) return null;
  let w = 0, d = 0, l = 0;
  for (const m of played) {
    const isHome = m.home === teamName;
    const won = isHome ? m.homeWin : m.awayWin;
    const lost = isHome ? m.awayWin : m.homeWin;
    if (won) w++;
    else if (lost) l++;
    else d++;
  }
  return { w, d, l, played: played.length };
}

function formatRecord(record) {
  if (!record) return '—';
  return `${record.w}V ${record.d}E ${record.l}D`;
}

function renderFormIndex(rows, matches) {
  const el = document.getElementById('form-index-body');
  if (!el) return;
  const withForm = (rows || []).filter(r => r.formIndex !== null && r.formIndex !== undefined);
  if (withForm.length === 0) {
    el.innerHTML = '<tr><td colspan="5" class="loading-msg">Todavía no hay suficiente historial esta temporada para calcular el Índice de Forma.</td></tr>';
    return;
  }
  const sorted = [...withForm].sort((a, b) => b.formIndex - a.formIndex);
  el.innerHTML = sorted.map(r => {
    const record5 = computeTeamRecord(matches, r.club, 5);
    const record10 = computeTeamRecord(matches, r.club, 10);
    return `
    <tr>
      <td class="club">${r.club}</td>
      <td class="num pts">${r.formIndex}</td>
      <td>${r.formLabel}</td>
      <td class="num mono">${formatRecord(record5)}</td>
      <td class="num mono">${formatRecord(record10)}</td>
    </tr>
  `;
  }).join('');
}

function renderScorers(list) {
  const el = document.getElementById('topscorers-list');
  if (!el) return;
  if (!list || list.length === 0) {
    el.innerHTML = '<li class="loading-msg">Sin datos todavía.</li>';
    return;
  }
  el.innerHTML = list.map((s, i) => `
    <li><span class="rank">${i + 1}</span><span>${s.name}</span><span class="goals">${s.goals}</span></li>
  `).join('');
}

function renderLeagueTabs(competitions) {
  const el = document.getElementById('league-tabs');
  if (!el || !competitions) return;
  el.innerHTML = competitions.map(c => `
    <button class="league-tab ${c.code === currentLeague ? 'active' : ''}" data-code="${c.code}">${c.name}</button>
  `).join('');
  el.querySelectorAll('.league-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLeague = btn.dataset.code;
      el.querySelectorAll('.league-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Al cambiar de liga, la temporada más reciente disponible puede
      // no ser la misma que en la liga anterior, así que la reseteamos.
      currentSeason = (seasonsIndex[currentLeague] && seasonsIndex[currentLeague][0]) ?? null;
      renderSeasonSelector();
      loadLeagueData(currentLeague, currentSeason);
    });
  });
}

// --- Selector de temporada ---------------------------------------------
function renderSeasonSelector() {
  const el = document.getElementById('season-selector');
  if (!el) return;
  const years = seasonsIndex[currentLeague] || [];
  if (years.length <= 1) {
    // Con una sola temporada disponible no hace falta selector todavía.
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = years.map(y => `
    <option value="${y}" ${y === currentSeason ? 'selected' : ''}>Temporada ${y}/${String(y + 1).slice(2)}</option>
  `).join('');
}

function initSeasonSelector() {
  const el = document.getElementById('season-selector');
  if (!el) return;
  el.addEventListener('change', () => {
    currentSeason = parseInt(el.value, 10);
    loadLeagueData(currentLeague, currentSeason);
  });
}

async function loadLeagueData(code, season) {
  // Si no tenemos temporada (primera carga antes de leer seasons.json)
  // usamos los archivos "-latest" que siempre apuntan a la temporada activa.
  const suffix = season ?? 'latest';
  const [matches, standings, scorers] = await Promise.all([
    loadJSON(`data/matches-${code}-${suffix}.json`),
    loadJSON(`data/standings-${code}-${suffix}.json`),
    loadJSON(`data/topscorers-${code}-${suffix}.json`),
  ]);
  renderTicker(matches?.matches);
  renderMatchList(matches?.matches);
  renderCalendar(matches?.matches, code, suffix);
  renderStandings(standings?.table);
  renderFormIndex(standings?.table, matches?.matches);
  renderScorers(scorers?.scorers);

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl && standings?.lastUpdated) {
    const d = new Date(standings.lastUpdated);
    const seasonTag = standings.season ? ` · Temporada ${standings.season}/${String(standings.season + 1).slice(2)}` : '';
    updatedEl.textContent = 'Actualizado: ' + d.toLocaleString('es-ES') + seasonTag;
  }
}

async function initHome() {
  const [competitions, seasons] = await Promise.all([
    loadJSON('data/competitions.json'),
    loadJSON('data/seasons.json'),
  ]);
  seasonsIndex = seasons || {};

  if (competitions && competitions.length) {
    currentLeague = competitions[0].code;
    renderLeagueTabs(competitions);
  }
  currentSeason = (seasonsIndex[currentLeague] && seasonsIndex[currentLeague][0]) ?? null;
  renderSeasonSelector();
  initSeasonSelector();
  initMatchdaySelector();
  loadLeagueData(currentLeague, currentSeason);
}

// --- Página de detalle de un partido (partido.html) ------------------------
function getQueryParams() {
  return new URLSearchParams(window.location.search);
}

function renderMatchDetail(match, allMatches, code, season) {
  const el = document.getElementById('match-detail');
  if (!el) return;

  if (!match) {
    el.innerHTML = '<div class="loading-msg">No hemos encontrado ese partido. Puede que el enlace esté mal o que la temporada aún no tenga datos.</div>';
    return;
  }

  const d = new Date(match.date);
  const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <div class="match-detail-card">
      <div class="match-detail-meta">${match.matchday ? 'Jornada ' + match.matchday : ''} · ${dateLabel}</div>
      <div class="match-detail-teams">
        <div class="match-detail-team">
          <span class="team-name ${match.homeWin ? 'win' : ''}">${match.home}</span>
        </div>
        <div class="match-detail-score">${match.homeScore ?? '—'} - ${match.awayScore ?? '—'}</div>
        <div class="match-detail-team">
          <span class="team-name ${match.awayWin ? 'win' : ''}">${match.away}</span>
        </div>
      </div>
      <div class="match-detail-status">${match.status}</div>
    </div>
  `;

  // Otros partidos de la misma jornada, para poder navegar sin volver atrás.
  const othersEl = document.getElementById('matchday-others');
  if (othersEl && allMatches) {
    const others = allMatches.filter(m => m.matchday === match.matchday && m.id !== match.id);
    if (others.length === 0) {
      othersEl.innerHTML = '';
    } else {
      othersEl.innerHTML = `
        <h4 class="section-subtitle">Más partidos de esta jornada</h4>
        ${others.map(m => `
          <a class="match-row match-row-link" href="partido.html?code=${code}&season=${season}&id=${m.id}">
            <span class="matchday"></span>
            <span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span>
            <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
            <span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span>
            <span class="status">${m.status}</span>
          </a>
        `).join('')}
      `;
    }
  }

  document.title = `${match.home} ${match.homeScore ?? ''}-${match.awayScore ?? ''} ${match.away} — DatosDeFutbol.com`;
}

async function initMatchPage() {
  const params = getQueryParams();
  const code = params.get('code');
  const season = params.get('season');
  const id = params.get('id');
  const el = document.getElementById('match-detail');

  if (!code || !season || !id) {
    if (el) el.innerHTML = '<div class="loading-msg">Falta información en el enlace para mostrar este partido.</div>';
    return;
  }

  const data = await loadJSON(`data/matches-${code}-${season}.json`);
  const match = data?.matches?.find(m => String(m.id) === String(id));
  renderMatchDetail(match, data?.matches, code, season);
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page === 'home' || document.body.dataset.page === 'clasificacion' || document.body.dataset.page === 'calendario') {
    initHome();
  }
  if (document.body.dataset.page === 'partido') {
    initMatchPage();
  }
});
