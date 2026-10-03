import { describe, expect, it } from 'vitest';
import { IconAppWindow, IconDeviceGamepad2, IconLayoutGrid, IconMovie, IconMusic, IconRobot, IconSchool } from '@tabler/icons-react';
import { categoryIcon } from './category-icons';

describe('category icons', () => {
  it.each([
    ['Streaming', IconMovie], ['SVOD', IconMovie], ['Music', IconMusic], ['AI Tools', IconRobot],
    ['Software', IconAppWindow], ['Gaming', IconDeviceGamepad2], ['Game top-ups', IconDeviceGamepad2], ['EDUCATION', IconSchool],
  ])('maps %s', (name, icon) => {
    expect(categoryIcon({ name })).toBe(icon);
  });

  it('matches by slug and falls back to a neutral grid icon', () => {
    expect(categoryIcon({ name: 'Video', slug: 'streaming' })).toBe(IconMovie);
    expect(categoryIcon({ name: 'Email', slug: 'email' })).toBe(IconLayoutGrid);
    expect(categoryIcon({ name: 'Smart home' })).toBe(IconLayoutGrid);
  });
});
