# Transition Animation Guide

The public build intentionally keeps 3D visuals minimal: gallery, portrait, and combat views use only lightweight ambient particles and simple post-processing.

Private or character-specific visual effects should live outside this public repository. If you maintain local-only experiments, keep them in ignored files or a private branch and do not bind them through committed environment variables.

## Public Pattern

- Use generic ambient particles only.
- Avoid character-specific scene/effect components in source.
- Keep `.env.local` and private branches out of Git.
