# Celestial Archive

A local-first React + Vite creative archive for character notes, long-form writing, scrapbook references, and optional AI-assisted text/image workflows.

## Local Data And Privacy

This repository is intended to be safe for public source sharing. Runtime data and secrets should stay local:

- API keys are entered in the app UI and stored in browser/local runtime state.
- Do not commit `data/`, exported archives, `.env.local`, or personal key notes.
- Use `.env.example` as a template for local-only environment variables.

## Development

```bash
npm install
npm run dev
```

## Optional Image Proxy

If your network requires a local proxy for image-generation upstreams, set:

```bash
IMAGE_PROXY_URL=http://127.0.0.1:7897
```

On Windows CMD:

```bat
set IMAGE_PROXY_URL=http://127.0.0.1:7897
npm run dev
```

## Build

```bash
npm run build
```
