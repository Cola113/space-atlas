import { scenes } from "./scenes.js";

// A stable default makes the root URL useful even on a first visit.
location.replace(scenes[0].path + location.search + location.hash);
