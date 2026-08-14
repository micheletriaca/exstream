# Support policy

## Runtime support

Exstream supports Node.js 22 and newer. The portable entry points require modern
Web Streams, `AbortController`, `TextEncoder`, and `TextDecoder` implementations.
The supported versions are the ones exercised by the repository's Node and
headless-browser test suites.

## Releases

Exstream uses semantic versioning. While the project is on the 0.x line, a minor
release may change an unstable part of the public contract; the changelog and a
migration path must document the change. Patch releases preserve documented API
and behavior. From 1.0 onward, incompatible changes require a major release
unless they fix a security issue or a clearly documented defect.

Deprecated APIs remain available for at least one minor release. A deprecation
must name its replacement and the earliest release in which removal may happen.

## Security and bug reports

Report reproducible bugs through the repository issue tracker. Include the
Exstream version, Node or browser version, a minimal input, and the observed and
expected results. Do not publish sensitive production data in an issue.