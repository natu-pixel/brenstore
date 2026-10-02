import { useEffect, useRef, useState } from 'react';
import AvatarGlasses from './AvatarGlasses';

export default function HeroAvatar() {
  const [failed, setFailed] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [eyesReady, setEyesReady] = useState(false);
  const [motionFailed, setMotionFailed] = useState(false);
  const portrait = useRef<HTMLDivElement>(null);
  const trackingReady = faceReady && eyesReady && !motionFailed;

  useEffect(() => {
    const element = portrait.current;
    if (!element || failed || !trackingReady) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      element.style.setProperty('--gaze-x', '0px');
      element.style.setProperty('--gaze-y', '0px');
    };
    const update = () => {
      frame = 0;
      if (!pointer || reducedMotion.matches || document.hidden) { reset(); return; }
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) { reset(); return; }
      // The eye line and travel limits are measured in the 543 x 636 source artwork.
      const dx = pointer.x - (bounds.left + bounds.width * 288 / 543);
      const dy = pointer.y - (bounds.top + bounds.height * 159 / 636);
      const distance = Math.max(Math.hypot(dx, dy), bounds.width * 1.3);
      element.style.setProperty('--gaze-x', `${dx / distance * bounds.width * 18 / 543}px`);
      element.style.setProperty('--gaze-y', `${dy / distance * bounds.height * 12 / 636}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reducedMotion.matches || document.hidden) { reset(); return; }
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) reset(); };
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerout', leave);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', reset, { passive: true, capture: true });
    document.addEventListener('visibilitychange', visibility);
    reducedMotion.addEventListener('change', reset);
    return () => {
      reset();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerout', leave);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('scroll', reset, true);
      document.removeEventListener('visibilitychange', visibility);
      reducedMotion.removeEventListener('change', reset);
    };
  }, [failed, trackingReady]);

  return <div className="hero-avatar">
    <div className="hero-avatar-halo" aria-hidden="true" />
    {failed ? <div className="hero-avatar-error" role="alert">
      <p>The shop avatar could not be loaded.</p>
      <button className="auth-switch" onClick={() => {
        setFaceReady(false); setEyesReady(false); setMotionFailed(false); setFailed(false);
      }}>Retry avatar</button>
    </div> : <div className="hero-avatar-portrait" ref={portrait}>
      <div className="hero-avatar-art">
        <img
          className="hero-avatar-image"
          src="/images/shop-avatar.png"
          alt="Brenstore character wearing round black glasses"
          width={543}
          height={636}
          fetchPriority="high"
          decoding="async"
          onError={() => setFailed(true)}
        />
        {!motionFailed && <div className={`hero-avatar-tracking${trackingReady ? ' is-ready' : ''}`} aria-hidden="true">
          <img className="hero-avatar-face" src="/images/shop-avatar-face.png" alt="" width={543} height={636}
            onLoad={() => setFaceReady(true)} onError={() => setMotionFailed(true)} />
          <img className="hero-avatar-eyes" src="/images/shop-avatar-eyes.png" alt="" width={543} height={636}
            onLoad={() => setEyesReady(true)} onError={() => setMotionFailed(true)} />
        </div>}
        <AvatarGlasses />
      </div>
      {motionFailed && <p className="hero-avatar-motion-note" role="status">Eye animation unavailable. Showing the original avatar.</p>}
    </div>}
    <div className="hero-avatar-shadow" aria-hidden="true" />
  </div>;
}
