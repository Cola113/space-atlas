# Orion Nebula Image Assets

Source: https://esahubble.org/images/heic0601a/

NASA, ESA, M. Robberto (Space Telescope Science Institute/ESA) and the Hubble Space Telescope Orion Treasury Project Team

License: CC BY 4.0. Terms: https://esahubble.org/copyright/

Derived with scripts/build-orion-assets.mjs from the 4000 x 4000 publication JPEG. See source.json for the original URL and SHA-256. observation.webp is a 2048 x 2048 reference; emission.webp is a 1536 x 1536 median-filtered diffuse map; stars.json contains image-derived brightness peaks, not an astrometric catalog.

cloud-detail.webp is a 1024 x 1024 derivative of emission.webp with a 15-pixel median filter and 1.1 blur to suppress stellar peaks. The renderer samples it on three world-space axes inside a procedural 3D density field; it is not a photograph of the interior.

Changes: resizing, star separation, filtering and blur, exposure and color adjustment. Cloud geometry, interior and back side, stellar depths, added field stars and the central star group are illustrative. No AI image generation was used. See ../../orion-nebula/README.md for rendering limitations.
