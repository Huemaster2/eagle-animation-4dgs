# js-aruco2 (vendored)

Marker detector from [js-aruco2](https://github.com/damianofalcioni/js-aruco2) 2.0.0 (MIT, see `LICENSE.txt`),
with the AprilTag code lists it ships (their own licence text is at the top of each dictionary file).

The package is written for CommonJS and reads `this` at the top of each file, which is `undefined` once
Vite bundles it, so it cannot be imported from `node_modules`. The files here are the originals with one
change each, marked `Philip Frame:` — the `this`/`require` lines became `import`/`export`.

Used only through `src/renderer/core/tagDetect.js`.
