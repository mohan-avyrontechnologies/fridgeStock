import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW server for tests running in Node (jsdom). */
export const server = setupServer(...handlers);
