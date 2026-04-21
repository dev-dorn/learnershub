type LogLevel = 'info' | 'warn' | 'error' | 'debug';

type LogMeta = Record<string, unknown>;

const SENSITIVE_KEYS = new Set ([
  'authorization', 'token', 'jwt', 'password',
  'email', 'phone', 'ssn', 'creditCard', 'secret'
]);

function sanitize(meta?: LogMeta) : LogMeta | undefined {
  if (!meta) return;
  return Object.fromEntries(
    Object.entries(meta).filter(([key])=> !SENSITIVE_KEYS.has(key))
  );
}

function formatMessage(level: LogLevel, ctx: string, msg:string, meta?:LogMeta){
  return {
    timestamp: new Date().toLocaleString(),
    level,
    context: ctx,
    message: msg,
    ...(meta && {meta: sanitize(meta) }),
  };

}
export const logger = {
  info: (ctx: string, msg: string, meta?: LogMeta) =>
    console.info(JSON.stringify(formatMessage('info', ctx, msg, meta))),
  warn: (ctx: string, msg: string, meta?: LogMeta) =>
    console.warn(JSON.stringify(formatMessage('warn', ctx, msg, meta))),
  error: (ctx: string, msg: string, meta?: LogMeta) =>
    console.error(JSON.stringify(formatMessage('error', ctx, msg, meta))),
  debug: (ctx: string, msg: string, meta?: LogMeta) =>{
    if (process.env.NODE_ENV !== 'production') {
      console.debug(JSON.stringify(formatMessage('debug', ctx, msg, meta)));
    }
  },
};