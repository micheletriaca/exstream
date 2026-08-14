# Changelog

This file records user-visible changes. Exstream follows semantic versioning:
patch releases fix compatible behavior, minor releases add compatible features,
and major releases may change the public contract.

## Unreleased

### Added

- TypeScript declarations that infer value and record-context changes through a pipeline.
- Typed CommonJS, ESM, Node, core, and browser package entry points.
- Named ESM exports backed by the same CommonJS module instance.
- Type-level regression tests and generated API-reference support.
- Incremental JSON Lines parsing and serialization for string and byte chunks.
- Streaming JSON selection through a declared forward-only JSONPath subset.
- Streaming JSON arrays and object envelopes with end-of-stream final properties.
- Located JSON parse errors, depth and value-size limits, browser and worker support.

### Changed

- The standard test command now verifies the published TypeScript surface.