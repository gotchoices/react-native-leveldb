import { NativeModules } from 'react-native';

let nativeModuleInitError: null|string = null;
const LeveldbModule = NativeModules.Leveldb;
if (LeveldbModule == null || typeof LeveldbModule.install !== 'function') {
  nativeModuleInitError = 'The native Leveldb module could not be found! Is it correctly installed and autolinked?';
}

// Call the synchronous blocking install() function
try {
  if (LeveldbModule.install() !== true) {
    nativeModuleInitError = 'The native Leveldb JSI bindings could not be installed!';
  }
} catch (e) {
  nativeModuleInitError = e instanceof Error ? e?.message : 'Leveldb.install caught error!';
}

const g = global as any;

export interface LevelDBIteratorI {
  // Position at the first key in the source.  The iterator is Valid()
  // after this call iff the source is not empty.
  seekToFirst(): LevelDBIteratorI;

  // Position at the last key in the source.  The iterator is
  // Valid() after this call iff the source is not empty.
  seekLast(): LevelDBIteratorI;

  // Position at the first key in the source that is at or past target.
  // The iterator is Valid() after this call iff the source contains
  // an entry that comes at or past target.
  seek(target: ArrayBuffer | string): LevelDBIteratorI;

  // An iterator is either positioned at a key/value pair, or
  // not valid.  This method returns true iff the iterator is valid.
  valid(): boolean;

  // Moves to the next entry in the source.  After this call, Valid() is
  // true iff the iterator was not positioned at the last entry in the source.
  // REQUIRES: Valid()
  next(): void;

  // Moves to the previous entry in the source.  After this call, Valid() is
  // true iff the iterator was not positioned at the first entry in source.
  // REQUIRES: Valid()
  prev(): void;
  close(): void;

  // Return the key for the current entry.  The underlying storage for
  // the returned slice is valid only until the next modification of
  // the iterator.
  // REQUIRES: Valid()
  keyStr(): string;
  keyBuf(): ArrayBuffer;

  // Return the value for the current entry.  The underlying storage for
  // the returned slice is valid only until the next modification of
  // the iterator.
  // REQUIRES: Valid()
  valueStr(): string;
  valueBuf(): ArrayBuffer;

  /**
   * Executes a comparison using the underlying iterator's Compare(Slice ...) method
   * @param target 
   */
  compareKey(target: ArrayBuffer | string): number;
}

export interface LevelDBWriteBatchI {
  // Set the database entry for "k" to "v".
  put(k: ArrayBuffer | string, v: ArrayBuffer | string): void;

  // Remove the database entry (if any) for "key".
  // It is not an error if "key" did not exist in the database.
  delete(k: ArrayBuffer | string): void;

  // Drops the reference to this WriteBatch.
  close(): void;
}

export interface LevelDBI {
  // Close this ref to LevelDB.
  close(): void;

  // Returns true if this ref to LevelDB is closed. This can happen if close() is called on *any* open reference to a
  // given LevelDB name.
  closed(): boolean;

  // Set the database entry for "k" to "v".  Returns OK on success, throws an exception on error.
  put(k: ArrayBuffer | string, v: ArrayBuffer | string): void;

  // Remove the database entry (if any) for "key". Throws an exception on error.
  // It is not an error if "key" did not exist in the database.
  delete(k: ArrayBuffer | string): void;

  // Returns the corresponding value for "key", if the database contains it; returns null otherwise.
  // Throws an exception if there is an error.
  // The *Str and *Buf methods help with geting the underlying data as a utf8 string or a byte buffer.
  getStr(k: ArrayBuffer | string): null | string;
  getBuf(k: ArrayBuffer | string): null | ArrayBuffer;

  // Returns an iterator over the contents of the database.
  // The result of newIterator() is initially invalid (caller must
  // call one of the seek methods on the iterator before using it).
  //
  // Caller should delete the iterator when it is no longer needed.
  // The returned iterator should be closed before this db is closed.
  newIterator(): LevelDBIteratorI;
}

export class LevelDBWriteBatch implements LevelDBWriteBatchI {
  ref: number;

  constructor() {
    this.ref = g.leveldbNewWriteBatch();
  }

  put(k: ArrayBuffer | string, v: ArrayBuffer | string) {
    g.leveldbWriteBatchPut(this.ref, k, v);
  }

  delete(k: ArrayBuffer | string) {
    g.leveldbWriteBatchDelete(this.ref, k);
  }

  close() {
    g.leveldbWriteBatchClose(this.ref);
    this.ref = -1;
  }
}

export class LevelDBIterator implements LevelDBIteratorI {
  private ref: number;

  constructor(dbRef: number) {
    this.ref = g.leveldbNewIterator(dbRef);
  }

  seekToFirst(): LevelDBIterator {
    g.leveldbIteratorSeekToFirst(this.ref);
    return this;
  }

  seekLast(): LevelDBIterator {
    g.leveldbIteratorSeekToLast(this.ref);
    return this;
  }

  seek(target: ArrayBuffer | string): LevelDBIterator {
    g.leveldbIteratorSeek(this.ref, target);
    return this;
  }

  valid(): boolean {
    return g.leveldbIteratorValid(this.ref);
  }

  next(): void {
    g.leveldbIteratorNext(this.ref);
  }

  prev(): void {
    g.leveldbIteratorPrev(this.ref);
  }

  close() {
    g.leveldbIteratorDelete(this.ref);
    this.ref = -1;
  }

  keyStr(): string {
    return g.leveldbIteratorKeyStr(this.ref);
  }

  keyBuf(): ArrayBuffer {
    return g.leveldbIteratorKeyBuf(this.ref);
  }

  valueStr(): string {
    return g.leveldbIteratorValueStr(this.ref);
  }

  valueBuf(): ArrayBuffer {
    return g.leveldbIteratorValueBuf(this.ref);
  }
  compareKey(target: ArrayBuffer | string) : number {
    return g.leveldbIteratorKeyCompare(this.ref, target);
  }
}

export class LevelDB implements LevelDBI {
  // Keep references to already open DBs to facilitate RN's reload flow.
  // This must live on globalThis (not module state) since Metro reloads this module.
  private static openRefs(): Record<string, number> {
    const key = '__rn_leveldb_openPathRefs';
    const host = globalThis as unknown as Record<string, unknown>;
    const existing = host[key] as undefined | Record<string, number>;
    if (existing) return existing;
    const created: Record<string, number> = Object.create(null);
    host[key] = created;
    return created;
  }
  private ref: undefined | number;

  constructor(name: string, createIfMissing: boolean, errorIfExists: boolean) {
    if (nativeModuleInitError) {
      throw new Error(nativeModuleInitError);
    }

    const openRefs = LevelDB.openRefs();
    if (openRefs[name] !== undefined) {
      this.ref = openRefs[name];
    } else {
      openRefs[name] = this.ref = g.leveldbOpen(name, createIfMissing, errorIfExists);
    }
  }

  close() {
    g.leveldbClose(this.ref);
    const openRefs = LevelDB.openRefs();
    for (const name in openRefs) {
      if (openRefs[name] === this.ref) {
        delete openRefs[name];
      }
    }
    this.ref = undefined;
  }

  closed(): boolean {
    if (this.ref === undefined) return true;
    return !Object.values(LevelDB.openRefs()).includes(this.ref);
  }

  put(k: ArrayBuffer | string, v: ArrayBuffer | string) {
    g.leveldbPut(this.ref, k, v);
  }

  delete(k: ArrayBuffer | string) {
    g.leveldbDelete(this.ref, k);
  }

  getStr(k: ArrayBuffer | string): null | string {
    return g.leveldbGetStr(this.ref, k);
  }

  getBuf(k: ArrayBuffer | string): null | ArrayBuffer {
    return g.leveldbGetBuf(this.ref, k);
  }

  newIterator(): LevelDBIterator {
    if (this.ref === undefined) {
      throw new Error('LevelDB.newIterator: could not create iterator, the DB was closed!');
    }
    return new LevelDBIterator(this.ref);
  }

  write(batch: LevelDBWriteBatch) {
    g.leveldbWriteWriteBatch(this.ref, batch.ref);
  }

  // Merges the data from another LevelDB into this one. All keys from src will be written into this LevelDB,
  // overwriting any existing values.
  // batchMerge=true will write all values from src in one transaction, thus ensuring that the dst DB is not left
  // in a corrupt state.
  merge(src: LevelDB, batchMerge: boolean) {
    if (this.ref === undefined) {
      throw new Error('LevelDB.merge: could not merge, the dest DB (this) was closed!');
    }
    if (src.ref === undefined) {
      throw new Error('LevelDB.merge: could not merge, the source DB was closed!');
    }
    g.leveldbMerge(this.ref, src.ref, batchMerge);
  }

  static destroyDB(name: string, force?: boolean) {
    const openRefs = LevelDB.openRefs();
    if (openRefs[name] !== undefined) {
      if (force) {
        g.leveldbClose(openRefs[name]);
        delete openRefs[name];
      } else {
        throw new Error('DB is open! Cannot destroy');
      }
    }

    g.leveldbDestroy(name);
  }

  static readFileToBuf = g.leveldbReadFileBuf as (path: string, pos: number, len: number) => ArrayBuffer;
}
