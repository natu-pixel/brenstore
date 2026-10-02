import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siNetflix, siSpotify } from 'simple-icons';
import HeroAvatar from './HeroAvatar';
import FloatingLogos from './FloatingLogos';

describe('hero character and decorative brands', () => {
  it('uses the supplied local character with descriptive text and no WebGL viewer', () => {
    const { container } = render(<HeroAvatar />);
    const image = screen.getByRole('img', { name: 'Brenstore character wearing round black glasses' });
    expect(image).toHaveAttribute('src', '/images/shop-avatar.png');
    expect(image).toHaveAttribute('width', '543');
    expect(image).toHaveAttribute('height', '636');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(container.querySelector('canvas, iframe')).toBeNull();
    const glasses = container.querySelector('.hero-avatar-glasses');
    expect(glasses).toHaveAttribute('viewBox', '0 0 543 636');
    expect(glasses).toHaveAttribute('aria-hidden', 'true');
    expect(glasses).toHaveAttribute('focusable', 'false');
    expect(glasses?.querySelectorAll('path')).toHaveLength(5);
    expect(glasses?.querySelector('image')).toBeNull();
  });

  it('keeps vector gradient references unique when more than one avatar is rendered', () => {
    const { container } = render(<><HeroAvatar /><HeroAvatar /></>);
    const ids = [...container.querySelectorAll('.hero-avatar-glasses linearGradient')].map(element => element.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const glasses of container.querySelectorAll('.hero-avatar-glasses')) {
      const gradient = glasses.querySelector('linearGradient');
      expect(glasses.querySelector('g')).toHaveAttribute('stroke', `url(#${gradient?.id})`);
    }
  });

  describe('mouse-following eyes', () => {
    let media: { matches: boolean; addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener'] };
    let mediaEvents: EventTarget;

    beforeEach(() => {
      vi.useFakeTimers();
      mediaEvents = new EventTarget();
      media = { matches: false, addEventListener: mediaEvents.addEventListener.bind(mediaEvents), removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents) };
      vi.stubGlobal('matchMedia', vi.fn(() => media));
      vi.spyOn(window, 'requestAnimationFrame');
    });
    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    function setup(loadEyes = true) {
      const view = render(<HeroAvatar />);
      const portrait = view.container.querySelector<HTMLDivElement>('.hero-avatar-portrait');
      const face = view.container.querySelector<HTMLImageElement>('.hero-avatar-face');
      const eyes = view.container.querySelector<HTMLImageElement>('.hero-avatar-eyes');
      if (!portrait || !face || !eyes) throw new Error('The layered avatar was not rendered.');
      vi.spyOn(portrait, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 270, 316));
      fireEvent.load(face);
      if (loadEyes) fireEvent.load(eyes);
      return { ...view, portrait, face, eyes };
    }

    function point(x: number, y: number, pointerType = 'mouse') {
      const event = new MouseEvent('pointermove', { clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      window.dispatchEvent(event);
    }
    async function frame() {
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    }

    it.each([
      [10_000, 179, 'x', 1], [-10_000, 179, 'x', -1],
      [243, 10_000, 'y', 1], [243, -10_000, 'y', -1],
    ])('follows pointer (%s, %s) with bounded %s movement', async (x, y, axis, direction) => {
      const { portrait } = setup();
      point(Number(x), Number(y)); await frame();
      const offset = parseFloat(portrait.style.getPropertyValue(`--gaze-${axis}`));
      expect(Math.sign(offset)).toBe(direction);
      expect(Math.abs(offset)).toBeGreaterThan(1);
      expect(Math.abs(offset)).toBeLessThanOrEqual(axis === 'x' ? 9 : 6);
    });

    it('waits for both layers before replacing the original eyes or tracking', async () => {
      const { container, eyes } = setup(false);
      expect(container.querySelector('.hero-avatar-tracking')).not.toHaveClass('is-ready');
      point(1000, 200); await frame();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
      fireEvent.load(eyes);
      expect(container.querySelector('.hero-avatar-tracking')).toHaveClass('is-ready');
      point(1000, 200); await frame();
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('coalesces pointer events into one frame and uses the latest direction', async () => {
      const { portrait } = setup();
      point(1000, 200); point(0, 200); point(1000, 200);
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
      await frame();
      expect(parseFloat(portrait.style.getPropertyValue('--gaze-x'))).toBeGreaterThan(0);
    });

    it.each(['blur', 'resize', 'scroll'])('returns to neutral on %s', async (event) => {
      const { portrait } = setup();
      point(1000, 400); await frame();
      window.dispatchEvent(new Event(event));
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
      expect(portrait.style.getPropertyValue('--gaze-y')).toBe('0px');
    });

    it('only resets pointer-out when leaving the page, not when moving between elements', async () => {
      const { portrait } = setup();
      point(1000, 400); await frame();
      window.dispatchEvent(new MouseEvent('pointerout', { relatedTarget: document.body }));
      expect(parseFloat(portrait.style.getPropertyValue('--gaze-x'))).toBeGreaterThan(0);
      window.dispatchEvent(new MouseEvent('pointerout'));
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
    });

    it('resets when the tab is hidden and ignores touch movement', async () => {
      const { portrait } = setup();
      point(1000, 400); await frame();
      point(1000, 400, 'touch');
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
      point(1000, 400); await frame();
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
      point(1000, 400); await frame();
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
    });

    it('honors reduced motion immediately and when the preference changes', async () => {
      media.matches = true;
      const { portrait } = setup();
      point(1000, 400); await frame();
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
      media.matches = false;
      mediaEvents.dispatchEvent(new Event('change'));
      point(1000, 400); await frame();
      expect(parseFloat(portrait.style.getPropertyValue('--gaze-x'))).toBeGreaterThan(0);
      media.matches = true;
      mediaEvents.dispatchEvent(new Event('change'));
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
    });

    it('keeps the original avatar with a visible notice when an eye layer fails', () => {
      const { container, eyes } = setup(false);
      fireEvent.error(eyes);
      expect(screen.getByRole('img')).toHaveAttribute('src', '/images/shop-avatar.png');
      expect(screen.getByRole('status')).toHaveTextContent('Eye animation unavailable.');
      expect(container.querySelector('.hero-avatar-tracking')).toBeNull();
      expect(container.querySelector('.hero-avatar-glasses')).toBeInTheDocument();
    });

    it('cancels queued work and removes pointer listeners on unmount', async () => {
      const { unmount, portrait } = setup();
      point(1000, 400);
      unmount();
      await frame();
      expect(portrait.style.getPropertyValue('--gaze-x')).toBe('0px');
      vi.mocked(window.requestAnimationFrame).mockClear();
      point(1000, 400); await frame();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  it('shows an explicit image error and retries without removing the surrounding logos', () => {
    const { container } = render(<><HeroAvatar /><FloatingLogos /></>);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('The shop avatar could not be loaded.');
    expect(container.querySelectorAll('.float-tile')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Retry avatar' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/images/shop-avatar.png');
  });

  it('renders all eight service presets without a catalog or query provider', () => {
    const { container } = render(<FloatingLogos />);
    for (const name of ['Netflix', 'Spotify', 'YouTube Premium', 'HBO Max', 'Apple Music', 'PlayStation Plus', 'Duolingo', 'Crunchyroll']) {
      expect(screen.getByTitle(name).querySelector('svg path')).not.toBeNull();
    }
    expect(screen.getByTitle('Netflix').querySelector('path')).toHaveAttribute('d', siNetflix.path);
    expect(screen.getByTitle('Spotify').querySelector('path')).toHaveAttribute('d', siSpotify.path);
    expect(container.querySelectorAll('.float-tile')).toHaveLength(8);
    expect(container.querySelector('.float-layer')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('a, button')).toBeNull();
  });
});
