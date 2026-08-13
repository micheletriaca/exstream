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

### Changed

- The standard test command now verifies the published TypeScript surface.