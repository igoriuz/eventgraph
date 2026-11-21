# Stacks

The house rules and the model are the same on every stack. Pick the row with
two questions: is native UI (SwiftUI/Compose) required, and which platforms
ship first? State as of 2026-11; re-check versions before starting a project.

| Target | Core | UI | CLI | Main risk |
| --- | --- | --- | --- | --- |
| Apple only | Swift package (SwiftPM, Swift Testing, GRDB) | SwiftUI | Swift executable target | none worth naming |
| Web only | TypeScript module | React | Node CLI | none worth naming |
| Web + iOS + Android, cross-platform UI acceptable | TypeScript core | React Native/Expo + React | Node CLI | no SwiftUI/Compose — native UI is ruled out |
| All platforms, one UI toolkit | Flutter/Dart (Drift) | Flutter | Dart CLI | Flutter lock-in; not native widgets |
| iOS + Android, native UI | Kotlin Multiplatform core | SwiftUI + Compose | Kotlin/JVM CLI | Swift interop via ObjC export; SKIE or Swift export soften it |
| iOS + Android (+ web), native UI | Rust core: Crux, or Rust + UniFFI | SwiftUI + Compose (+ React/wasm) | Rust binary | three toolchains; Crux pre-1.0 with monthly breaking releases |

Swift on Android (official SDK since 6.3, Skip) and on wasm (6.4) exist but are
young; a Swift core under three platforms is the least proven option.

## Recipes

- Swift: `swift.md`.
- Flutter/Dart: `dart.md` (an existing app moved one flow at a time).
- Every other row: no recipe yet. Write one when the first project on that row
  starts, in the shape of `swift.md` (layout, one worked flow, CLI, tests,
  model pointers), and add it here. Until then, apply `architecture.md`
  directly and note in the project's handoff what the recipe should say.
