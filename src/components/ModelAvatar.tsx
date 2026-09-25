import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import SketchfabEmbed from './SketchfabEmbed';

/**
 * Self-hosted hero character ("Female Cowgirl V4" by Fadly.W, CC BY 4.0).
 * Renders the licensed GLB with studio lighting, a soft floor shadow, cursor
 * tracking and an idle bob/breathing loop. Falls back to the official
 * Sketchfab embed when WebGL or the model file is unavailable.
 */
const MODEL_URL = '/models/cowgirl/female-cowgirl-v4.glb';

export default function ModelAvatar() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!renderer.getContext()) throw new Error('no context');
    } catch {
      setFailed(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.4, 4.8);
    camera.lookAt(0, 1.05, 0);

    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 1.15));
    const key = new THREE.DirectionalLight(0xfff1dd, 2.4);
    key.position.set(2.5, 4.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.5;
    key.shadow.camera.right = 2.5;
    key.shadow.camera.top = 3.5;
    key.shadow.camera.bottom = -1.5;
    key.shadow.radius = 5;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x93c5fd, 1.1);
    rim.position.set(-3, 2.5, -2.5);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.35, 40),
      new THREE.ShadowMaterial({ opacity: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // The rig takes all procedural motion so the model's own transform stays normalized.
    const rig = new THREE.Group();
    scene.add(rig);
    let baseScale = 1;

    let disposed = false;
    new GLTFLoader().load(MODEL_URL, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      baseScale = 2.3 / size.y;
      model.scale.setScalar(baseScale);
      model.position.set(-center.x * baseScale, -box.min.y * baseScale, -center.z * baseScale);
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = true;
      });
      rig.add(model);
    }, undefined, (error) => {
      console.error('Hero model failed to load', error);
      if (!disposed) setFailed(true);
    });

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    // cursor tracking, smoothed every frame
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: MouseEvent) => {
      const r = wrap.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 3)));
      targetY = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 3)));
    };
    const onLeave = () => { targetX = 0; targetY = 0; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);

    const timer = new THREE.Timer();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      timer.update();
      const t = timer.getElapsed();
      x += (targetX - x) * 0.12;
      y += (targetY - y) * 0.12;

      // idle: bob, gentle sway, breathing; turn toward the cursor
      rig.position.y = Math.sin(t * 1.5) * 0.045;
      rig.rotation.y += (x * 0.55 - rig.rotation.y) * 0.1;
      rig.rotation.x += (-y * 0.1 - rig.rotation.x) * 0.1;
      rig.rotation.z = Math.sin(t * 0.9) * 0.018;
      const breath = 1 + Math.sin(t * 2.1) * 0.005;
      rig.scale.setScalar(breath);

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
            const textured = m as THREE.MeshStandardMaterial;
            textured.map?.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (failed) return <SketchfabEmbed />;
  return <div className="hero-model-canvas" ref={wrapRef} role="img" aria-label="Animated 3D shop character" />;
}
