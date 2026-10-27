export class PostReviewError extends Error {
  constructor(message, { code = 1, payload } = {}) {
    super(message);
    this.code = code;
    this.payload = payload;
  }
}

export const refuse = (message, payload) => new PostReviewError(`refused: ${message}`, { code: 2, payload });
