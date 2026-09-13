export interface ToolCall { name: string; args: Record<string, unknown>; error?: string }
export interface ResponseParserInstance { parseToolCalls(text: string): ToolCall[]; isDone(text: string): boolean }
export interface ParserUtils {
  logger: { warn(...values: unknown[]): void; error(...values: unknown[]): void; debug(...values: unknown[]): void; info(...values: unknown[]): void };
  sanitizeLlmJsonRespPure(text: string): { json: string };
}
declare const ResponseParser: {
  metadata: Readonly<Record<string, unknown>>;
  factory(deps: { Utils: ParserUtils }): ResponseParserInstance;
};
export default ResponseParser;
