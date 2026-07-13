import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

export interface RequestContext {
  userId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getCurrentUserId(): string {
  const ctx = asyncLocalStorage.getStore();
  return ctx?.userId || config.defaultUserId;
}

export function runWithContext<R>(ctx: RequestContext, fn: () => R): R {
  return asyncLocalStorage.run(ctx, fn);
}
