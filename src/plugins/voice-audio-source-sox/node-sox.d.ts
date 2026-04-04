declare module 'node-sox' {
  type NodeSoxOptions = {
    device?: string | null, // Recording device to use.
    bits?: number, // Sample size. (only for `rec` and `sox`)
    channels?: number, // Channel count.
    encoding?: 'signed-integer' | 'unsigned-integer' | 'floating-point', // Encoding type
    rate?: number, // Sample rate.
    type?: string, // Output type (e.g. wav, mp3, etc.)
  }

  export default class NodeSox {
    constructor(options: NodeSoxOptions = {})
    on(event: 'spawn', listener: (process: import('node:child_process').ChildProcessWithoutNullStreams) => void): this;
    on(event: 'data' | 'stderr', listener: (data: Buffer) => void): this;
    on(event: 'error', listener: (error: unknown) => void): this;
    on(event: 'close' | 'exit', listener: (code: number | null) => void): this;
    start(): void;
    stop(): void;
  }
}