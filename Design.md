# Leveldb for TypeScript/JavaScript

## Background
This project started out as a fork of [react-native-leveldb](https://github.com/greentriangle/react-native-leveldb.git).

That repo provides certain cpp/js wrappers facilitating access to [leveldb](https://github.com/google/leveldb.git) from react native.

The intent was to build a persistent backend for [Quereus](https://github.com/gotchoices/quereus.git).  Specifically, there is a persistent storage module in quereus/packages/quereus-plugin-store and a node backend (quereus/packages/quereus-store-leveldb) and a web backend (quereus/packages/quereus-store-indexeddb).  This package was to be invoked by a new quereus/packages/quereus-store-rnleveldb.  But it soon became clear that the library does not provide access to the underlying batch write functionality of leveldb (which is an important feature for quereus).

It was discovered that the react-native-leveldb repo contained an [open pull request](https://github.com/greentriangle/react-native-leveldb/pull/29) for enabling batch writes.  Since the PR had been sitting open for almost two years, it was determined to fork the repo and add the necessary functionality.  This fork was initially the result of forking the original project, applying the open PR, and then applying a few optimization tweaks, including a fix for an apparent memory leak.

## Development Objectives
- Provide js/ts access to leveldb suitable for use with quereus
- Include access to as much of the leveldb api as can reasonably be provided but focus on what quereus need.
- Support react-native deployments
- If reasonable/feasible, also support other mobile platforms such as NativeScript/svelte

## Questions
- Is it correct that leveldb has its own batch features to transactionalize writes (and perhaps other operations)?
- Is it correct that react-native-leveldb does not full access those batch features?
- Is it correct that applied PR to facilitate batch writes does not really access leveldb's batch features but instead engages in a loop to implement its own all-or-nothing write transaction?
- Wouldn't it be more efficient to give proper access to native leveldb batch features?
- Is this reasonable/feasible?
- How much of the current package is really unique to a react-native deployment?
- Or is it really just a way of exposing the cpp leveldb code to use by ts/js?
- If so, can it become a package that any ts package could include to have access to leveldb?
- Is there already some well-supported package that does exactly that?
- The classic-level package provides leveldb access to javascript cosumers but is very much bound to node.js
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
    - Browser: cannot run LevelDB directly; use IndexedDB backend instead (which Quereus already has)

- **Is there already some well-supported package that does exactly that?**
  - **Answer**: There are well-supported LevelDB bindings for Node, but they’re tied to Node’s native addon ecosystems. For React Native, this repo is already in the niche of “fast native LevelDB via JSI”.

- **Do we have a similar problem trying to use leveldb in react-native? Must the package take on a very specific profile in order to work at all for react-native.**
  - **Answer**: Yes. You need a native module + native build (iOS/Android) + a bridging strategy (JSI, TurboModules, or classic bridge). This package’s profile is: synchronous JSI host functions installed at runtime, with database paths scoped under the app’s document/files directory.

## Open design questions (for choosing the best path forward)

- **Atomicity scope for Quereus**
  - **What the current Quereus code actually enforces**: atomic batching is **per table / per KVStore** (not cross-table) in the current `StoreModule` architecture.
    - `StoreTable` creates a `StoreConnection` per table and registers it with the DB; each connection delegates BEGIN/COMMIT/ROLLBACK to its table’s `TransactionCoordinator`. (`quereus/packages/quereus-plugin-store/src/common/store-table.ts`, `.../store-connection.ts`)
    - `StoreModule.getCoordinator(tableKey, ...)` caches coordinators **by `schema.table` key**, so different tables get different coordinators, each committing via `store.batch().write()` for that *one* store. (`quereus/packages/quereus-plugin-store/src/common/store-module.ts`, `.../transaction.ts`)
    - In `@quereus/store-rnleveldb`, `getStore(schema, table)` opens **one LevelDB per table** (separate DB name per table), so even if Quereus wanted cross-table atomicity, the storage layout prevents it. (`quereus/packages/quereus-store-rnleveldb/src/provider.ts`)
  - **What Quereus is clearly aiming for (docs + partial code)**: true cross-table atomicity is an explicit design goal (see `quereus/packages/quereus/docs/store.md`), and `UnifiedIndexedDBModule` includes `createMultiStoreBatch()` to do atomic cross-store commits in one native IDB transaction, but this is currently **manual/explicit** (not wired into the generic transaction coordinator). (`quereus/packages/quereus-plugin-store/src/indexeddb/unified-module.ts`)
  - **Answer**: For *today’s implementation*, Quereus does **not** require cross-table atomic commits from the KV backend to function (it will commit per-table). For the *planned direction*, Quereus wants cross-table atomicity (especially to make sync/data+metadata commits crash-safe).

- **Durability expectations**
  - **What the current Quereus code actually requires**: there is **no** exposed durability knob (no `sync=true`, `fsync`, etc.) in the store interfaces/backends I found; batching is used for atomic multi-key writes, but durability settings are not modeled.
    - Node LevelDB backend uses `classic-level` `db.batch(...)` without a durability option. (`quereus/packages/quereus-plugin-store/src/leveldb/store.ts`)
    - RN LevelDB backend calls `db.write(batch)` without a durability option. (`quereus/packages/quereus-store-rnleveldb/src/store.ts`)
  - **Answer**: Default durability is currently treated as “acceptable”; adding configurable durability (e.g. LevelDB `WriteOptions.sync`) would be an enhancement, not something Quereus code depends on today.

## More Questions

### Vendoring / submodules / consumer build pipeline

- **This repo has some kind of sub-repo that is leveldb**
  - **Answer**: Yes: `cpp/leveldb` is a git submodule pointing at Google’s LevelDB repo. (see `.gitmodules`)
  - **Related**: the LevelDB submodule itself has submodules (`third_party/googletest`, `third_party/benchmark`). (see `cpp/leveldb/.gitmodules`)

- **In order to build the repo, the leveldb subrepo must be populated, then there is some kind of build procedure**
  - **Answer**: Yes: this repo expects `git submodule update --init --recursive` to be run for dev setup. (see `CONTRIBUTING.md`)
  - **Answer**: A convenience script already exists: `yarn bootstrap` runs that submodule init and then installs deps + example + pods. (see `package.json`)

- **It would be nice to have a simple pipeline so that react-native consumers of quereus could just do 'yarn install' and have their app work. But it seems like one has to install this repo first and go through some manual steps before quereus can use it.**
  - **Answer**: TBD (needs decision + verification in a real consumer app install).
  - **Confirmed constraint**: npm/yarn installs **do not automatically init git submodules** for a dependency; if `react-native-leveldb` is consumed via the package registry, it must ship with all required native sources already present (no submodule fetch during install).
  - **Update**: this fork will be published as `rn-leveldb`; the above constraint applies to `rn-leveldb` the same way.

- **Is there a clean way to prepare this repo so it can be a simple dependency of quereus that will get configured and built as needed without the user needing to know manual steps to prepare a sub-dependency of quereus?**
  - **Answer**: Yes conceptually; implementation approach is TBD. Options include:
    - **Pre-vendor LevelDB into the published package** (ensure `cpp/leveldb` is included at publish time, so consumers don’t need submodules).
    - **Replace the git submodule with a vendored copy** in-repo (removes submodule requirement entirely; update via scripted sync).
    - **Download LevelDB as part of install** (generally undesirable: requires network, complicates supply-chain, and isn’t supported in many locked-down build environments).
