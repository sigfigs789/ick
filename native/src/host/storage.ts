import { Storage as SQLiteStorage } from 'expo-sqlite/kv-store';

/**
 * `localStorage`, on a device that has none.
 *
 * The game's whole persistence layer -- today's progress, the streak, the
 * board identity, the visit counters, the live-lookup budget -- is five shared
 * modules that call `localStorage` directly and synchronously
 * (`src/game/storage.ts`, `player.ts`, `whatsNew.ts`, `visits.ts`,
 * `liveValidate.ts`). None of them is async, and several are called during
 * render: `Root` mints the player id while rendering, and `useDailyPuzzle`
 * seeds its state from storage in a `useState` initialiser. Rewriting that to
 * await an AsyncStorage would be a rewrite of the game, not a port of it, and
 * it would leave two persistence layers to keep in step.
 *
 * So the platform is given the API instead. `expo-sqlite`'s key-value store is
 * genuinely synchronous, ships with the SDK, and needs no native module beyond
 * SQLite itself -- so this works in Expo Go and in a store build alike.
 *
 * ## Why not `expo-sqlite/localStorage`
 *
 * Expo ships its own `localStorage` global built on the same store, and it is
 * very nearly this. What it lacks is an `ownKeys` trap, so `Object.keys()` on
 * it reports the wrapper's own fields rather than the stored keys.
 *
 * That is not a detail here. `storage.playedOnItsDay()` enumerates the keys to
 * find every day this device has played, and it is the whole of the
 * leaderboard's history import -- a player who has been playing for weeks
 * before joining the board gets those weeks counted because of that one call.
 * Against Expo's wrapper it would find nothing, import nothing, and report no
 * error: the board would simply start everyone at zero. The trap below is what
 * makes the enumeration real.
 */

/** The methods the Web Storage API puts on the object itself. */
class WebStorageShim {
  getItem(key: string): string | null {
    return SQLiteStorage.getItemSync(key);
  }

  setItem(key: string, value: string): void {
    SQLiteStorage.setItemSync(key, String(value));
  }

  removeItem(key: string): void {
    SQLiteStorage.removeItemSync(key);
  }

  clear(): void {
    SQLiteStorage.clearSync();
  }

  key(index: number): string | null {
    return SQLiteStorage.getKeyByIndexSync(index);
  }

  get length(): number {
    return SQLiteStorage.getLengthSync();
  }

  toString(): string {
    return '[object Storage]';
  }
}

/** Every name that belongs to the shim rather than to the stored data. */
function ownNames(instance: object): Set<string> {
  const names = new Set<string>();
  for (let proto: object | null = instance; proto; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  return names;
}

/**
 * The shim, wrapped so that stored keys behave like properties.
 *
 * Web Storage is two APIs over one bag of strings: the methods above, and
 * plain property access (`localStorage.foo`, `Object.keys(localStorage)`).
 * The shared code uses both, so the proxy has to serve both -- with the
 * methods always winning, or a stored key named `length` would shadow one.
 */
function withStoredKeysAsProperties(shim: WebStorageShim): Storage {
  const builtin = ownNames(shim);

  return new Proxy(shim, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || builtin.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      const value = target.getItem(prop);
      return value === null ? undefined : value;
    },

    set(target, prop, value, receiver) {
      if (typeof prop !== 'string' || builtin.has(prop)) {
        return Reflect.set(target, prop, value, receiver);
      }
      target.setItem(prop, String(value));
      return true;
    },

    deleteProperty(target, prop) {
      if (typeof prop !== 'string' || builtin.has(prop)) {
        return Reflect.deleteProperty(target, prop);
      }
      target.removeItem(prop);
      return true;
    },

    has(target, prop) {
      if (typeof prop !== 'string' || builtin.has(prop)) return Reflect.has(target, prop);
      return target.getItem(prop) !== null;
    },

    /*
     * The reason this file exists rather than `expo-sqlite/localStorage`.
     *
     * `Object.keys()` is `ownKeys` filtered by `getOwnPropertyDescriptor`'s
     * `enumerable`, so a trap here without one below returns nothing at all --
     * which is exactly the silent-empty-history failure described at the top.
     */
    ownKeys() {
      return [...new Set(SQLiteStorage.getAllKeysSync())].filter((key) => !builtin.has(key));
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== 'string' || builtin.has(prop)) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      const value = target.getItem(prop);
      if (value === null) return undefined;
      // Configurable because a proxy may not report a non-configurable
      // property that the target does not actually have -- the invariant check
      // throws a TypeError, which would turn every key enumeration into a crash.
      return { value, writable: true, enumerable: true, configurable: true };
    },
  }) as unknown as Storage;
}

/**
 * Put `localStorage` on the global object, once, before anything reads it.
 *
 * Idempotent: a fast refresh re-runs the module, and replacing a live store
 * mid-session would be a new empty one to anything holding a reference.
 */
export function installLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  Object.defineProperty(globalThis, 'localStorage', {
    value: withStoredKeysAsProperties(new WebStorageShim()),
    writable: false,
    configurable: true,
  });
}
