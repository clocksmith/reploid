# Blueprint 0x000042: Dependency Injection Container

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/di-container.js`, `/tests/unit/di-container.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/di-container.js`

**Former Blueprint Paths:** `self/blueprints/0x000042-dependency-injection-container.md`
**Objective:** Register modules by ID, build each one once from its declared dependencies, and dispose instances when a module is replaced or a boot is abandoned.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (utilities and logger)

---

### 1. Module contract

A module is an object `{ metadata, factory }`. `metadata.id` names it, `metadata.dependencies` lists the IDs it needs (a trailing `?` marks an optional one), and `metadata.async: true` asks the container to await `instance.init()` after construction. `factory(deps)` receives an object keyed by dependency ID and returns the instance (the module's API). The genesis level that loads a module is `metadata.genesis.introduced`; that is read by the boot loader, not by the container.

### 2. Container

`self/infrastructure/di-container.js` registers `DIContainer` (genesis level `tabula`). Boot creates it with `DIContainer.factory({ Utils })` (`self/boot-helpers/index.js`). The factory returns:

- `register(mod)`: throws `Invalid module registration` without `metadata.id`; disposes any existing instance of that ID, then stores the module.
- `resolve(id)`: returns the cached instance, or builds it: resolves each dependency recursively, calls `factory`, awaits `init()` for async modules, caches and returns the instance. Throws `Module not found: <id>` for an unknown ID and `Circular dependency: <id>` when an ID is reached again during its own resolution. A missing optional dependency is logged and left `undefined`; a missing required one propagates its error. An instance whose `init()` throws is not cached.
- `invalidate(id)`: drops and disposes one instance; returns whether there was one.
- `clearInstances()` (alias `clear()`): drops and disposes all instances; returns the count. The boot host calls it to revoke a failed boot's instances (`self/host/start-app.js`).
- `hasModule(id)`, `hasInstance(id)`.

Disposal calls the instance's `dispose`, `cleanup` or `destroy`, whichever exists first, and logs rather than throws on failure, including asynchronous failure.

### 3. Known behavior

The in-progress set used for cycle detection does not distinguish recursion from concurrency: a second `resolve(id)` that starts while the first is still awaiting the same module's dependencies or `init()` throws `Circular dependency`. Callers resolve shared modules in sequence.

The container has no UI and no module manifest file; module sets come from `self/config/genesis-levels.json`.

### 4. Verification conditions

- Resolving a module twice returns the same instance and calls its factory once.
- A required missing dependency fails resolution; an optional one does not.
- `register` of an already-built ID disposes the old instance.
