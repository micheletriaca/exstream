declare const exstreamDataValue: unique symbol
declare const exstreamDestinationInput: unique symbol
declare const exstreamLazyContext: unique symbol

declare function exstream<T, C extends object>(
  source: exstream.Exstream<T, C>,
  options?: exstream.StreamOptions | null,
): exstream.Exstream<T, C>
declare function exstream<T>(
  source: PromiseLike<T>,
  options?: exstream.StreamOptions | null,
): exstream.Exstream<Awaited<T>, exstream.LazyRecordContext<Awaited<T>>>
declare function exstream<T>(
  source: Iterable<exstream.DataValue<T>> | AsyncIterable<exstream.DataValue<T>>,
  options?: exstream.StreamOptions | null,
): exstream.Exstream<T, exstream.LazyRecordContext<T>>
declare function exstream<T>(
  source: exstream.StreamSource<T>,
  options?: exstream.StreamOptions | null,
): exstream.Exstream<T, exstream.LazyRecordContext<T>>
declare function exstream<T = unknown>(
  source?: exstream.StreamSource<T> | null,
  options?: exstream.StreamOptions | null,
): exstream.Exstream<T, exstream.LazyRecordContext<T>>

declare namespace exstream {
  /** The special value that marks the end of an Exstream. */
  const nil: unique symbol
  type Nil = typeof nil

  /** The lifecycle state of a stream. */
  type StreamState = 'idle' | 'running' | 'ending' | 'ended' | 'destroyed' | 'aborted'
  type OverflowPolicy = 'error' | 'drop-oldest' | 'drop-newest'
  type ErrorOrigin = 'source' | 'operator' | 'format' | 'sink' | 'lifecycle' | 'unknown'
  type SortDirection = 'asc' | 'desc'
  type JoinType = 'inner' | 'left' | 'right'
  type PropertyKeyOf<T> = Extract<keyof T, PropertyKey>
  type Falsy = false | 0 | '' | null | undefined
  type FlatValue<T> = T extends string ? T : T extends Iterable<infer U> ? U : T
  /** Creates an inner stream only when merge activates its slot. */
  type StreamFactory<T, C extends object> = () => Exstream<T, C>
  type MergeValue<T> =
    T extends Exstream<infer U, any> ? U : T extends StreamFactory<infer U, any> ? U : never
  type MergeContext<T, Fallback extends object> =
    T extends Exstream<any, infer C> ? C : T extends StreamFactory<any, infer C> ? C : Fallback
  type ContextAddition<T> = Awaited<T> extends object ? Awaited<T> : object
  type ValueOf<S> = S extends Exstream<infer T, any> ? T : never
  type ContextOf<S> = S extends Exstream<infer T, infer C> ? CallbackContext<T, C> : never

  /** Information that follows one value through the pipeline. */
  interface RecordContext<Input = unknown> {
    /** The value that created this context. */
    readonly input: Input
    /** A signal cancelled when work for this branch should stop. */
    readonly signal: AbortSignal
  }

  /** @internal Tracks a context that has not been created at runtime yet. */
  interface LazyRecordContext<Input = unknown> extends RecordContext<Input> {
    readonly [exstreamLazyContext]: true
  }

  type CallbackContext<T, C extends object> =
    C extends LazyRecordContext<unknown> ? RecordContext<T> : C
  type NextContext<C extends object, Output> =
    C extends LazyRecordContext<unknown> ? LazyRecordContext<Output> : C
  type MaterializedContext<C extends object, Input> =
    C extends LazyRecordContext<unknown> ? RecordContext<Input> : C
  type ContextAfterCallback<C extends object, Input, Output, F extends (...args: any[]) => any> =
    Parameters<F> extends [any, any, ...any[]]
      ? MaterializedContext<C, Input>
      : NextContext<C, Output>
  type AggregateOutputContext<C extends object, Output, UsesContext extends boolean = false> =
    C extends LazyRecordContext<unknown>
      ? UsesContext extends true
        ? AggregateContext<Output, RecordContext<unknown>>
        : LazyRecordContext<Output>
      : AggregateContext<Output, C>

  /** Context produced when several input values become one output value. */
  type AggregateContext<Input, ParentContext extends object> = RecordContext<Input> & {
    /** Contexts of the values included in this result, in input order. */
    readonly contexts?: Array<ParentContext | undefined>
  }

  /** Controls buffering and cancellation when a stream is created. */
  interface StreamOptions {
    /** Maximum number of queued values. Defaults to Infinity. */
    bufferLimit?: number
    /** What to do when the buffer is full. Defaults to "error". */
    overflow?: OverflowPolicy
    /** Cancels the stream when this signal is aborted. */
    signal?: AbortSignal
  }

  /** Wraps a value so an Error can travel as normal data. */
  interface DataValue<T> {
    readonly value: T
    readonly [exstreamDataValue]: true
  }

  /** Minimal shape accepted for Node-style readable streams. */
  interface NodeReadableLike<T = unknown> {
    pipe(destination: unknown): unknown
    on(event: string | symbol, listener: (...args: any[]) => void): this
    once(event: string | symbol, listener: (...args: any[]) => void): this
    off(event: string | symbol, listener: (...args: any[]) => void): this
    destroy(error?: Error): unknown
    [Symbol.asyncIterator]?: () => AsyncIterator<T>
  }

  /** Minimal shape accepted for Node-style writable streams. */
  interface NodeWritableLike<T = unknown> {
    write(value: T): boolean
    end(): unknown
    emit(event: string | symbol, ...args: any[]): boolean
    on(event: string | symbol, listener: (...args: any[]) => void): this
    off(event: string | symbol, listener: (...args: any[]) => void): this
  }

  /** Minimal shape returned when a reusable pipeline becomes a Node Transform stream. */
  interface NodeTransformLike<Input = unknown, Output = Input>
    extends NodeReadableLike<Output>, NodeWritableLike<Input> {}

  type GeneratorWrite<T> = (value: T | Error | DataValue<T> | Nil) => boolean
  type GeneratorNext<T> = (source?: StreamSource<T>) => void
  type StreamGenerator<T> = (write: GeneratorWrite<T>, next: GeneratorNext<T>) => void
  type StreamSource<T> =
    | Iterable<T>
    | AsyncIterable<T>
    | ReadableStream<T>
    | NodeReadableLike<T>
    | StreamGenerator<T>

  type Push<T, C extends object> = (
    error?: unknown | null,
    value?: T | Nil | null,
    context?: C,
  ) => boolean | void
  type AsyncConsumer<T, U, C extends object, NextContext extends object = C> = (
    error: ExstreamError<T> | null | undefined,
    value: T | Nil,
    push: Push<U, NextContext>,
    next: () => void,
  ) => void | Promise<void>
  type SyncConsumer<T, U, C extends object, NextContext extends object = C> = (
    error: ExstreamError<T> | null | undefined,
    value: T | Nil,
    push: Push<U, NextContext>,
  ) => void

  interface MapOptions {
    /** Include both the input and output in each result. */
    wrap?: boolean
  }

  interface MapAsyncRetry<T, C extends object> {
    /** Number of additional attempts after the first failure. */
    retries?: number
    /** Wait time in milliseconds, or a function that calculates it. */
    delay?:
      | number
      | ((
          attempt: number,
          error: ExstreamError<T>,
          value: T,
          context: C,
        ) => number | PromiseLike<number>)
    /** Return false to stop retrying a particular error. */
    when?: (
      error: ExstreamError<T>,
      value: T,
      context: C,
      attempt: number,
    ) => boolean | PromiseLike<boolean>
  }

  interface MapAsyncOptions<T, C extends object> {
    /** Maximum active operations plus completed results awaiting downstream demand. Defaults to 1. */
    concurrency?: number
    /** Keep results in input order. Defaults to true. */
    ordered?: boolean
    /** Retry policy, or a number of retries. */
    retry?: number | MapAsyncRetry<T, C> | null
    /** Maximum time in milliseconds for each attempt. */
    timeout?: number | null
    /** Cancels this operator when aborted. */
    signal?: AbortSignal
  }

  interface CsvOptions<Header extends readonly PropertyKey[] | boolean = false> {
    encoding?: string
    separator?: string
    quote?: string
    escape?: string
    fastMode?: boolean
    skipEmptyLines?: boolean
    header?: Header | ((row: string[]) => readonly PropertyKey[])
    maxColumns?: number
    maxRecordBytes?: number
  }

  interface CsvStringifyOptions<Header extends readonly PropertyKey[] | boolean = false> {
    encoding?: string
    separator?: string
    quote?: string
    escape?: string
    lineEnding?: string
    header?: Header
    quoted?: boolean
    quotedEmpty?: boolean
    maxColumns?: number
    maxRecordBytes?: number
  }

  interface JsonOptions {
    /** Text encoding used for byte chunks. Defaults to UTF-8. */
    encoding?: string
    /** Maximum nesting level accepted in the document. */
    maxDepth?: number
    /** Maximum encoded size of each selected value. */
    maxValueBytes?: number
    /** Streamable JSONPath selecting the values to emit. Defaults to the document root. */
    path?: string
  }

  interface JsonlOptions {
    /** Text encoding used for byte chunks. Defaults to UTF-8. */
    encoding?: string
    /** Maximum nesting level accepted in one record. */
    maxDepth?: number
    /** Maximum encoded size of one input record. */
    maxRecordBytes?: number
    /** Ignores blank input lines. Defaults to true. */
    skipEmptyLines?: boolean
    /** Transforms parsed properties using the same rules as JSON.parse(). */
    reviver?: (this: unknown, key: string, value: unknown) => unknown
  }

  interface JsonlStringifyOptions {
    /** Text encoding used for output chunks. Defaults to UTF-8. */
    encoding?: string
    /** Text appended after every record. Defaults to a line feed. */
    lineEnding?: string
    /** Maximum encoded size of one output record, including its line ending. */
    maxRecordBytes?: number
    /** Selects or transforms properties using the same rules as JSON.stringify(). */
    replacer?:
      | readonly (number | string)[]
      | ((this: unknown, key: string, value: unknown) => unknown)
  }

  interface JsonStringifyStats {
    /** Number of values successfully serialized into the streamed array. */
    readonly count: number
    /** Bytes emitted before the final JSON properties and closing delimiters. */
    readonly bytesWritten: number
    /** Cancels when work for the stringifier branch should stop. */
    readonly signal: AbortSignal
  }

  interface JsonStringifyOptions<FinalProperties extends object = Record<string, unknown>> {
    /** Text encoding used for output chunks. Defaults to UTF-8. */
    encoding?: string
    /** Adds these root properties before the streamed array. */
    properties?: Record<string, unknown>
    /** Maximum encoded size of each array value. */
    maxValueBytes?: number
    /** Location of the streamed array. Defaults to $[*]. Envelope paths must end in [*]. */
    path?: string
    /** Selects or transforms properties using the same rules as JSON.stringify(). */
    replacer?:
      | readonly (number | string)[]
      | ((this: unknown, key: string, value: unknown) => unknown)
    /** Adds root properties after the source ends. May return a promise. */
    finalize?: (stats: JsonStringifyStats) => FinalProperties | PromiseLike<FinalProperties>
  }

  type CsvRow<Header> = Header extends readonly (infer K extends PropertyKey)[]
    ? Record<K, string>
    : Header extends true
      ? Record<string, string>
      : string[]

  interface FromEventOptions<Args extends unknown[], T> extends StreamOptions {
    /** Converts the event arguments into one stream value. */
    map?: (...args: Args) => T
    /** Event that ends the stream. Use false to disable it. */
    end?: string | symbol | false
    /** Event that fails the stream. Use false to disable it. */
    error?: string | symbol | false
    /** Buffer size used before overflow handling starts. */
    highWaterMark?: number
  }

  interface EventTargetLike {
    addEventListener(event: string | symbol, listener: (...args: any[]) => void): unknown
    removeEventListener(event: string | symbol, listener: (...args: any[]) => void): unknown
  }

  interface EventEmitterLike {
    on(event: string | symbol, listener: (...args: any[]) => void): unknown
    off(event: string | symbol, listener: (...args: any[]) => void): unknown
  }

  interface ObserveOptions extends StreamOptions {}
  interface PipeOptions {
    /** End the destination when the source ends. Defaults to true. */
    end?: boolean
    /** Cancels the transfer when this signal aborts. */
    signal?: AbortSignal
    /** Leaves the destination open after a failed or cancelled transfer. */
    preventAbort?: boolean
    /** Leaves the destination open after a successful transfer. */
    preventClose?: boolean
  }
  interface DestinationPipeOptions {
    /** Cancels the destination and its source branch when this signal aborts. */
    signal?: AbortSignal
  }
  interface DestinationContext {
    /** Cancels when the transfer or its source branch is aborted. */
    readonly signal: AbortSignal
  }
  /** Describes where an error first entered an Exstream pipeline. */
  interface ErrorInfo<Input = unknown> {
    readonly origin: ErrorOrigin
    readonly stage?: string
    readonly input?: Input
  }

  /** A reusable terminal consumer accepted by pipeTo(). */
  interface Destination<Input = unknown> {
    readonly __exstream_destination__: true
    /** @internal Keeps the consumed value type available for inference. */
    readonly [exstreamDestinationInput]: (input: Input) => void
  }
  interface ToWebReadableOptions {
    signal?: AbortSignal
    strategy?: QueuingStrategy<unknown>
  }
  interface ExtendOptions {
    /** Set false when the extension cannot be recorded in a reusable pipeline. */
    pipeline?: boolean
  }
  interface ThroughOptions {
    /** Treat a Node stream as write-only. */
    writable?: boolean
  }
  interface RoutedErrors<T, C extends object> {
    output: Exstream<T, C>
    deadLetters: Exstream<{ error: ExstreamError<T>; input: T }, C>
  }
  interface SortedGroup<K, T> {
    key: K
    values: T[]
  }
  interface SortedJoinResult<K, A, B> {
    key: K
    a: A | null
    b: B | null
  }

  /** An error raised while processing one input value. */
  interface ExstreamError<Input = unknown> extends Error {
    readonly exstreamError: true
    readonly exstreamInput: Input
    readonly reason?: unknown
    readonly exstreamFatal?: boolean
    readonly exstreamInfo?: ErrorInfo<Input>
  }

  /** Raised when a configured stream buffer cannot accept another value. */
  class BufferOverflowError extends Error {
    readonly code: 'EXSTREAM_BUFFER_OVERFLOW'
    readonly limit: number
  }

  /** Raised when one mapAsync attempt reaches its time limit. */
  class MapAsyncTimeoutError extends Error {
    readonly code: 'EXSTREAM_MAP_ASYNC_TIMEOUT'
    readonly timeout: number
    readonly attempt: number
  }

  /** A CSV parsing error with the exact input position. */
  class CsvParseError extends Error {
    readonly code: string
    readonly column: number
    readonly line: number
    readonly offset: number
    readonly record: number
  }

  /** A CSV output error with the record and optional column. */
  class CsvStringifyError extends Error {
    readonly code: string
    readonly column?: number
    readonly record: number
  }

  /** A JSON or JSONL parsing error with the exact input position. */
  class JsonParseError extends Error {
    readonly code: string
    readonly column: number
    readonly line: number
    readonly offset: number
    readonly record?: number
  }

  /** A JSON output error with the source record when available. */
  class JsonStringifyError extends Error {
    readonly code: string
    readonly record?: number
  }

  /** A lazy, backpressure-aware sequence of values. */
  interface Exstream<T = unknown, C extends object = LazyRecordContext<T>> {
    readonly __exstream__: true
    writable: boolean
    readable: boolean
    readonly state: StreamState
    readonly ended: boolean
    readonly abortReason: unknown
    readonly signal: AbortSignal
    readonly buffered: number
    readonly peakBuffered: number
    readonly dropped: number
    readonly bufferLimit: number
    readonly overflowPolicy: OverflowPolicy
    readonly paused: boolean
    readonly pausedFromOutside: boolean
    readonly pausedFromInside: boolean
    /** The stream that feeds this stream, when connected. */
    readonly source?: Exstream<unknown, object> | null
    /** The last stream in a connected chain, when one is assigned. */
    readonly endOfChain?: Exstream<unknown, object>

    /** Adds an event listener. */
    on(event: string | symbol, listener: (...args: any[]) => void): this
    /** Adds an event listener that runs once. */
    once(event: string | symbol, listener: (...args: any[]) => void): this
    /** Removes an event listener. */
    off(event: string | symbol, listener: (...args: any[]) => void): this
    /** Emits an event and returns whether it had listeners. */
    emit(event: string | symbol, ...args: any[]): boolean
    /** Returns the number of listeners for an event. */
    listenerCount(event: string | symbol): number
    /** Returns all event names with listeners. */
    eventNames(): Array<string | symbol>
    /** Removes listeners for one event, or every event when omitted. */
    removeAllListeners(event?: string | symbol): this
    /** Sets the listener warning limit where the runtime supports it. */
    setMaxListeners(count: number): this
    /** Iterates lazily with backpressure and cancels the branch when iteration stops early. */
    [Symbol.asyncIterator](): AsyncIterableIterator<T>

    /** Writes one value. Error objects become error records; wrap them with data() to keep them as data. */
    write(value: T | Error | DataValue<T> | Nil): boolean
    /**
     * Starts a source whose automatic startup was disabled, typically with `fork(true)`.
     * This releases the producer once downstream consumers are ready; it is not a terminal
     * consumer and the returned promise does not wait for the stream to finish. Use `drain()`
     * to run a pipeline that has no writer or whose output should be discarded.
     */
    start(): Promise<void>
    /** Ends this stream after its buffered values. */
    end(): void

    /** Creates a custom asynchronous operator. Call next() when ready for another value. */
    consume<U = T, NextContext extends object = C>(
      fn: AsyncConsumer<T, U, C, NextContext>,
    ): Exstream<U, NextContext>
    /** Creates a custom synchronous operator. */
    consumeSync<U = T, NextContext extends object = C>(
      fn: SyncConsumer<T, U, C, NextContext>,
    ): Exstream<U, NextContext>
    /** Transforms every value and keeps the input beside the output. */
    map<U>(
      fn: (value: T, context: CallbackContext<T, C>) => U,
      options: { wrap: true },
    ): Exstream<
      U extends PromiseLike<infer R>
        ? Promise<{ input: T; output: Awaited<R> }>
        : { input: T; output: U },
      MaterializedContext<C, T>
    >
    /** Transforms every value and infers the new stream value type. */
    map<U>(
      fn: (value: T, context: CallbackContext<T, C>) => U,
      options?: MapOptions | null,
    ): Exstream<U, NextContext<C, U>>
    /** Adds fields to the record context without changing the value. */
    withContext(): Exstream<T, C>
    withContext<A extends object | void>(
      fn: (value: T, context: CallbackContext<T, C>) => A,
    ): Exstream<T, MaterializedContext<C, T> & ContextAddition<A>>
    /** Adds fields to the record context after an asynchronous operation. */
    extendContext<A extends object | void | PromiseLike<object | void>>(
      fn: (value: T, context: CallbackContext<T, C>) => A,
    ): Exstream<T, MaterializedContext<C, T> & ContextAddition<A>>
    /** Transforms a value and emits the items inside the returned iterable. */
    flatMap<U>(fn: (value: T, context: C) => U): Exstream<FlatValue<U>, C>
    /** Runs a side effect for each value without changing it. */
    tap(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Removes false, zero, empty strings, null and undefined values. */
    compact(): Exstream<Exclude<T, Falsy>, C>
    /** Emits the first value that matches the test. */
    find<S extends T>(fn: (value: T, context: C) => value is S): Exstream<S, C>
    find(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Reads a field from every value. Dot and bracket paths are supported at runtime. */
    pluck<K extends PropertyKeyOf<T>>(field: K): Exstream<T[K], C>
    pluck<D = undefined>(field: string, defaultValue?: D): Exstream<unknown | D, C>
    /** Keeps only the selected fields of every object. */
    pick<K extends PropertyKeyOf<T>>(fields: readonly K[]): Exstream<Pick<T, K>, C>
    /** Removes the selected fields from every object. */
    omit<K extends PropertyKeyOf<T>>(fields: K | readonly K[]): Exstream<Omit<T, K>, C>
    /** Keeps values that pass the test. */
    filter<S extends T>(fn: (value: T, context: C) => value is S): Exstream<S, C>
    filter(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Removes values that pass the test. */
    reject(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Keeps values that pass an asynchronous test. */
    asyncFilter(fn: (value: T, context: C) => unknown | PromiseLike<unknown>): Exstream<T, C>
    /** Emits each value, then stops when the test passes. */
    stopWhen(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Emits items from iterable values; non-iterable values pass through unchanged. */
    flatten(): Exstream<FlatValue<T>, C>
    /** Keeps only the first occurrence of each value. */
    uniq(): Exstream<T, C>
    /** Keeps the first value for each selected key. */
    uniqBy<K>(fn: (value: T, context: C) => K): Exstream<T, C>
    uniqBy<K extends PropertyKeyOf<T>>(fields: K | readonly K[]): Exstream<T, C>
    /** Collects all values into one array. */
    collect(): Exstream<T[], AggregateOutputContext<C, T[]>>
    /** Groups values into arrays of the requested maximum size. */
    batch(size: number): Exstream<T[], AggregateOutputContext<C, T[]>>

    /** Runs an asynchronous transform with concurrency, ordering, retry and timeout controls. */
    mapAsync<U>(
      fn: (value: T, context: C) => U | PromiseLike<U>,
      options?: MapAsyncOptions<T, C> | null,
    ): Exstream<Awaited<U>, C>

    /** Handles error records and can emit replacement values with push(). */
    errors<U = T>(
      fn: (error: ExstreamError<T>, push: Push<U, C>, context: C) => void,
    ): Exstream<T | U, C>
    /** Drops all error records, or only the ones accepted by the predicate. */
    skipErrors(
      predicate?: ((error: ExstreamError<T>, input: T, context: C) => unknown) | null,
    ): Exstream<T, C>
    /** Turns the first error record into a fatal pipeline failure. */
    failOnError(): Exstream<T, C>
    /** Splits data and error records into separate streams. */
    routeErrors(): RoutedErrors<T, C>
    /** Handles the first error record and then stops this branch. */
    stopOnError<U = T>(
      fn: (error: ExstreamError<T>, push: Push<U, C>, context: C) => void,
    ): Exstream<T | U, C>

    /** Parses CSV chunks into rows or objects. */
    csv<H extends readonly PropertyKey[] | boolean = false>(
      options?: CsvOptions<H> | null,
    ): Exstream<CsvRow<H>, C>
    /** Converts rows or objects into CSV chunks. */
    csvStringify<H extends readonly PropertyKey[] | boolean = false>(
      options?: CsvStringifyOptions<H> | null,
    ): Exstream<string | Uint8Array, C>
    /** Parses one JSON document and emits its selected values as soon as they complete. */
    json<U = unknown>(options?: JsonOptions | null): Exstream<U, C>
    /** Parses one JSON value from every input line. */
    jsonl<U = unknown>(options?: JsonlOptions | null): Exstream<U, C>
    /** Converts every value into one compact JSON line. */
    jsonlStringify(options?: JsonlStringifyOptions | null): Exstream<string | Uint8Array, C>
    /** Streams values into a JSON array, optionally nested inside an object envelope. */
    jsonStringify<FinalProperties extends object = Record<string, unknown>>(
      options?: JsonStringifyOptions<FinalProperties> | null,
    ): Exstream<string | Uint8Array, C>

    /** Emits values from start (included) to end (excluded). */
    slice(start: number, end?: number): Exstream<T, C>
    /** Emits at most the first n values. */
    take(n: number): Exstream<T, C>
    /** Emits only the first value. */
    head(): Exstream<T, C>
    /** Emits only the last value. */
    last(): Exstream<T, C>
    /** Skips the first n values. */
    drop(n: number): Exstream<T, C>
    /** Emits at most one value during each time window. */
    throttle(milliseconds: number): Exstream<T, C>
    /** Emits no more than num values during each time window. */
    ratelimit(num: number, milliseconds: number): Exstream<T, C>

    /** Combines all values into one result. */
    reduce<A, F extends (accumulator: A, value: T, context: CallbackContext<T, C>) => A>(
      fn: F,
      initialValue: A,
    ): Exstream<
      A,
      AggregateOutputContext<C, A, Parameters<F> extends [any, any, any, ...any[]] ? true : false>
    >
    /** Combines all values, using the first value as the initial result. */
    reduce1<F extends (accumulator: T, value: T, context: CallbackContext<T, C>) => T>(
      fn: F,
    ): Exstream<
      T,
      AggregateOutputContext<C, T, Parameters<F> extends [any, any, any, ...any[]] ? true : false>
    >
    /** Combines all values with an asynchronous reducer. */
    asyncReduce<
      A,
      F extends (accumulator: A, value: T, context: CallbackContext<T, C>) => A | PromiseLike<A>,
    >(
      fn: F,
      initialValue: A,
    ): Exstream<
      A,
      AggregateOutputContext<C, A, Parameters<F> extends [any, any, any, ...any[]] ? true : false>
    >
    /** Collects values into arrays indexed by a selected key. */
    groupBy<K extends PropertyKey>(
      fn: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    ): Exstream<Record<K, T[]>, AggregateContext<Record<K, T[]>, C>>
    /** Indexes values by a selected unique key. */
    keyBy<K extends PropertyKey>(
      fn: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    ): Exstream<Record<K, T>, AggregateContext<Record<K, T>, C>>
    /** Sorts values using their string representation. */
    sort(): Exstream<T, C>
    /** Sorts values with a comparison function. */
    sortBy(fn: (left: T, right: T, leftContext: C, rightContext: C) => number): Exstream<T, C>

    /** Decodes byte chunks and splits them on line endings. */
    split(encoding?: string): Exstream<string, C>
    /** Decodes byte chunks and splits them with a regular expression. */
    splitBy(separator: RegExp, encoding?: string): Exstream<string, C>
    /** Encodes chunks as base64 text. */
    encode(encoding: 'base64'): Exstream<string, C>
    /** Decodes base64 text into byte chunks. */
    decode(encoding: 'base64'): Exstream<Uint8Array, C>
    /** Periodically yields to the event loop during long synchronous runs. */
    makeAsync(maxSyncExecutionTime: number): Exstream<T, C>

    /**
     * Writes every value to a destination and settles only when the transfer is complete.
     * Unhandled record errors, source failures, destination failures and cancellation reject the
     * promise. Handle recoverable errors before this terminal operation.
     */
    pipeTo(
      destination: NodeWritableLike<T> | WritableStream<T>,
      options?: PipeOptions,
    ): Promise<void>
    /** Runs a reusable Exstream destination against this source. */
    pipeTo(destination: Destination<T>, options?: DestinationPipeOptions): Promise<void>
    /** Creates an independent consuming branch. Context objects are copied at the boundary. */
    fork(disableAutostart?: boolean): Exstream<T, C>
    /** Creates a non-blocking branch that may drop buffered values by policy. */
    observe(options?: ObserveOptions | null): Exstream<T, C>
    /** Connects this stream to a reusable pipeline, stream or transform function. */
    through<U>(
      target: <InputContext extends object>(
        stream: Exstream<T, InputContext>,
      ) => Exstream<U, InputContext>,
      options?: ThroughOptions,
    ): Exstream<U, C>
    through<U, NextContext extends object>(
      target:
        | Pipeline<T, U, NextContext>
        | Exstream<U, NextContext>
        | ((stream: Exstream<T, C>) => Exstream<U, NextContext>),
      options?: ThroughOptions,
    ): Exstream<U, NextContext>
    through(target?: null | undefined, options?: ThroughOptions): Exstream<T, C>
    /** Merges the Exstreams or lazy stream factories carried by this stream. */
    merge(
      parallelism?: number,
      preserveOrder?: boolean,
    ): Exstream<MergeValue<T>, MergeContext<T, C>>
    /** Adapts this pipeline to a lazy Node readable stream. */
    toNodeReadable(options?: object | null): NodeReadableLike<T>
    /** Converts values to a Web ReadableStream. */
    toWebReadable(options?: ToWebReadableOptions | null): ReadableStream<T>
    /** Collects every output value and settles when the pipeline completes. */
    toArray(): Promise<T[]>
    /**
     * Runs this pipeline to completion while discarding every output value.
     * Use this terminal operation for side-effecting pipelines that have no writer, or whenever
     * collecting the output would be unnecessary. Unlike `start()`, `drain()` supplies downstream
     * demand and its promise settles when the pipeline finishes or encounters an unhandled error.
     */
    drain(): Promise<void>
    /** Returns the only value, undefined for empty input, and rejects when a second value arrives. */
    single(): Promise<T | undefined>

    /** Keeps objects whose listed fields equal the provided values. */
    where(properties: Partial<T>): Exstream<T, C>
    /** Emits the first object whose listed fields equal the provided values. */
    findWhere(properties: Partial<T>): Exstream<T, C>
    /** Groups adjacent values that have the same key. Input must already be sorted. */
    sortedGroupBy<K>(
      fn: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    ): Exstream<SortedGroup<K, T>, AggregateContext<SortedGroup<K, T>, C>>
    /** Joins two sorted Exstreams carried by this stream. */
    sortedJoin<K, A, B>(
      this: Exstream<readonly [Exstream<A, object>, Exstream<B, object>], C>,
      leftKey: ((value: A, context: object) => K) | PropertyKeyOf<A>,
      rightKey: ((value: B, context: object) => K) | PropertyKeyOf<B>,
      type?: JoinType,
      direction?:
        | SortDirection
        | ((left: K, right: K, leftContext: object, rightContext: object) => boolean),
      buffer?: number,
    ): Exstream<SortedJoinResult<K, A, B>, AggregateContext<SortedJoinResult<K, A, B>, object>>
  }

  /** A reusable list of operators that can be attached with through(). */
  interface Pipeline<Input = unknown, Output = Input, C extends object = RecordContext<Input>> {
    readonly __exstream_pipeline__: true
    /** Creates a fresh stream containing this pipeline's operators. */
    generateStream(): Exstream<Output, C>
    /** Closes this operator definition into a reusable terminal destination. */
    drain(): Destination<Input>
    /** Creates a native Node Transform with this pipeline as its writable-to-readable body. */
    toNodeTransform(): NodeTransformLike<Input, Output>
    /** Adds a value transform to this reusable pipeline. */
    map<U>(
      fn: (value: Output, context: C) => U,
      options: { wrap: true },
    ): Pipeline<
      Input,
      U extends PromiseLike<infer R>
        ? Promise<{ input: Output; output: Awaited<R> }>
        : { input: Output; output: U },
      C
    >
    map<U>(fn: (value: Output, context: C) => U, options?: MapOptions | null): Pipeline<Input, U, C>
    /** Adds fields to the context of this reusable pipeline. */
    withContext<A extends object | void>(
      fn: (value: Output, context: C) => A,
    ): Pipeline<Input, Output, C & ContextAddition<A>>
    /** Adds fields to the context asynchronously. */
    extendContext<A extends object | void | PromiseLike<object | void>>(
      fn: (value: Output, context: C) => A,
    ): Pipeline<Input, Output, C & ContextAddition<A>>
    /** Adds a filtering step to this reusable pipeline. */
    filter<S extends Output>(fn: (value: Output, context: C) => value is S): Pipeline<Input, S, C>
    filter(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds a rejecting filter. */
    reject(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds an asynchronous filter. */
    asyncFilter(
      fn: (value: Output, context: C) => unknown | PromiseLike<unknown>,
    ): Pipeline<Input, Output, C>
    /** Adds a stop condition. */
    stopWhen(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds a map followed by flatten. */
    flatMap<U>(fn: (value: Output, context: C) => U): Pipeline<Input, FlatValue<U>, C>
    /** Adds an asynchronous transform to this reusable pipeline. */
    mapAsync<U>(
      fn: (value: Output, context: C) => U | PromiseLike<U>,
      options?: MapAsyncOptions<Output, C> | null,
    ): Pipeline<Input, Awaited<U>, C>
    /** Adds a flattening step to this reusable pipeline. */
    flatten(): Pipeline<Input, FlatValue<Output>, C>
    /** Adds a side effect without changing values. */
    tap(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds falsey-value removal. */
    compact(): Pipeline<Input, Exclude<Output, Falsy>, C>
    /** Adds field extraction. */
    pluck<K extends PropertyKeyOf<Output>>(field: K): Pipeline<Input, Output[K], C>
    /** Adds field selection. */
    pick<K extends PropertyKeyOf<Output>>(fields: readonly K[]): Pipeline<Input, Pick<Output, K>, C>
    /** Adds field removal. */
    omit<K extends PropertyKeyOf<Output>>(
      fields: K | readonly K[],
    ): Pipeline<Input, Omit<Output, K>, C>
    /** Adds duplicate removal. */
    uniq(): Pipeline<Input, Output, C>
    /** Adds duplicate removal by key. */
    uniqBy<K>(fn: (value: Output, context: C) => K): Pipeline<Input, Output, C>
    /** Adds first-match selection. */
    find(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds collection into one array. */
    collect(): Pipeline<Input, Output[], AggregateContext<Output[], C>>
    /** Adds a fixed-size batching step. */
    batch(size: number): Pipeline<Input, Output[], AggregateContext<Output[], C>>
    /** Adds recoverable-error handling. */
    errors<U = Output>(
      fn: (error: ExstreamError<Output>, push: Push<U, C>, context: C) => void,
    ): Pipeline<Input, Output | U, C>
    /** Adds recoverable-error removal. */
    skipErrors(
      predicate?: ((error: ExstreamError<Output>, input: Output, context: C) => unknown) | null,
    ): Pipeline<Input, Output, C>
    /** Adds promotion of record errors to fatal errors. */
    failOnError(): Pipeline<Input, Output, C>
    /** Adds handling of the first error followed by branch termination. */
    stopOnError<U = Output>(
      fn: (error: ExstreamError<Output>, push: Push<U, C>, context: C) => void,
    ): Pipeline<Input, Output | U, C>
    /** Adds a fixed range. */
    slice(start: number, end?: number): Pipeline<Input, Output, C>
    /** Adds a maximum output count. */
    take(count: number): Pipeline<Input, Output, C>
    /** Adds first-value selection. */
    head(): Pipeline<Input, Output, C>
    /** Adds last-value selection. */
    last(): Pipeline<Input, Output, C>
    /** Adds an initial skip count. */
    drop(count: number): Pipeline<Input, Output, C>
    /** Adds a synchronous reducer. */
    reduce<A>(
      fn: (accumulator: A, value: Output, context: C) => A,
      initialValue: A,
    ): Pipeline<Input, A, AggregateContext<A, C>>
    /** Adds an asynchronous reducer. */
    asyncReduce<A>(
      fn: (accumulator: A, value: Output, context: C) => A | PromiseLike<A>,
      initialValue: A,
    ): Pipeline<Input, A, AggregateContext<A, C>>
    /** Adds a reducer that starts with the first value. */
    reduce1(
      fn: (accumulator: Output, value: Output, context: C) => Output,
    ): Pipeline<Input, Output, AggregateContext<Output, C>>
    /** Adds grouping by key. */
    groupBy<K extends PropertyKey>(
      fn: (value: Output, context: C) => K,
    ): Pipeline<Input, Record<K, Output[]>, AggregateContext<Record<K, Output[]>, C>>
    /** Adds indexing by a unique key. */
    keyBy<K extends PropertyKey>(
      fn: (value: Output, context: C) => K,
    ): Pipeline<Input, Record<K, Output>, AggregateContext<Record<K, Output>, C>>
    /** Adds CSV parsing. */
    csv<H extends readonly PropertyKey[] | boolean = false>(
      options?: CsvOptions<H> | null,
    ): Pipeline<Input, CsvRow<H>, C>
    /** Adds CSV serialization. */
    csvStringify<H extends readonly PropertyKey[] | boolean = false>(
      options?: CsvStringifyOptions<H> | null,
    ): Pipeline<Input, string | Uint8Array, C>
    /** Adds incremental JSON parsing. */
    json<U = unknown>(options?: JsonOptions | null): Pipeline<Input, U, C>
    /** Adds line-delimited JSON parsing. */
    jsonl<U = unknown>(options?: JsonlOptions | null): Pipeline<Input, U, C>
    /** Adds line-delimited JSON serialization. */
    jsonlStringify(options?: JsonlStringifyOptions | null): Pipeline<Input, string | Uint8Array, C>
    /** Adds streaming JSON array or envelope serialization. */
    jsonStringify<FinalProperties extends object = Record<string, unknown>>(
      options?: JsonStringifyOptions<FinalProperties> | null,
    ): Pipeline<Input, string | Uint8Array, C>
    /** Adds string-value sorting. */
    sort(): Pipeline<Input, Output, C>
    /** Adds comparison sorting. */
    sortBy(
      fn: (left: Output, right: Output, leftContext: C, rightContext: C) => number,
    ): Pipeline<Input, Output, C>
    /** Adds line splitting. */
    split(encoding?: string): Pipeline<Input, string, C>
    /** Adds regular-expression splitting. */
    splitBy(separator: RegExp, encoding?: string): Pipeline<Input, string, C>
    /** Adds base64 encoding. */
    encode(encoding: 'base64'): Pipeline<Input, string, C>
    /** Adds base64 decoding. */
    decode(encoding: 'base64'): Pipeline<Input, Uint8Array, C>
    /** Adds periodic yielding to the event loop. */
    makeAsync(maxSyncExecutionTime: number): Pipeline<Input, Output, C>
    /** Adds output throttling. */
    throttle(milliseconds: number): Pipeline<Input, Output, C>
    /** Adds output rate limiting. */
    ratelimit(count: number, milliseconds: number): Pipeline<Input, Output, C>
    /** Adds object matching. */
    where(properties: Partial<Output>): Pipeline<Input, Output, C>
    /** Adds first-object matching. */
    findWhere(properties: Partial<Output>): Pipeline<Input, Output, C>
    /** Adds adjacent grouping for sorted input. */
    sortedGroupBy<K>(
      fn: (value: Output, context: C) => K,
    ): Pipeline<Input, SortedGroup<K, Output>, AggregateContext<SortedGroup<K, Output>, C>>
    /** Adds another reusable pipeline after this one. */
    through<NextOutput>(
      target: <InputContext extends object>(
        stream: Exstream<Output, InputContext>,
      ) => Exstream<NextOutput, InputContext>,
      options?: ThroughOptions,
    ): Pipeline<Input, NextOutput, C>
    through<NextOutput, NextContext extends object>(
      target:
        | Pipeline<Output, NextOutput, NextContext>
        | ((stream: Exstream<Output, C>) => Exstream<NextOutput, NextContext>),
      options?: ThroughOptions,
    ): Pipeline<Input, NextOutput, NextContext>
  }

  /** Creates a reusable pipeline definition. */
  function pipeline<T = unknown>(): Pipeline<T, T, RecordContext<T>>
  /** Creates a reusable terminal destination with high-level Exstream lifecycle access. */
  function destination<T = unknown>(
    run: (
      source: Exstream<T, LazyRecordContext<T>>,
      context: DestinationContext,
    ) => PromiseLike<void>,
  ): Destination<T>
  /** Creates a stream from repeated events. */
  function fromEvent<Args extends unknown[], T = Args extends [infer Only] ? Only : Args>(
    target: EventTargetLike | EventEmitterLike,
    event: string | symbol,
    options?: FromEventOptions<Args, T> | null,
  ): Exstream<T, RecordContext<T>> & { received: number }
  /** Wraps a value so Error objects are treated as data. */
  function data<T>(value: T): DataValue<T>
  /** Adds a method to every Exstream instance. */
  function extend(
    name: string,
    fn: (this: Exstream<any, any>, ...args: any[]) => unknown,
    options?: ExtendOptions | null,
  ): void

  /** Builds a curried map operator. Pass a stream as the last argument to run it immediately. */
  function map<T, U, C extends object>(
    fn: (value: T, context: C) => U,
    options: MapOptions | null,
    stream: Exstream<T, C>,
  ): Exstream<U, C>
  function map<T, U>(
    fn: (value: T, context: RecordContext<T>) => U,
    options?: MapOptions | null,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<U, C>
  /** Builds a curried context initializer. */
  function withContext<T, C extends object, A extends object | void>(
    fn: ((value: T, context: C) => A) | null,
    stream: Exstream<T, C>,
  ): Exstream<T, C & ContextAddition<A>>
  function withContext<T, A extends object | void>(
    fn?: ((value: T, context: RecordContext<T>) => A) | null,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C & ContextAddition<A>>
  /** Builds a curried asynchronous context initializer. */
  function extendContext<T, C extends object, A extends object | void | PromiseLike<object | void>>(
    fn: (value: T, context: C) => A,
    stream: Exstream<T, C>,
  ): Exstream<T, C & ContextAddition<A>>
  function extendContext<T, A extends object | void | PromiseLike<object | void>>(
    fn: (value: T, context: RecordContext<T>) => A,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C & ContextAddition<A>>
  /** Builds a curried map followed by flatten. */
  function flatMap<T, U, C extends object>(
    fn: (value: T, context: C) => U,
    stream: Exstream<T, C>,
  ): Exstream<FlatValue<U>, C>
  function flatMap<T, U>(
    fn: (value: T, context: RecordContext<T>) => U,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<FlatValue<U>, C>
  /** Builds a curried side-effect operator. */
  function tap<T, C extends object>(
    fn: (value: T, context: C) => unknown,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function tap<T>(
    fn: (value: T, context: RecordContext<T>) => unknown,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Removes falsey values from a stream. */
  function compact<T, C extends object>(stream: Exstream<T, C>): Exstream<Exclude<T, Falsy>, C>
  /** Builds a curried first-match operator. */
  function find<T, C extends object>(
    fn: (value: T, context: C) => unknown,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function find<T>(
    fn: (value: T, context: RecordContext<T>) => unknown,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried field reader. */
  function pluck<T, K extends PropertyKeyOf<T>, C extends object>(
    field: K,
    defaultValue: undefined,
    stream: Exstream<T, C>,
  ): Exstream<T[K], C>
  function pluck(
    field: string,
    defaultValue?: unknown,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<unknown, C>
  /** Builds a curried field selection operator. */
  function pick<T, K extends PropertyKeyOf<T>, C extends object>(
    fields: readonly K[],
    stream: Exstream<T, C>,
  ): Exstream<Pick<T, K>, C>
  function pick<K extends PropertyKey>(
    fields: readonly K[],
  ): <T extends Record<K, unknown>, C extends object>(
    stream: Exstream<T, C>,
  ) => Exstream<Pick<T, K>, C>
  /** Builds a curried field removal operator. */
  function omit<T, K extends PropertyKeyOf<T>, C extends object>(
    fields: K | readonly K[],
    stream: Exstream<T, C>,
  ): Exstream<Omit<T, K>, C>
  function omit<K extends PropertyKey>(
    fields: K | readonly K[],
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<Omit<T, Extract<K, keyof T>>, C>
  /** Builds a curried filtering operator. */
  function filter<T, S extends T, C extends object>(
    fn: (value: T, context: C) => value is S,
    stream: Exstream<T, C>,
  ): Exstream<S, C>
  function filter<T, C extends object>(
    fn: (value: T, context: C) => unknown,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function filter<T>(
    fn: (value: T, context: RecordContext<T>) => unknown,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried rejecting filter. */
  function reject<T, C extends object>(
    fn: (value: T, context: C) => unknown,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function reject<T>(
    fn: (value: T, context: RecordContext<T>) => unknown,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried asynchronous filter. */
  function asyncFilter<T, C extends object>(
    fn: (value: T, context: C) => unknown | PromiseLike<unknown>,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function asyncFilter<T>(
    fn: (value: T, context: RecordContext<T>) => unknown | PromiseLike<unknown>,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried stop condition. */
  function stopWhen<T, C extends object>(
    fn: (value: T, context: C) => unknown,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function stopWhen<T>(
    fn: (value: T, context: RecordContext<T>) => unknown,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Flattens iterable values from a stream. */
  function flatten<T, C extends object>(stream: Exstream<T, C>): Exstream<FlatValue<T>, C>
  /** Keeps unique values from a stream. */
  function uniq<T, C extends object>(stream: Exstream<T, C>): Exstream<T, C>
  /** Builds a curried unique-key operator. */
  function uniqBy<T, K, C extends object>(
    selector: ((value: T, context: C) => K) | PropertyKeyOf<T> | readonly PropertyKeyOf<T>[],
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function uniqBy<T>(
    selector:
      | ((value: T, context: RecordContext<T>) => unknown)
      | PropertyKeyOf<T>
      | readonly PropertyKeyOf<T>[],
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Collects a stream into one array value. */
  function collect<T, C extends object>(
    stream: Exstream<T, C>,
  ): Exstream<T[], AggregateContext<T[], C>>
  /** Builds a curried batching operator. */
  function batch<T, C extends object>(
    size: number,
    stream: Exstream<T, C>,
  ): Exstream<T[], AggregateContext<T[], C>>
  function batch(
    size: number,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T[], AggregateContext<T[], C>>
  /** Builds a curried concurrent asynchronous transform. */
  function mapAsync<T, U, C extends object>(
    fn: (value: T, context: C) => U | PromiseLike<U>,
    options: MapAsyncOptions<T, C> | null,
    stream: Exstream<T, C>,
  ): Exstream<Awaited<U>, C>
  function mapAsync<T, U>(
    fn: (value: T, context: RecordContext<T>) => U | PromiseLike<U>,
    options?: MapAsyncOptions<T, RecordContext<T>> | null,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<Awaited<U>, C>
  /** Builds a curried error handler. */
  function errors<T, U, C extends object>(
    fn: (error: ExstreamError<T>, push: Push<U, C>, context: C) => void,
    stream: Exstream<T, C>,
  ): Exstream<T | U, C>
  function errors<T, U>(
    fn: (
      error: ExstreamError<T>,
      push: Push<U, RecordContext<T>>,
      context: RecordContext<T>,
    ) => void,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T | U, C>
  /** Builds a curried error-dropping operator. */
  function skipErrors<T, C extends object>(
    predicate: ((error: ExstreamError<T>, input: T, context: C) => unknown) | null,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function skipErrors<T>(
    predicate?: ((error: ExstreamError<T>, input: T, context: RecordContext<T>) => unknown) | null,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Turns error records into fatal failures. */
  function failOnError<T, C extends object>(stream: Exstream<T, C>): Exstream<T, C>
  /** Splits errors from normal output. */
  function routeErrors<T, C extends object>(stream: Exstream<T, C>): RoutedErrors<T, C>
  /** Builds a curried first-error handler. */
  function stopOnError<T, U, C extends object>(
    fn: (error: ExstreamError<T>, push: Push<U, C>, context: C) => void,
    stream: Exstream<T, C>,
  ): Exstream<T | U, C>
  function stopOnError<T, U>(
    fn: (
      error: ExstreamError<T>,
      push: Push<U, RecordContext<T>>,
      context: RecordContext<T>,
    ) => void,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T | U, C>
  /** Parses CSV with a stream passed as the last argument. */
  function csv<T, C extends object, H extends readonly PropertyKey[] | boolean = false>(
    options: CsvOptions<H> | null,
    stream: Exstream<T, C>,
  ): Exstream<CsvRow<H>, C>
  function csv<H extends readonly PropertyKey[] | boolean = false>(
    options?: CsvOptions<H> | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<CsvRow<H>, C>
  /** Stringifies CSV with a stream passed as the last argument. */
  function csvStringify<T, C extends object, H extends readonly PropertyKey[] | boolean = false>(
    options: CsvStringifyOptions<H> | null,
    stream: Exstream<T, C>,
  ): Exstream<string | Uint8Array, C>
  function csvStringify<H extends readonly PropertyKey[] | boolean = false>(
    options?: CsvStringifyOptions<H> | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string | Uint8Array, C>
  /** Parses JSON with a stream passed as the last argument. */
  function json<U = unknown, T = unknown, C extends object = object>(
    options: JsonOptions | null,
    stream: Exstream<T, C>,
  ): Exstream<U, C>
  function json<U = unknown>(
    options?: JsonOptions | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<U, C>
  /** Parses JSON Lines with a stream passed as the last argument. */
  function jsonl<U = unknown, T = unknown, C extends object = object>(
    options: JsonlOptions | null,
    stream: Exstream<T, C>,
  ): Exstream<U, C>
  function jsonl<U = unknown>(
    options?: JsonlOptions | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<U, C>
  /** Stringifies JSON Lines with a stream passed as the last argument. */
  function jsonlStringify<T, C extends object>(
    options: JsonlStringifyOptions | null,
    stream: Exstream<T, C>,
  ): Exstream<string | Uint8Array, C>
  function jsonlStringify(
    options?: JsonlStringifyOptions | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string | Uint8Array, C>
  /** Stringifies a streaming JSON array or envelope with a stream passed as the last argument. */
  function jsonStringify<
    T,
    C extends object,
    FinalProperties extends object = Record<string, unknown>,
  >(
    options: JsonStringifyOptions<FinalProperties> | null,
    stream: Exstream<T, C>,
  ): Exstream<string | Uint8Array, C>
  function jsonStringify<FinalProperties extends object = Record<string, unknown>>(
    options?: JsonStringifyOptions<FinalProperties> | null,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string | Uint8Array, C>
  /** Builds a curried slice operator. */
  function slice<T, C extends object>(
    start: number,
    end: number,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function slice(
    start: number,
    end?: number,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried first-n operator. */
  function take<T, C extends object>(count: number, stream: Exstream<T, C>): Exstream<T, C>
  function take(count: number): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Emits the first value from a stream. */
  function head<T, C extends object>(stream: Exstream<T, C>): Exstream<T, C>
  /** Emits the last value from a stream. */
  function last<T, C extends object>(stream: Exstream<T, C>): Exstream<T, C>
  /** Builds a curried skip-first-n operator. */
  function drop<T, C extends object>(count: number, stream: Exstream<T, C>): Exstream<T, C>
  function drop(count: number): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried throttling operator. */
  function throttle<T, C extends object>(
    milliseconds: number,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function throttle(
    milliseconds: number,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried rate-limit operator. */
  function ratelimit<T, C extends object>(
    count: number,
    milliseconds: number,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function ratelimit(
    count: number,
    milliseconds: number,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried reducer. */
  function reduce<T, A, C extends object>(
    fn: (accumulator: A, value: T, context: C) => A,
    initialValue: A,
    stream: Exstream<T, C>,
  ): Exstream<A, AggregateContext<A, C>>
  function reduce<T, A>(
    fn: (accumulator: A, value: T, context: RecordContext<T>) => A,
    initialValue: A,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<A, AggregateContext<A, C>>
  /** Builds a curried reducer that starts with the first value. */
  function reduce1<T, C extends object>(
    fn: (accumulator: T, value: T, context: C) => T,
    stream: Exstream<T, C>,
  ): Exstream<T, AggregateContext<T, C>>
  function reduce1<T>(
    fn: (accumulator: T, value: T, context: RecordContext<T>) => T,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, AggregateContext<T, C>>
  /** Builds a curried asynchronous reducer. */
  function asyncReduce<T, A, C extends object>(
    fn: (accumulator: A, value: T, context: C) => A | PromiseLike<A>,
    initialValue: A,
    stream: Exstream<T, C>,
  ): Exstream<A, AggregateContext<A, C>>
  function asyncReduce<T, A>(
    fn: (accumulator: A, value: T, context: RecordContext<T>) => A | PromiseLike<A>,
    initialValue: A,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<A, AggregateContext<A, C>>
  /** Builds a curried grouping operator. */
  function groupBy<T, K extends PropertyKey, C extends object>(
    selector: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    stream: Exstream<T, C>,
  ): Exstream<Record<K, T[]>, AggregateContext<Record<K, T[]>, C>>
  function groupBy<T, K extends PropertyKey>(
    selector: ((value: T, context: RecordContext<T>) => K) | PropertyKeyOf<T>,
  ): <C extends object>(
    stream: Exstream<T, C>,
  ) => Exstream<Record<K, T[]>, AggregateContext<Record<K, T[]>, C>>
  /** Builds a curried unique indexing operator. */
  function keyBy<T, K extends PropertyKey, C extends object>(
    selector: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    stream: Exstream<T, C>,
  ): Exstream<Record<K, T>, AggregateContext<Record<K, T>, C>>
  function keyBy<T, K extends PropertyKey>(
    selector: ((value: T, context: RecordContext<T>) => K) | PropertyKeyOf<T>,
  ): <C extends object>(
    stream: Exstream<T, C>,
  ) => Exstream<Record<K, T>, AggregateContext<Record<K, T>, C>>
  /** Sorts one stream by string value. */
  function sort<T, C extends object>(stream: Exstream<T, C>): Exstream<T, C>
  /** Builds a curried comparison sort. */
  function sortBy<T, C extends object>(
    fn: (left: T, right: T, leftContext: C, rightContext: C) => number,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function sortBy<T>(
    fn: (
      left: T,
      right: T,
      leftContext: RecordContext<T>,
      rightContext: RecordContext<T>,
    ) => number,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried line splitter. */
  function split<T, C extends object>(encoding: string, stream: Exstream<T, C>): Exstream<string, C>
  function split(
    encoding?: string,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string, C>
  /** Builds a curried regular-expression splitter. */
  function splitBy<T, C extends object>(
    separator: RegExp,
    encoding: string,
    stream: Exstream<T, C>,
  ): Exstream<string, C>
  function splitBy(
    separator: RegExp,
    encoding?: string,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string, C>
  /** Builds a curried base64 encoder. */
  function encode<T, C extends object>(
    encoding: 'base64',
    stream: Exstream<T, C>,
  ): Exstream<string, C>
  function encode(
    encoding: 'base64',
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<string, C>
  /** Builds a curried base64 decoder. */
  function decode<T, C extends object>(
    encoding: 'base64',
    stream: Exstream<T, C>,
  ): Exstream<Uint8Array, C>
  function decode(
    encoding: 'base64',
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<Uint8Array, C>
  /** Builds a curried event-loop yielding operator. */
  function makeAsync<T, C extends object>(
    milliseconds: number,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function makeAsync(
    milliseconds: number,
  ): <T, C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried object matcher. */
  function where<T, C extends object>(
    properties: Partial<T>,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function where<T>(
    properties: Partial<T>,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried first object matcher. */
  function findWhere<T, C extends object>(
    properties: Partial<T>,
    stream: Exstream<T, C>,
  ): Exstream<T, C>
  function findWhere<T>(
    properties: Partial<T>,
  ): <C extends object>(stream: Exstream<T, C>) => Exstream<T, C>
  /** Builds a curried adjacent grouping operator for sorted input. */
  function sortedGroupBy<T, K, C extends object>(
    selector: ((value: T, context: C) => K) | PropertyKeyOf<T>,
    stream: Exstream<T, C>,
  ): Exstream<SortedGroup<K, T>, AggregateContext<SortedGroup<K, T>, C>>
  function sortedGroupBy<T, K>(
    selector: ((value: T, context: RecordContext<T>) => K) | PropertyKeyOf<T>,
  ): <C extends object>(
    stream: Exstream<T, C>,
  ) => Exstream<SortedGroup<K, T>, AggregateContext<SortedGroup<K, T>, C>>
  /** Joins two sorted streams passed as the final argument. */
  function sortedJoin<K, A, B, C extends object>(
    leftKey: ((value: A, context: object) => K) | PropertyKeyOf<A>,
    rightKey: ((value: B, context: object) => K) | PropertyKeyOf<B>,
    type: JoinType,
    direction: SortDirection,
    buffer: number,
    stream: Exstream<readonly [Exstream<A, object>, Exstream<B, object>], C>,
  ): Exstream<SortedJoinResult<K, A, B>, AggregateContext<SortedJoinResult<K, A, B>, object>>
  /** Returns Exstream provenance metadata without replacing the original error. */
  function errorInfo<Input = unknown>(error: unknown): ErrorInfo<Input>
}

export = exstream