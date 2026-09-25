import {
  siApplearcade,
  siApplemusic,
  siAppletv,
  siClaude,
  siCrunchyroll,
  siDeezer,
  siDuolingo,
  siHbomax,
  siNetflix,
  siNordvpn,
  siNotion,
  siParamountplus,
  siPerplexity,
  siPlaystation,
  siProtonvpn,
  siPubg,
  siSpotify,
  siTidal,
  siYoutube,
  siYoutubemusic,
} from 'simple-icons';
import type { SimpleIcon } from 'simple-icons';

export type ServicePreset = {
  key: string;
  name: string;
  category: 'streaming' | 'music' | 'ai-tools' | 'software' | 'gaming';
  initial: string;
  color_start: string;
  color_end: string;
  icon?: SimpleIcon;
  logoColor?: string;
  aliases?: readonly string[];
};

// Name/branding shortcuts only: these are not products or statements of availability.
export const SERVICES: readonly ServicePreset[] = [
  { key: 'netflix', name: 'Netflix', category: 'streaming', initial: 'N', color_start: '#141414', color_end: '#242424', icon: siNetflix, logoColor: '#E50914' },
  { key: 'prime-video', name: 'Prime Video', category: 'streaming', initial: 'PV', color_start: '#096f9b', color_end: '#073a56', aliases: ['Amazon Prime Video'] },
  { key: 'disney-plus', name: 'Disney+', category: 'streaming', initial: 'D+', color_start: '#103b52', color_end: '#071b2e', aliases: ['Disney Plus'] },
  { key: 'hbo', name: 'HBO Max', category: 'streaming', initial: 'HBO', color_start: '#141414', color_end: '#353535', icon: siHbomax, aliases: ['Max', 'HBO'] },
  { key: 'apple-tv', name: 'Apple TV+', category: 'streaming', initial: 'TV', color_start: '#181818', color_end: '#383838', icon: siAppletv, aliases: ['Apple TV Plus', 'Apple TV'] },
  { key: 'crunchyroll', name: 'Crunchyroll', category: 'streaming', initial: 'C', color_start: '#c74700', color_end: '#9b3400', icon: siCrunchyroll },
  { key: 'paramount-plus', name: 'Paramount+', category: 'streaming', initial: 'P+', color_start: '#0064ff', color_end: '#003788', icon: siParamountplus, aliases: ['Paramount Plus'] },
  { key: 'youtube', name: 'YouTube Premium', category: 'streaming', initial: 'YT', color_start: '#d60000', color_end: '#900000', icon: siYoutube, aliases: ['YouTube'] },
  { key: 'spotify', name: 'Spotify', category: 'music', initial: 'S', color_start: '#087a36', color_end: '#064d27', icon: siSpotify },
  { key: 'apple-music', name: 'Apple Music', category: 'music', initial: 'AM', color_start: '#d91b37', color_end: '#981026', icon: siApplemusic },
  { key: 'youtube-music', name: 'YouTube Music', category: 'music', initial: 'YM', color_start: '#d60000', color_end: '#900000', icon: siYoutubemusic },
  { key: 'deezer', name: 'Deezer', category: 'music', initial: 'D', color_start: '#7622c0', color_end: '#4b157d', icon: siDeezer },
  { key: 'tidal', name: 'TIDAL', category: 'music', initial: 'T', color_start: '#181818', color_end: '#383838', icon: siTidal },
  { key: 'chatgpt', name: 'ChatGPT', category: 'ai-tools', initial: 'AI', color_start: '#12715e', color_end: '#0b473b' },
  { key: 'claude', name: 'Claude', category: 'ai-tools', initial: 'C', color_start: '#a64b31', color_end: '#71311f', icon: siClaude },
  { key: 'gemini', name: 'Google Gemini', category: 'ai-tools', initial: 'G', color_start: '#315ab7', color_end: '#543098', aliases: ['Gemini'] },
  { key: 'perplexity', name: 'Perplexity', category: 'ai-tools', initial: 'P', color_start: '#087d8d', color_end: '#06505b', icon: siPerplexity },
  { key: 'canva', name: 'Canva', category: 'software', initial: 'C', color_start: '#147f94', color_end: '#6744ac' },
  { key: 'microsoft-365', name: 'Microsoft 365', category: 'software', initial: 'MS', color_start: '#245ca5', color_end: '#243973' },
  { key: 'adobe', name: 'Adobe Creative Cloud', category: 'software', initial: 'AD', color_start: '#b72222', color_end: '#792424' },
  { key: 'notion', name: 'Notion', category: 'software', initial: 'N', color_start: '#181818', color_end: '#383838', icon: siNotion },
  { key: 'nordvpn', name: 'NordVPN', category: 'software', initial: 'NV', color_start: '#305dc4', color_end: '#1d3979', icon: siNordvpn },
  { key: 'proton-vpn', name: 'Proton VPN', category: 'software', initial: 'PV', color_start: '#4c3aad', color_end: '#302569', icon: siProtonvpn },
  { key: 'duolingo', name: 'Duolingo', category: 'software', initial: 'D', color_start: '#337d00', color_end: '#235500', icon: siDuolingo },
  { key: 'free-fire-diamonds', name: 'Free Fire Diamonds', category: 'gaming', initial: 'FF', color_start: '#b45309', color_end: '#78350f', aliases: ['Free Fire'] },
  { key: 'pubg-uc', name: 'PUBG Mobile UC', category: 'gaming', initial: 'UC', color_start: '#181818', color_end: '#383838', icon: siPubg, logoColor: '#F4B942', aliases: ['PUBG UC', 'PUBG Mobile'] },
  { key: 'psplus', name: 'PlayStation Plus', category: 'gaming', initial: 'PS', color_start: '#0061b6', color_end: '#003a6d', icon: siPlaystation },
  { key: 'xbox-game-pass', name: 'Xbox Game Pass', category: 'gaming', initial: 'X', color_start: '#107c10', color_end: '#095009' },
  { key: 'nintendo-switch-online', name: 'Nintendo Switch Online', category: 'gaming', initial: 'NS', color_start: '#c6151d', color_end: '#820e14' },
  { key: 'apple-arcade', name: 'Apple Arcade', category: 'gaming', initial: 'AA', color_start: '#181818', color_end: '#383838', icon: siApplearcade },
];

export function servicesForCategory(slug: string | undefined): readonly ServicePreset[] {
  return SERVICES.filter(service => service.category === slug);
}

export function resolveService(brandKey: string, name: string): ServicePreset | undefined {
  const key = brandKey.trim().toLowerCase();
  if (key) return SERVICES.find(service => service.key === key);
  const normalized = name.trim().toLowerCase();
  return SERVICES.find(service => [service.name, ...(service.aliases ?? [])].some(alias => alias.toLowerCase() === normalized));
}
