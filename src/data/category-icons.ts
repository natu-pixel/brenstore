import {
  AppWindow, BookOpen, Bot, Briefcase, Clapperboard, Cloud, Gamepad2, GraduationCap, Languages, LayoutGrid,
  Music, Palette, ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// First keyword match wins; categories are admin-defined, so match by name or slug words.
const RULES: [RegExp, LucideIcon][] = [
  [/\b(ai|gpt|chat|llm|intelligen)/, Bot],
  [/stream|svod|movie|video|tv|film|cinema/, Clapperboard],
  [/music|audio|spotify|podcast/, Music],
  [/gam(e|ing)|top-?up|console|uc\b|diamond/, Gamepad2],
  [/vpn|security|antivirus|privacy/, ShieldCheck],
  [/educat|learn|course|school|study/, GraduationCap],
  [/language|duolingo|translat/, Languages],
  [/design|creative|photo|\bart\b|canva|adobe/, Palette],
  [/\bbooks?\b|\bread|kindle|audible/, BookOpen],
  [/cloud|storage|drive/, Cloud],
  [/productiv|office|work|business/, Briefcase],
  [/software|app|tool|utilit/, AppWindow],
];

export function categoryIcon(category: { name: string; slug?: string }): LucideIcon {
  const text = `${category.name} ${category.slug ?? ''}`.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? LayoutGrid;
}
