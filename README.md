# FiberCop Map

FiberCop Map e' un progetto informativo dedicato ai punti FiberCop CRO/CNO.

Al momento il progetto e' temporaneamente in revisione. Il sito pubblico mostra
una homepage informativa e il viewer con mappa non e' attivo in questa fase.

## Stato attuale

- Homepage pubblica temporanea, senza mappa interattiva
- Caricamento dei dataset pubblici disattivato
- Repository mantenuto per revisione, documentazione e sviluppo controllato

## Nota sui dati

- Alcuni dati utilizzati dal progetto derivano da fonti pubblicamente accessibili
- La disponibilita' pubblica di una fonte non implica automaticamente liberta'
  di riutilizzo o redistribuzione
- Per questo motivo i file generati `data/base_points.json` e
  `data/status_points.json` non sono distribuiti pubblicamente in questa fase
- La riattivazione del viewer completo avverra' solo dopo le verifiche
  necessarie

## Stack tecnico

- Sito statico pubblicato con GitHub Pages
- Frontend HTML, CSS e JavaScript vanilla
- Leaflet e Turf.js nel viewer completo, quando attivo
- GitHub Actions per automazioni e aggiornamenti
- Supabase e Telegram Bot per le funzionalita' di notifica del progetto completo

## Sviluppo locale

Per servire il progetto in locale dalla root del repository:

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000`.

## Modalita' temporanea

La homepage corrente e' intenzionalmente minimale e non inizializza la mappa
ne' prova a caricare i dataset JSON rimossi dal tracking Git.
