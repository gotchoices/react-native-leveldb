import { LevelDB, LevelDBWriteBatch } from 'rn-leveldb';
import { bufEquals, getRandomString } from './test-util';

type TestFn = () => void;

export function runRnLeveldbSmokeTests(): string[] {
  const results: string[] = [];
  let passed = 0;

  // Some smoke tests can trigger native crashes (e.g. use-after-close scenarios that aren't guarded natively).
  // Re-enable gradually and watch Metro logs for the last "[smoke] start ..." line.
  const enableBinaryKeyTests = true;
  const enableUnsafeNegativeTests = false;

  const tests: Array<{ name: string; fn: TestFn }> = [
    { name: 'open/close + closed()', fn: testOpenClose },
    { name: 'getStr missing -> null', fn: testGetStrMissing },
    { name: 'getBuf missing -> null', fn: testGetBufMissing },
    { name: 'put/getStr/delete (string)', fn: testPutGetDeleteString },
    { name: 'put/getBuf/delete (ArrayBuffer)', fn: testPutGetDeleteBuffer },
    { name: 'utf8 string roundtrip (unicode)', fn: testUtf8RoundTrip },
    { name: 'iterator seekToFirst/seekLast ordering', fn: testIteratorOrdering },
    { name: 'iterator seek + compareKey', fn: testIteratorSeekCompare },
    { name: 'iterator close -> further use throws', fn: testIteratorCloseThrows },
    ...(enableBinaryKeyTests ? [{ name: 'binary keys: ordering + seek', fn: testBinaryKeysOrderingSeek }] : []),
    { name: 'WriteBatch: put two keys', fn: testWriteBatchPutTwo },
    { name: 'WriteBatch: last-write-wins', fn: testWriteBatchLastWriteWins },
    { name: 'WriteBatch: delete wins if last', fn: testWriteBatchDeleteLastWins },
    { name: 'WriteBatch close -> further use throws', fn: testWriteBatchCloseThrows },
    { name: 'DB close prevents further use', fn: testDbClosePreventsUse },
    { name: 'destroyDB: throws if open', fn: testDestroyDbThrowsIfOpen },
    { name: 'destroyDB: removes closed DB', fn: testDestroyDbRemovesClosedDb },
    ...(enableUnsafeNegativeTests ? [{ name: 'UNSAFE: iterator after DB close -> throws (may crash native)', fn: unsafeTestIteratorAfterDbCloseThrows }] : []),
    ...(enableUnsafeNegativeTests ? [{ name: 'UNSAFE: destroyDB(force) while open (may crash native)', fn: unsafeTestDestroyDbForceWhileOpen }] : []),
  ];

  for (const t of tests) {
    try {
      console.info('[smoke] start', t.name);
      t.fn();
      results.push(`${t.name}: ok`);
      passed++;
      console.info('[smoke] ok', t.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`${t.name}: FAIL (${msg})`);
      console.warn('[smoke] FAIL', t.name, msg);
    }
  }

  results.push(`SUMMARY: ${passed}/${tests.length} passed`);
  return results;
}

// Keep optional/unsafe tests "referenced" so TS/linters don't flag them as unused.
void [testBinaryKeysOrderingSeek, unsafeTestIteratorAfterDbCloseThrows, unsafeTestDestroyDbForceWhileOpen];

function newDbName(prefix: string): string {
  return `${prefix}-${getRandomString(12)}.db`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function testOpenClose(): void {
  const db = new LevelDB(newDbName('open-close'), true, false);
  assert(db.closed() === false, 'expected db.closed() === false');
  db.close();
  assert(db.closed() === true, 'expected db.closed() === true after close');
}

function testGetStrMissing(): void {
  const db = new LevelDB(newDbName('getstr-missing'), true, false);
  try {
    assert(db.getStr('nope') === null, 'expected getStr missing -> null');
  } finally {
    db.close();
  }
}

function testGetBufMissing(): void {
  const db = new LevelDB(newDbName('getbuf-missing'), true, false);
  try {
    assert(db.getBuf('nope') === null, 'expected getBuf missing -> null');
  } finally {
    db.close();
  }
}

function testPutGetDeleteString(): void {
  const db = new LevelDB(newDbName('crud-string'), true, false);
  try {
    db.put('k', 'v');
    assert(db.getStr('k') === 'v', 'expected getStr(k) === v');
    db.delete('k');
    assert(db.getStr('k') === null, 'expected deleted key -> null');
  } finally {
    db.close();
  }
}

function testPutGetDeleteBuffer(): void {
  const db = new LevelDB(newDbName('crud-buf'), true, false);
  const k = new Uint8Array([1, 2, 3]).buffer;
  const v = new Uint8Array([4, 5, 6]).buffer;
  try {
    db.put(k, v);
    const got = db.getBuf(k);
    assert(got !== null, 'expected getBuf(k) != null');
    assert(bufEquals(got, v), 'expected stored buffer to roundtrip');
    db.delete(k);
    assert(db.getBuf(k) === null, 'expected deleted key -> null');
  } finally {
    db.close();
  }
}

function testUtf8RoundTrip(): void {
  const db = new LevelDB(newDbName('utf8'), true, false);
  try {
    const key = 'ключ'; // "key" (ru)
    const value = 'こんにちは世界'; // "hello world" (jp)
    db.put(key, value);
    assert(db.getStr(key) === value, 'expected unicode string roundtrip');
  } finally {
    db.close();
  }
}

function testIteratorOrdering(): void {
  const db = new LevelDB(newDbName('iter-order'), true, false);
  try {
    db.put('b', '2');
    db.put('a', '1');
    db.put('c', '3');

    const it = db.newIterator().seekToFirst();
    try {
      assert(it.valid(), 'expected iterator valid after seekToFirst');
      assert(it.keyStr() === 'a', 'expected first key === a');
      it.next();
      assert(it.keyStr() === 'b', 'expected second key === b');
      it.next();
      assert(it.keyStr() === 'c', 'expected third key === c');
    } finally {
      it.close();
    }

    const it2 = db.newIterator().seekLast();
    try {
      assert(it2.valid(), 'expected iterator valid after seekLast');
      assert(it2.keyStr() === 'c', 'expected last key === c');
    } finally {
      it2.close();
    }
  } finally {
    db.close();
  }
}

function testIteratorSeekCompare(): void {
  const db = new LevelDB(newDbName('iter-seek'), true, false);
  try {
    db.put('a', '1');
    db.put('b', '2');
    db.put('c', '3');

    const it = db.newIterator().seek('b');
    try {
      assert(it.valid(), 'expected iterator valid after seek(b)');
      assert(it.keyStr() === 'b', 'expected seek(b) to land on b');
      assert(it.compareKey('b') === 0, 'expected compareKey(b) === 0');
      assert(it.compareKey('a') > 0, 'expected key b > a');
      assert(it.compareKey('c') < 0, 'expected key b < c');
    } finally {
      it.close();
    }
  } finally {
    db.close();
  }
}

function testIteratorCloseThrows(): void {
  const db = new LevelDB(newDbName('iter-close'), true, false);
  try {
    db.put('a', '1');
    const it = db.newIterator().seekToFirst();
    it.close();
    assertThrows(() => it.valid(), 'expected iterator.valid() to throw after close');
  } finally {
    db.close();
  }
}

function unsafeTestIteratorAfterDbCloseThrows(): void {
  const name = newDbName('iter-after-db-close');
  const db = new LevelDB(name, true, false);
  const it = db.newIterator();
  try {
    db.put('a', '1');
    it.seekToFirst();
    assert(it.valid(), 'expected iterator valid before db close');
  } finally {
    db.close();
  }

  assertThrows(() => it.valid(), 'expected iterator.valid() to throw after db close');
  try {
    it.close();
  } catch {
    // best-effort cleanup; behavior after db close is implementation-defined
  }
}

function testBinaryKeysOrderingSeek(): void {
  const db = new LevelDB(newDbName('bin-keys'), true, false);
  try {
    const k1 = new Uint8Array([1]).buffer;
    const k2 = new Uint8Array([2]).buffer;
    const kff = new Uint8Array([255]).buffer;

    db.put(k2, new Uint8Array([2]).buffer);
    db.put(kff, new Uint8Array([255]).buffer);
    db.put(k1, new Uint8Array([1]).buffer);

    const it = db.newIterator().seekToFirst();
    try {
      assert(it.valid(), 'expected iterator valid');

      assert(bufEquals(it.keyBuf(), k1), 'expected first binary key to be [1]');
      it.next();
      assert(bufEquals(it.keyBuf(), k2), 'expected second binary key to be [2]');
      it.next();
      assert(bufEquals(it.keyBuf(), kff), 'expected third binary key to be [255]');

      it.seek(k2);
      assert(it.valid(), 'expected iterator valid after seek([2])');
      assert(bufEquals(it.keyBuf(), k2), 'expected seek([2]) to land on [2]');
      assert(it.compareKey(k2) === 0, 'expected compareKey([2]) === 0');
    } finally {
      it.close();
    }
  } finally {
    db.close();
  }
}

function testWriteBatchPutTwo(): void {
  const db = new LevelDB(newDbName('batch-put2'), true, false);
  try {
    const b = new LevelDBWriteBatch();
    try {
      b.put('k1', 'v1');
      b.put('k2', 'v2');
      db.write(b);
    } finally {
      b.close();
    }
    assert(db.getStr('k1') === 'v1', 'expected k1=v1');
    assert(db.getStr('k2') === 'v2', 'expected k2=v2');
  } finally {
    db.close();
  }
}

function testWriteBatchLastWriteWins(): void {
  const db = new LevelDB(newDbName('batch-lastwins'), true, false);
  try {
    const b = new LevelDBWriteBatch();
    try {
      b.put('k', 'v1');
      b.put('k', 'v2');
      db.write(b);
    } finally {
      b.close();
    }
    assert(db.getStr('k') === 'v2', 'expected last write to win');
  } finally {
    db.close();
  }
}

function testWriteBatchDeleteLastWins(): void {
  const db = new LevelDB(newDbName('batch-delwins'), true, false);
  try {
    const b = new LevelDBWriteBatch();
    try {
      b.put('k', 'v1');
      b.delete('k');
      db.write(b);
    } finally {
      b.close();
    }
    assert(db.getStr('k') === null, 'expected delete to win if last');
  } finally {
    db.close();
  }
}

function testWriteBatchCloseThrows(): void {
  const b = new LevelDBWriteBatch();
  b.close();
  assertThrows(() => b.put('k', 'v'), 'expected batch.put to throw after close');
}

function testDbClosePreventsUse(): void {
  const db = new LevelDB(newDbName('db-close-use'), true, false);
  db.close();
  assertThrows(() => db.put('k', 'v'), 'expected db.put to throw after close');
}

function testDestroyDbThrowsIfOpen(): void {
  const name = newDbName('destroy');

  const db = new LevelDB(name, true, false);
  db.put('k', 'v');
  assertThrows(() => LevelDB.destroyDB(name), 'expected destroyDB to throw if DB is open');
  db.close();
}

function testDestroyDbRemovesClosedDb(): void {
  const name = newDbName('destroy-closed');

  const db = new LevelDB(name, true, false);
  db.put('k', 'v');
  db.close();

  LevelDB.destroyDB(name);
  assertThrows(
    () => {
      const reopened = new LevelDB(name, false, false);
      reopened.close();
    },
    'expected open(createIfMissing=false) to throw after destroyDB'
  );
}

function unsafeTestDestroyDbForceWhileOpen(): void {
  const name = newDbName('destroy-force');
  const db = new LevelDB(name, true, false);
  db.put('k', 'v');

  // This may invalidate native handles in a way that's not fully guarded in native code.
  LevelDB.destroyDB(name, true);

  // At minimum, the JS wrapper should report closed.
  assert(db.closed(), 'expected existing ref to report closed after forced destroy');
}


