import {
  IconAppWindow, IconBook, IconBriefcase, IconCloud, IconDeviceGamepad2, IconLanguage, IconLayoutGrid,
  IconMovie, IconMusic, IconPalette, IconRobot, IconSchool, IconShieldLock,
} from '@tabler/icons-react';

type Icon = typeof IconLayoutGrid;

// First keyword match wins; categories are admin-defined, so match by name or slug words.
const RULES: [RegExp, Icon][] = [
  [/\b(ai|gpt|chat|llm|intelligen)/, IconRobot],
  [/stream|svod|movie|video|tv|film|cinema/, IconMovie],
  [/music|audio|spotify|podcast/, IconMusic],
  [/gam(e|ing)|top-?up|console|uc\b|diamond/, IconDeviceGamepad2],
  [/vpn|security|antivirus|privacy/, IconShieldLock],
  [/educat|learn|course|school|study/, IconSchool],
  [/language|duolingo|translat/, IconLanguage],
  [/design|creative|photo|\bart\b|canva|adobe/, IconPalette],
  [/\bbooks?\b|\bread|kindle|audible/, IconBook],
  [/cloud|storage|drive/, IconCloud],
  [/productiv|office|work|business/, IconBriefcase],
  [/software|app|tool|utilit/, IconAppWindow],
];

export function categoryIcon(category: { name: string; slug?: string }): Icon {
  const text = `${category.name} ${category.slug ?? ''}`.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? IconLayoutGrid;
}
