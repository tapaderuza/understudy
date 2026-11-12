// Who Atlassian calls run as. Normally the signed-in person (asUser), so
// Understudy never shows anyone work they could not open themselves. A
// product event trigger has no signed-in person: the work it does inside
// asTheApp() runs as the app, and Teamwork Graph (which only answers people)
// is left out.
import { AsyncLocalStorage } from 'node:async_hooks';
import api from '@forge/api';

const mode = new AsyncLocalStorage<'app'>();

/** Runs `work` with every Atlassian call made as the app instead of a person. */
export function asTheApp<T>(work: () => Promise<T>): Promise<T> {
  return mode.run('app', work);
}

export const isAppMode = (): boolean => mode.getStore() === 'app';

/** The Forge client for the current call: the signed-in person, or the app inside asTheApp(). */
export const caller = () => (isAppMode() ? api.asApp() : api.asUser());
