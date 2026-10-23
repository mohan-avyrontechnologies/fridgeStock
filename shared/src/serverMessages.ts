import messages from '../data/messages.json' with { type: 'json' };

/**
 * The server's wording (shared/data/messages.json), read by server/src/copy.ts and the Python server. It is a
 * separate entry point (@cook-first/shared/server-messages), so the AI prompts never ship in the web app.
 */
export const SERVER_MESSAGES = messages;
