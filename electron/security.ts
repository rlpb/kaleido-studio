import type { BrowserWindow, IpcMainInvokeEvent, Session } from 'electron';

/**
 * Whether a URL is the page this application itself serves.
 *
 * In a build that is `dist/index.html`, wherever the install put it, so the
 * check is on the protocol and the tail of the path rather than on a full path:
 * spaces, drive-letter case and the `app.asar` segment all vary by machine, and
 * a check that refused the real page would take every IPC call down with it.
 * Under the dev server it is that server's origin.
 */
export function isAppUrl(raw: string, devUrl?: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (devUrl) {
    try {
      if (url.origin === new URL(devUrl).origin) return true;
    } catch {
      // A malformed dev URL simply matches nothing.
    }
  }
  return url.protocol === 'file:' && url.pathname.endsWith('/dist/index.html');
}

/**
 * Whether an IPC request came from the application window's own page.
 *
 * The handlers act on the user's disk and on their API key, so they answer only
 * the main frame of the one window this process created, showing the app's own
 * page. Nothing else is meant to reach them, and this keeps it that way if a
 * second window, a subframe or a navigated page ever exists.
 */
export function isTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null, devUrl?: string): boolean {
  if (!window || window.isDestroyed()) return false;
  const frame = event.senderFrame;
  return (
    event.sender === window.webContents &&
    frame !== null &&
    frame === window.webContents.mainFrame &&
    isAppUrl(frame.url, devUrl)
  );
}

/**
 * The only permission the interface uses: copying text to the clipboard.
 * Chromium grants everything else (camera, location, notifications) to a page
 * unless told otherwise, and this page has no use for any of it.
 */
const GRANTED = new Set(['clipboard-sanitized-write']);

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(GRANTED.has(permission)));
  session.setPermissionCheckHandler((_contents, permission) => GRANTED.has(permission));
}
