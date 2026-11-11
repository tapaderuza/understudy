// Plain words for errors that reach a person, on the Jira page or in Rovo.
// Jira's and Confluence's raw answers stay in the logs: they are long,
// technical, and can mention fields or IDs the person never asked about.

export type Product = 'jira' | 'confluence';

/** What the request was for, when that changes the message. */
export type ApiAction = 'create-page';

const PRODUCT_NAME: Record<Product, string> = { jira: 'Jira', confluence: 'Confluence' };

export const REAUTHORISE = 'Understudy needs to be re-authorised; open the app once and accept the consent screen.';
export const BUSY = 'Atlassian is busy right now. Try again in a minute.';
export const UNREACHABLE = 'Could not reach Jira or Confluence just now. Try again.';
export const NOT_CONNECTED =
  'Understudy is not connected to that product on this site. To use Confluence, ask an admin to install Understudy on Confluence.';
export const UNEXPECTED = 'Understudy hit an unexpected problem. Try again, and if it keeps happening, tell your Jira admin.';

/** The message for an error status from Jira or Confluence. */
export function apiErrorMessage(product: Product, status: number, action?: ApiAction): string {
  const name = PRODUCT_NAME[product];
  if (status === 401) return REAUTHORISE;
  if (status === 403) return `You don't have permission to do this in ${name}.`;
  if (status === 404) return "Not found, or you don't have access to it.";
  if (status === 409 && action === 'create-page') return 'A page with this title already exists.';
  if (status === 429) return BUSY;
  if (status >= 500) return `${name} had a temporary problem. Try again.`;
  if (status === 400) return `${name} could not handle this request. Check the details and try again.`;
  return `${name} could not complete this request (status ${status}). Try again.`;
}

/**
 * Errors whose message is already meant for people: the ones Understudy
 * throws itself (plain Error) and API errors, whose message is the plain one.
 */
export function isPlainMessage(e: unknown): e is Error {
  return e instanceof Error && (e.name === 'Error' || e.name === 'ApiError');
}

/** Forge platform errors, by the names @forge/api gives them. */
const FORGE_MESSAGES: Record<string, string> = {
  NEEDS_AUTHENTICATION_ERR: REAUTHORISE,
  REQUEST_EGRESS_ALLOWLIST_ERR: NOT_CONNECTED,
  FUNCTION_FETCH_ERR: UNREACHABLE,
  PROXY_ERR: UNREACHABLE,
  API_NOT_READY_ERR: UNREACHABLE,
};

/** What to show a person for any error: never a stack trace or a raw API answer. */
export function userMessage(e: unknown): string {
  if (isPlainMessage(e)) return e.message;
  const forge = e instanceof Error ? FORGE_MESSAGES[e.name] : undefined;
  return forge ?? UNEXPECTED;
}
