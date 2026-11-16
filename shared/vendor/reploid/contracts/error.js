/** Local operational error identity. Domain names/codes survive; wire admission stays protocol-owned. */
export class ReploidError extends Error {
  constructor(message, options) {
    super(message, options);
    if (options?.code !== undefined) this.code = options.code;
  }
}
