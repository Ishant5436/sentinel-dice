import React from 'react';
import { BODIES, type BodyId } from '../lib/slingshot';

/** Still of a body taken from its Blender spin sheet (frame 0, top-left cell of the 6x6 grid). */
export function BodyArt({ body, size = 44, className = '' }: { body: BodyId; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(./sprites/${BODIES[body].key}.webp)`,
        backgroundSize: '600% 600%',
        backgroundPosition: '0% 0%',
      }}
    />
  );
}
