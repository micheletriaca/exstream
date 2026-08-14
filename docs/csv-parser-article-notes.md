# Dossier editoriale: il viaggio del parser CSV di Exstream

Questo documento conserva il materiale necessario per scrivere un articolo
tecnico sull'evoluzione del parser CSV di Exstream. Non è una bozza da
pubblicare: separa fatti versionati, appunti della sessione di profiling e
decisioni editoriali ancora da validare.

## Tesi dell'articolo

Il risultato interessante non è una riscrittura totale né una vittoria assoluta
su ogni parser CSV. È il modo in cui una state machine nata nel 2021 è diventata
competitiva con librerie molto note attraverso:

1. test storici trattati come contratti;
2. benchmark riproducibili e progressivamente più equi;
3. profiling prima delle modifiche;
4. fast path che non duplicano la semantica;
5. ottimizzazioni piccole, misurate e reversibili;
6. verifiche separate per throughput, frammentazione e memoria.

La frase guida può essere:

> Non abbiamo riscritto il parser per vincere un benchmark. Abbiamo seguito le
> prove fino a scoprire dove il lavoro veniva realmente sprecato.

## Regola narrativa fondamentale

“Exstream ha superato Papa Parse” è accettabile soltanto con il perimetro
esplicito:

> Nel benchmark Node.js streaming quoted/escaped/multiline versionato nel
> repository, su Apple M5 con Node.js 26.4.0, Exstream ha ottenuto una mediana di
> 97,25 MiB/s contro 92,81 MiB/s di Papa Parse. Un controllo separato su sette
> run ha misurato 110,65 contro 105,79 MiB/s.

Non usare “il parser CSV più veloce”, “batte sempre Papa Parse” o formulazioni
equivalenti. Dataset, runtime, chunking, API e osservazione dell'output fanno
parte del risultato.

## Cronologia verificabile

| Data          | Commit               | Passaggio                                         | Evidenza principale                                               |
| ------------- | -------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| 2021-08-17    | `7715788`            | Primo parser “superfast”                          | `src/csv.js`, 91 righe aggiunte                                   |
| 2021-08-19    | `5723b61`            | Prime ottimizzazioni locali                       | modifiche concentrate in `src/csv.js`                             |
| 2021-08-19    | `67d9ea7`            | `fastMode` per CSV senza quote                    | ricerca newline + `split`, dichiarato 2× nel commit               |
| 2021-08-20/21 | `a6ecc94`, `0f7aabe` | Escape e ulteriori rifiniture                     | codice e test CSV storici                                         |
| 2026-08-12    | `d426fb3`            | Hardening, parser incrementale e harness completo | parser separato, property/fuzz/error test, report full e memory   |
| 2026-08-13    | `a44fce8`            | Token e hot path specializzati                    | `charCodeAt`, token window, meno copie e join evitati             |
| 2026-08-13    | `7d56839`            | CSV Parser e Papa Parse nel confronto             | capability matrix e report a cinque librerie                      |
| 2026-08-13    | `397f69a`            | Scanner stateful indicizzato                      | salti con `indexOf`, byte router, blocchi decodificati più grandi |
| 2026-08-13    | `8b375b9`            | Accumulatore ibrido, newline reuse e sink comune  | parser, test mirati, metodologia e report aggiornati              |

Per ricostruire una fase usare `git show <commit>` e non affidarsi soltanto a
questo riassunto.

## Il parser originale: cosa mostrare

Il parser del 2021 lavorava sui byte di un `Buffer`, conservava il residuo fra
chunk e manteneva esplicitamente almeno questi concetti:

- `inQuote`;
- inizio e fine della cella;
- colonna e riga corrente;
- escape seguito da quote;
- separatore e newline validi soltanto fuori dalle quote;
- buffer incompleto da conservare per il chunk successivo.

Questa è già la sostanza della state machine attuale. Sono cambiati il modo di
raggiungere i token, la gestione degli encoding, la ricostruzione dei campi e la
robustezza ai confini; non è stata sostituita l'idea centrale.

Limiti utili da mostrare senza ridicolizzare il codice originale:

- `Buffer.concat` ricostruiva il buffer ad ogni ingresso;
- il ciclo visitava ogni byte;
- quote, escape e separator venivano ridotti al primo byte della codifica;
- il record finale richiedeva una gestione speciale;
- la ricostruzione e l'unescape della cella avvenivano dopo la scansione.

Il `fastMode` del 2021 è un ottimo ponte didattico: per righe senza quote cercava
direttamente la newline e usava `split`. Il principio “il caso semplice non deve
pagare tutta la grammatica” era presente fin dall'inizio.

## Correttezza: il capitale che ha permesso il lavoro

Regola esplicita emersa durante il lavoro:

> Ogni problema trovato negli anni è stato corretto e coperto da un test. Un test
> che fallisce è informazione da comprendere insieme, non un'aspettativa da
> adattare automaticamente alla nuova implementazione.

Coperture da citare e collegare:

- `test/csv.test.js`: comportamento storico e round trip;
- `test/csv-property.test.js`: property test, fuzz deterministico e record da
  128 KiB in chunk da tre byte;
- `test/csv-multibyte.test.js`: encoding e token Unicode/multibyte;
- `test/csv-errors.test.js`: limiti ed errori con line, column, offset e record;
- `test/csv-indexed-scanner.test.js`: passaggio dal router semplice allo scanner
  stateful, token spezzati, quote astrali e accumulatore ibrido;
- `test/csv-benchmark-harness.test.js`: validità funzionale dell'harness;
- test browser e worker: stessa semantica nel runtime web.

Stato al commit `8b375b9`: 60 file e 603 test verdi; coverage complessiva
97,75% statement, 88,12% branch, 97,10% function e 97,73% line.

## Evoluzione del benchmark

### Domande separate

Il benchmark non cerca un singolo “numero della libreria”. Separa:

- parse, stringify e pipeline parse → stringify;
- array e object mode;
- input plain, quoted/escaped/multiline, wide, narrow e record da 1 MiB;
- chunk da 64 KiB, sette byte e tre byte;
- writer veloce e writer che applica backpressure;
- throughput, first record, heap/RSS, memoria esterna, ArrayBuffer e GC.

Ogni sample viene eseguito in un processo fresco con input deterministico. Le
librerie ruotano fra i round; vengono registrati warmup, campioni e mediana.

### Correzione metodologica finale

Inizialmente ogni parser contava i record con il proprio meccanismo:

- Exstream: `tap`;
- Node CSV: `on_record`;
- Fast-CSV: `transform`;
- CSV Parser e Papa Parse: listener `data`.

Questi hook non avevano lo stesso costo. Nel commit `8b375b9`, tutti gli scenari
di parse contano il record soltanto nel medesimo `ObjectSink`. Le pipeline
end-to-end continuano invece a contare subito dopo il parser, perché i chunk di
byte serializzati non conservano i confini dei record.

Conseguenza editoriale: i delta fra `397f69a` e `8b375b9` includono anche questo
cambio di osservazione e non vanno presentati come accelerazione isolata del
solo parser.

## Progressione dei risultati versionati

Valori mediani in MiB/s, presi dai rispettivi `CSV_RESULTS.md` e quindi
riproducibili dal commit indicato.

| Commit    | Quoted comune | 7-byte object | 3-byte array | Pipeline quoted |
| --------- | ------------: | ------------: | -----------: | --------------: |
| `d426fb3` |         41,00 |         12,97 |        11,47 |           33,54 |
| `a44fce8` |         60,55 |         15,09 |        12,77 |           44,66 |
| `397f69a` |         90,82 |         17,86 |        15,44 |           66,70 |
| `8b375b9` |         97,25 |         18,14 |        16,11 |           68,68 |

Il confronto con Papa Parse è stato aggiunto dopo `a44fce8`. Nel report di
`397f69a`, con la vecchia osservazione per-libreria, Papa Parse misurava 110,62
MiB/s contro 90,82 di Exstream sul quoted comune. Nel report di `8b375b9`, con
sink comune, Exstream misura 97,25 contro 92,81. Il controllo dedicato a sette
run della stessa sessione misura 110,65 contro 105,79.

Per il testo finale preferire il report versionato; usare il controllo a sette
run come conferma e rieseguirlo salvandone l'output prima della pubblicazione.

## Le svolte tecniche

### 1. Rendere economici i confronti frequenti

Il commit `a44fce8` evita lavoro ripetuto nel ciclo caldo:

- confronti di token a singolo carattere tramite code unit;
- fallback a `startsWith` per token Unicode o multibyte;
- finestra limitata per riconoscere token parziali a fine chunk;
- niente concatenazione con `pending` quando non serve;
- niente `join` quando una cella contiene un solo frammento;
- tracking delle coordinate che esce subito in assenza di newline.

È la prima lezione generale: specializzare il caso comune senza rimuovere il
fallback corretto.

### 2. Saltare fra eventi invece di interrogare ogni carattere

Il commit `397f69a` sostituisce gran parte del passo carattere-per-carattere con
ricerche indicizzate di quote, escape, separator, CR e LF. I blocchi compresi fra
due token vengono trattati insieme.

Il byte router conserva un fast path per righe sicuramente semplici. Quando
incontra una quote, consegna il buffer e i chunk successivi allo scanner
stateful. Non esistono due grammatiche CSV indipendenti: il fast path evita il
lavoro inutile, mentre la state machine resta l'autorità per il formato
complesso.

### 3. Ricostruire le celle in modo ibrido

L'array di frammenti più `join` è robusto per campi enormi e input molto
frammentato, ma costa anche sui comuni campi quoted che producono pochi pezzi.
La concatenazione sempre diretta è rapida nel caso comune, ma rischia rope
profonde o copie ripetute su migliaia di frammenti.

La soluzione finale:

- concatena direttamente fino a otto frammenti e 4 KiB;
- oltre una delle soglie passa una sola volta ad array + `join`;
- ignora append vuote;
- azzera insieme stringa, array e contatore a fine cella.

Le soglie limitano profondità della rope e lavoro di copia senza imporre array e
join alla riga comune.

### 4. Non calcolare due volte la stessa informazione

Lo scanner conosce già la posizione del prossimo CR e LF. Il vecchio tracker di
linea e colonna riscansionava comunque il blocco. Il commit `8b375b9` passa al
tracker gli indici già trovati e cerca soltanto le newline successive,
preservando CR, LF, CRLF, offset e coordinate esatte.

## Profiling e micro-esperimenti della sessione

Questa sezione contiene appunti non tutti versionati. Sono materiale narrativo,
non evidenza pubblicabile senza una nuova esecuzione salvata.

### Profilo CPU

Profilo su un milione di righe quoted con chunk da 64 KiB:

- `processText` era il principale centro di costo;
- `cellParts.join('')` rappresentava circa l'11–13% dei sample;
- erano visibili anche `flush`, `advance` e il ciclo di scansione;
- il risultato ha spostato l'attenzione dalla grammatica alla ricostruzione
  delle celle e al tracking diagnostico.

### Varianti temporanee

Tempi indicativi osservati nel workspace temporaneo, da non pubblicare senza
rerun:

| Variante                             | Tempo indicativo sul quoted comune |
| ------------------------------------ | ---------------------------------: |
| baseline `397f69a`                   |                       circa 321 ms |
| concatenazione diretta               |                       circa 276 ms |
| concatenazione + newline indicizzate |                       circa 264 ms |

Un consumer che eseguiva `Buffer.byteLength` su ogni campo forzava la
materializzazione delle stringhe e impediva di attribuire al parser lavoro
semplicemente rinviato in una rope V8:

| Variante materializzata              | Mediana indicativa |
| ------------------------------------ | -----------------: |
| baseline                             |          392,07 ms |
| Papa Parse                           |          351,07 ms |
| concatenazione + newline indicizzate |          347,76 ms |

Altri controlli della sessione:

- su chunk da sette byte il prototipo migliorava circa del 6%;
- su chunk da tre byte migliorava circa del 4%;
- la pipeline quoted migliorava circa del 5–6%;
- campi quoted da 1 MiB non mostravano una regressione materiale;
- il caching isolato delle quote valeva soltanto circa 1–2%;
- una variante di unescape nativo una volta per campo sembrava promettente ma
  non è entrata nei primi tre interventi e resta lavoro futuro.

### Esperimenti scartati o corretti

- **Secondo parser specializzato:** troppo rischio di duplicare semantica e
  moltiplicare la matrice dei test. Si è preferito un router che converge sulla
  stessa state machine.
- **Concatenazione sempre diretta:** ottimo numero comune, protezione
  insufficiente contro campi enormi e migliaia di frammenti. Sostituita dalla
  strategia ibrida.
- **Benchmark con hook differenti:** corretto spostando il conteggio nel sink
  comune.
- **Microbenchmark troppo brevi:** scarti di pochi punti percentuali possono
  essere rumore; sono stati usati run più lunghi, processi freschi e mediane.
- **Guardare soltanto il parse:** stringify, pipeline e backpressure possono
  invertire la rilevanza di una micro-ottimizzazione.

## Traccia proposta dell'articolo

1. **Il CSV è semplice finché non lo è.** Quote, escape, multiline e chunk.
2. **La prima state machine.** Il parser del 2021 e il primo `fastMode`.
3. **Cinque anni di bug diventati test.** Correttezza come libertà di cambiare.
4. **Il primo confronto serio.** Harness, memoria e sorpresa sul quoted.
5. **Profilare, non indovinare.** Dove veniva speso davvero il tempo.
6. **Tre passaggi di ottimizzazione.** Token, salti indicizzati, accumulatore
   ibrido e riuso delle newline.
7. **Gli esperimenti che non sono diventati codice.** Rope, secondo parser,
   rumore e materializzazione.
8. **Il confronto finale.** Numeri, memoria e limiti dell'affermazione.
9. **Cosa resta dell'implementazione originale.** La state machine e “l'anima”.
10. **Lezioni trasferibili.** Test, profiler, fast path convergenti e benchmark
    onesti.

## Visuali da preparare

Usare soltanto visuali che chiariscono una relazione difficile da rendere in
prosa:

1. timeline 2021 → 2026 con commit e throughput quoted;
2. diagramma minimo degli stati `plain`, `inQuotes`, `afterQuote`, `end/error`;
3. confronto “scan every character” vs “jump to next token”;
4. accumulatore ibrido con soglie e fallback;
5. flamegraph annotato prima dell'ultima ottimizzazione;
6. grafico finale Exstream/Papa Parse per quoted comune e chunk da tre byte.

Evitare dashboard dense e grafici che mescolano parse, stringify e pipeline.

## Glossario minimo per il lettore newbie

- **Chunk:** porzione di input ricevuta in un singolo passo; non coincide con una
  riga o un carattere completo.
- **State machine:** insieme esplicito di stati e transizioni usato per decidere
  il significato dello stesso carattere in contesti differenti.
- **Fast path:** percorso ottimizzato per un caso comune riconoscibile, con un
  percorso completo per i casi restanti.
- **Backpressure:** capacità del consumer lento di limitare la velocità del
  producer.
- **Hot path:** codice eseguito abbastanza spesso da dominare il tempo totale.
- **Rope:** rappresentazione interna di una stringa come albero di
  concatenazioni, materializzata quando necessario.
- **Warmup:** esecuzioni escluse dalla misura che permettono al runtime di
  caricare e ottimizzare il codice.
- **Mediana:** valore centrale dei campioni, meno sensibile agli outlier della
  media.
- **RSS:** memoria residente osservata dal sistema operativo; non equivale alle
  sole allocazioni JavaScript.

## Checklist prima della pubblicazione

- [ ] Scegliere un commit immutabile da usare come riferimento finale.
- [ ] Rieseguire full, memory e controllo quoted a sette run.
- [ ] Salvare anche l'output del controllo dedicato, oggi presente solo negli
      appunti di sessione.
- [ ] Generare un flamegraph riproducibile per il commit precedente e quello
      finale.
- [ ] Verificare ogni snippet contro il commit citato.
- [ ] Collegare test storici senza suggerire che ogni test sia stato scritto nel 2021.
- [ ] Separare chiaramente numeri ottenuti con metodologie differenti.
- [ ] Far revisionare il testo a una persona esperta di CSV e una di performance
      JavaScript/V8.
- [ ] Inserire hardware, Node.js, versioni delle librerie e comando.
- [ ] Dichiarare feature e scenari ai quali CSV Parser o Papa Parse non
      partecipano nativamente.
- [ ] Evitare claim universali nel titolo, sottotitolo e social preview.
- [ ] Terminare con principi generalizzabili, non con una victory lap.

## Fonti interne

- Parser attuale: `src/csv-parser.js`
- Facciata parse/stringify: `src/csv.js`
- Metodologia: `test/benchmarks/README.md`
- Sintesi corrente: `test/benchmarks/CSV_RESULTS.md`
- Report grezzi: `test/benchmarks/csv-benchmark-*.json`
- Harness: `test/benchmarks/streaming-csv.mjs`
- Worker: `test/benchmarks/streaming-csv.worker.mjs`
- Dataset e casi: `test/benchmarks/csv-benchmark-data.mjs` e
  `test/benchmarks/csv-benchmark-cases.mjs`
- Cronologia Git: commit elencati nella tabella iniziale.