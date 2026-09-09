# Observed sky assets

## Bright stars

`hyg-v41-mag65.json` is adapted from **HYG v4.1**, by **David Nash / Astronexus**, incorporating the Hipparcos, Yale Bright Star and Gliese catalogues.

- Source: https://github.com/astronexus/HYG-Database/tree/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg
- Current upstream home: https://codeberg.org/astronexus/hyg
- Original data and this derived catalogue: **Creative Commons Attribution-ShareAlike 4.0 International**, https://creativecommons.org/licenses/by-sa/4.0/
- Changes by Space Atlas: exclude the Sun; retain apparent visual magnitude <= 6.5; select HYG ID, J2000 right ascension and declination, V magnitude and B-V colour index; round angles to 8 decimal places; sort by magnitude. The bundled 96-star fallback is a subset of the same data under the same licence.
- These files contain 8,920 stars. Null B-V is displayed neutrally. Positions retain catalogue epoch J2000.0; runtime transforms them to the simulation date's true ecliptic orientation. Stellar proper motion, annual parallax and variations in stellar brightness are not simulated. Solar-system distances, sizes and orbit inclinations still use the app's illustrative scaling.

The magnitude-to-display-brightness curve compresses dynamic range. Point sizes and B-V colours are display approximations, not resolved stellar diameters or calibrated photometry. Stars have no artificial twinkling. Bright foreground objects gradually reduce background display brightness; this is a presentation adjustment, not a physical camera or eye model.

## Diffuse Galactic background

`gaia-edr3-diffuse.webp` is adapted from **The colour of the sky from Gaia's Early Data Release 3**, equirectangular projection, 3 December 2020.

- Credit: **ESA/Gaia/DPAC; acknowledgement: A. Moitinho.**
- Source and original image: https://www.esa.int/ESA_Multimedia/Images/2020/12/The_colour_of_the_sky_from_Gaia_s_Early_Data_Release_32
- Original image and this adaptation: **Creative Commons Attribution-ShareAlike 3.0 IGO**, https://creativecommons.org/licenses/by-sa/3.0/igo/
- Changes by Space Atlas: resize, median-filter and blur to suppress individual stars; reduce saturation; compress to WebP; strongly reduce brightness at display time. This retains observed large-scale Galactic structure and dark dust lanes, rather than synthesising a nebula.
- Galactic longitude increases to the left, latitude increases upward; image centre is l=0, b=0. Runtime uses Astronomy Engine's Galactic/J2000 transform to align it with the star catalogue.

The Gaia image is a processed observation map, not a photograph reproducing unaided human vision. The separate HYG points and filtered Gaia layer are a visual composite and are not a calibrated flux sum.

`gaia-edr3-source.json` and the catalogue metadata record source URLs, upstream revision and SHA-256 checksums. Rebuild these assets with `node scripts/build-solar-sky.mjs` from the repository root; browser clients load only the reduced local files.
