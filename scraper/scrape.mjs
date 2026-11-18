// Raccoglie le aste immobiliari future dal Portale delle Vendite Pubbliche (pvp.giustizia.it)
// e scrive i file statici letti dalla PWA:
//   <out>/index.json          elenco compatto per mappa e filtri
//   <out>/det/<nn>.json       dettagli completi, divisi in 64 file per id % 64
//   <out>/meta.json           data di aggiornamento e conteggi
//
// Uso: node scraper/scrape.mjs [cartella-output]
// Variabili: PREV_URL  = URL base dei dati già pubblicati (cache dei dettagli, evita di riscaricarli)
//            MAX_DETAILS = limite di dettagli nuovi da scaricare (per test)

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'site/data');
const PREV_URL = process.env.PREV_URL || '';
const MAX_DETAILS = Number(process.env.MAX_DETAILS || Infinity);
const CONCURRENCY = 4;
const SHARDS = 64;

const BASE = 'https://pvp.giustizia.it';
const SEARCH = `${BASE}/ric-496b258c-986a1b71/ric-ms/ricerca/vendite`;
const DETAIL = (id) => `${BASE}/ve-3f723b85-986a1b71/ve-ms/vendite/${id}/restricted`;
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (aste-personali)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * i);
    }
  }
}

// ---------- tipologie dell'app ----------
const TIPI = {
  casa: ['ABITAZIONE_TIPO_SIGN', 'ABITAZIONE_TIPO_CIV', 'ABITAZIONE_TIPO_ECO', 'ABITAZIONE_TIPO_POP', 'ABITAZIONE_TIPO_UPOP', 'ABITAZIONE_TIPO_RUR', 'ABITAZIONE_IN_VILLINI', 'ABITAZIONE_IN_VILLE', 'CASTELLI_PALAZZI', 'ABITAZIONI_E_ALL_TIPICI', 'APPARTAMENTO', 'VILLA', 'CASTEL_IMM_PREGIO_STR', 'FABBRICATO_RURALE', 'FABBRICATO', 'FABBRICATO_IN_COSTR', 'PORZIONE_DI_FABBRICATO', 'PORZIONE_DI_IMMOBILE'],
  magazzino: ['MAGAZZINO', 'MAGAZZINI_DEPOSITO', 'MAGAZZINI_E_DEPOSITO', 'DEPOSITO', 'OPIFICI', 'OPIFICIO_INDUSTRIALE', 'FABBRICATI_COSTRUITI_PER_ESIGENZE_IND', 'LABORATORIO_ARTIGIANO', 'LABORATORI_ARTI', 'TETTOIE_CHIUSE_APERTE', 'STALLE_SCUDERIE_RIMESSE', 'FABBRICATI_AGRICOLI', 'CANTINA'],
  terreno: ['TERRENO', 'LOTTO_EDIFICABILE'],
  commerciale: ['NEGOZIO', 'NEGOZI_BOTTEGHE', 'UFFICIO', 'UFFICI_E_STUDI', 'FABBRICATI_COMMERCIALI', 'ALBERGO_E_PENSIONE', 'ALBERGHI_E_PENSIONI', 'ISTITUTO_CREDITO_CAMBIO'],
  garage: ['GARAGE_AUTORIMESSA', 'POSTO_AUTO'],
};
const BENE2TIPO = Object.fromEntries(Object.entries(TIPI).flatMap(([t, l]) => l.map((b) => [b, t])));
function tipiDi(categoriaLotto, beni) {
  const s = new Set();
  for (const b of beni || []) if (BENE2TIPO[b]) s.add(BENE2TIPO[b]);
  if (!s.size) {
    if (categoriaLotto === 'IMMOBILE_RESIDENZIALE') s.add('casa');
    else if (categoriaLotto === 'IMMOBILE_INDUSTRIALE') s.add('magazzino');
    else if (categoriaLotto === 'IMMOBILE_COMMERCIALE') s.add('commerciale');
    else s.add('altro');
  }
  return [...s];
}

// ---------- 1. elenco aste future ----------
async function elenco() {
  const all = [];
  for (let page = 0; ; page++) {
    const url = `${SEARCH}?language=it&page=${page}&size=1000&sort=dataVendita,asc&sort=orarioVendita,asc`;
    const j = await fetchJson(url, { method: 'POST', body: JSON.stringify({ tipoLotto: 'IMMOBILI', filtroAnnunci: 1 }) });
    const b = j.body || {};
    all.push(...(b.content || []));
    console.log(`elenco pagina ${page + 1}/${b.totalPages} (${all.length}/${b.totalElements})`);
    if (b.last || !b.content?.length) break;
    await sleep(300);
  }
  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(Date.now() + 3 * 365 * 864e5).toISOString().slice(0, 10); // scarta date palesemente errate
  const seen = new Set();
  return all.filter((a) => a.dataVendita >= today && a.dataVendita <= max && !seen.has(a.id) && seen.add(a.id));
}

// ---------- 2. dettagli ----------
const itDate = (d) => (d && /^\d{2}\/\d{2}\/\d{4}$/.test(d) ? d.split('/').reverse().join('-') : d || null);
const coord = (ind) => (ind?.coordinate?.latitudine ? [ind.coordinate.latitudine, ind.coordinate.longitudine] : null);
const RUOLI = { CURATOR: 'Curatore', SOGGSPV: 'Gestore della vendita', DELEGATO: 'Delegato', CUSTODE: 'Custode', LIQUIDAT: 'Liquidatore', COMMISS: 'Commissario', GIUDICE: 'Giudice' };
const DISP = { LIBER: 'Libero', OCCUP: 'Occupato', OCCST: 'Occupato senza titolo', INCOR: 'In corso di liberazione' };

function riduciDettaglio(d) {
  const p = d.procedura || {};
  const beni = (d.beni || []).map((b) => ({
    tipologia: b.descTipologiaBene,
    descrizione: b.descrizione,
    superficie: b.superficie ? Number(String(b.superficie).replace(',', '.')) || b.superficie : null,
    vani: b.numeroVani,
    piano: b.piano,
    disponibilita: b.disponibilitaDesc || DISP[b.codiceTipoDispBene] || null,
    indirizzo: b.indirizzo?.via || null,
    catasto: (b.datiCatastali || []).map((c) => [c.textSezione && `sez. ${c.textSezione}`, c.textFoglio && `fg. ${c.textFoglio}`, c.textParticella && `part. ${c.textParticella}`, c.textSubalterno && `sub. ${c.textSubalterno}`].filter(Boolean).join(' ')).filter(Boolean),
  }));
  const ll = coord(d.lotto?.indirizzo) || (d.beni || []).map((b) => coord(b.indirizzo)).find(Boolean) || null;
  return {
    tipoVendita: d.descTipoVendita || null,
    modalita: d.descModVendita || null,
    termineOfferte: d.dataTermPresOff ? `${itDate(d.dataTermPresOff)}T${d.oraTermPresOff || '00:00'}` : null,
    luogoVendita: [d.indirizzo?.via, d.indirizzo?.cap, d.indirizzo?.descComune].filter(Boolean).join(' ') || null,
    rito: p.descTipoRito || null,
    registro: p.descTipoRegistro || null,
    numeroRg: p.numeRg || null,
    annoRg: p.numeAnnoRg || null,
    codLotto: d.lotto?.codLotto || null,
    descrizione: d.lotto?.descLotto || null,
    comune: d.lotto?.indirizzo?.descComune || null,
    provincia: d.lotto?.indirizzo?.codProvincia || null,
    regione: d.lotto?.indirizzo?.descRegione || null,
    ll,
    beni,
    deposito: d.datiDeposito?.depoCauzionale || null,
    referenti: (d.soggetti || []).map((s) => ({ ruolo: RUOLI[s.ruolo] || s.ruolo, nome: [s.nome, s.cognome].filter(Boolean).join(' '), visite: !!s.soggVisitaBene })), // niente email/telefono: il sito è pubblico, i contatti restano sul PVP
    allegati: (d.allegati || []).map((a) => a.nomeFile),
    siti: [...(d.siti || []).map((s) => ({ nome: s.nomeSito, url: s.urlInserizione || s.link })), ...(d.altriSiti || []).map((s) => ({ nome: null, url: s.urlSito }))].filter((s) => s.url),
  };
}

async function caricaCachePrecedente() {
  const cache = new Map();
  if (!PREV_URL) return cache;
  await Promise.all(Array.from({ length: SHARDS }, async (_, i) => {
    try {
      const r = await fetch(`${PREV_URL.replace(/\/$/, '')}/det/${i}.json`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return;
      const j = await r.json();
      for (const [id, v] of Object.entries(j)) cache.set(Number(id), v);
    } catch {}
  }));
  console.log(`cache dettagli precedenti: ${cache.size}`);
  return cache;
}

async function dettagli(lista, cache) {
  const out = new Map();
  const daScaricare = [];
  for (const a of lista) (cache.has(a.id) ? out.set(a.id, cache.get(a.id)) : daScaricare.push(a.id));
  const todo = daScaricare.slice(0, MAX_DETAILS);
  console.log(`dettagli: ${out.size} in cache, ${todo.length} da scaricare`);
  let done = 0, errors = 0, i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < todo.length) {
      const id = todo[i++];
      try {
        const j = await fetchJson(DETAIL(id));
        if (j.body) out.set(id, riduciDettaglio(j.body));
      } catch (e) {
        errors++;
        if (errors < 20) console.warn('errore dettaglio', id, e.message);
      }
      if (++done % 250 === 0) console.log(`  ${done}/${todo.length}`);
      await sleep(120);
    }
  }));
  console.log(`dettagli scaricati: ${done - errors}, errori: ${errors}`);
  return out;
}

// ---------- 3. output ----------
function compatta(a, d) {
  const ll = coord(a.indirizzo) || d?.ll || null;
  const via = a.indirizzo?.via?.replace(/,?\s*Italia\s*$/i, '').trim() || null;
  return {
    id: a.id,
    ll: ll && [Math.round(ll[0] * 1e4) / 1e4, Math.round(ll[1] * 1e4) / 1e4],
    t: tipiDi(a.categoriaLotto, a.categoriaBene),
    via,
    cap: a.indirizzo?.cap || via?.match(/\b\d{5}\b/)?.[0] || null,
    com: a.indirizzo?.citta || d?.comune || null,
    prov: a.indirizzo?.provincia || null,
    p: a.prezzoBaseAsta || 0,
    om: a.offertaMinima || 0,
    r: a.rialzoMinimo || 0,
    dv: a.dataOraVendita || a.dataVendita,
    pub: a.dataPubblicazione,
    disp: [...new Set((a.disponibilita || []).map((x) => DISP[x]).filter(Boolean))],
    desc: (a.descLotto || '').replace(/\s+/g, ' ').trim().slice(0, 110),
    trib: (a.tribunale || '').replace(/^Tribunale di /i, ''),
    mod: d?.modalita || null,
    to: d?.termineOfferte || null,
    mq: d?.beni?.reduce((s, b) => s + (typeof b.superficie === 'number' ? b.superficie : 0), 0) || null,
  };
}

// Aste senza coordinate: posizione approssimata al centro delle altre aste dello stesso comune.
function stimaPosizioni(index) {
  const acc = new Map();
  const key = (x) => `${(x.com || '').toLowerCase()}|${(x.prov || '').toLowerCase()}`;
  for (const x of index) if (x.ll && x.com) {
    const k = key(x), v = acc.get(k) || [0, 0, 0];
    v[0] += x.ll[0]; v[1] += x.ll[1]; v[2]++; acc.set(k, v);
  }
  let n = 0;
  for (const x of index) if (!x.ll && acc.has(key(x))) {
    const v = acc.get(key(x));
    x.ll = [Math.round((v[0] / v[2]) * 1e4) / 1e4, Math.round((v[1] / v[2]) * 1e4) / 1e4];
    x.approx = 1; n++;
  }
  console.log(`posizioni stimate dal comune: ${n}`);
}

// ---------- aste notarili (avvisinotarili.notariato.it) ----------
// Il sito lavora a sessione: si invia la ricerca "avvisi in corso" e poi, con lo stesso cookie,
// si leggono le pagine dell'elenco (5 avvisi l'una, con coordinate quando presenti) e i riquadri
// della mappa (dati più ricchi: tipologia, stato, notaio, ma solo per gli avvisi geolocalizzati).
// Senza sessione l'interfaccia della mappa restituisce anche l'archivio storico: non usarla così.
const NOT_BASE = 'https://avvisinotarili.notariato.it';
const UA = { 'User-Agent': HEADERS['User-Agent'] };
const itDT = (s) => { const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}` : null; };
const decode = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s+/g, ' ').trim();

async function notariliSessione() {
  const body = new URLSearchParams({ tipoBene: 'I', statoAvviso: 'inCorso', ordinamento: 'prezzo:ASC' });
  const r = await fetch(`${NOT_BASE}/beni-immobili/?`, { method: 'POST', body, headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(60000) });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const totale = Number((await r.text()).match(/(\d+)\s+Risultati Trovati/)?.[1] || 0);
  if (!cookie || !totale) throw new Error('ricerca notarile senza risultati o senza sessione');
  return { cookie, totale };
}
function parsePaginaNotarile(html) {
  const out = [];
  for (const part of html.split('<input class="avvisolat"').slice(1)) {
    const link = part.match(/dettaglio-avviso\/(\w+)\/(\d+)/);
    if (!link) continue;
    const campo = (label) => decode(part.match(new RegExp(`${label}[^<]*<span>([^<]*)</span>`))?.[1]);
    const luogo = decode(part.match(/<small class="pull-left[^>]*>([^<]*)<\/small>/)?.[1]);
    const lm = luogo.match(/^(.*?),?\s*([^,()]+)\s*\(([^)]+)\)\s*$/);
    out.push({
      origin: link[1], idAvviso: link[2],
      lat: part.match(/value="\s*(-?[\d.]+)"/)?.[1], lon: part.match(/class="avvisolon"[^>]*value="\s*(-?[\d.]+)"/)?.[1],
      descrizione: decode(part.match(/<p>([\s\S]*?)<\/p>/)?.[1]),
      prezzo: Number(campo("Prezzo dell'Avviso").replace(/[^\d,]/g, '').replace(',', '.')) || 0,
      dataPubblicazione: itDT(campo('Data e Ora di pubblicazione')),
      dataPresOfferteA: itDT(campo('Data e Ora fine raccolta offerte')),
      dataVendita: itDT(campo('Data e Ora vendita')),
      indirizzo: lm ? lm[1] : luogo, comune: lm ? lm[2] : null, provincia: lm ? lm[3] : null,
      mq: Number(part.match(/<strong class="pull-right">\s*([\d.,]+)\s*mq/)?.[1]?.replace(/\./g, '').replace(',', '.')) || null,
    });
  }
  return out;
}
async function notariliRaw() {
  const { cookie, totale } = await notariliSessione();
  const H = { ...UA, Cookie: cookie };
  const raw = new Map();
  const pagine = Math.ceil(totale / 5);
  for (let p = 0; p < pagine; p++) {
    try {
      const r = await fetch(`${NOT_BASE}/beni-immobili/?&page=${p}`, { headers: H, signal: AbortSignal.timeout(30000) });
      for (const x of parsePaginaNotarile(await r.text())) raw.set(`${x.origin}-${x.idAvviso}`, x);
    } catch (e) { console.warn('notarili pagina', p, e.message); }
    await sleep(100);
  }
  console.log(`notarili: ${raw.size} avvisi dall'elenco (attesi ${totale})`);
  // dati ricchi dalla mappa, a riquadri di 1 grado (una zona troppo grande viene rifiutata)
  let ricchi = 0;
  for (let la = 36; la < 47.5; la++) for (let lo = 6; lo < 19; lo++) {
    try {
      const url = `${NOT_BASE}/avvisi/geolocation?nw_lat=${la}&nw_lon=${lo + 1}&ne_lat=${la + 1}&ne_lon=${lo + 1}&se_lat=${la + 1}&se_lon=${lo}&sw_lat=${la}&sw_lon=${lo}&total=${totale}`;
      const j = await (await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) })).json();
      for (const x of j.value || []) {
        const k = `${x.origin}-${x.idAvviso}`;
        raw.set(k, { ...(raw.get(k) || {}), ...x, dataVendita: x.dataVendita?.slice(0, 16), dataPresOfferteA: x.dataPresOfferteA?.slice(0, 16), dataPubblicazione: x.dataPubblicazione?.slice(0, 16) });
        ricchi++;
      }
    } catch (e) { console.warn('notarili riquadro', la, lo, e.message); }
  }
  console.log(`notarili: ${ricchi} con dati completi dalla mappa`);
  return raw;
}
function tipoNotarile(x) {
  const daTipo = tipoDaTesto(x.tipoImmobileDes);
  return daTipo !== 'altro' ? daTipo : tipoDaTesto((x.descrizione || '').slice(0, 200));
}
function tipoDaTesto(t) {
  const s = `${t || ''}`.toLowerCase();
  if (/autorim|box|garage|posto auto|posti auto/.test(s)) return 'garage';
  if (/terren|agricol|edificab|bosc|uliv|vign/.test(s)) return 'terreno';
  if (/magazz|deposit|capann|laborat|industr|opific|artigian|cantin|soffitt/.test(s)) return 'magazzino';
  if (/negoz|uffic|commerc|albergh|ristor|bar\b/.test(s)) return 'commerciale';
  if (/abitaz|appart|villa|resid|casa|rustic|fabbricat/.test(s)) return 'casa';
  return 'altro';
}
const titolo = (s) => (s || '').trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
const STATO_NOT = { LIB: 'Libero', OCC: 'Occupato', LOC: 'Occupato', OST: 'Occupato senza titolo' };
const DIRITTO_NOT = { PRP: null, NUD: 'Nuda proprietà', USU: 'Usufrutto', SUP: 'Diritto di superficie', QUO: 'Quota' };
async function notarili(pvpIds) {
  const raw = await notariliRaw();
  const now = new Date().toISOString().slice(0, 16);
  const out = [];
  let doppioni = 0;
  for (const [key, x] of raw) {
    // GAST = aste giudiziarie delegate ai notai: hanno lo stesso numero del PVP, già presenti
    if (x.origin === 'GAST' && pvpIds.has(Number(x.idAvviso))) { doppioni++; continue; }
    const dv = (x.dataVendita || '').slice(0, 16);
    const to = (x.dataPresOfferteA || '').slice(0, 16) || null;
    if (!dv || dv < now.slice(0, 10)) continue;
    const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
    const disp = STATO_NOT[x.statoImmobile];
    const diritto = x.diritto in DIRITTO_NOT ? DIRITTO_NOT[x.diritto] : x.diritto;
    const id = `N-${key}`;
    out.push({
      idx: {
        id, src: 'notai',
        ll: lat > 35 && lat < 48 && lon > 6 && lon < 19 ? [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4] : undefined,
        t: [tipoNotarile(x)],
        via: x.indirizzo || undefined,
        com: titolo(x.comune) || undefined,
        prov: x.provincia?.trim() || undefined,
        p: x.prezzo || 0,
        dv,
        pub: (x.dataPubblicazione || '').slice(0, 10) || undefined,
        disp: disp ? [disp] : undefined,
        desc: (x.descrizione || '').replace(/\s+/g, ' ').trim().slice(0, 110),
        mod: x.modalitaAcquistoDes || undefined,
        to: to || undefined,
        mq: x.mq || undefined,
      },
      det: {
        tipoVendita: x.metodoAsta || null,
        modalita: x.modalitaAcquistoDes || null,
        termineOfferte: to,
        luogoVendita: x.luogoVendita || null,
        procedura: [x.tipoProceduraDes, x.richiedente && `richiedente: ${x.richiedente}`].filter(Boolean).join(' · ') || null,
        notaio: x.notaioRiferimento ? `Notaio ${titolo(x.notaioRiferimento)}` : null,
        diritto,
        descrizione: x.descrizione || null,
        tipologia: x.tipoImmobileDes || null,
        url: `${NOT_BASE}/beni-immobili/dettaglio-avviso/${x.origin}/${x.idAvviso}`,
        trattativaRiservata: !!x.trattativaRiservata,
      },
    });
  }
  console.log(`aste notarili future: ${out.length} (su ${raw.size} avvisi letti, ${doppioni} già presenti nel PVP)`);
  return out;
}

const lista = await elenco();
console.log(`aste future: ${lista.length}`);
const cache = await caricaCachePrecedente();
const det = await dettagli(lista, cache);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'det'), { recursive: true });
let notai = [];
try { notai = await notarili(new Set(lista.map((a) => a.id))); } catch (e) { console.warn('aste notarili non disponibili:', e.message); }

const index = lista.map((a) => compatta(a, det.get(a.id)));
index.push(...notai.map((n) => n.idx));
stimaPosizioni(index);
for (const x of index) for (const k of Object.keys(x)) if (x[k] == null || (Array.isArray(x[k]) && !x[k].length)) delete x[k];
await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index));
const shards = Array.from({ length: SHARDS }, () => ({}));
for (const a of lista) if (det.has(a.id)) shards[a.id % SHARDS][a.id] = det.get(a.id);
await Promise.all(shards.map((s, i) => fs.writeFile(path.join(OUT, 'det', `${i}.json`), JSON.stringify(s))));
await fs.writeFile(path.join(OUT, 'det', 'notai.json'), JSON.stringify(Object.fromEntries(notai.map((n) => [n.idx.id, n.det]))));
const meta = {
  aggiornato: new Date().toISOString(),
  totale: index.length,
  conCoordinate: index.filter((x) => x.ll && !x.approx).length,
  posizioneStimata: index.filter((x) => x.approx).length,
  conDettaglio: det.size,
  perTipo: Object.fromEntries(['casa', 'magazzino', 'terreno', 'commerciale', 'garage', 'altro'].map((t) => [t, index.filter((x) => x.t.includes(t)).length])),
  perFonte: { pvp: index.filter((x) => !x.src).length, notai: notai.length },
  fonti: ['pvp.giustizia.it', 'avvisinotarili.notariato.it'],
};
await fs.writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(meta);
