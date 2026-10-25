import { describe, expect, it } from 'vitest';
import { AppWindow, Bot, Clapperboard, Gamepad2, GraduationCap, LayoutGrid, Music } from 'lucide-react';
import { categoryIcon } from './category-icons';

describe('category icons', () => {
  it.each([
    ['Streaming', Clapperboard], ['SVOD', Clapperboard], ['Music', Music], ['AI Tools', Bot],
    ['Software', AppWindow], ['Gaming', Gamepad2], ['Game top-ups', Gamepad2], ['EDUCATION', GraduationCap],
  ])('maps %s', (name, icon) => {
    expect(categoryIcon({ name })).toBe(icon);
  });

  it('matches by slug and falls back to a neutral grid icon', () => {
    expect(categoryIcon({ name: 'Video', slug: 'streaming' })).toBe(Clapperboard);
    expect(categoryIcon({ name: 'Email', slug: 'email' })).toBe(LayoutGrid);
    expect(categoryIcon({ name: 'Smart home' })).toBe(LayoutGrid);
  });
});
