# Aste Immobili

App personale (PWA, installabile su iPhone) che raccoglie le aste future di case, magazzini, terreni, negozi e garage da due fonti:

- **Portale delle Vendite Pubbliche** del Ministero della Giustizia (pvp.giustizia.it), dove per legge vengono pubblicate tutte le vendite giudiziarie;
- **Rete Aste Notarili** (avvisinotarili.notariato.it): dismissioni di enti pubblici e vendite private tramite notaio. Gli avvisi "GAST" che sono aste giudiziarie delegate ai notai hanno lo stesso numero del PVP e vengono scartati come doppioni.

Zona predefinita dell'app: costa ligure da Bogliasco a Lerici (modificabile in Filtri).

## Come funziona

- **Raccolta** (`scraper/scrape.mjs`, Node senza dipendenze): ogni notte GitHub Actions legge l'elenco delle aste future e, solo per quelle nuove, il dettaglio (tipo di vendita, termine offerte, procedura, beni, catasto, referenti, siti dove è pubblicata). I dettagli già scaricati vengono riletti dal sito pubblicato, così ogni notte si scaricano solo le novità.
- **Dati**: file JSON statici in `site/data/` (non versionati, generati dal workflow).
- **App** (`site/`): mappa OpenStreetMap con disegno dell'area, filtri per tipologia, CAP/comuni, prezzo, data, stato di occupazione; scheda con riassunto e punti di attenzione calcolati da regole (nessuna AI, nessun costo); preferiti salvati sul telefono.
- **Hosting**: GitHub Pages, gratuito.

## Installare su iPhone

Apri il sito in **Safari** → pulsante Condividi → **Aggiungi alla schermata Home**.

## Comandi

```bash
node scraper/scrape.mjs site/data          # scarica tutto (prima volta ~30 min)
MAX_DETAILS=50 node scraper/scrape.mjs     # prova veloce
node scripts/serve.mjs 8080                # prova in locale su http://localhost:8080
node scripts/make-icons.mjs                # rigenera le icone
```

## Limiti noti

- Non ci sono le vendite private delle banche e dei siti commerciali che non passano dal PVP o dalla Rete Aste Notarili.
- Il sito del Notariato funziona a sessione: lo script invia la ricerca "avvisi in corso" e poi legge elenco e mappa con lo stesso cookie. Senza sessione l'interfaccia della mappa restituisce anche l'archivio storico.
- I documenti (perizia, avviso) si scaricano dalla pagina del Portale: richiedono la sessione del sito.
- Circa il 40% degli annunci non ha coordinate: la posizione viene stimata dal centro del comune (segnalata come "Posizione stimata").
