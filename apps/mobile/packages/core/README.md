# core

Pure Dart lifecycle and diagnostic primitives, with no Flutter or Riverpod imports.

```dart
final sessions = SessionCoordinator();
await sessions.activate(const SessionIdentity('account', tenantId: 'workspace'));
final session = sessions.state.session!;
session.registerCleanup(() => closeAccountResources());
final result = await fetchSomething();
session.requireActive();
publish(result);
```

The last example's resource, fetch, and publish functions are supplied by the consuming app. An active handle must be checked after each await. Attach listeners with `watch()` and cancel subscriptions when their owner ends.

Transitions revoke the old handle immediately, await registered cleanup, and expose only the latest requested session. Cleanup failure produces `SessionStatus.failed`; a later transition retries failed cleanups. Cleanup functions must be idempotent and asynchronous work must have app-defined timeouts so preparation cannot wait indefinitely. Token refresh for the same session should update credentials through the app's auth coordinator without calling `activate` again.

`AppFailure` uses fixed categories. `Diagnostics` serializes only typed safe event fields. Domain failures and telemetry categories specific to an app belong to that app until multiple consumers establish a shared need.

Run `dart test` from this directory. `SessionCoordinator.dispose` returns a future; await it before disposing storage it depends on. Flutter widget tests must pump fake microtasks while awaiting cleanup futures created inside their fake clock.
