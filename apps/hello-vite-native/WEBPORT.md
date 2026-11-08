# Native port of Hello TypeScript web app

Generated from web-apps/hello-vite by WebPort v1.

This is a real ABI-3 app package for the Switch-side BrendanLauncher runtime.
WebPort maps semantic markup and declared data-native-action interactions to the native renderer/input API.
It does not execute the Vite JavaScript bundle on-console.
Supported markup: h1/h2, paragraphs and buttons; supported CSS: simple color properties; supported action: counter.
Unsupported browser features require an explicit native implementation.

Rebuild with node tools/port-webapp.cjs hello-vite.
