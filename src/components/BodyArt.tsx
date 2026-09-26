import React from 'react';
import { BODIES, type BodyId } from '../lib/slingshot';

// Sheets framed wide (Black hole disk, Comet coma, Saturn rings) are zoomed so thumbnails read.
const ZOOM: Partial<Record<BodyId, number>> = { 3: 1.7, 4: 1.35, 6: 1.5 };

/** Still of a body taken from its Blender spin sheet (frame 0, top-left cell of the 6x6 grid). */
export function BodyArt({ body, size = 44, className = '' }: { body: BodyId; size?: number; className?: string }) {
  const zoom = ZOOM[body] ?? 1;
  // Frame 0 is the top-left cell; center it after zooming.
  const offset = (-(zoom - 1) / 2) * size;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(./sprites/${BODIES[body].key}.webp)`,
        backgroundSize: `${600 * zoom}% ${600 * zoom}%`,
        backgroundPosition: `${offset}px ${offset}px`,
      }}
    />
  );
}
