# Input Read Limits

Validation reads inputs through bounded regular-file descriptors.

- Configuration JSON: 1 MiB per file.
- Run-record JSON: 256 KiB per file.
- Configured project, scenario, fixture, and context source files: 32 MiB per file.

The config and run-record limits bound the JSON documents validated by this package. The 32 MiB project-file cap matches the existing scenario/fixture contract used by agent-skills, including binary fixtures. The reader opens canonicalized paths with nonblocking and no-follow flags, checks the opened descriptor is a regular file, and reads incrementally with a one-byte-over-cap guard. Non-regular and oversized inputs receive structured diagnostics. Existing project-path resolution canonicalizes symlinks and continues to enforce project-root confinement before opening.
