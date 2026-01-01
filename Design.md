# Leveldb for TypeScript/JavaScript

## Background
This project started out as a fork of [react-native-leveldb](https://github.com/greentriangle/react-native-leveldb.git).

That repo provides certain cpp/js wrappers facilitating access to [leveldb](https://github.com/google/leveldb.git) from react native.

The motivation for this fork is to expose more of the native LevelDB API to JS/TS consumers, specifically **atomic multi-key writes via native `leveldb::WriteBatch`**.

It was discovered that the react-native-leveldb repo contained an [open pull request](https://github.com/greentriangle/react-native-leveldb/pull/29) for enabling batch writes.  Since the PR had been sitting open for almost two years, it was determined to fork the repo and add the necessary functionality.  This fork was initially the result of forking the original project, applying the open PR, and then applying a few optimization tweaks, including a fix for an apparent memory leak.

## Development Objectives
- Provide js/ts access to leveldb suitable for use by application code and higher-level libraries
- Include access to as much of the leveldb api as can reasonably be provided, with focus on correctness and performance.
- Support react-native deployments
- If reasonable/feasible, also support other mobile platforms such as NativeScript/svelte

## Questions
- Is it correct that leveldb has its own batch features to transactionalize writes (and perhaps other operations)?
- Is it correct that react-native-leveldb does not fully access those batch features?
- Is it correct that applied PR to facilitate batch writes does not really access leveldb's batch features but instead engages in a loop to implement its own all-or-nothing write transaction?
- Wouldn't it be more efficient to give proper access to native leveldb batch features?
- Is this reasonable/feasible?
- How much of the current package is really unique to a react-native deployment?
- Or is it really just a way of exposing the cpp leveldb code to use by ts/js?
- If so, can it become a package that any ts package could include to have access to leveldb?
- Is there already some well-supported package that does exactly that?
- The classic-level package provides leveldb access to javascript cosumers but is very much bound to node.js
- The classic-level package provides leveldb access to javascript consumers but is very much bound to node.js
- Do we have a similar problem trying to use leveldb in react-native?  Must the package take on a very specific profile in order to work at all for react-native.

## Answers (confirmed in this codebase)

### Batch writes / “transactions”

- **Is it correct that leveldb has its own batch features to transactionalize writes (and perhaps other operations)?**
  - **Answer**: Yes for writes. LevelDB provides `leveldb::WriteBatch`, which is applied atomically via `leveldb::DB::Write(...)`.
  - **Scope note**: This is atomicity for a *set of updates*; it is not a general SQL-like transaction system (e.g. it doesn’t give multi-statement read isolation).

- **Is it correct that react-native-leveldb does not fully access those batch features?**
  - **Answer**: Not in *this* repo: this fork does expose native `WriteBatch` to TS/JS.
  - **Evidence**: `src/index.ts` defines `LevelDBWriteBatch` + `LevelDB.write(batch)`, backed by JSI globals. The native binding (`cpp/react-native-leveldb.cpp`) constructs a real `leveldb::WriteBatch` and calls `db->Write(..., batch)`.

- **Is it correct that the applied PR does not really access leveldb's batch features but instead loops to implement its own all-or-nothing transaction?**
  - **Answer**: Not in this repo. The implementation here is a direct bridge to `leveldb::WriteBatch` and `DB::Write()` (native atomic batch), not a JS-side loop.

- **Wouldn't it be more efficient to give proper access to native leveldb batch features? Is this reasonable/feasible?**
  - **Answer**: Yes, and it’s already implemented here. This approach is the “right” one: it preserves LevelDB’s atomicity semantics and avoids per-operation JNI/ObjC/JSI overhead.

### React Native specificity / portability

- **How much of the current package is really unique to a react-native deployment?**
  - **Answer**: The packaging + runtime wiring is React-Native-specific:
    - JS side uses `react-native` `NativeModules` and a synchronous `install()` to inject JSI host functions (see `src/index.ts`).
    - iOS/Android modules provide the `install()` entrypoint and pass an app-private document/files directory to native (see `ios/Leveldb.mm`, `android/.../LeveldbModule.java`).
    - Android builds a shared library via CMake and links against React Native JSI (`android/CMakeLists.txt`).

- **Or is it really just a way of exposing the cpp leveldb code to use by ts/js?**
  - **Answer**: Architecturally yes: it’s “LevelDB C++ + a JSI bridge”. The bridge is the key platform-dependent part.

- **If so, can it become a package that any ts package could include to have access to leveldb?**
  - **Answer**: Not “as-is”. Other runtimes (Node, browser, NativeScript, etc) don’t provide React Native’s JSI environment and native module lifecycle.
  - **Feasible path**: extract a small “core” C++ layer (DB registry, batch registry, shared helpers) and then supply runtime-specific bindings:
    - React Native: current JSI approach
    - Node: N-API / node-addon-api bindings (separate package)
    - Browser: cannot run LevelDB directly; use IndexedDB-based storage instead

- **Is there already some well-supported package that does exactly that?**
  - **Answer**: There are well-supported LevelDB bindings for Node, but they’re tied to Node’s native addon ecosystems. For React Native, this repo is already in the niche of “fast native LevelDB via JSI”.

- **Do we have a similar problem trying to use leveldb in react-native? Must the package take on a very specific profile in order to work at all for react-native.**
  - **Answer**: Yes. You need a native module + native build (iOS/Android) + a bridging strategy (JSI, TurboModules, or classic bridge). This package’s profile is: synchronous JSI host functions installed at runtime, with database paths scoped under the app’s document/files directory.

## More Questions

### Vendoring / submodules / consumer build pipeline

- **This repo has some kind of sub-repo that is leveldb**
  - **Answer**: `cpp/leveldb` is **vendored source** (a static copy) of Google LevelDB, shipped as part of the `rn-leveldb` npm package.
  - **Maintainer note**: use `yarn update-leveldb` to refresh this vendored copy from upstream when needed.

- **In order to build the repo, the leveldb subrepo must be populated, then there is some kind of build procedure**
  - **Answer**: No special fetch step is required for consumers: the npm package includes the C++ sources under `cpp/`.
  - **Answer**: For development, use `yarn bootstrap` to install deps + example + pods.

- **It would be nice to have a simple pipeline so that react-native consumers of quereus could just do 'yarn install' and have their app work. But it seems like one has to install this repo first and go through some manual steps before quereus can use it.**
  - **Answer**: TBD (needs decision + verification in a real consumer app install).
  - **Confirmed constraint**: npm/yarn installs can’t run git submodule initialization for dependencies; vendoring the source avoids that entire class of problems.
  - **Update**: this fork is published as `rn-leveldb`; the above constraint applies to `rn-leveldb` the same way.

- **Is there a clean way to prepare this repo so it can be a simple dependency of quereus that will get configured and built as needed without the user needing to know manual steps to prepare a sub-dependency of quereus?**
  - **Answer**: Yes conceptually; implementation approach is TBD. Options include:
    - **Pre-vendor LevelDB into the published package** (ensure `cpp/leveldb` is included at publish time, so consumers don’t need submodules).
    - **Replace the git submodule with a vendored copy** in-repo (removes submodule requirement entirely; update via scripted sync).
    - **Download LevelDB as part of install** (generally undesirable: requires network, complicates supply-chain, and isn’t supported in many locked-down build environments).
