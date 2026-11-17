# Aste Immobili

App personale (PWA, installabile su iPhone) che raccoglie le aste giudiziarie future di case, magazzini, terreni, negozi e garage dal **Portale delle Vendite Pubbliche** del Ministero della Giustizia (pvp.giustizia.it), dove per legge vengono pubblicate tutte le vendite giudiziarie.

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

- Fonte unica per ora: il PVP. Aste notarili e vendite private delle banche non ci sono.
- I documenti (perizia, avviso) si scaricano dalla pagina del Portale: richiedono la sessione del sito.
- Circa il 40% degli annunci non ha coordinate: la posizione viene stimata dal centro del comune (segnalata come "Posizione stimata").
