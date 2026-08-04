const DEV = import.meta.env.DEV;

export const log = DEV ? console.log.bind(console) : () => {};

export const logError = (...args: unknown[]) => {
  if (DEV) console.error(...args);
  // TODO: em producao enviar para endpoint central de erro.
};
