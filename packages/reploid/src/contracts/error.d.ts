/** Local operational errors; configuration remains a TypeError and remote codes need protocol validation. */
export declare class ReploidError extends Error {
  code?: string;
  constructor(message: string, options?: ErrorOptions & { code?: string });
}
