/**
 * Messages from the native layer to the screens, as window events, so platform code never has to import the
 * stores or the router (which would be a cycle: the stores import the platform).
 */

/** A notification was tapped: open this page. The event's `detail` is the address, like "/food/123". */
export const OPEN_PAGE_EVENT = 'cook-first:open-page';

/** A push arrived while the app is open: refresh the reminders. */
export const PUSH_RECEIVED_EVENT = 'cook-first:push-received';

/** A notification button (Used or Snooze) was handled without opening a page. The `detail` is the action. */
export const PUSH_ACTION_DONE_EVENT = 'cook-first:push-action-done';

export const openPage = (url: string) => window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: url }));
