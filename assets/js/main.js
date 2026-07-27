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

function renderFormIndex(rows) {
  const el = document.getElementById('form-index-body');
  if (!el) return;
  const withForm = (rows || []).filter(r => r.formIndex !== null && r.formIndex !== undefined);
  if (withForm.length === 0) {
    el.innerHTML = '<tr><td colspan="3" class="loading-msg">Todavía no hay suficiente historial esta temporada para calcular el Índice de Forma.</td></tr>';
    return;
  }
  const sorted = [...withForm].sort((a, b) => b.formIndex - a.formIndex);
  el.innerHTML = sorted.map(r => `
    <tr>
      <td class="club">${r.club}</td>
      <td class="num pts">${r.formIndex}</td>
      <td>${r.formLabel}</td>
    </tr>
  `).join('');
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
  renderStandings(standings?.table);
  renderFormIndex(standings?.table);
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
  loadLeagueData(currentLeague, currentSeason);
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page === 'home' || document.body.dataset.page === 'clasificacion') {
    initHome();
  }
});
