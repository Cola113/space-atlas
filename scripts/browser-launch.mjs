// One place that decides which browser the visual checks run in.
//
// Locally they drive the Edge build installed on this machine. CI has no Edge, and the version a
// runner happens to ship would make pixel counts drift, so the channel is selectable:
// ATLAS_BROWSER_CHANNEL=chromium (or empty) uses Playwright's bundled Chromium, whose build is
// pinned by the playwright package itself. Assertions are tolerance-based, never golden images,
// because the two builds do not render identically.
import {chromium} from 'playwright';

export const browserChannel = process.env.ATLAS_BROWSER_CHANNEL ?? 'msedge';
export const launchBrowser = options =>
  chromium.launch({headless: true, ...(browserChannel ? {channel: browserChannel} : {}), ...options});
