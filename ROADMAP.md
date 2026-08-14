# Exstream Reboot Roadmap

> Draft strategico e tecnico per trasformare l'esperienza produttiva di Exstream
> in una nuova libreria 1.0 focalizzata sugli ETL streaming, con un nuovo brand e
> un nuovo portale di documentazione.

## Visione

Exstream è un toolkit per costruire pipeline ETL streaming in JavaScript.
Collega reader, trasformazioni sincrone e asincrone e più writer, mantenendo
backpressure end-to-end, concorrenza limitata, ordine, propagazione degli errori
e cleanup dell'intero flusso. Node.js rimane il primo ambiente di riferimento,
ma il core deve poter funzionare anche nel browser attraverso async iterable,
Web Streams ed EventTarget.

L'obiettivo non è competere con le primitive native di Node.js. Async iterator,
stream e Promise sono i mattoni su cui Exstream costruisce un livello di
composizione più alto:

```text
Reader -> transform -> async map -> fork -+-> database writer
                                           +-> CSV -> file/S3
                                           +-> audit writer
```

Il valore del progetto è nella possibilità di descrivere questo grafo in modo
compatto e leggibile, senza dover implementare ogni volta backpressure,
parallelismo, fan-out, terminazione ed error handling.

## Posizionamento

**Composable streaming ETL for JavaScript.**

I pilastri del prodotto sono:

1. backpressure attraverso l'intero grafo;
2. `fork`, `merge` e pipeline riutilizzabili;
3. operazioni asincrone con parallelismo, ordine, throttle e rate limit;
4. parsing e serializzazione CSV semplici e ad alte prestazioni;
5. interoperabilità con iterable, async iterable e stream Node.js;
6. reader e writer componibili per sistemi esterni;
7. gestione esplicita di lifecycle, cancellazione ed errori.
8. core portabile fra Node.js e browser, senza polyfill impliciti;
9. consumo controllato di sorgenti event-driven come EventEmitter ed
   EventTarget.

## Rebranding e nuovo progetto

La nuova generazione della libreria può nascere come fork o derivazione diretta
del repository originale, con un nuovo nome, un nuovo package e un'identità
focalizzata sugli ETL streaming.

Il rebranding non deve cancellare la storia del progetto. Il messaggio corretto
è che la nuova libreria nasce da anni di esperienza produttiva con Exstream, non
che si tratta di un'implementazione completamente nuova.

### Strategia proposta

- Conservare il repository e il package `exstream.js` come progetto originale,
  in maintenance mode.
- Creare un nuovo repository tramite fork o import della storia Git, mantenendo
  attribuzione e tracciabilità delle modifiche.
- Scegliere un nome che comunichi flusso, composizione o data movement e che sia
  distinguibile nelle ricerche web e npm.
- Pubblicare il nuovo core con un package moderno, eventualmente sotto uno scope
  che possa ospitare anche adapter ufficiali.
- Aggiungere a Exstream una guida di migrazione e un'indicazione chiara del
  successore, senza deprecarlo prima che il nuovo progetto sia utilizzabile.
- Trattare la compatibilità API come uno strumento di migrazione, non come un
  vincolo assoluto: i comportamenti validati in produzione vanno preservati, le
  ambiguità possono essere corrette.
- Mantenere nel nuovo portale una pagina “Built from Exstream” che racconti
  origine, casi d'uso produttivi e ragioni del rilancio.

### Criteri per il nuovo brand

- nome corto, pronunciabile e non legato esclusivamente a Node.js;
- disponibilità verificata su npm, GitHub, dominio e motori di ricerca;
- assenza di collisioni rilevanti con prodotti data o JavaScript esistenti;
- identità adatta a package come `core`, `csv`, `node`, `web` e adapter;
- promessa immediatamente comprensibile dalla tagline, anche se il nome è
  astratto.

## Non-obiettivi

- Diventare una libreria generalista di programmazione reattiva.
- Replicare ogni operatore di lodash o RxJS.
- Nascondere comportamenti critici come buffering, perdita dati o ordinamento.
- Sacrificare il percorso sincrono e le prestazioni per uniformare tutto a
  Promise e async iterator.
- Introdurre dipendenze runtime nel core senza un beneficio misurabile.
- Portare nel browser adapter intrinsecamente server-side come filesystem e
  driver database.
- Simulare backpressure impossibile su sorgenti evento non pausabili: buffering
  e perdita devono essere sempre limitati ed espliciti.

---

# Roadmap tecnica

## Principi di evoluzione

- **Niente big-bang rewrite.** Prima si caratterizza il comportamento usato in
  produzione, poi si sostituiscono gradualmente le parti interne.
- **Compatibilità prima dell'eleganza interna.** Il refactoring non deve cambiare
  silenziosamente backpressure, ordine o terminazione.
- **Semantiche esplicite.** Ogni operatore concorrente deve documentare ordine,
  buffering, errori e cancellazione.
- **Prestazioni verificabili.** Le decisioni sul core e sul CSV devono essere
  accompagnate da benchmark riproducibili.
- **Core piccolo.** Reader e writer specifici appartengono a package separati o
  a un livello di integrazione chiaramente distinto.
- **Portabilità nel core.** Scheduler, byte handling ed eventi non devono
  dipendere implicitamente da API Node.js.
- **Backpressure onesta.** Web Streams e Node streams possono cooperare con la
  domanda del consumer; EventEmitter ed EventTarget richiedono invece una
  politica esplicita quando il producer non è pausabile.

## Milestone 0 — Baseline e test di caratterizzazione

Prima di modificare il motore occorre fissare le proprietà che hanno reso
Exstream affidabile negli ETL reali.

### Attività

- Tradurre i principali flussi di produzione in test minimali e anonimi.
- Definire e testare le invarianti di backpressure:
  - un `fork` affidabile avanza solo quando tutti i rami sono pronti;
  - un observer non rallenta il flusso principale;
  - la memoria rimane limitata in presenza di writer sbilanciati;
  - la sorgente si ferma quando un ramo applica backpressure.
- Definire e testare le invarianti di concorrenza:
  - `merge(n)` non attiva più di `n` stream;
  - `mapAsync`/`resolve(n)` non esegue più di `n` task;
  - l'ordine è preservato solo quando richiesto;
  - nessun task continua dopo abort o distruzione del grafo.
- Aggiungere test di leak per listener, timer, buffer e Promise pendenti.
- Sostituire le aspettative dipendenti dallo scheduler, come l'alternanza esatta
  del test `multipipe`, con aspettative sul contratto pubblico.
- Aggiungere stress test con writer lenti, errori tardivi e terminazioni
  concorrenti.
- Creare la prima baseline prestazionale del core e del CSV.
- Eseguire gli stessi test di trasformazione su Node.js e in un browser headless
  dove l'operatore non dipende da adapter server-side.
- Caratterizzare sorgenti EventEmitter/EventTarget pausabili e non pausabili,
  inclusi unsubscribe, overflow ed eventi emessi durante l'avvio o la chiusura.

### Criterio di uscita

Le semantiche attuali considerate corrette sono espresse da test deterministici
che passano sulle versioni Node.js supportate.

## 0.26 — Hardening e compatibilità moderna

Release di manutenzione senza cambiamenti intenzionali dell'API.

### Attività

- Supportare e testare le versioni Node.js LTS correnti e la versione Current.
- Aggiornare GitHub Actions e la toolchain di sviluppo.
- Rendere l'installazione CI riproducibile usando il lockfile del package manager
  scelto.
- Correggere il test `multipipe` e gli altri test sensibili al timing.
- Correggere la collisione delle chiavi composte in `uniqBy`.
- Gestire correttamente Promise rifiutate con valori non `Error`.
- Validare `parallelism`, dimensione dei batch, rate, timeout e buffer.
- Verificare la rimozione di tutti i listener in `pipe`, `merge`, `fork` e
  `through`.
- Aggiornare le dipendenze di sviluppo e azzerare le vulnerabilità evitabili.
- Pulire il package npm con `files` o `.npmignore`, aggiungere `LICENSE` e
  completare i metadata.
- Eseguire un audit di portabilità per isolare `Buffer`, `EventEmitter`,
  `process.nextTick`, `setImmediate` e stream Node.js dal core condivisibile.

### Criterio di uscita

Lint e suite completi sono verdi su tutta la matrice Node.js; il package contiene
soltanto gli artefatti necessari all'uso della libreria.

## 0.27 — Lifecycle e backpressure

Questa release inizia la modernizzazione del motore senza riscrivere l'API
pubblica.

### Attività

- Introdurre un lifecycle interno esplicito:
  `idle -> running -> ending -> ended`, con `aborted` e `destroyed` terminali.
- Rendere `start`, `end`, `destroy` e `abort` idempotenti.
- Separare la backpressure richiesta dai consumer affidabili dal comportamento
  degli observer.
- Sostituire progressivamente i flag e le dipendenze accidentali da
  `setImmediate`/`nextTick` con controller interni dedicati.
- Introdurre un'astrazione minima dello scheduler basata su primitive disponibili
  anche nel browser, senza incorporare un event loop proprietario.
- Introdurre un limite di buffer configurabile e metriche sul buffer corrente.
- Formalizzare le modalità di fan-out:
  - `fork`: consegna affidabile e backpressure da tutti i rami;
  - `observe`: nessuna influenza sul flusso principale;
  - eventuali modalità best-effort solo se esplicite e con buffer limitato.
- Usare `finished` e `pipeline` nativi ai confini con gli stream Node.js quando
  semplificano cleanup e propagazione degli errori.

### Criterio di uscita

Il lifecycle del grafo è deterministico e non lascia risorse attive dopo end,
errore, abort o distruzione anticipata di un ramo.

## 0.28 — Protocollo degli errori e cancellazione

Gli errori non devono più essere distinti dai dati tramite `instanceof Error`.

### Protocollo interno proposto

```javascript
{ type: 'data', value }
{ type: 'error', error, input, fatal }
{ type: 'end' }
```

Il protocollo è interno: l'API pubblica può inizialmente rimanere compatibile.

### Attività

- Permettere a un oggetto `Error` di transitare come dato quando richiesto.
- Normalizzare rejection con stringhe, oggetti o valori primitivi.
- Distinguere errori del singolo record da errori fatali del flusso.
- Preservare sempre l'input che ha causato un errore di trasformazione.
- Integrare `AbortSignal` in sorgenti, operatori asincroni, pipeline e sink.
- Propagare il signal alle funzioni utente che lo supportano.
- Definire operatori o policy per `retry`, `skip`, `stop` e dead-letter stream.
- Garantire che un errore fatale chiuda in modo coerente tutti i rami.

### Criterio di uscita

Errori, dati e terminazione non sono più rappresentati da valori ambigui; abort
ed errori fatali rilasciano l'intero grafo.

## 0.29 — API asincrona e concorrenza

Rendere esplicito ciò che oggi si ottiene componendo `map` e `resolve`.

### API indicativa

```javascript
source
  .mapAsync(enrichRecord, {
    concurrency: 10,
    ordered: true,
    signal,
  })
```

### Attività

- Introdurre `mapAsync` senza rimuovere immediatamente `map().resolve()`.
- Unificare validazione e implementazione degli operatori concorrenti.
- Definire con precisione ordine di emissione e limite di risultati pendenti.
- Rendere throttle e rate limit resistenti ad abort e variazioni del clock.
- Aggiungere timeout e retry come operatori componibili.
- Rendere `toAsyncIterator()` un vero async iterator con cancellazione corretta.
- Valutare API esplicite `valuesSync()` e `toPromise()` per ridurre l'ambiguità
  di `values()`, preservando la compatibilità iniziale.

### Criterio di uscita

Le pipeline asincrone dichiarano concorrenza, ordine, timeout e cancellazione in
modo leggibile e verificabile.

## 0.30 — Browser, Web Streams e sorgenti evento

La compatibilità browser deve nascere dalla separazione del core dalle API
Node.js, non dall'aggiunta di polyfill globali.

### Architettura runtime

- Estrarre un core environment-agnostic per pipeline, operatori, lifecycle,
  backpressure e concorrenza.
- Spostare l'interoperabilità con Node Readable/Writable ed EventEmitter in
  adapter Node espliciti.
- Aggiungere adapter browser per ReadableStream, WritableStream, EventTarget e
  fetch response body.
- Usare `Uint8Array`, `TextEncoder` e `TextDecoder` nel core byte-oriented;
  convertire `Buffer` soltanto nell'adapter Node.
- Pubblicare entry point condizionali senza includere polyfill Node nel bundle
  browser.
- Verificare il funzionamento in main thread e Web Worker.

### EventEmitter ed EventTarget come source

API indicativa:

```javascript
fromEvent(emitter, 'data', {
  end: 'end',
  error: 'error',
  signal,
  highWaterMark: 1024,
  overflow: 'error',
})
```

L'adapter deve:

- registrare e rimuovere tutti i listener in modo deterministico;
- mappare separatamente eventi data, end ed error;
- usare `pause()`/`resume()` quando il producer li espone;
- supportare EventTarget tramite `addEventListener`/`removeEventListener`;
- dichiarare che una sorgente hot non pausabile non può ricevere vera
  backpressure;
- richiedere un buffer limitato e una policy di overflow fra `error`,
  `drop-oldest` e `drop-newest` per sorgenti non pausabili;
- esporre metriche su eventi ricevuti, buffered e scartati;
- terminare e fare unsubscribe quando il signal viene abortito.

### Web Streams

- Accettare ReadableStream come source e WritableStream come sink.
- Propagare `cancel`, `abort` e `close` nel lifecycle Exstream.
- Tradurre la domanda del consumer nel protocollo di backpressure Web Streams.
- Consentire pipeline browser come `fetch -> CSV -> transform -> WritableStream`.
- Testare fan-out verso più sink browser con velocità differenti.

### Criterio di uscita

Lo stesso core esegue pipeline e operatori in Node.js e browser; gli adapter
event-driven hanno buffering, overflow e cleanup espliciti e verificati.

## 0.31 — CSV ad alte prestazioni

Il parser e il serializer CSV sono funzionalità centrali di Exstream. Devono
essere trattati come un vantaggio competitivo e supportati da correttezza e
benchmark pubblici.

### Benchmark

Creare un harness riproducibile che confronti Exstream con parser e serializer
CSV diffusi, usando versioni e configurazioni fissate.

Misurare:

- MB/s e record/s;
- tempo totale end-to-end;
- picco RSS e heap;
- numero e volume delle allocazioni, quando misurabile;
- latenza al primo record;
- file con e senza quote;
- quote escaped e campi multilinea;
- milioni di righe strette e righe molto larghe;
- array e object mode;
- chunk grandi e input fortemente frammentato;
- parser isolato e pipeline completa con writer lento;
- parsing e serializzazione.

Ogni risultato deve includere hardware, versione Node.js, dataset, comando e
configurazione. Il repository deve permettere di riprodurre i risultati.

### Correttezza e robustezza

- Aggiungere property test e fuzz test.
- Verificare quote, escape e newline attraversati dai confini dei chunk.
- Verificare record molto grandi e chunk di pochi byte.
- Misurare e, se necessario, ridurre le copie causate dalla concatenazione dei
  buffer su record altamente frammentati.
- Formalizzare encoding e separatori supportati.
- Aggiungere errori descrittivi con posizione, riga e colonna quando possibile.
- Definire limiti configurabili per dimensione del record e numero di colonne.

### Criterio di uscita

Le prestazioni dichiarate sono riproducibili e la suite copre sia il formato CSV
comune sia i casi limite più importanti per input streaming.

## Articolo tecnico — Dal primo parser CSV al confronto con Papa Parse

Raccontare l'evoluzione del parser come percorso di ingegneria, non come una
classifica assoluta: state machine originale, test accumulati negli anni,
benchmark riproducibili, profiling, tentativi scartati e ottimizzazioni
incrementali fino al sorpasso di Papa Parse nel workload streaming quoted
misurato su questa macchina.

Le note storiche ed editoriali da preservare sono raccolte in
[`docs/csv-parser-article-notes.md`](docs/csv-parser-article-notes.md).

### A0 — Congelare le prove

- Collegare ogni fase narrativa ai commit e ai file che la dimostrano.
- Distinguere i risultati presenti nei report versionati dagli esperimenti
  temporanei annotati durante la sessione di profiling.
- Conservare hardware, runtime, versioni, comandi, dataset e digest delle
  sorgenti per ogni numero pubblicato.
- Rimuovere dal testo finale qualunque numero che non sia riproducibile su un
  commit identificato o rieseguire l'esperimento prima della pubblicazione.

**Uscita:** evidence ledger completo e nessuna affermazione prestazionale priva
di una fonte verificabile.

### A1 — Ricostruire il parser originale

- Mostrare la state machine del 2021 senza riscriverla in forma irriconoscibile.
- Spiegare perché quote, escape, newline nei campi e confini dei chunk rendono
  il CSV un problema di stato.
- Raccontare il primo `fastMode` come introduzione precoce del concetto di fast
  path per righe prive di quote.
- Evidenziare cosa del modello originale è ancora presente nel parser attuale.

**Uscita:** diagramma degli stati e primo esempio eseguibile comprensibile a chi
non ha mai scritto un parser streaming.

### A2 — Correttezza come prerequisito delle ottimizzazioni

- Spiegare la regola del progetto: un test storico rappresenta un comportamento
  acquisito e non si modifica per far passare una nuova implementazione.
- Selezionare test rappresentativi per chunk boundaries, escaped quote,
  multiline, CR/LF/CRLF, Unicode, separator multibyte, record grandi ed errori
  localizzati.
- Mostrare come property test, fuzz test e test browser permettono modifiche
  aggressive senza perdere la semantica.

**Uscita:** una sezione che colleghi ogni invariante importante a un test reale,
senza trasformare l'articolo in una lista di edge case.

### A3 — Costruire un benchmark onesto

- Spiegare processi isolati, warmup, mediane, rotazione delle librerie e input
  deterministico.
- Separare parsing, stringifying e pipeline end-to-end con writer lento.
- Mostrare perché record/s, MiB/s, first record e memoria rispondono a domande
  differenti.
- Raccontare la correzione metodologica che sposta il conteggio dei parse nel
  sink comune ed elimina hook specifici delle singole librerie.
- Dichiarare con precisione i limiti del confronto: workload, hardware, runtime
  e feature native supportate da ciascuna libreria.

**Uscita:** box metodologico breve nel corpo dell'articolo e appendice completa
con comando riproducibile.

### A4 — Seguire il profiler

- Partire dal collo di bottiglia reale in `processText`, non da una riscrittura
  intuitiva dell'intero parser.
- Visualizzare i costi di scansione, `cellParts.join('')`, `flush` e tracking
  delle coordinate.
- Raccontare anche gli esperimenti scartati: concatenazione sempre diretta,
  caching con guadagni marginali, assenza del tracking e alternative che
  duplicavano troppa logica.
- Spiegare il controllo con consumer che materializza davvero le stringhe, per
  evitare di attribuire a un parser il lavoro rinviato a una rope di V8.

**Uscita:** flamegraph annotato e tabella “ipotesi / esperimento / decisione”.

### A5 — Spiegare le tre svolte tecniche

1. Specializzare il caso comune e ridurre confronti, copie e token parziali.
2. Saltare fra token con ricerche indicizzate e consegnare blocchi più grandi
   alla stessa state machine, senza introdurre un secondo parser divergente.
3. Usare un accumulatore ibrido per i campi e riutilizzare gli indici CR/LF già
   trovati dallo scanner.

Per ogni svolta mostrare prima il codice concettuale, poi il dettaglio reale e
infine l'effetto su caso comune, input frammentato, record grandi e memoria.

**Uscita:** il lettore deve saper spiegare perché il parser è diventato più
veloce, non soltanto ripetere il risultato del benchmark.

### A6 — Scrittura, revisione e pubblicazione

- Preparare un articolo Medium da circa 15–20 minuti con progressive disclosure
  e glossario minimo per i newbie.
- Usare una timeline, un diagramma della state machine, un flamegraph e non più
  di due grafici di benchmark nel corpo principale.
- Far revisionare separatamente correttezza CSV, interpretazione del profiler e
  metodologia del benchmark.
- Rieseguire il benchmark finale dal commit pubblicato e aggiornare numeri,
  digest e data immediatamente prima della pubblicazione.
- Chiudere con le lezioni generalizzabili, non con “il parser più veloce”.

**Uscita:** articolo pubblicabile, esempi verificati e link permanenti a codice,
test, metodologia e risultati grezzi.

### Criterio editoriale di uscita

Un newbie può seguire l'intero percorso dall'idea di state machine al profiling
senza conoscenze pregresse di V8; un lettore esperto può verificare ogni claim e
non trova affermazioni universali ricavate da un singolo benchmark.

## 0.32 — Tipi, moduli e packaging

### Attività

- Fornire dichiarazioni TypeScript con generics per input e output.
- Tipizzare pipeline, fork, merge, error handling e adapter.
- Definire `exports` e supporto CommonJS/ESM senza doppie istanze del modulo.
- Fornire entry point e tipi distinti per core, Node.js e browser.
- Verificare tree shaking e assenza di import Node nel bundle browser.
- Pubblicare una API reference generabile dal codice o da metadata mantenuti
  accanto all'implementazione.
- Aggiungere changelog, support policy e guida di migrazione.
- Definire una policy di versionamento e deprecazione.

### Criterio di uscita

Un progetto JavaScript o TypeScript moderno può importare Exstream senza
configurazioni speciali e riceve tipi coerenti attraverso l'intera pipeline.

## 1.0 — Contratto stabile

La 1.0 non deve coincidere con una riscrittura completa. Deve certificare che il
contratto essenziale è stabile e mantenibile.

### Requisiti

- Semantiche documentate di backpressure, fork, merge, ordine ed errori.
- Supporto alle versioni Node.js dichiarate e testate in CI.
- Supporto ai browser dichiarati e testati in CI per il core e gli adapter web.
- Interoperabilità verificata con async iterable, Node streams, Web Streams,
  EventEmitter ed EventTarget.
- Nessun bug noto ad alta severità nel lifecycle.
- Benchmark CSV e core pubblici e riproducibili.
- Tipi TypeScript e API reference complete.
- Guide di migrazione dalla serie 0.x.
- Almeno due ETL end-to-end eseguiti in CI.
- Package npm minimale e release process riproducibile.

## 1.x — Ecosistema di reader e writer

Gli adapter non devono ampliare indiscriminatamente il core. Devono condividere
un contratto minimo per lifecycle, backpressure, signal e metriche.

### Prime integrazioni candidate

- filesystem e stream Node.js;
- fetch, Web Streams, File API e download streaming nel browser;
- EventEmitter ed EventTarget;
- database relazionali con lettura paginata/cursor e batch writer;
- Salesforce reader/writer;
- S3 o object storage;
- HTTP pagination e API rate-limited;
- code e broker solo quando esiste un caso d'uso concreto.

### Contratto indicativo

```javascript
source({ signal, metrics })
sink({ signal, metrics })
```

Ogni adapter deve documentare:

- granularità della backpressure;
- limiti di concorrenza;
- garanzie di consegna;
- retry e idempotenza;
- comportamento su abort;
- disponibilità runtime: Node.js, browser o entrambi;
- comportamento per sorgenti hot e policy di overflow;
- gestione di checkpoint e resume, quando applicabile.

---

# Roadmap del portale di documentazione

## Obiettivo

Creare un sito presentazionale leggero, riconoscibile e veloce che faccia capire
il valore di Exstream in pochi secondi e offra una documentazione tecnica chiara,
coerente e verificabile.

Il portale deve essere contemporaneamente:

- una homepage capace di comunicare il prodotto;
- una guida progressiva per chi lo prova;
- una reference precisa per chi lo usa in produzione;
- una raccolta di ricette ETL reali;
- la sede trasparente di benchmark, compatibilità e support policy.
- il lancio del nuovo brand e il ponte trasparente dal progetto Exstream
  originale.

## Principi editoriali e visuali

- **Code first:** mostrare una pipeline reale prima di spiegarla.
- **Una pagina, una domanda:** ogni pagina deve avere uno scopo evidente.
- **Progressive disclosure:** quick start breve, dettagli disponibili senza
  interrompere il percorso principale.
- **Contratti espliciti:** ogni operatore documenta ordine, backpressure,
  buffering, errori e cancellazione.
- **Esempi eseguibili:** il codice pubblicato deve essere verificato in CI.
- **Leggerezza:** HTML statico, JavaScript minimo, niente animazioni pesanti.
- **Accessibilità:** contrasto, tastiera, screen reader e reduced motion sono
  requisiti, non rifiniture.
- **Onestà:** spiegare anche quando non usare Exstream.

## Architettura dei contenuti

### 1. Home

La homepage deve rispondere rapidamente a quattro domande:

1. Che cos'è Exstream?
2. Perché non basta un `for await`?
3. Che aspetto ha una pipeline reale?
4. Come lo provo in meno di cinque minuti?

Sezioni proposte:

- hero con promessa breve e pipeline ETL reale;
- diagramma leggero del flusso reader -> transform -> fork -> writer;
- tre vantaggi: backpressure, concorrenza, composizione;
- badge e snippet che mostrino supporto Node.js e browser senza far sembrare il
  progetto una libreria front-end generalista;
- esempio CSV end-to-end;
- esempio fork verso più destinazioni;
- numeri di benchmark con link alla metodologia;
- compatibilità Node.js e stato del progetto;
- call to action verso quick start e GitHub.

Il movimento, se presente, deve essere ottenuto preferibilmente con CSS o SVG e
disattivato tramite `prefers-reduced-motion`.

### 2. Quick start

- Installazione.
- Prima pipeline sincrona.
- Prima pipeline asincrona.
- Lettura da async iterator.
- Scrittura verso uno stream Node.js.
- Lettura da `fetch()`/ReadableStream nel browser.
- Consumo controllato di EventEmitter ed EventTarget.
- Fork verso due writer con backpressure.
- Gestione minima degli errori.

Il quick start deve portare a un risultato utile in una singola pagina.

### 3. Concetti fondamentali

- modello source -> operators -> sink;
- laziness e avvio della pipeline;
- sync e async;
- backpressure;
- fork e observer;
- merge, parallelismo e ordine;
- lifecycle, end, destroy e abort;
- differenza fra source pull-based, stream pausabili ed eventi hot non pausabili;
- Web Streams e interoperabilità browser;
- errori per record ed errori fatali;
- memoria, buffer e throughput.

Usare piccoli diagrammi e timeline solo quando chiariscono il comportamento.

### 4. Guide operative

- Elaborare file CSV di grandi dimensioni.
- Scrivere batch su database.
- Leggere da API paginate e rate-limited.
- Arricchire record con concorrenza limitata.
- Scrivere contemporaneamente su database, file e audit log.
- Retry, dead-letter e resume.
- Sorted group e sorted join.
- Integrare stream Node.js, generatori e async iterator.
- Elaborare un CSV ottenuto via `fetch()` in un Web Worker.
- Trasformare EventEmitter ed EventTarget in source con buffer limitato.
- Osservabilità e metriche di una pipeline.

### 5. API reference

Ogni operatore deve seguire lo stesso template:

1. firma;
2. descrizione in una frase;
3. esempio minimo;
4. tipo di input e output;
5. comportamento sync/async;
6. backpressure e buffering;
7. ordine e concorrenza;
8. errori e cancellazione;
9. ambienti supportati: core, Node.js e browser;
10. comportamento con source hot o non pausabili;
11. edge case;
12. operatori correlati.

La reference deve essere generata o verificata a partire da una fonte vicina al
codice per ridurre la divergenza tra implementazione e documentazione.

### 6. Adapter

Per ogni reader e writer:

- installazione;
- configurazione;
- esempio completo;
- backpressure e batching;
- retry e idempotenza;
- signal e cleanup;
- runtime e primitive richieste;
- buffering e overflow per adapter event-driven;
- limiti noti;
- metriche esposte.

### 7. Benchmark

- metodologia completa;
- hardware e versioni;
- dataset scaricabili o generabili;
- comandi riproducibili;
- throughput e memoria;
- parser e serializer;
- benchmark end-to-end;
- storico dei risultati per release;
- limiti e casi nei quali un concorrente è più adatto.

### 8. Progetto

- visione e scope;
- storia del progetto originale e motivazioni del rebranding;
- relazione fra Exstream e il nuovo package;
- roadmap;
- changelog;
- support policy;
- versioni Node.js supportate;
- guida alla contribuzione;
- migrazioni e deprecazioni;
- security policy.

## Direzione visiva

Il sito deve risultare tecnico, pulito e contemporaneo senza sembrare una demo di
effetti grafici.

### Linguaggio visivo

- tipografia molto leggibile e gerarchia netta;
- palette limitata con un colore distintivo per il flusso dei dati;
- dark e light mode coerenti;
- diagrammi basati su linee, nodi e flussi;
- card usate con moderazione;
- code block centrali nel design, con copy e highlight delle righe importanti;
- spaziatura generosa e larghezza del testo controllata;
- nessuna immagine decorativa pesante.

### Riferimento stilistico: DocuPipe

La homepage di [DocuPipe](https://www.docupipe.ai/) è un riferimento utile per
tono e qualità percepita. Va reinterpretata per il nuovo brand, non replicata.

Elementi da riprendere:

- hero editoriale con headline molto grande, corta e orientata al problema;
- prodotto mostrato immediatamente, prima di una lunga lista di feature;
- palette ridotta composta da fondo caldo, colore quasi nero e un solo accento;
- alternanza di sezioni full-width chiare e scure per dare ritmo alla pagina;
- griglia tecnica sottile come sfondo, coerente con nodi e flussi;
- CTA a pillola, bordi morbidi e ombre molto contenute;
- micro-label uppercase/monospace per aggiungere un tono tecnico;
- mockup che sembrano strumenti reali, non illustrazioni generiche;
- benchmark e prova quantitativa presentati come parte del prodotto;
- molto spazio bianco e una sola idea principale per ogni sezione.

Elementi da non copiare:

- nome, palette esatta, tipografia proprietaria o composizione dei singoli
  mockup;
- animazioni che bloccano o rallentano lo scroll;
- ripetizioni narrative adatte a un prodotto enterprise ma eccessive per una
  libreria open source;
- sezioni commerciali come pricing, compliance e customer proof quando non
  esistono contenuti autentici.

Per il nuovo progetto, l'equivalente visuale del documento trasformato in JSON è
un grafo ETL interattivo:

```text
ASYNC ITERATOR        NORMALIZE       ENRICH (4)       FORK
     source  ------->   map    ------> mapAsync ------+------> PostgreSQL
                                                      +------> CSV / file
                                                      +------> audit
```

Il hero dovrebbe mostrare record che attraversano il grafo, slot di concorrenza
occupati e un writer lento che propaga backpressure verso la sorgente. Il
movimento deve essere breve, comprensibile e realizzato con CSS/SVG o un piccolo
componente isolato, con fallback statico e supporto a `prefers-reduced-motion`.

### Struttura visuale proposta per la homepage

1. **Hero:** promessa, due CTA e grafo ETL interattivo.
2. **The core difference:** una sezione scura che spiega la backpressure
   end-to-end con un solo diagramma.
3. **Composable operations:** pipeline selezionabile con `mapAsync`, `batch`,
   `fork`, `merge`, `csv` e `through`.
4. **Performance:** benchmark CSV riproducibile, throughput e memoria.
5. **Runs anywhere:** lo stesso flusso alimentato da Node stream, async iterator,
   Web Stream ed EventEmitter/EventTarget.
6. **Real ETL recipe:** Salesforce/API -> enrichment -> DB + CSV + audit.
7. **Quick start:** installazione e primo risultato senza registrazione.
8. **Open source:** GitHub, licenza, roadmap e storia da Exstream.

La homepage deve essere più corta di quella DocuPipe: per una libreria open
source il percorso principale è hero -> prova tecnica -> benchmark -> quick
start, non una sequenza commerciale lunga.

### Elemento distintivo

Il motivo grafico ricorrente può essere il flusso che attraversa trasformazioni e
si divide in più rami. Deve apparire nel logo/wordmark, nel hero e nei diagrammi,
senza compromettere leggibilità o velocità.

La nuova identità deve essere progettata per il brand successore, non come un
semplice restyling del vecchio sito Exstream. Il portale deve comunque riconoscere
chiaramente l'origine del progetto e mantenere redirect e percorsi di migrazione.

## Requisiti tecnici del portale

La scelta del framework deve essere formalizzata con un breve spike e una ADR.
Il nome dello strumento è secondario rispetto a questi requisiti:

- generazione statica;
- Markdown o MDX versionabile insieme al codice;
- build e snippet distinti per Node.js e browser quando le API divergono;
- componenti interattivi caricati solo dove necessari;
- syntax highlighting build-time;
- ricerca locale o progressivamente caricata;
- versionamento della documentazione;
- supporto a redirect e URL stabili;
- sitemap, metadata social e SEO tecnico;
- deploy preview per pull request;
- link checker e controllo esempi in CI;
- nessuna dipendenza dal runtime del backend Exstream.

### Budget iniziali

- punteggio Lighthouse almeno 95 per performance, accessibilità, best practice e
  SEO sulle pagine principali;
- JavaScript iniziale sotto 100 KB compressi, preferibilmente molto meno sulle
  pagine puramente documentali;
- homepage utilizzabile senza JavaScript;
- layout stabile durante il caricamento;
- font di sistema o font self-hosted e fortemente subsetted;
- immagini e diagrammi SVG ottimizzati;
- rispetto di `prefers-reduced-motion` e `prefers-color-scheme`.

## Piano di realizzazione del portale

## D0 — Audit e information architecture

- Inventariare le pagine esistenti.
- Inventariare nome, dominio, package e URL da migrare o mantenere.
- Classificare contenuti corretti, obsoleti, duplicati e mancanti.
- Correggere subito requisiti Node.js e API non più coerenti.
- Definire sitemap, navigazione e template della reference.
- Selezionare 3-5 ricette ETL rappresentative.
- Definire tono, terminologia e glossario.
- Definire la relazione editoriale fra Exstream e il nuovo brand.

**Uscita:** sitemap approvata e matrice di migrazione dei contenuti esistenti.

## D1 — Prototipo visuale e stack

- Creare due direzioni visuali leggere per homepage e pagina reference.
- Sviluppare naming shortlist, tagline e identità del nuovo progetto.
- Implementare un prototipo responsive del hero e della navigazione docs.
- Eseguire lo spike sui generatori statici candidati.
- Registrare la scelta in una ADR con dati su bundle, build, ricerca e DX.
- Definire design token, tipografia, colori, code block e diagrammi.

**Uscita:** prototipo navigabile, stack scelto e budget prestazionali verificati.

## D2 — Fondamenta e contenuti essenziali

- Implementare layout, navigazione, ricerca, dark mode e componenti docs.
- Scrivere home, quick start e concetti fondamentali.
- Pubblicare una pagina dedicata a browser, Web Streams e sorgenti evento.
- Pubblicare “Built from Exstream” e la prima guida di migrazione.
- Integrare esempi eseguibili e link checker in CI.
- Pubblicare versioni Node.js supportate e support policy.
- Configurare preview deploy e analytics rispettosi della privacy, se necessari.

**Uscita:** un nuovo utente può capire, installare e usare Exstream senza
consultare i test del repository.

## D3 — Reference e ricette ETL

- Migrare e uniformare la reference degli operatori.
- Documentare backpressure, ordine, buffering ed errori per ogni operatore.
- Pubblicare le prime ricette end-to-end.
- Aggiungere pagine CSV, fork/merge e concorrenza approfondite.
- Aggiungere esempi equivalenti Node/browser per gli operatori portabili.
- Collegare ogni esempio al codice verificato in CI.

**Uscita:** tutta l'API supportata è documentata con un formato coerente.

## D4 — Benchmark e adapter

- Integrare il benchmark CSV riproducibile.
- Pubblicare grafici accessibili e tabelle con dati grezzi scaricabili.
- Documentare i primi reader e writer.
- Aggiungere una demo completa reader -> transform -> fork -> multi-writer.
- Spiegare chiaramente quando Exstream è adatto e quando non lo è.

**Uscita:** il portale dimostra con codice e numeri la proposta di valore.

## D5 — Lancio e manutenzione

- Verificare redirect dalle vecchie URL.
- Aggiornare README e package originale con il collegamento al successore.
- Eseguire audit mobile, accessibilità, SEO e performance.
- Controllare tutti gli snippet contro la release pubblicata.
- Pubblicare guida di migrazione e changelog.
- Definire ownership e processo di aggiornamento della documentazione.
- Aggiungere un controllo release che impedisca la pubblicazione se reference ed
  esempi non sono sincronizzati.

**Uscita:** il nuovo portale sostituisce il precedente senza link rotti né
documentazione divergente.

---

# Demo di riferimento

Lo sviluppo del core, degli adapter e del portale dovrebbe convergere su una demo
unica, abbastanza realistica da esercitare il prodotto intero:

```javascript
salesforceReader(query, { signal })
  .map(normalizeAccount)
  .mapAsync(enrichAccount, {
    concurrency: 10,
    ordered: true,
    signal,
  })
  .fork(
    _.pipeline()
      .batch(1000)
      .through(postgresWriter({ signal })),
    _.pipeline()
      .csvStringify({ header: true })
      .pipe(fileWriter),
    _.pipeline()
      .map(toAuditRecord)
      .through(auditWriter({ signal })),
  )
  .toPromise()
```

La demo deve provare che:

- la sorgente non supera la capacità del writer più lento;
- sono attive al massimo dieci operazioni di enrichment;
- database, CSV e audit ricevono tutti i record previsti;
- ordine e garanzie di consegna corrispondono alla configurazione;
- un errore o un abort chiude reader, task e writer;
- la memoria rimane limitata;
- metriche e progress sono osservabili senza interferire con la backpressure.

Questa demo è contemporaneamente test di accettazione, benchmark end-to-end,
esempio documentale e sintesi della ragione per cui Exstream esiste.

## Demo browser di riferimento

Una seconda demo, più piccola, deve provare che il core non è soltanto
teoricamente portabile:

```javascript
fromWebStream(fetch('/accounts.csv').then(res => res.body))
  .csv({ header: true })
  .map(normalizeAccount)
  .mapAsync(validateAccount, { concurrency: 4, signal })
  .fork(
    _.pipeline().through(indexedDbWriter({ signal })),
    _.pipeline().csvStringify({ header: true }).pipe(downloadStream),
  )
  .toPromise()
```

La demo deve poter girare in un Web Worker, mostrare progress senza interferire
con la backpressure e interrompere fetch, trasformazioni e writer con un unico
`AbortSignal`.

---

# Ordine raccomandato

1. Baseline, test di caratterizzazione e audit di portabilità.
2. Shortlist del nuovo brand e verifica di package, repository e dominio.
3. Release 0.26 di hardening del progetto originale.
4. Fork/import della storia nel nuovo repository e scheletro del nuovo package.
5. Audit e prototipo del nuovo portale in parallelo al lavoro sul lifecycle.
6. Lifecycle/backpressure ed error protocol.
7. Nuova API asincrona.
8. Separazione del core e adapter Node.js/browser/eventi.
9. Benchmark e hardening CSV su Node.js e browser.
10. Tipi, moduli e packaging multi-runtime.
11. Portale completo con reference, ricette, migrazione e benchmark.
12. Release 1.0 del nuovo brand.
13. Adapter ETL della serie 1.x e maintenance mode di `exstream.js`.

La roadmap deve essere rivista a ogni milestone. Se una modifica non migliora
backpressure, composizione, affidabilità degli ETL, prestazioni o chiarezza
dell'API, probabilmente non appartiene al core di Exstream.
