# rn-leveldb
Sponsored by [GotChoices.org](https://www.gotchoices.org)

Superfast React Native bindings for LevelDB:
* 2-7x faster than AsyncStorage or react-native-sqlite-storage - try the benchmarks under example/!
* completely synchronous, blocking API (even on slow devices, a single read or write takes 0.1ms)
* use it with Flatbuffers to turbo charge your app - support for binary data via ArrayBuffers

## What this package is

`rn-leveldb` is a fork of [`react-native-leveldb`](https://github.com/greentriangle/react-native-leveldb) published under a new npm name.

Key fork feature:
- **Atomic multi-key writes via native LevelDB `WriteBatch`** exposed to JS/TS as `LevelDBWriteBatch` + `db.write(batch)`.

## Installation

```sh
yarn add rn-leveldb
cd ios && pod install
```

## Usage

```ts
import {LevelDB} from "rn-leveldb";

// Open a potentially new database.
const name = 'example.db';
const createIfMissing = true;
const errorIfExists = false;

const db = new LevelDB(name, createIfMissing, errorIfExists);

// Insert something into the database. Note that the key and the
// value can either be strings or ArrayBuffers. 

// Strings are read & written in utf8.
db.put('key', 'value');

// You can also use ArrayBuffers as input, containing binary data.
const key = new Uint8Array([1, 2, 3]);
const value = new Uint32Array([654321]);
db.put(key.buffer, value.buffer);

// Get values as string or as an ArrayBuffer (useful for binary data).
const readStringValue = db.getStr('key');
const readBufferValue = new Uint32Array(db.getBuf(key.buffer)!);
console.log(readStringValue, readBufferValue);  // logs: value [654321]

// Iterate over a range of values (here, from key "key" to the end.)
let iter = db.newIterator();
for (iter.seek('key'); iter.valid(); iter.next()) {
// There are also *Buf version to access iterators' keys & values.
  console.log(`iterating: "${iter.keyStr()}" / "${iter.valueStr()}"`);
}

// You need to close iterators when you are done with them. 
// Iterators will throw an error if used after this.
iter.close();

db.close();  // Same for databases.

```

## Atomic batch writes

```ts
import {LevelDB, LevelDBWriteBatch} from "rn-leveldb";

const db = new LevelDB('example.db', true, false);
const batch = new LevelDBWriteBatch();
batch.put('k1', 'v1');
batch.put('k2', 'v2');
db.write(batch); // atomic at the LevelDB layer
batch.close();
db.close();
```

## Contributing

See the [contributing guide](CONTRIBUTING.md) to learn how to contribute to the repository and the development workflow.

## Example app / smoke tests

The included example app runs basic smoke tests (and benchmarks) on startup.

See `CONTRIBUTING.md` for the exact commands to run the example on iOS/Android.

## Vendored LevelDB source

The C++ LevelDB implementation lives **in-tree** under `cpp/leveldb` (it is *not* a
git submodule — the source files are committed directly, so a fresh `git clone`
or `npm install` has everything needed to build).

- **Current version:** LevelDB 1.22 (see `cpp/leveldb/include/leveldb/db.h`).
- **Refreshing it:** `yarn update-leveldb --ref <tag> --repo https://github.com/google/leveldb.git`
  (wraps `scripts/update-leveldb.sh`). This clones the given ref, replaces
  `cpp/leveldb`, and strips nested `.git` metadata. Review the diff, then rebuild
  the example app on both platforms before releasing.
- **Local patch:** `env_posix.cc` / `env_windows.cc` spell the `SingletonEnv`
  atomic memory order as `std::memory_order_relaxed` (backported from
  google/leveldb `main`). Upstream 1.22 and 1.23 use
  `std::memory_order::memory_order_relaxed`, which does **not** compile under
  C++20 (React Native 0.82+ builds pods at C++20, where `std::memory_order` is a
  scoped enum). **If you re-vendor to a LevelDB release newer than 1.23 that
  already contains this fix, this patch can be dropped** — re-check those lines
  after running `update-leveldb`.
- **Not vendored:** `cpp/leveldb/third_party/{googletest,benchmark}` are omitted.
  They are test/benchmark-only deps, never compiled by the Android CMake
  (`LEVELDB_BUILD_TESTS`/`LEVELDB_BUILD_BENCHMARKS` are forced `OFF`) or the iOS
  podspec, so they are excluded from the repo and the published tarball.

## Releasing / publishing to npm

This package is published to npm as [`rn-leveldb`](https://www.npmjs.com/package/rn-leveldb)
(owner: `gotchoices`). npm won't accept a re-publish of an existing version, so
every release needs a version bump.

1. **Commit and push** all changes (including any `cpp/leveldb` updates) to
   `master` first.
2. **Bump the version + tag.** Either:
   - `yarn release` — runs [release-it] (interactive: bumps version, tags,
     pushes, publishes), or
   - manual: `npm version patch` (or `minor`/`major`) to bump `package.json` and
     create a git tag.
3. **`lib/` is built automatically** by the `prepare` hook (`bob build`) during
   `npm publish` — no manual build step needed.
4. **Verify the tarball before publishing:**
   ```sh
   npm publish --dry-run
   ```
   Confirm it includes `cpp/leveldb/util/env_posix.cc` (with the memory-order
   fix), the built `lib/`, `android/`, `ios/`, and `rn-leveldb.podspec`, and that
   `cpp/leveldb/third_party` is absent.
5. **Log in and publish** (one-time `npm login` as `gotchoices`):
   ```sh
   npm publish
   ```
6. **Consume it** in a host app: bump the `rn-leveldb` dependency to the new
   version, `yarn install`, then `cd ios && pod install`, and rebuild.

[release-it]: https://github.com/release-it/release-it

## License

MIT
