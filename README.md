# FiberCop Map

FiberCop Map e' una mappa dei punti CRO/CNO FiberCop con stato aggiornato, filtri geografici reali e notifiche Telegram per singolo punto. Il progetto unisce una base dati storica piu' ricca con il file stato aggiornato FiberCop, cosi' da mostrare i punti su mappa e permettere all'utente di seguire le variazioni di stato.

## Funzionalita' principali

- Visualizzazione dei punti CRO/CNO su mappa interattiva
- Stato aggiornato del singolo punto
- Filtri per regione, provincia, comune e stato
- Filtri geografici reali quando sono disponibili i confini GeoJSON
- Popup con dettagli del punto selezionato
- Pulsante Telegram per iscriversi alle notifiche del singolo punto

## Come usare il sito

1. Seleziona regione, provincia e, se vuoi, comune.
2. Applica un filtro per stato oppure lascia tutti gli stati.
3. Premi `Mostra punti` per aggiornare la mappa.
4. Clicca un punto per aprire il popup con i dettagli.
5. Usa il pulsante Telegram per ricevere notifiche quando quel punto cambia stato.

## Come funzionano i dati

- `data/base_points.json` contiene la base anagrafica dei punti: coordinate, area geografica, indirizzo e altri campi utili. Viene generato a partire dal file storico piu' ricco del progetto.
- `data/status_points.json` contiene lo stato aggiornato dei punti e la data di disponibilita'. Viene generato dal file aggiornato FiberCop scaricato automaticamente.
- Il frontend unisce questi due dataset per mostrare sulla mappa i dati base insieme allo stato piu' recente.

## Aggiornamento automatico

Un workflow GitHub Actions aggiorna `status_points.json` due volte al giorno. Quando vengono rilevati cambi di stato rilevanti, il sistema puo' inviare notifiche Telegram agli utenti iscritti ai singoli punti.

## Stack tecnico

- GitHub Pages per la pubblicazione del sito statico
- GitHub Actions per aggiornamento dati e automazione
- Supabase per gestione iscrizioni e integrazione backend
- Telegram Bot per le notifiche per singolo punto
- Leaflet per la mappa
- Turf.js per i filtri geografici reali

## Sviluppo locale

Per avviare il progetto in locale basta servire i file statici dalla root del repository:

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000`.

## Nota sui dati

I dati ufficiali possono contenere incoerenze geografiche tra coordinate, comune, provincia e regione associati al punto. Quando possibile, il progetto usa filtri geografici reali basati sui confini territoriali; negli altri casi usa il fallback anagrafico presente nei dataset.
