# Kaleido Studio

Applicazione desktop per generare media con OpenRouter. Immagini, modifica di immagini, video da testo, video da immagine, upscaling video, sintesi vocale, musica e trascrizioni, in un'unica interfaccia.

Incolli la chiave API al primo avvio. Da lì scegli una schermata e un modello, e generi.

[![build](https://github.com/rlpb/kaleido-studio/actions/workflows/build.yml/badge.svg)](https://github.com/rlpb/kaleido-studio/actions/workflows/build.yml)
![Electron](https://img.shields.io/badge/Electron-desktop-47848F)
![Licenza](https://img.shields.io/badge/licenza-MIT-blue)
![Piattaforme](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supportate-lightgrey)

---

## Cosa fa

Otto modalità, ognuna appoggiata a un endpoint OpenRouter:

| Modalità | Cosa produce | Endpoint | Modelli disponibili |
|---|---|---|---|
| Immagini | Immagine da prompt | `POST /api/v1/images` | 50 |
| Modifica immagini | Immagine da prompt più immagini di riferimento | `POST /api/v1/images` | 49 |
| Video da testo | Video da prompt | `POST /api/v1/videos` | 27 |
| Video da immagine | Video da fotogramma iniziale ed eventualmente finale | `POST /api/v1/videos` | 24 |
| Migliora video | Upscaling di un video esistente | `POST /api/v1/videos` | 1 |
| Voce | Parlato da testo, con voce selezionabile | `POST /api/v1/audio/speech` | 18 |
| Musica e audio | Traccia audio da descrizione | `POST /api/v1/chat/completions` | 4 |
| Trascrizione | Testo da file audio, con timestamp opzionali | `POST /api/v1/audio/transcriptions` | 20 |

I conteggi sono quelli letti dal catalogo il giorno della scrittura. L'app non li tiene fissi: li rilegge da OpenRouter a ogni avvio, quindi un modello pubblicato domani compare da solo.

## Il punto centrale del progetto

Nessun modello è cablato nel codice. OpenRouter espone, per ogni endpoint, i parametri che ciascun modello accetta, già tipizzati:

```json
// GET /api/v1/images/models
"supported_parameters": {
  "aspect_ratio": { "type": "enum", "values": ["1:1", "16:9", "9:16", "auto"] },
  "n":            { "type": "range", "min": 1, "max": 1 },
  "input_references": { "type": "range", "min": 0, "max": 5 }
}
```

```json
// GET /api/v1/videos/models
"supported_resolutions": ["768p", "480p"],
"supported_durations":   [5, 6, 7, 8, 9, 10],
"supported_frame_images": ["first_frame", "last_frame"],
"pricing_skus": { "duration_seconds_480p": "0.05", "duration_seconds_768p": "0.08" }
```

Kaleido normalizza queste tre forme diverse in un'unica struttura e genera il pannello dei controlli da lì. Un modello nuovo, con parametri mai visti prima, ottiene il suo form corretto senza che venga toccata una riga di codice.

## Costi

L'app distingue tre casi e lo dichiara nell'interfaccia, invece di mostrare sempre un numero:

- **listino** — i video sono fatturati al secondo e la tariffa è nel catalogo, quindi la stima è aritmetica esatta: tariffa × durata × quantità.
- **misurato** — per le altre modalità la fatturazione è a token e il numero di token dipende dal risultato. Se la stessa combinazione di modello e parametri è già stata eseguita, viene mostrato il costo reale di quella volta.
- **sconosciuto** — prima esecuzione di una combinazione: viene mostrata la tariffa unitaria e detto esplicitamente che la cifra esatta arriva a fine generazione.

Il costo reale di ogni job viene letto da `usage.cost` nella risposta, salvato con il file e sommato nel contatore di spesa.

## Altre cose che servono davvero usandola

- Coda con generazioni in parallelo configurabili, avanzamento in tempo reale, annullamento.
- Generazione in lotto: da 1 a 8 esecuzioni con la stessa configurazione.
- Libreria di tutto il generato, con ricerca su prompt, modello e testo, filtri per modalità e tipo, preferiti, costo per file, spazio occupato.
- Riuso con un clic: un risultato diventa l'input della modalità successiva, un prompt torna nella casella.
- Preset salvabili per modalità, cronologia dei prompt.
- Trascina e rilascia i file, o scegli dalla finestra di sistema.
- Preferiti sui modelli, ricerca nel catalogo, ordinamento per prezzo o data.
- Tema scuro e chiaro, `Ctrl+Invio` per generare, `Esc` per chiudere il visualizzatore.
- Credito residuo OpenRouter e spesa cumulata sempre visibili.

## Sicurezza della chiave

La chiave viene cifrata con il portachiavi del sistema operativo tramite `safeStorage` di Electron (Credential Manager su Windows, Keychain su macOS, `libsecret` su Linux) e salvata nella cartella dati dell'applicazione. Non lascia mai il computer se non verso `openrouter.ai`.

Dove il portachiavi non è disponibile, Electron non fallisce: degrada silenziosamente. Kaleido registra il caso e lo dichiara nelle impostazioni con l'etichetta *salvata in chiaro*, invece di lasciar credere che sia cifrata.

Il processo di rendering è isolato (`contextIsolation`, `sandbox`, niente Node), non ha accesso alla chiave e comunica solo tramite IPC tipizzato. I file della libreria sono serviti da un protocollo custom che rifiuta qualunque percorso fuori dalla cartella della libreria.

## Installazione

### Pacchetti pronti

Gli installer per Windows, macOS e Linux vengono compilati dalla [GitHub Action](.github/workflows/build.yml) e allegati alle release.

Le build non sono firmate. Windows SmartScreen e Gatekeeper su macOS mostreranno un avviso al primo avvio.

### Da sorgente

```bash
git clone https://github.com/rlpb/kaleido-studio.git
cd kaleido-studio
npm install
npm start
```

Serve Node.js 20 o superiore.

### Sviluppo

```bash
npm run dev        # Vite in hot reload più Electron
npm run typecheck  # TypeScript in modalità strict
npm run check      # controlli contro il catalogo OpenRouter reale
npm run dist       # installer per il sistema operativo corrente
```

## Struttura

```
electron/
  main.ts         finestra, IPC, protocollo media, menu
  preload.ts      ponte contextBridge verso il renderer
  openrouter.ts   client API e normalizzazione delle capability
  jobs.ts         coda, costruzione richieste, polling video, salvataggio
  store.ts        configurazione, chiave cifrata, preset, costi osservati
  library.ts      file su disco e indice della libreria
src/
  screens/        onboarding, studio, libreria, impostazioni
  components/     selettore modelli, form dinamico, input, schede media
  lib/            tipi condivisi, definizione delle modalità, prezzi
scripts/
  selfcheck.mjs   verifica contro l'API live
```

## Verifica

`npm run check` interroga il catalogo pubblico di OpenRouter, senza chiave, e verifica che:

- ogni modalità abbia almeno un modello;
- ogni parametro normalizzato sia utilizzabile da un form, con enum non vuoti e intervalli coerenti;
- i modelli video espongano durata e tariffa al secondo;
- la modalità di modifica immagini contenga solo modelli che accettano riferimenti;
- la stima a listino coincida con tariffa × durata × quantità;
- una combinazione mai eseguita non produca un numero inventato.

L'ultimo controllo è il più importante: impedisce che l'interfaccia presenti una stima dove non ha i dati per farla.

## Limiti noti

- Niente generazione 3D, perché OpenRouter non espone modelli con output 3D.
- I video sono asincroni e possono richiedere minuti; il polling si interrompe dopo 20 minuti.
- I timestamp per parola nella trascrizione dipendono dal provider e vengono ignorati da chi non li supporta.
- La cifratura della chiave dipende dal portachiavi di sistema, assente su alcune installazioni Linux minimali.

## Licenza

MIT. Vedi [LICENSE](LICENSE).

Kaleido Studio non è affiliato con OpenRouter.
