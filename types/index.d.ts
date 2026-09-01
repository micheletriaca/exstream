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
  type JoinKeySelector<T, C extends object> =
    | ((value: T, context: CallbackContext<T, C>) => unknown)
    | PropertyKeyOf<T>
  type JoinKey<T, Selector> = Selector extends (...args: any[]) => infer K
    ? K
    : Selector extends keyof T
      ? T[Selector]
      : never
  type Falsy = false | 0 | '' | null | undefined
  type FlatValue<T> = T extends string ? T : T extends Iterable<infer U> ? U : T
  type MergeValue<T> = T extends Exstream<infer U, any> ? U : never
  type MergeContext<T> = T extends Exstream<any, infer C> ? C : never
  type ContextAddition<T> = Awaited<T> extends object ? Awaited<T> : object
  type ValueOf<S> = S extends Exstream<infer T, any> ? T : never
  type ContextOf<S> = S extends Exstream<infer T, infer C> ? CallbackContext<T, C> : never
  type PipelineValue<P> = [P] extends [Pipeline<any, infer Output, any>] ? Output : never
  type PipelineContext<P> = P extends Pipeline<any, any, infer C> ? C : never

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
    /** Activates on downstream demand, or waits for an explicit start(). Defaults to "auto". */
    start?: 'auto' | 'manual'
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

  type StreamSource<T> = Iterable<T> | AsyncIterable<T> | ReadableStream<T> | NodeReadableLike<T>

  type DeferredStreamSource<T, C extends object = LazyRecordContext<T>> =
    | Exstream<T, C>
    | StreamSource<T>
  type DeferredStreamFactory<T, C extends object = LazyRecordContext<T>> = () =>
    | DeferredStreamSource<T, C>
    | PromiseLike<DeferredStreamSource<T, C>>

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

  /** Chooses how a failed mapAsync attempt should continue. */
  interface MapAsyncFailurePush<Input, Output> {
    /** Recovers the record with a replacement output. */
    (error: null | undefined, value: Output): void
    /** Propagates a record error, optionally associating a replacement input with it. */
    (error: unknown, input?: Input): void
  }

  /** Restarts the mapAsync callback, with the same input or a replacement input. */
  interface MapAsyncRetryAttempt<Input> {
    (): void
    (input: Input): void
  }

  type MapAsyncOnFail<Input, Output, C extends object> = {
    bivarianceHack(
      error: ExstreamError<Input>,
      input: Input,
      push: MapAsyncFailurePush<Input, Output>,
      attempt: number,
      retry: MapAsyncRetryAttempt<Input>,
      context: C,
    ): void | PromiseLike<void>
  }['bivarianceHack']

  interface MapAsyncOptions<T, C extends object, Output = unknown> {
    /** Maximum active operations plus completed results awaiting downstream demand. Defaults to 1. */
    concurrency?: number
    /** Keep results in input order. Defaults to true. */
    ordered?: boolean
    /** Retry policy, or a number of retries. */
    retry?: number | MapAsyncRetry<T, C> | null
    /** Handles a failed attempt locally. Cannot be combined with retry. */
    onFail?: MapAsyncOnFail<T, Output, C> | null
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
  interface MergeOptions {
    /** Maximum active inner streams. Defaults to Infinity. */
    concurrency?: number
    /** Preserve outer-stream order. Defaults to false. */
    ordered?: boolean
  }
  interface RateLimitOptions {
    /** Maximum number of values emitted during one interval. */
    limit: number
    /** Window duration in milliseconds. */
    interval: number
  }
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
  interface RoutedErrors<T, C extends object> {
    output: Exstream<T, C>
    deadLetters: Exstream<{ error: ExstreamError<T>; input: T }, C>
  }
  interface SortedGroup<K, T> {
    key: K
    values: T[]
  }
  type SortedJoinResult<K, Left, Right, Type extends JoinType = JoinType> = Type extends 'inner'
    ? { key: K; left: Left; right: Right }
    : Type extends 'left'
      ? { key: K; left: Left; right: Right | null }
      : { key: K; left: Left | null; right: Right }
  interface SortedJoinOptions<
    Left,
    LeftContext extends object,
    Right,
    RightContext extends object,
    LeftSelector extends JoinKeySelector<Left, LeftContext>,
    RightSelector extends JoinKeySelector<Right, RightContext>,
    Type extends JoinType = 'inner',
  > {
    leftKey: LeftSelector
    rightKey: RightSelector
    type?: Type
    order?:
      | SortDirection
      | ((left: JoinKey<Left, LeftSelector>, right: JoinKey<Right, RightSelector>) => number)
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
     * Activates a graph created with `{ start: 'manual' }` and freezes reliable fork registration.
     * This releases the producer once downstream consumers are ready; it is not a terminal consumer
     * and the returned promise does not wait for the stream to finish. Use `drain()` to run a
     * pipeline that has no writer or whose output should be discarded.
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
    /** Transforms every value and infers the new stream value type. */
    map<U>(fn: (value: T, context: CallbackContext<T, C>) => U): Exstream<U, NextContext<C, U>>
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
    /** Emits each value, then stops when the test passes. */
    stopWhen(fn: (value: T, context: C) => unknown): Exstream<T, C>
    /** Emits items from iterable values; non-iterable values pass through unchanged. */
    flatten(): Exstream<FlatValue<T>, C>
    /** Keeps only the first occurrence of each value. */
    uniq(): Exstream<T, C>
    /** Keeps the first value for each key returned by the selector. */
    uniq<K>(selector: (value: T, context: C) => K): Exstream<T, C>
    /** Keeps the first value for each selected field or field tuple. */
    uniq<K extends PropertyKeyOf<T>>(selector: K | readonly K[]): Exstream<T, C>
    /** Collects all values into one array. */
    collect(): Exstream<T[], AggregateOutputContext<C, T[]>>
    /** Groups values into arrays of the requested maximum size. */
    batch(size: number): Exstream<T[], AggregateOutputContext<C, T[]>>

    /** Runs an asynchronous transform with concurrency, ordering, recovery and timeout controls. */
    mapAsync<U>(
      fn: (value: T, context: C) => U | PromiseLike<U>,
      options?: MapAsyncOptions<T, C, Awaited<U>> | null,
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
    /** Emits no more than limit values during each local time window. */
    rateLimit(options: RateLimitOptions): Exstream<T, C>

    /** Combines all values into one result. */
    reduce<F extends (accumulator: T, value: T, context: CallbackContext<T, C>) => T>(
      fn: F,
    ): Exstream<
      T,
      AggregateOutputContext<C, T, Parameters<F> extends [any, any, any, ...any[]] ? true : false>
    >
    reduce<A, F extends (accumulator: A, value: T, context: CallbackContext<T, C>) => A>(
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
    /** Sorts values using their string representation or a comparison function. */
    sort(compare?: (left: T, right: T, leftContext: C, rightContext: C) => number): Exstream<T, C>

    /** Decodes byte chunks and splits them on line endings. */
    split(encoding?: string): Exstream<string, C>
    /** Decodes byte chunks and splits them with a regular expression. */
    split(separator: RegExp, encoding?: string): Exstream<string, C>
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
    /** Creates an independent consuming branch before the source graph is activated. */
    fork(): Exstream<T, C>
    /** Creates a non-blocking branch that may drop buffered values by policy. */
    observe(options?: ObserveOptions | null): Exstream<T, C>
    /** Connects this stream to a reusable pipeline, transform function, or Node transform. */
    through<P extends Pipeline<T, any, any>>(
      target: P,
    ): Exstream<PipelineValue<P>, PipelineContext<P>>
    through<U>(
      target: <InputContext extends object>(
        stream: Exstream<T, InputContext>,
      ) => Exstream<U, InputContext>,
    ): Exstream<U, C>
    through<U, NextContext extends object>(
      target: Pipeline<T, U, NextContext> | ((stream: Exstream<T, C>) => Exstream<U, NextContext>),
    ): Exstream<U, NextContext>
    through<U>(target: NodeTransformLike<T, U>): Exstream<U, C>
    /** Merges the Exstreams carried by this stream. */
    merge(
      this: [T] extends [Exstream<any, any>] ? Exstream<T, C> : never,
      options?: MergeOptions | null,
    ): Exstream<MergeValue<T>, MergeContext<T>>
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
    /** Merge-joins this sorted stream with another sorted stream. */
    sortedJoin<
      Right,
      RightContext extends object,
      LeftSelector extends JoinKeySelector<T, C>,
      RightSelector extends JoinKeySelector<Right, RightContext>,
      Type extends JoinType = 'inner',
      Key = JoinKey<T, LeftSelector> | JoinKey<Right, RightSelector>,
      Output = SortedJoinResult<Key, T, Right, Type>,
    >(
      right: Exstream<Right, RightContext>,
      options: SortedJoinOptions<T, C, Right, RightContext, LeftSelector, RightSelector, Type>,
    ): Exstream<Output, AggregateContext<Output, C | RightContext>>
  }

  /** A reusable list of operators that can be attached with through(). */
  interface Pipeline<Input = unknown, Output = Input, C extends object = RecordContext<Input>> {
    readonly __exstream_pipeline__: true
    /** Closes this operator definition into a reusable terminal destination. */
    drain(): Destination<Input>
    /** Creates a native Node Transform with this pipeline as its writable-to-readable body. */
    toNodeTransform(): NodeTransformLike<Input, Output>
    /** Adds a value transform to this reusable pipeline. */
    map<U>(fn: (value: Output, context: C) => U): Pipeline<Input, U, C>
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
    /** Adds a stop condition. */
    stopWhen(fn: (value: Output, context: C) => unknown): Pipeline<Input, Output, C>
    /** Adds a map followed by flatten. */
    flatMap<U>(fn: (value: Output, context: C) => U): Pipeline<Input, FlatValue<U>, C>
    /** Adds an asynchronous transform with per-record recovery to this reusable pipeline. */
    mapAsync<U>(
      fn: (value: Output, context: C) => U | PromiseLike<U>,
      options?: MapAsyncOptions<Output, C, Awaited<U>> | null,
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
    /** Adds duplicate removal by a computed key. */
    uniq<K>(selector: (value: Output, context: C) => K): Pipeline<Input, Output, C>
    /** Adds duplicate removal by one field or a field tuple. */
    uniq<K extends PropertyKeyOf<Output>>(selector: K | readonly K[]): Pipeline<Input, Output, C>
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
    reduce(
      fn: (accumulator: Output, value: Output, context: C) => Output,
    ): Pipeline<Input, Output, AggregateContext<Output, C>>
    reduce<A>(
      fn: (accumulator: A, value: Output, context: C) => A,
      initialValue: A,
    ): Pipeline<Input, A, AggregateContext<A, C>>
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
    /** Adds string-value or comparison sorting. */
    sort(
      compare?: (left: Output, right: Output, leftContext: C, rightContext: C) => number,
    ): Pipeline<Input, Output, C>
    /** Adds line splitting. */
    split(encoding?: string): Pipeline<Input, string, C>
    /** Adds regular-expression splitting. */
    split(separator: RegExp, encoding?: string): Pipeline<Input, string, C>
    /** Adds base64 encoding. */
    encode(encoding: 'base64'): Pipeline<Input, string, C>
    /** Adds base64 decoding. */
    decode(encoding: 'base64'): Pipeline<Input, Uint8Array, C>
    /** Adds periodic yielding to the event loop. */
    makeAsync(maxSyncExecutionTime: number): Pipeline<Input, Output, C>
    /** Adds output throttling. */
    throttle(milliseconds: number): Pipeline<Input, Output, C>
    /** Adds output rate limiting. */
    rateLimit(options: RateLimitOptions): Pipeline<Input, Output, C>
    /** Adds object matching. */
    where(properties: Partial<Output>): Pipeline<Input, Output, C>
    /** Adds first-object matching. */
    findWhere(properties: Partial<Output>): Pipeline<Input, Output, C>
    /** Adds adjacent grouping for sorted input. */
    sortedGroupBy<K>(
      fn: (value: Output, context: C) => K,
    ): Pipeline<Input, SortedGroup<K, Output>, AggregateContext<SortedGroup<K, Output>, C>>
    /** Adds another reusable pipeline after this one. */
    through<P extends Pipeline<Output, any, any>>(
      target: P,
    ): Pipeline<Input, PipelineValue<P>, PipelineContext<P>>
    through<NextOutput>(
      target: <InputContext extends object>(
        stream: Exstream<Output, InputContext>,
      ) => Exstream<NextOutput, InputContext>,
    ): Pipeline<Input, NextOutput, C>
    through<NextOutput, NextContext extends object>(
      target:
        | Pipeline<Output, NextOutput, NextContext>
        | ((stream: Exstream<Output, C>) => Exstream<NextOutput, NextContext>),
    ): Pipeline<Input, NextOutput, NextContext>
  }

  /** Creates a reusable pipeline definition. */
  function pipeline<T = unknown>(): Pipeline<T, T, RecordContext<T>>
  /** Creates a source whose factory is invoked once, only when its graph is activated by demand. */
  function defer<T, C extends object>(
    factory: DeferredStreamFactory<T, C>,
    options?: StreamOptions | null,
  ): Exstream<T, C>
  /** Creates a deferred source with lazily materialized record context. */
  function defer<T>(
    factory: DeferredStreamFactory<T>,
    options?: StreamOptions | null,
  ): Exstream<T, LazyRecordContext<T>>
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

  /** Returns Exstream provenance metadata without replacing the original error. */
  function errorInfo<Input = unknown>(error: unknown): ErrorInfo<Input>
}

export = exstream