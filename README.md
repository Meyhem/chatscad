# PromptCAD

A client-only React PWA where an LLM writes OpenSCAD, the browser compiles it with OpenSCAD WASM, and you iterate by chat, code, sliders, 3D picking or images, then export STL. No backend: keys, projects and history stay on your device.

- **Stack:** Vite, React, TypeScript, Zustand, Dexie, CodeMirror 6, three.js (react-three-fiber), OpenSCAD WASM with the Manifold backend, Tailwind.
- **Providers:** any OpenAI-compatible endpoint, plus native Anthropic. You bring your own key.

See [docs/SPEC.md](docs/SPEC.md) for the full technical spec and milestones.
