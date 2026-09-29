export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const notFound = () => new AppError(404, 'NOT_FOUND', 'Food item not found.');
export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
