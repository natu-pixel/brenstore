import {
  siApplemusic,
  siCrunchyroll,
  siDeezer,
  siDuolingo,
  siMax,
  siNetflix,
  siNordvpn,
  siPerplexity,
  siPlaystation,
  siSpotify,
  siYoutube,
} from 'simple-icons';

/**
 * Real brand logo paths (24x24 viewBox) from the open-source simple-icons set.
 * Brands not present in the library (removed on trademark request) fall back
 * to the initial-letter tile.
 */
export const LOGOS: Record<string, string> = {
  netflix: siNetflix.path,
  hbo: siMax.path,
  crunchyroll: siCrunchyroll.path,
  spotify: siSpotify.path,
  youtube: siYoutube.path,
  'apple-music': siApplemusic.path,
  deezer: siDeezer.path,
  perplexity: siPerplexity.path,
  nordvpn: siNordvpn.path,
  duolingo: siDuolingo.path,
  psplus: siPlaystation.path,
};
