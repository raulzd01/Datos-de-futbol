// Este script lee los archivos data/*.json (que el robot de GitHub Actions
// actualiza solo cada día) y los pinta en la página. No necesitas tocar
// este archivo para que los datos se actualicen: eso lo hace scripts/update_data.py.

let currentLeague = 'PD'; // liga que se muestra al entrar

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

function renderTicker(matches) {
  const el = document.getElementById('ticker');
  if (!el) return;
  if (!matches || matches.length === 0) {
    el.innerHTML = '<div class="ticker-empty">Aún no hay partidos cargados para esta liga. Se actualizará en el próximo ciclo automático.</div>';
    return;
  }
  el.innerHTML = matches.map(m => `
    <div class="match">
      <div class="comp">${m.competition}</div>
      <div class="teams">
        <div class="team-row"><span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span><span class="score">${m.homeScore ?? '—'}</span></div>
        <div class="team-row"><span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span><span class="score">${m.awayScore ?? '—'}</span></div>
      </div>
      <div class="status">${m.status}</div>
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
      loadLeagueData(currentLeague);
    });
  });
}

async function loadLeagueData(code) {
  const [matches, standings, scorers] = await Promise.all([
    loadJSON(`data/results-${code}.json`),
    loadJSON(`data/standings-${code}.json`),
    loadJSON(`data/topscorers-${code}.json`),
  ]);
  renderTicker(matches?.matches);
  renderStandings(standings?.table);
  renderFormIndex(standings?.table);
  renderScorers(scorers?.scorers);

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl && standings?.lastUpdated) {
    const d = new Date(standings.lastUpdated);
    updatedEl.textContent = 'Actualizado: ' + d.toLocaleString('es-ES');
  }
}

async function initHome() {
  const competitions = await loadJSON('data/competitions.json');
  if (competitions && competitions.length) {
    currentLeague = competitions[0].code;
    renderLeagueTabs(competitions);
  }
  loadLeagueData(currentLeague);
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page === 'home' || document.body.dataset.page === 'clasificacion') {
    initHome();
  }
});
