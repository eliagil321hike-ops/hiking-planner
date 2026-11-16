// Firestore security rules tests (W9 stage B). Run on the Firestore emulator:
//   cd firebase && npm install && npm test
// Two test users (alice, bob) plus a third party; test accounts exist only in the emulator.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, increment, Bytes,
} from 'firebase/firestore';

const MAX = 10;
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-topo3d',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'meta/userCount'), { count: 0 }); });
});

const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
// withSecurityRulesDisabled does not return the callback's value: read into a variable
async function adminRead(path) {
  let out;
  await env.withSecurityRulesDisabled(async (c) => { out = (await getDoc(doc(c.firestore(), path))).data(); });
  return out;
}
const count = async () => (await adminRead('meta/userCount')).count;
const setCount = (n) => env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'meta/userCount'), { count: n }));

/** What the site does on first sign-in: profile + counter + 1 in one batch. */
function signUp(f, uid, profile = {}) {
  const b = writeBatch(f);
  b.set(doc(f, 'users', uid), { displayName: 'Test ' + uid, avatarUrl: null, createdAt: serverTimestamp(), ...profile });
  b.update(doc(f, 'meta/userCount'), { count: increment(1) });
  return b.commit();
}
const sha = 'a'.repeat(64);
function routeHeader(over = {}) {
  return { name: 'מסלול', description: '', folderId: null, color: '#128ABA', stats: { distance: 1200 }, bbox: [35, 31, 35.1, 31.1],
    thumb: null, days: 0, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deletedAt: null,
    rev: 1, chunks: 1, bytes: 3, sha256: sha, ...over };
}
/** What the site does on save: header + chunks in one batch. */
function saveRoute(f, uid, id, over = {}, chunkOver = {}) {
  const b = writeBatch(f);
  const h = routeHeader(over);
  b.set(doc(f, 'users', uid, 'routes', id), h);
  for (let i = 0; i < h.chunks; i++) b.set(doc(f, 'users', uid, 'routes', id, 'chunks', String(i)), { data: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])), rev: h.rev, ...chunkOver });
  return b.commit();
}
async function updateRoute(f, uid, id, rev, over = {}) {
  const b = writeBatch(f);
  b.set(doc(f, 'users', uid, 'routes', id), routeHeader({ rev, ...over }), { merge: false });
  b.set(doc(f, 'users', uid, 'routes', id, 'chunks', '0'), { data: Bytes.fromUint8Array(new Uint8Array([9])), rev });
  return b.commit();
}
/** createdAt must stay as stored on update: read it first (the site keeps it from the loaded copy). */
async function storedCreatedAt(uid, id) {
  return (await adminRead(`users/${uid}/routes/${id}`)).createdAt;
}

// ---------------------------------------------------------------- sign-up and the cap
test('new user: profile + counter +1 in one batch succeeds', async () => {
  await assertSucceeds(signUp(db('alice'), 'alice'));
  assert.equal(await count(), 1);
});
test('profile without the counter, or counter without a profile, is refused', async () => {
  const f = db('alice');
  await assertFails(setDoc(doc(f, 'users/alice'), { displayName: 'A', avatarUrl: null, createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, 'meta/userCount'), { count: increment(1) }));
  assert.equal(await count(), 0);
});
test('counter +2 with one profile is refused', async () => {
  const f = db('alice');
  const b = writeBatch(f);
  b.set(doc(f, 'users/alice'), { displayName: 'A', avatarUrl: null, createdAt: serverTimestamp() });
  b.update(doc(f, 'meta/userCount'), { count: increment(2) });
  await assertFails(b.commit());
});
test('a second sign-up of the same user cannot increment again', async () => {
  await assertSucceeds(signUp(db('alice'), 'alice'));
  await assertFails(signUp(db('alice'), 'alice'));
  assert.equal(await count(), 1);
});
test(`cap: user ${MAX + 1} cannot create a profile and cannot save`, async () => {
  await setCount(MAX);
  const f = db('late');
  await assertFails(signUp(f, 'late'));
  await assertFails(saveRoute(f, 'late', 'r1'));
  assert.equal(await count(), MAX);
  await assertSucceeds(getDoc(doc(f, 'meta/userCount')));   // the site reads it to say "the group is full"
});
test(`cap: user ${MAX} can still sign up`, async () => {
  await setCount(MAX - 1);
  await assertSucceeds(signUp(db('last'), 'last'));
  assert.equal(await count(), MAX);
});
test('the counter cannot be set, created or deleted directly', async () => {
  const f = db('alice');
  await assertFails(setDoc(doc(f, 'meta/userCount'), { count: 0 }));
  await assertFails(deleteDoc(doc(f, 'meta/userCount')));
  await assertFails(getDoc(doc(db(null), 'meta/userCount')));   // signed out: not even readable
});
test('profile fields are checked; unknown fields refused', async () => {
  await assertFails(signUp(db('alice'), 'alice', { email: 'x@y' }));
  await assertFails(signUp(db('alice'), 'alice', { displayName: 5 }));
});

// ---------------------------------------------------------------- isolation between users
test('A cannot read, list, update or delete B\'s data', async () => {
  await signUp(db('bob'), 'bob');
  await saveRoute(db('bob'), 'bob', 'r1');
  const a = db('alice');
  await signUp(a, 'alice');
  await assertFails(getDoc(doc(a, 'users/bob')));
  await assertFails(getDoc(doc(a, 'users/bob/routes/r1')));
  await assertFails(getDocs(collection(a, 'users/bob/routes')));
  await assertFails(getDoc(doc(a, 'users/bob/routes/r1/chunks/0')));
  await assertFails(updateDoc(doc(a, 'users/bob/routes/r1'), { name: 'mine' }));
  await assertFails(deleteDoc(doc(a, 'users/bob/routes/r1')));
  await assertFails(deleteDoc(doc(a, 'users/bob')));
  await assertFails(updateDoc(doc(a, 'users/bob'), { displayName: 'x' }));
});
test('A cannot write into B\'s path (owner change / planting a route)', async () => {
  await signUp(db('bob'), 'bob');
  await signUp(db('alice'), 'alice');
  await assertFails(saveRoute(db('alice'), 'bob', 'planted'));
  await assertFails(setDoc(doc(db('alice'), 'users/bob/folders/f1'), { name: 'x', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db('alice'), 'users/bob/points/p1'), { name: 'x', icon: 'water', lon: 35, lat: 31, ele: null, source: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test('signed out: nothing readable or writable', async () => {
  await signUp(db('bob'), 'bob');
  await saveRoute(db('bob'), 'bob', 'r1');
  const n = db(null);
  await assertFails(getDoc(doc(n, 'users/bob/routes/r1')));
  await assertFails(getDoc(doc(n, 'meta/userCount')));
  await assertFails(saveRoute(n, 'bob', 'r2'));
});
test('unknown top-level collections are closed', async () => {
  await signUp(db('alice'), 'alice');
  await assertFails(setDoc(doc(db('alice'), 'anything/x'), { a: 1 }));
  await assertFails(setDoc(doc(db('alice'), 'users/alice/other/x'), { a: 1 }));
});

// ---------------------------------------------------------------- routes
test('own route: create, read, list, soft delete, restore, delete', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await assertSucceeds(saveRoute(a, 'alice', 'r1'));
  await assertSucceeds(getDoc(doc(a, 'users/alice/routes/r1')));
  await assertSucceeds(getDocs(collection(a, 'users/alice/routes')));
  await assertSucceeds(getDoc(doc(a, 'users/alice/routes/r1/chunks/0')));
  const c = await storedCreatedAt('alice', 'r1');
  await assertSucceeds(updateDoc(doc(a, 'users/alice/routes/r1'), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp(), rev: 2, createdAt: c }));
  await assertSucceeds(updateDoc(doc(a, 'users/alice/routes/r1'), { deletedAt: null, updatedAt: serverTimestamp(), rev: 3 }));
  const b = writeBatch(a);
  b.delete(doc(a, 'users/alice/routes/r1/chunks/0'));
  b.delete(doc(a, 'users/alice/routes/r1'));
  await assertSucceeds(b.commit());
});
test('saving needs a profile (no account = no save)', async () => {
  await assertFails(saveRoute(db('alice'), 'alice', 'r1'));
});
test('conflict: an update from an older copy is refused (rev must be stored rev + 1)', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await saveRoute(a, 'alice', 'r1');                                   // rev 1
  const c = await storedCreatedAt('alice', 'r1');
  await assertSucceeds(updateRoute(a, 'alice', 'r1', 2, { createdAt: c }));   // device 1 saves: rev 2
  await assertFails(updateRoute(a, 'alice', 'r1', 2, { createdAt: c }));      // device 2 loaded rev 1: refused
  await assertFails(updateRoute(a, 'alice', 'r1', 5, { createdAt: c }));      // skipping ahead: refused
  await assertSucceeds(updateRoute(a, 'alice', 'r1', 3, { createdAt: c }));
});
test('create must start at rev 1; createdAt cannot be rewritten; updatedAt is the server time', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await assertFails(saveRoute(a, 'alice', 'r1', { rev: 2 }, { rev: 2 }));
  await assertFails(saveRoute(a, 'alice', 'r1', { updatedAt: new Date(0) }));
  await saveRoute(a, 'alice', 'r1');
  await assertFails(updateRoute(a, 'alice', 'r1', 2, { createdAt: new Date(0) }));
});
test('route fields are checked; unknown fields refused', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await assertFails(saveRoute(a, 'alice', 'r1', { owner: 'bob' }));
  await assertFails(saveRoute(a, 'alice', 'r1', { name: '' }));
  await assertFails(saveRoute(a, 'alice', 'r1', { name: 'x'.repeat(81) }));
  await assertFails(saveRoute(a, 'alice', 'r1', { schemaVersion: 2 }));
  await assertFails(saveRoute(a, 'alice', 'r1', { chunks: 13 }));
  await assertFails(saveRoute(a, 'alice', 'r1', { sha256: 'nothex' }));
  await assertFails(saveRoute(a, 'alice', 'r1', { description: 5 }));
  const h = routeHeader(); delete h.description;
  await assertFails(setDoc(doc(a, 'users/alice/routes/r2'), h));
});
test('chunks: only with their route, same rev, within the chunk count and size', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await assertFails(saveRoute(a, 'alice', 'r1', {}, { rev: 7 }));                       // rev mismatch
  await saveRoute(a, 'alice', 'r1');
  await assertFails(setDoc(doc(a, 'users/alice/routes/r1/chunks/1'), { data: Bytes.fromUint8Array(new Uint8Array([1])), rev: 1 }));   // beyond chunks
  await assertFails(setDoc(doc(a, 'users/alice/routes/r1/chunks/0'), { data: 'text', rev: 1 }));   // not bytes
  await assertFails(setDoc(doc(a, 'users/alice/routes/r1/chunks/0'), { data: Bytes.fromUint8Array(new Uint8Array(700001)), rev: 1 }));
  await assertSucceeds(saveRoute(a, 'alice', 'r2', { chunks: 2, bytes: 6 }));
});

// ---------------------------------------------------------------- folders and points
test('own folders and points: create, update, delete; fields checked', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  const t = serverTimestamp();
  await assertSucceeds(setDoc(doc(a, 'users/alice/folders/f1'), { name: 'ים המלח', createdAt: t, updatedAt: t }));
  await assertFails(setDoc(doc(a, 'users/alice/folders/f2'), { name: 'x', createdAt: t, updatedAt: t, extra: 1 }));
  const p = { name: 'מעיין', icon: 'water', lon: 35.4, lat: 33.0, ele: 512, source: { key: 'osm:1', name: 'עין' }, createdAt: t, updatedAt: t };
  await assertSucceeds(setDoc(doc(a, 'users/alice/points/p1'), p));
  await assertFails(setDoc(doc(a, 'users/alice/points/p2'), { ...p, lat: 91 }));
  await assertFails(setDoc(doc(a, 'users/alice/points/p3'), { ...p, icon: '' }));
  await assertSucceeds(deleteDoc(doc(a, 'users/alice/points/p1')));
  await assertSucceeds(deleteDoc(doc(a, 'users/alice/folders/f1')));
});

// ---------------------------------------------------------------- account deletion
test('account deletion: profile delete only together with counter −1', async () => {
  const a = db('alice');
  await signUp(a, 'alice');
  await assertFails(deleteDoc(doc(a, 'users/alice')));                                   // without −1
  const b = writeBatch(a);
  b.delete(doc(a, 'users/alice'));
  b.update(doc(a, 'meta/userCount'), { count: increment(-1) });
  await assertSucceeds(b.commit());
  assert.equal(await count(), 0);
  const c = writeBatch(a);                                                                 // −1 again: no profile
  c.update(doc(a, 'meta/userCount'), { count: increment(-1) });
  await assertFails(c.commit());
});
test('B cannot lower the counter by deleting A\'s profile', async () => {
  await signUp(db('alice'), 'alice');
  await signUp(db('bob'), 'bob');
  const f = db('bob');
  const b = writeBatch(f);
  b.delete(doc(f, 'users/alice'));
  b.update(doc(f, 'meta/userCount'), { count: increment(-1) });
  await assertFails(b.commit());
  assert.equal(await count(), 2);
});
