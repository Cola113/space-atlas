import { bodies } from './data.js';

const byId = new Map(bodies.map(body => [body.id, body]));

// The texture a body starts from, defined once. The solar-system view loads this key and
// then swaps in `high` when the body is selected; the landing sky draws it as the only
// level. Deriving both from the catalogue is what keeps them from drifting to different
// images of one world: Pluto and Charon are shipped as completed/repaired maps, and the
// landing sky used to point at older 2k jpgs of the same bodies instead.
export const baseTextureKey = body => body.baseTexture || `2k_${body.texture}.jpg`;

// The id may arrive as a display name from a site's `parent` field, so it is normalised
// here rather than at each call site.
export function bodyTexturePath(id) {
  const body = byId.get(String(id).toLowerCase());
  return body ? `/solar-system/textures/${baseTextureKey(body)}` : null;
}
