export type LogLevel = "debug" | "info" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  error: 30,
};

export class JsonLogger implements Logger {
  constructor(
    private readonly minimumLevel: LogLevel = "info",
    private readonly write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minimumLevel]) {
      return;
    }

    this.write(
      JSON.stringify({
        timestamp: this.now().toISOString(),
        level,
        event,
        ...removeUndefined(fields),
      }),
    );
  }
}

export class NullLogger implements Logger {
  log(_level: LogLevel, _event: string, _fields?: LogFields): void {}
}

function removeUndefined(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined;
    }),
  );
}
