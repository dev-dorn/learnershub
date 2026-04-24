export class DALError extends Error {
  constructor(
    public code: string,
    message: string,
    public original?: unknown
  ) {
    super(message);
    this.name = 'DALError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}
export class NotFoundError extends DALError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} [${id}] not found`);
    this.name = 'NotFoundError';
  }
}
export class ConflictError extends DALError {
  constructor(resource: string, field: string) {
    super('CONFLICT', `${resource} with this ${field} already exists`);
    this.name = 'ConflictError';

  }
}

export class DatabaseError extends DALError {
  constructor(operation: string, original?: unknown){
    super('DATABASE_ERROR', `Database operation failed: ${operation}`, original);
    this.name = 'DatabaseError';

  }
}
export class UnauthorizedError extends DALError {
  constructor(action: string) {
    super('UNAUTHORIZED', `Not authorised to  ${action}`);

    this.name = 'UnauthorizedError';
  }
}
export class ValidationError extends DALError {
  constructor(details: string) {
    super ('VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}
export function toHttpStatus(err: DALError): number {
  switch (err.code) {
    case 'NOT_FOUND':        return 404;
    case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT':         return 409;
    case 'UNAUTHORIZED':     return 401;
    case 'DATABASE_ERROR':   return 500;
    default:                 return 500;
  }
}
