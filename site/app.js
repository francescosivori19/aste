'use strict';
// ---------- costanti ----------
const TIPI = [
  ['casa', '🏠 Case'],
  ['magazzino', '🏭 Magazzini e capannoni'],
  ['terreno', '🌾 Terreni'],
  ['commerciale', '🏪 Negozi e uffici'],
  ['garage', '🚗 Garage e posti auto'],
  ['altro', '❓ Altro'],
];
const SHARDS = 64;
const PVP = (id) => `https://pvp.giustizia.it/pvp/it/detail_annuncio.page?idAnnuncio=${id}`;
const LS = {
  get(k, d) { try { const v = localStorage.getItem('aste.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('aste.' + k, JSON.stringify(v)); } catch {} },
};

// ---------- stato ----------
let ALL = [];            // index.json
let RESULTS = [];        // filtrate
let shown = 0;
const detCache = new Map();
// Zone rapide: comuni costieri, in ordine da ovest a est
const ZONE = {
  'Levante: Bogliasco – Lerici': 'Bogliasco, Pieve Ligure, Sori, Recco, Camogli, Portofino, Santa Margherita Ligure, Rapallo, Zoagli, Chiavari, Lavagna, Sestri Levante, Moneglia, Deiva Marina, Framura, Bonassola, Levanto, Monterosso al Mare, Vernazza, Riomaggiore, Porto Venere, Portovenere, La Spezia, Lerici',
};
const ZONA_DEFAULT = ZONE['Levante: Bogliasco – Lerici'];
const DEFAULT_F = { tipi: ['casa', 'magazzino', 'terreno'], zona: 'cap', area: null, caps: ZONA_DEFAULT, pmin: '', pmax: '', dmin: '', dmax: '', libero: false, nonscaduti: true, preciso: false, testo: '', sort: 'data' };
let F = { ...DEFAULT_F, ...LS.get('filtri', {}) };
if (!LS.get('zonaLevante', false)) { F.zona = 'cap'; F.caps = ZONA_DEFAULT; LS.set('zonaLevante', true); } // applica una volta la zona richiesta
let favs = new Set(LS.get('preferiti', []).map(String));
const lastVisit = LS.get('ultimaVisita', null);

// ---------- utilità ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (n || n === 0) ? n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0, useGrouping: 'always' }) : '—';
const trib = (a) => (a.trib || '').replace(/^Tribunale di /i, '');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const parseDT = (s) => s ? new Date(s.length <= 10 ? s + 'T00:00' : s) : null;
const fmtD = (s, ora = true) => {
  const d = parseDT(s); if (!d || isNaN(d)) return '—';
  const o = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
  if (ora && s.length > 10) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('it-IT', o);
};
const giorniA = (s) => { const d = parseDT(s); return d ? Math.ceil((d - Date.now()) / 864e5) : null; };
const tipoLabel = (t) => (TIPI.find((x) => x[0] === t) || [, t])[1];

function inPoly(ll, poly) { // ray casting su [lat,lng]
  const [y, x] = ll; let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- filtri ----------
function applyFilters() {
  const tokens = F.caps.split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const pmin = Number(F.pmin) || 0, pmax = Number(F.pmax) || Infinity;
  const testo = F.testo.trim().toLowerCase();
  const now = new Date().toISOString().slice(0, 16);
  RESULTS = ALL.filter((a) => {
    if (!a.t.some((t) => F.tipi.includes(t))) return false;
    if (a.p < pmin || a.p > pmax) return false;
    if (F.dmin && a.dv.slice(0, 10) < F.dmin) return false;
    if (F.dmax && a.dv.slice(0, 10) > F.dmax) return false;
    if (F.libero && !(a.disp && a.disp.includes('Libero'))) return false;
    if (F.nonscaduti && (a.to || a.dv).slice(0, 16) < now) return false;
    if (F.preciso && (a.approx || !a.ll)) return false;
    if (F.zona === 'area') {
      if (!F.area || !a.ll || !inPoly(a.ll, F.area)) return false;
    } else if (F.zona === 'cap' && tokens.length) {
      const cap = a.cap || '', com = (a.com || '').toLowerCase();
      if (!tokens.some((t) => /^\d+$/.test(t) ? cap.startsWith(t) : com === t || com.startsWith(t + ' '))) return false;
    }
    if (testo && !`${a.desc} ${a.via} ${a.com} ${a.trib} ${a.mod}`.toLowerCase().includes(testo)) return false;
    return true;
  });
  sortResults();
  LS.set('filtri', F);
  $('#count').textContent = `· ${RESULTS.length.toLocaleString('it-IT')} risultati`;
  renderList(true);
  renderMap();
}
function sortResults() {
  const s = F.sort;
  const eurmq = (a) => (a.mq ? a.p / a.mq : Infinity);
  RESULTS.sort(
    s === 'prezzo' ? (a, b) => a.p - b.p :
    s === 'prezzo-desc' ? (a, b) => b.p - a.p :
    s === 'nuove' ? (a, b) => (b.pub || '').localeCompare(a.pub || '') :
    s === 'eurmq' ? (a, b) => eurmq(a) - eurmq(b) :
    (a, b) => a.dv.localeCompare(b.dv));
}

function readForm() {
  F.tipi = [...document.querySelectorAll('#tipi input:checked')].map((i) => i.value);
  F.zona = document.querySelector('input[name=zona]:checked').value;
  F.caps = $('#caps').value; F.pmin = $('#pmin').value; F.pmax = $('#pmax').value;
  F.dmin = $('#dmin').value; F.dmax = $('#dmax').value;
  F.libero = $('#libero').checked; F.nonscaduti = $('#nonscaduti').checked; F.preciso = $('#preciso').checked;
  F.testo = $('#testo').value;
}
function writeForm() {
  $('#zone-rapide').innerHTML = Object.keys(ZONE).map((k) => `<label data-zona="${esc(k)}">📍 ${esc(k)}</label>`).join('');
  $('#tipi').innerHTML = TIPI.map(([v, l]) => `<label><input type="checkbox" value="${v}" ${F.tipi.includes(v) ? 'checked' : ''}>${l}</label>`).join('');
  document.querySelector(`input[name=zona][value=${F.zona}]`).checked = true;
  $('#caps').value = F.caps; $('#pmin').value = F.pmin; $('#pmax').value = F.pmax;
  $('#dmin').value = F.dmin; $('#dmax').value = F.dmax;
  $('#libero').checked = F.libero; $('#nonscaduti').checked = F.nonscaduti; $('#preciso').checked = F.preciso;
  $('#testo').value = F.testo; $('#sort').value = F.sort;
  zonaUI();
}
function zonaUI() {
  const z = document.querySelector('input[name=zona]:checked').value;
  $('#zona-area').classList.toggle('hidden', z !== 'area');
  $('#zona-cap').classList.toggle('hidden', z !== 'cap');
  $('#area-status').textContent = F.area ? `Area con ${F.area.length} vertici` : 'Nessuna area disegnata';
  $('#btn-clear-area').classList.toggle('hidden', !(F.zona === 'area' && F.area));
}

// ---------- elenco ----------
function tagsHtml(a) {
  const t = [];
  if (lastVisit && a.pub && a.pub > lastVisit.slice(0, 10)) t.push('<span class="tag new">Nuova</span>');
  if (a.src === 'notai') t.push('<span class="tag warn">Asta notarile</span>');
  for (const x of a.t) t.push(`<span class="tag">${esc(tipoLabel(x).replace(/^\S+\s/, ''))}</span>`);
  for (const d of a.disp || []) t.push(`<span class="tag ${d === 'Libero' ? 'ok' : d.startsWith('Occupato') ? 'bad' : 'warn'}">${esc(d)}</span>`);
  if (a.mod) t.push(`<span class="tag">${esc(a.mod)}</span>`);
  if (a.approx) t.push('<span class="tag warn">Posizione stimata</span>');
  return `<div class="tags">${t.join('')}</div>`;
}
function cardHtml(a) {
  const g = giorniA(a.dv);
  return `<li class="card" data-id="${a.id}">
    <div class="price">${eur(a.p)} <span class="muted small">${a.om ? `min. ${eur(a.om)}` : ''}${a.mq ? ` · ${a.mq} m² · ${eur(Math.round(a.p / a.mq))}/m²` : ''}</span></div>
    <div class="meta">📅 ${fmtD(a.dv)}${g != null && g >= 0 ? ` (tra ${g} gg)` : ''}</div>
    <div class="meta">📍 ${esc(a.com || '')}${a.prov ? ` (${esc(a.prov)})` : ''}${a.cap ? ` · ${esc(a.cap)}` : ''}</div>
    <div class="desc">${esc(a.desc || '')}${(a.desc || '').length >= 110 ? '…' : ''}</div>
    ${tagsHtml(a)}
  </li>`;
}
function renderList(reset) {
  if (reset) { shown = 0; $('#list').innerHTML = ''; $('#v-elenco').scrollTop = 0; }
  const next = RESULTS.slice(shown, shown + 100);
  $('#list').insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
  shown += next.length;
  $('#listcount').textContent = `${RESULTS.length.toLocaleString('it-IT')} aste`;
  $('#more').classList.toggle('hidden', shown >= RESULTS.length);
}

// ---------- mappa ----------
let map, cluster, areaLayer, drawPts = [], drawLayer = null, drawing = false;
function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(LS.get('vista', [42.5, 12.5, 6]).slice(0, 2), LS.get('vista', [42.5, 12.5, 6])[2]);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50, showCoverageOnHover: false });
  map.addLayer(cluster);
  map.on('moveend', () => { const c = map.getCenter(); LS.set('vista', [c.lat, c.lng, map.getZoom()]); });
  map.on('click', (e) => { if (drawing) { drawPts.push([e.latlng.lat, e.latlng.lng]); redrawDraft(); } });
}
const COLORS = { casa: '#2563eb', magazzino: '#b45309', terreno: '#15803d', commerciale: '#7c3aed', garage: '#475569', altro: '#6b7280' };
function renderMap() {
  cluster.clearLayers();
  const markers = [];
  for (const a of RESULTS) {
    if (!a.ll) continue;
    const m = L.circleMarker(a.ll, { radius: 7, weight: 2, color: '#fff', fillColor: COLORS[a.t[0]] || '#666', fillOpacity: a.approx ? 0.55 : 0.95 });
    m.bindPopup(() => `<div class="popup-price">${eur(a.p)}</div><div>${esc(a.com || '')} · ${fmtD(a.dv, false)}</div><div class="small">${esc((a.desc || '').slice(0, 90))}…</div><button class="btn primary" style="margin-top:6px;width:100%" onclick="openDetail('${a.id}')">Dettagli</button>`);
    markers.push(m);
  }
  cluster.addLayers(markers);
  if (areaLayer) { areaLayer.remove(); areaLayer = null; }
  if (F.zona === 'area' && F.area) areaLayer = L.polygon(F.area, { color: '#1d4ed8', weight: 2, fillOpacity: 0.06, interactive: false }).addTo(map);
  zonaUI();
}
function fitResults() { // con la ricerca per CAP/comuni centra la mappa sui risultati
  if (F.zona !== 'cap') return;
  const pts = RESULTS.filter((a) => a.ll).map((a) => a.ll);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 });
}
function startDraw() {
  showView('mappa');
  drawing = true; drawPts = [];
  map.removeLayer(cluster); // i tocchi devono aggiungere vertici, non aprire i gruppi
  if (areaLayer) areaLayer.remove();
  $('#drawbar').classList.remove('hidden');
  $('.mapbtns').classList.add('hidden');
  redrawDraft();
}
function redrawDraft() {
  if (drawLayer) drawLayer.remove();
  drawLayer = L.layerGroup().addTo(map);
  if (drawPts.length) L.polygon(drawPts, { color: '#dc2626', weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false }).addTo(drawLayer);
  drawPts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#dc2626', fillOpacity: 1, interactive: false }).addTo(drawLayer));
  $('#drawhint').textContent = drawPts.length < 3 ? `Tocca la mappa per aggiungere i vertici (${drawPts.length}/3 minimo)` : `${drawPts.length} vertici · tocca Fine per cercare qui`;
}
function endDraw(save) {
  drawing = false;
  $('#drawbar').classList.add('hidden');
  $('.mapbtns').classList.remove('hidden');
  if (drawLayer) { drawLayer.remove(); drawLayer = null; }
  map.addLayer(cluster);
  if (save && drawPts.length >= 3) {
    F.area = drawPts.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
    F.zona = 'area'; writeForm(); applyFilters();
    map.fitBounds(L.latLngBounds(F.area), { padding: [30, 30] });
  } else renderMap();
}

// ---------- dettaglio ----------
async function loadDet(id) {
  const s = String(id).startsWith('N-') ? 'notai' : Number(id) % SHARDS;
  if (!detCache.has(s)) detCache.set(s, fetch(`data/det/${s}.json`).then((r) => r.ok ? r.json() : {}).catch(() => ({})));
  return (await detCache.get(s))[id] || null;
}

function analisi(a, d) { // riassunto e punti di attenzione, senza AI: regole sui dati strutturati
  const flags = [];
  const testo = `${d?.descrizione || a.desc || ''} ${(d?.beni || []).map((b) => b.descrizione).join(' ')}`.toLowerCase();
  const norm = (x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase();
  const disp = new Set([...(a.disp || []), ...((d?.beni || []).map((b) => b.disponibilita).filter(Boolean))].map(norm));
  if (disp.has('Libero') && disp.size === 1) flags.push(['ok', 'Immobile dichiarato libero']);
  if (disp.has('Occupato') || disp.has('Occupato senza titolo')) flags.push(['bad', `Immobile ${disp.has('Occupato senza titolo') ? 'occupato senza titolo' : 'occupato'}: valuta tempi e costi di liberazione`]);
  if (disp.has('In corso di liberazione')) flags.push(['warn', 'Liberazione in corso']);
  if (!disp.size) flags.push(['warn', 'Stato di occupazione non indicato: controlla la perizia']);
  if (/nuda[\s_]propriet|usufrutto|diritto di superficie|\bquota\b|\b[1-9]\/(?!1\b)[2-9]\d*\b/.test(testo) && !/1\/1\b|piena (ed intera )?propriet/.test(testo))
    flags.push(['warn', 'Possibile vendita di una quota o di un diritto parziale (non piena proprietà)']);
  if (/abus|difformit|sanatori|condono/.test(testo)) flags.push(['warn', 'Il testo cita abusi, difformità o sanatorie']);
  if (/rudere|da ristrutturare|fatiscent|inagibil|collabent/.test(testo)) flags.push(['warn', 'Immobile da ristrutturare o in cattive condizioni']);
  if (/servit/.test(testo)) flags.push(['warn', 'Presenza di servitù citata']);
  if (a.approx) flags.push(['warn', 'Posizione sulla mappa stimata dal comune: l\'indirizzo esatto è nella scheda']);
  if (d?.diritto) flags.push(['warn', `Diritto in vendita: ${d.diritto} (non piena proprietà)`]);
  if (d?.trattativaRiservata) flags.push(['warn', 'Trattativa riservata']);
  if (a.src === 'notai') flags.push(['warn', 'Asta notarile: per partecipare serve rivolgersi a un notaio abilitato alla Rete Aste Notarili']);
  const to = d?.termineOfferte;
  const scaduto = to && parseDT(to) < new Date();
  const gTo = to && !scaduto ? giorniA(to) : null;
  if (scaduto) flags.push(['bad', 'Termine per le offerte già scaduto']);
  else if (gTo != null && gTo <= 7) flags.push(['warn', gTo <= 1 ? 'Il termine per le offerte scade entro 24 ore' : `Mancano ${gTo} giorni al termine per le offerte`]);
  const ribasso = a.p && a.om ? Math.round((1 - a.om / a.p) * 100) : null;

  const lower = (s) => s.replace(/\b[A-Z][a-zà-ù]+\b/g, (w) => w.toLowerCase()); // lascia le sigle (es. RAN)
  const tipo = [d?.tipoVendita && `vendita ${lower(d.tipoVendita)}`, d?.modalita && `in modalità ${lower(d.modalita)}`].filter(Boolean).join(' ') || 'Asta';
  const s = [];
  s.push(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} il ${fmtD(a.dv)}.`);
  s.push(a.om ? `Prezzo base ${eur(a.p)}, offerta minima ${eur(a.om)}${ribasso ? ` (−${ribasso}%)` : ''}${a.r ? `, rilancio minimo ${eur(a.r)}` : ''}.` : `Prezzo base ${eur(a.p)}.`);
  if (to) s.push(`Offerte entro ${fmtD(to)}${gTo != null && gTo >= 0 ? ` (tra ${gTo} giorni)` : ''}.`);
  const mq = a.mq || (d?.beni || []).reduce((t, b) => t + (typeof b.superficie === 'number' ? b.superficie : 0), 0);
  if (mq) s.push(`Superficie dichiarata ${mq} m², circa ${eur(Math.round(a.p / mq))}/m² al prezzo base${a.om ? ` (${eur(Math.round(a.om / mq))}/m² all'offerta minima)` : ''}.`);
  if (d?.rito) s.push(`Procedura: ${d.rito.toLowerCase()} n. ${d.numeroRg}/${d.annoRg}, Tribunale di ${trib(a)}.`);
  if (d?.procedura) s.push(`Procedura: ${d.procedura}${d.notaio ? `, ${d.notaio}` : ''}.`);
  return { summary: s.join(' '), flags };
}

async function openDetail(rawId) {
  const a = ALL.find((x) => String(x.id) === String(rawId));
  if (!a) return;
  const id = String(a.id);
  const notarile = a.src === 'notai';
  $('#detail').classList.remove('hidden');
  $('#d-body').innerHTML = '<p class="muted">Caricamento…</p>';
  $('#d-fav').textContent = favs.has(id) ? '★ Salvata' : '☆ Salva';
  $('#d-fav').onclick = () => { favs.has(id) ? favs.delete(id) : favs.add(id); LS.set('preferiti', [...favs]); $('#d-fav').textContent = favs.has(id) ? '★ Salvata' : '☆ Salva'; renderFavs(); };
  history.pushState({ d: id }, '');
  const d = await loadDet(id);
  const { summary, flags } = analisi(a, d);
  const ll = a.ll;
  const indirizzo = (d?.beni?.[0]?.indirizzo || a.via || '').replace(/,?\s*Italia\s*$/i, '');
  const kv = notarile ? [
    ['Prezzo', eur(a.p)], ['Data asta', fmtD(a.dv)], ['Termine offerte', d?.termineOfferte ? fmtD(d.termineOfferte) : '—'],
    ['Tipo di vendita', d?.tipoVendita || '—'], ['Modalità', d?.modalita || a.mod || '—'],
    ['Immobile', d?.tipologia || '—'], ['Superficie', a.mq ? `${a.mq} m²` : '—'], ['Diritto', d?.diritto || 'Proprietà'],
    ['Procedura', d?.procedura || '—'], ['Notaio', d?.notaio || '—'], ['Luogo vendita', d?.luogoVendita || '—'],
    ['Pubblicata il', fmtD(a.pub, false)], ['Avviso', id.replace(/^N-/, '')],
  ] : [
    ['Prezzo base', eur(a.p)], ['Offerta minima', eur(a.om)], ['Rilancio minimo', eur(a.r)],
    ['Data asta', fmtD(a.dv)], ['Termine offerte', d?.termineOfferte ? fmtD(d.termineOfferte) : '—'],
    ['Tipo di vendita', d?.tipoVendita || '—'], ['Modalità', d?.modalita || a.mod || '—'],
    ['Luogo vendita', d?.luogoVendita || '—'], ['Deposito cauzionale', d?.deposito || '—'],
    ['Tribunale', trib(a) || '—'], ['Procedura', d?.rito ? `${d.rito} ${d.numeroRg}/${d.annoRg}` : (a.proc || '—')],
    ['Lotto', d?.codLotto || a.lotto || '—'], ['Pubblicata il', fmtD(a.pub, false)], ['Inserzione PVP', id],
  ];
  $('#d-body').innerHTML = `
    <h2>${eur(a.p)}</h2>
    <div class="meta muted">${esc(a.t.map(tipoLabel).join(' · '))}</div>
    <div class="meta">📍 ${esc(indirizzo || a.com || '')}</div>
    ${tagsHtml(a)}
    <div class="summary">${esc(summary)}
      <ul class="flags">${flags.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join('')}</ul>
    </div>
    <div class="links">
      ${notarile
        ? `<a class="btn primary" href="${esc(d?.url || 'https://avvisinotarili.notariato.it/')}" target="_blank" rel="noopener">Apri l'avviso sul sito del Notariato</a>`
        : `<a class="btn primary" href="${PVP(a.id)}" target="_blank" rel="noopener">Apri l'asta sul Portale Vendite Pubbliche</a>`}
      ${[...new Map((d?.siti || []).filter((s) => /^https?:/.test(s.url)).map((s) => [host(s.url), s])).values()].map((s) => `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">Vedi su ${esc(host(s.url))}</a>`).join('')}
      ${ll ? `<div class="row2"><a class="btn" href="https://maps.apple.com/?q=${ll[0]},${ll[1]}" target="_blank">Mappe Apple</a><a class="btn" href="https://www.google.com/maps/search/?api=1&query=${ll[0]},${ll[1]}" target="_blank">Google Maps</a></div>` : ''}
    </div>
    <h4>Dati principali</h4>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${d?.beni?.length ? `<h4>Beni nel lotto (${d.beni.length})</h4>${d.beni.map((b) => `<div class="bene"><b>${esc(b.tipologia || '')}</b>${b.descrizione ? ` — ${esc(b.descrizione)}` : ''}<div class="small muted">${[b.superficie && `${b.superficie} m²`, b.vani && `${b.vani} vani`, b.piano != null && b.piano !== '' && `piano ${b.piano}`, b.disponibilita, ...(b.catasto || [])].filter(Boolean).map(esc).join(' · ')}</div>${b.indirizzo ? `<div class="small">${esc(b.indirizzo)}</div>` : ''}</div>`).join('')}` : ''}
    <h4>Descrizione</h4>
    <div class="longtext">${esc(d?.descrizione || a.desc || '')}</div>
    ${d?.referenti?.length ? `<h4>Referenti</h4><dl class="kv">${d.referenti.map((r) => `<dt>${esc(r.ruolo)}</dt><dd>${esc(r.nome)}${r.visite ? ' · gestisce le visite' : ''}</dd>`).join('')}</dl><p class="small muted">Recapiti, prenotazione visite e documenti sono sulla pagina del Portale.</p>` : ''}
    ${d?.allegati?.length ? `<h4>Documenti sul Portale</h4><ul>${d.allegati.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${!d ? '<p class="muted small">Dettagli completi non ancora scaricati: verranno aggiunti al prossimo aggiornamento notturno.</p>' : ''}
  `;
  $('#d-body').scrollTop = 0;
}
window.openDetail = openDetail;
function closeDetail() { $('#detail').classList.add('hidden'); }

function renderFavs() {
  const l = ALL.filter((a) => favs.has(String(a.id))).sort((a, b) => a.dv.localeCompare(b.dv));
  $('#favlist').innerHTML = l.map(cardHtml).join('');
  $('#favempty').classList.toggle('hidden', l.length > 0);
}

// ---------- navigazione ----------
function showView(v) {
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('active', x.id === 'v-' + v));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  if (v === 'mappa') setTimeout(() => map.invalidateSize(), 50);
}

// ---------- avvio ----------
async function main() {
  writeForm();
  initMap();
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => showView(b.dataset.v));
  document.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); });
  document.querySelectorAll('input[name=zona]').forEach((r) => r.onchange = () => { readForm(); zonaUI(); });
  $('#apply').onclick = () => { readForm(); applyFilters(); fitResults(); showView(F.zona === 'area' ? 'mappa' : 'elenco'); };
  $('#zone-rapide').onclick = (e) => { const z = e.target.closest('[data-zona]'); if (z) $('#caps').value = ZONE[z.dataset.zona]; };
  $('#reset').onclick = () => { F = { ...DEFAULT_F }; writeForm(); applyFilters(); };
  $('#go-draw').onclick = () => { readForm(); startDraw(); };
  $('#btn-draw').onclick = startDraw;
  $('#btn-clear-area').onclick = () => { F.area = null; F.zona = 'tutta'; writeForm(); applyFilters(); };
  $('#draw-undo').onclick = () => { drawPts.pop(); redrawDraft(); };
  $('#draw-cancel').onclick = () => endDraw(false);
  $('#draw-done').onclick = () => { if (drawPts.length < 3) return; endDraw(true); };
  $('#btn-locate').onclick = () => navigator.geolocation?.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 12), () => alert('Posizione non disponibile'));
  $('#sort').onchange = (e) => { F.sort = e.target.value; sortResults(); LS.set('filtri', F); renderList(true); };
  $('#more').onclick = () => renderList(false);
  $('#d-close').onclick = () => history.back();
  window.addEventListener('popstate', closeDetail);

  try {
    const [idx, meta] = await Promise.all([fetch('data/index.json').then((r) => r.json()), fetch('data/meta.json').then((r) => r.json()).catch(() => null)]);
    ALL = idx;
    if (meta) {
      $('#updated').textContent = `agg. ${new Date(meta.aggiornato).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      $('#metainfo').textContent = `Fonti: Portale delle Vendite Pubbliche (Ministero della Giustizia)${meta.perFonte ? ` con ${meta.perFonte.pvp.toLocaleString('it-IT')} aste e Rete Aste Notarili con ${meta.perFonte.notai.toLocaleString('it-IT')}` : ''}. ${meta.totale.toLocaleString('it-IT')} aste immobiliari future, aggiornate ogni notte. ${meta.posizioneStimata ? `${meta.posizioneStimata.toLocaleString('it-IT')} hanno la posizione stimata dal comune.` : ''}`;
    }
  } catch (e) {
    $('#count').textContent = '· errore nel caricamento dati';
    console.error(e);
  }
  applyFilters();
  fitResults();
  renderFavs();
  LS.set('ultimaVisita', new Date().toISOString());
}
main();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
