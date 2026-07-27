// Este script lee los archivos data/*.json (que el robot de GitHub Actions
// actualiza solo cada día) y los pinta en la página. No necesitas tocar
// este archivo para que los datos se actualicen: eso lo hace scripts/update_data.py.

let currentLeague = 'PD';   // liga que se muestra al entrar
let currentSeason = null;   // año de inicio de temporada seleccionado (ej. 2025)
let seasonsIndex = {};      // { PD: [2026, 2025, ...], PL: [...], ... } — data/seasons.json

// --- Iconos SVG (trazo simple, heredan color con currentColor) -------------
const ICONS = {
  trophy: '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v4"/><path d="M9 21h6"/><path d="M10 17h4v4h-4z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/><path d="M2.5 20.5h19"/></svg>',
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m12 8 3.6 2.6-1.4 4.2h-4.4L8.4 10.6Z"/><path d="M12 3.5v4.5"/><path d="m5 8 2.2 1.3"/><path d="m19 8-2.2 1.3"/><path d="m8.6 19 1-3.2"/><path d="m15.4 19-1-3.2"/></svg>',
  updown: '<svg viewBox="0 0 24 24"><path d="M8 4 4.5 8h7Z"/><path d="M16 20 19.5 16h-7Z"/><path d="M8 4v16"/><path d="M16 4v16"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 2.5c1 3-3.5 4.5-3.5 8a3.5 3.5 0 0 0 7 0c0-1.2-.6-2-1.2-2.8.8 3-1.3 3.8-1.3 1.3 0-2-3-3.6-1-6.5Z"/><path d="M8 14a4 4 0 0 0 8 0c0-1.7-.7-2.8-1.5-3.8"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3.5h9l3 3v14H6Z"/><path d="M14.5 3.5V7h3.5"/><path d="M8.5 12h7"/><path d="M8.5 15.5h7"/><path d="M8.5 8.5h3"/></svg>',
};

function iconSpan(name){
  return `<span class="icon">${ICONS[name] || ''}</span>`;
}
function iconChip(name, ghost){
  return `<span class="icon-chip${ghost ? ' ghost' : ''}">${iconSpan(name)}</span>`;
}

// --- Escudo de equipo con respaldo de iniciales -----------------------------
// La API gratuita de football-data.org sí ofrece el escudo real (campo
// "crest"), pero de momento el robot solo guarda nombre y resultado. En
// cuanto se guarde también el crest en data/*.json, esta misma función
// empieza a pintar el escudo real sin tocar nada más: basta con pasar la
// URL como segundo argumento. Mientras tanto (o si la imagen falla al
// cargar), se ve un círculo de color con las iniciales del club.
const TEAM_STOPWORDS = new Set(['FC','CF','UD','RC','RCD','SD','CD','AD','CA','SC','AS','de','De','Real','Club','Deportivo','Atlético','Atletico','Sporting']);
function teamInitials(name){
  if (!name) return '?';
  const words = name.split(' ').filter(w => w && !TEAM_STOPWORDS.has(w));
  const source = words.length ? words : name.split(' ');
  if (source.length === 1) return source[0].slice(0, 2).toUpperCase();
  return (source[0][0] + source[1][0]).toUpperCase();
}
function teamColor(name){
  const colors = ['var(--badge-1)','var(--badge-2)','var(--badge-3)','var(--badge-4)','var(--badge-5)'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}
function teamBadgeInner(name, crestUrl) {
  if (crestUrl) {
    const safeName = name.replace(/'/g, "\\'");
    return `<img src="${crestUrl}" alt="" loading="lazy" onerror="this.parentElement.style.background=teamColor('${safeName}');this.parentElement.textContent='${teamInitials(name)}';">`;
  }
  return teamInitials(name);
}
function teamBadge(name, crestUrl, size) {
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;` : '';
  const bg = crestUrl ? '' : `background:${teamColor(name)};`;
  return `<span class="team-badge" style="${style}${bg}">${teamBadgeInner(name, crestUrl)}</span>`;
}
function teamWithBadge(name, crestUrl, size, extraClass) {
  return `<span class="team-with-badge">${teamBadge(name, crestUrl, size)}<span class="${extraClass || ''}">${name}</span></span>`;
}

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
        <div class="team-row">${teamWithBadge(m.home, m.homeCrest, 18, 'team-name ' + (m.homeWin ? 'win' : ''))}<span class="score">${m.homeScore ?? '—'}</span></div>
        <div class="team-row">${teamWithBadge(m.away, m.awayCrest, 18, 'team-name ' + (m.awayWin ? 'win' : ''))}<span class="score">${m.awayScore ?? '—'}</span></div>
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
      <span class="team-with-badge">${teamBadge(m.home, m.homeCrest, 18)}<span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span></span>
      <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
      <span class="team-with-badge">${teamBadge(m.away, m.awayCrest, 18)}<span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span></span>
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
        // El nombre del equipo enlaza a su ficha; el resto de la fila
        // sigue llevando al detalle del partido.
        return `
          <a class="match-row match-row-link" href="${href}">
            <span class="matchday">${dateLabel}</span>
            <span class="team-with-badge" data-team-link="${encodeURIComponent(m.home)}">${teamBadge(m.home, m.homeCrest, 18)}<span class="team-name ${m.homeWin ? 'win' : ''}">${m.home}</span></span>
            <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
            <span class="team-with-badge" data-team-link="${encodeURIComponent(m.away)}">${teamBadge(m.away, m.awayCrest, 18)}<span class="team-name ${m.awayWin ? 'win' : ''}">${m.away}</span></span>
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

function renderStandings(rows, code, season) {
  const el = document.getElementById('standings-body');
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<tr><td colspan="6" class="loading-msg">Clasificación no disponible todavía.</td></tr>';
    return;
  }
  el.innerHTML = rows.map(r => {
    const teamHref = `equipo.html?code=${code}&season=${season}&team=${encodeURIComponent(r.club)}`;
    return `
    <tr class="${r.position <= 4 ? 'top4' : ''} ${r.position >= rows.length - 2 ? 'relegation' : ''}">
      <td class="pos num">${r.position}</td>
      <td class="club"><a href="${teamHref}" class="team-with-badge">${teamBadge(r.club, r.crest, 20)}<span>${r.club}</span></a></td>
      <td class="num">${r.played}</td>
      <td class="num">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td>
      <td class="num pts">${r.points}</td>
      <td class="num mono">${r.avgGoalsFor ?? '—'}</td>
    </tr>
  `;
  }).join('');
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

function renderFormIndex(rows, matches, code, season) {
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
    const teamHref = `equipo.html?code=${code}&season=${season}&team=${encodeURIComponent(r.club)}`;
    return `
    <tr>
      <td class="club"><a href="${teamHref}" class="team-with-badge">${teamBadge(r.club, r.crest, 20)}<span>${r.club}</span></a></td>
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
  renderStandings(standings?.table, code, suffix);
  renderFormIndex(standings?.table, matches?.matches, code, suffix);
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

// --- Helpers SEO: meta description y JSON-LD dinámicos ---------------------
// Estas páginas se pintan con JS (no hay servidor que genere HTML distinto
// por partido/equipo), así que en cuanto tenemos los datos reales,
// actualizamos <title>, <meta name="description"> e inyectamos JSON-LD.
// Google ejecuta el JS antes de indexar, así que esto sí cuenta para SEO,
// pero para redes sociales (Facebook/WhatsApp/Twitter, que NO ejecutan JS)
// no sustituye tener Open Graph estático — eso requeriría generar un
// archivo .html por partido en el propio robot (mejora de Fase 2).
function setMetaDescription(text) {
  let el = document.querySelector('meta[name="description"]');
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', 'description');
    document.head.appendChild(el);
  }
  el.setAttribute('content', text);
}

function setJsonLd(id, data) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
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
  const homeHref = `equipo.html?code=${code}&season=${season}&team=${encodeURIComponent(match.home)}`;
  const awayHref = `equipo.html?code=${code}&season=${season}&team=${encodeURIComponent(match.away)}`;

  el.innerHTML = `
    <div class="match-detail-card">
      <div class="match-detail-meta">${match.matchday ? 'Jornada ' + match.matchday : ''} · ${dateLabel}</div>
      <div class="match-detail-teams">
        <div class="match-detail-team">
          <a href="${homeHref}" class="team-with-badge">${teamBadge(match.home, match.homeCrest, 44)}<span class="team-name ${match.homeWin ? 'win' : ''}">${match.home}</span></a>
        </div>
        <div class="match-detail-score">${match.homeScore ?? '—'} - ${match.awayScore ?? '—'}</div>
        <div class="match-detail-team">
          <a href="${awayHref}" class="team-with-badge">${teamBadge(match.away, match.awayCrest, 44)}<span class="team-name ${match.awayWin ? 'win' : ''}">${match.away}</span></a>
        </div>
      </div>
      <div class="match-detail-status">${match.status}</div>
    </div>
  `;

  // --- SEO dinámico: título, descripción, canonical y JSON-LD ---------------
  const isPlayed = match.status === 'FINALIZADO';
  const scoreText = isPlayed ? `${match.homeScore}-${match.awayScore}` : dateLabel;
  const seoDescription = isPlayed
    ? `Resultado: ${match.home} ${match.homeScore}-${match.awayScore} ${match.away}. ${match.matchday ? 'Jornada ' + match.matchday + '. ' : ''}Consulta el detalle completo del partido en DatosDeFutbol.com.`
    : `${match.home} vs ${match.away}: horario, jornada y previa. ${match.matchday ? 'Jornada ' + match.matchday + '. ' : ''}Sigue el resultado en directo en DatosDeFutbol.com.`;
  setMetaDescription(seoDescription);

  const canonicalUrl = `https://datosdefutbol.com/partido.html?code=${code}&season=${season}&id=${match.id}`;
  setCanonical(canonicalUrl);

  setJsonLd('ld-sportsevent', {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "name": `${match.home} vs ${match.away}`,
    "startDate": match.date,
    "eventStatus": isPlayed ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "homeTeam": { "@type": "SportsTeam", "name": match.home },
    "awayTeam": { "@type": "SportsTeam", "name": match.away },
    ...(isPlayed ? {
      "result": {
        "@type": "SportsEvent",
        "name": `${match.home} ${match.homeScore}-${match.awayScore} ${match.away}`
      }
    } : {})
  });

  setJsonLd('ld-breadcrumb', {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://datosdefutbol.com/index.html" },
      { "@type": "ListItem", "position": 2, "name": "Calendario", "item": "https://datosdefutbol.com/calendario.html" },
      { "@type": "ListItem", "position": 3, "name": `${match.home} vs ${match.away}`, "item": canonicalUrl }
    ]
  });

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

// El HTML no permite anidar <a> dentro de <a> (cada fila de calendario ya
// es un enlace al partido), así que el nombre de equipo se marca con
// data-team-link y navegamos a su ficha por delegación, deteniendo el
// click para que no dispare también el enlace del partido.
function initTeamLinkDelegation() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-team-link]');
    if (!target) return;
    const parentLink = target.closest('.match-row-link');
    const code = getQueryParams().get('code') || currentLeague;
    const season = getQueryParams().get('season') || currentSeason || 'latest';
    e.preventDefault();
    if (parentLink) e.stopPropagation();
    window.location.href = `equipo.html?code=${code}&season=${season}&team=${target.dataset.teamLink}`;
  });
}

// --- Página de ficha de equipo (equipo.html) --------------------------------
// No hay una API de "detalle de equipo": esta página se construye del todo
// a partir de los mismos matches-{code}-{season}.json y standings-{code}-
// {season}.json que ya usan calendario.html y clasificacion.html. Cero
// llamadas nuevas, cero coste añadido de API.
function renderTeamMatchRow(m, teamName, code, season) {
  const d = new Date(m.date);
  const dateLabel = isNaN(d) ? '' : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  const isHome = m.home === teamName;
  const rival = isHome ? m.away : m.home;
  const href = `partido.html?code=${code}&season=${season}&id=${m.id}`;
  return `
    <a class="match-row match-row-link" href="${href}">
      <span class="matchday">${dateLabel}</span>
      <span class="team-name">${isHome ? 'vs' : '@'} ${rival}</span>
      <span class="score">${m.homeScore ?? '—'} - ${m.awayScore ?? '—'}</span>
      <span class="status">${m.status}</span>
    </a>
  `;
}

function renderTeamPage(teamName, standingsRow, matches, code, season, teamCrest) {
  const el = document.getElementById('team-detail');
  if (!el) return;

  if (!standingsRow && (!matches || matches.length === 0)) {
    el.innerHTML = '<div class="loading-msg">No hemos encontrado datos de este equipo para esta temporada.</div>';
    return;
  }

  const played = (matches || []).filter(m => m.status === 'FINALIZADO').sort((a, b) => new Date(b.date) - new Date(a.date));
  const upcoming = (matches || []).filter(m => m.status !== 'FINALIZADO').sort((a, b) => new Date(a.date) - new Date(b.date));
  const lastMatches = played.slice(0, 5);
  const nextMatch = upcoming[0];
  const record10 = computeTeamRecord(matches, teamName, 10);

  el.innerHTML = `
    <div class="match-detail-card">
      ${teamBadge(teamName, teamCrest, 56)}
      <h1 style="font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:28px;margin:10px 0 0;">${teamName}</h1>
    </div>

    <div class="stat-grid">
      ${standingsRow ? `
        <div class="stat-card">${iconChip('trophy')}<span class="stat-value">${standingsRow.position}º</span><span class="stat-label">Posición</span></div>
        <div class="stat-card">${iconChip('chart')}<span class="stat-value">${standingsRow.points}</span><span class="stat-label">Puntos</span></div>
        <div class="stat-card">${iconChip('calendar')}<span class="stat-value">${standingsRow.played}</span><span class="stat-label">Jugados</span></div>
        <div class="stat-card">${iconChip('updown')}<span class="stat-value">${standingsRow.goalDiff > 0 ? '+' : ''}${standingsRow.goalDiff}</span><span class="stat-label">Dif. de gol</span></div>
        <div class="stat-card">${iconChip('ball')}<span class="stat-value">${standingsRow.avgGoalsFor ?? '—'}</span><span class="stat-label">Goles/partido</span></div>
        <div class="stat-card">${iconChip('flame')}<span class="stat-value" style="font-size:15px;">${standingsRow.formLabel ?? '—'}</span><span class="stat-label">Racha</span></div>
      ` : '<p class="loading-msg">Sin datos de clasificación todavía para esta temporada.</p>'}
    </div>

    ${nextMatch ? `
      <h4 class="section-subtitle">${iconChip('calendar')} Próximo partido</h4>
      ${renderTeamMatchRow(nextMatch, teamName, code, season)}
    ` : ''}

    ${record10 ? `<p style="font-size:13px;color:var(--gray);margin:16px 0 4px;">Últimos ${record10.played} partidos: <strong>${formatRecord(record10)}</strong></p>` : ''}

    <h4 class="section-subtitle">Últimos resultados</h4>
    ${lastMatches.length ? lastMatches.map(m => renderTeamMatchRow(m, teamName, code, season)).join('') : '<div class="loading-msg">Sin partidos jugados todavía esta temporada.</div>'}
  `;

  document.title = `${teamName} — resultados, calendario y clasificación — DatosDeFutbol.com`;
  setMetaDescription(`${teamName}: resultados, próximo partido, últimos 10 partidos y posición en la clasificación. Datos actualizados cada jornada en DatosDeFutbol.com.`);
  const canonicalUrl = `https://datosdefutbol.com/equipo.html?code=${code}&season=${season}&team=${encodeURIComponent(teamName)}`;
  setCanonical(canonicalUrl);

  setJsonLd('ld-team', {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    "name": teamName,
    "url": canonicalUrl
  });

  setJsonLd('ld-breadcrumb', {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://datosdefutbol.com/index.html" },
      { "@type": "ListItem", "position": 2, "name": "Clasificación", "item": "https://datosdefutbol.com/clasificacion.html" },
      { "@type": "ListItem", "position": 3, "name": teamName, "item": canonicalUrl }
    ]
  });
}

async function initTeamPage() {
  const params = getQueryParams();
  const code = params.get('code');
  const season = params.get('season');
  const teamName = params.get('team') ? decodeURIComponent(params.get('team')) : null;
  const el = document.getElementById('team-detail');

  if (!code || !season || !teamName) {
    if (el) el.innerHTML = '<div class="loading-msg">Falta información en el enlace para mostrar este equipo.</div>';
    return;
  }

  const suffix = season === 'latest' ? 'latest' : season;
  const [matchesData, standingsData] = await Promise.all([
    loadJSON(`data/matches-${code}-${suffix}.json`),
    loadJSON(`data/standings-${code}-${suffix}.json`),
  ]);
  const teamMatches = (matchesData?.matches || []).filter(m => m.home === teamName || m.away === teamName);
  const standingsRow = (standingsData?.table || []).find(r => r.club === teamName);
  const teamCrest = standingsRow?.crest
    || teamMatches.find(m => m.home === teamName)?.homeCrest
    || teamMatches.find(m => m.away === teamName)?.awayCrest
    || null;
  renderTeamPage(teamName, standingsRow, teamMatches, code, suffix, teamCrest);
}

// Los <h2> de cabecera de sección llevan un atributo data-icon en el HTML
// estático (ej. data-icon="trophy"); aquí se les antepone el SVG real.
// Así el SVG vive en un solo sitio (ICONS) y el HTML se mantiene legible.
function applyHeaderIcons() {
  document.querySelectorAll('h2[data-icon]').forEach(h2 => {
    const name = h2.dataset.icon;
    if (ICONS[name] && !h2.querySelector('.icon-chip')) {
      h2.insertAdjacentHTML('afterbegin', iconChip(name));
    }
  });
}

// Iconos del menú principal (Clasificación, Calendario, Análisis): mismo
// patrón de icon-chip que en las cabeceras, pero en tono "ghost" (fondo
// translúcido) porque aquí van sobre el verde oscuro del header, no sobre
// una cajita blanca.
function applyNavIcons() {
  document.querySelectorAll('nav a[data-icon]').forEach(a => {
    const name = a.dataset.icon;
    if (ICONS[name] && !a.querySelector('.icon-chip')) {
      a.insertAdjacentHTML('afterbegin', iconChip(name));
    }
  });
}

// --- AdSense + consentimiento de cookies ------------------------------------
// El script base de AdSense (adsbygoogle.js) ya está puesto de forma fija
// en el <head> de cada página — Google exige que esté ahí, sin condiciones,
// para poder verificar el sitio. Cargar ese script por sí solo no muestra
// ningún anuncio todavía (no hay unidades de anuncio creadas). El banner de
// cookies de aquí abajo sigue siendo necesario para cuando se añadan
// unidades de anuncio reales: ADS_READY se pondrá a true en ese momento, y
// solo entonces se pedirán anuncios (personalizados si hay consentimiento,
// no personalizados si no lo hay).
const ADS_READY = false; // pásalo a true cuando crees tu primera unidad de anuncio

function getCookieConsent() {
  try { return localStorage.getItem('ddf_cookie_consent'); } catch (e) { return null; }
}
function setCookieConsent(value) {
  try { localStorage.setItem('ddf_cookie_consent', value); } catch (e) { /* Safari privado, etc. */ }
}

function requestAds(personalized) {
  if (!ADS_READY) return;
  window.adsbygoogle = window.adsbygoogle || [];
  document.querySelectorAll('ins.adsbygoogle:not([data-ad-status])').forEach(() => {
    window.adsbygoogle.push(personalized ? {} : { params: { npa: '1' } });
  });
}

function initCookieBanner() {
  const consent = getCookieConsent();
  if (consent === 'accepted') { requestAds(true); return; }
  if (consent === 'rejected') { requestAds(false); return; }

  const base = window.location.pathname.includes('/articulos/') ? '../' : '';
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <p>Usamos cookies técnicas necesarias para el sitio y, si las aceptas, cookies de publicidad (Google AdSense) para poder mantener DatosDeFutbol.com gratis. Más info en la <a href="${base}privacidad.html">Política de Privacidad</a>.</p>
    <div class="cookie-actions">
      <button class="cookie-reject" type="button">Rechazar</button>
      <button class="cookie-accept" type="button">Aceptar</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector('.cookie-accept').addEventListener('click', () => {
    setCookieConsent('accepted');
    requestAds(true);
    banner.remove();
  });
  banner.querySelector('.cookie-reject').addEventListener('click', () => {
    setCookieConsent('rejected');
    requestAds(false);
    banner.remove();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyHeaderIcons();
  applyNavIcons();
  initCookieBanner();
  initTeamLinkDelegation();
  if (document.body.dataset.page === 'home' || document.body.dataset.page === 'clasificacion' || document.body.dataset.page === 'calendario') {
    initHome();
  }
  if (document.body.dataset.page === 'partido') {
    initMatchPage();
  }
  if (document.body.dataset.page === 'equipo') {
    initTeamPage();
  }
});
