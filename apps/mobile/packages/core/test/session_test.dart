import 'dart:async';

import 'package:core/core.dart';
import 'package:test/test.dart';

void main() {
  test('switch revokes synchronously and waits for cleanup', () async {
    final coordinator = SessionCoordinator();
    addTearDown(coordinator.dispose);
    await coordinator.activate(const SessionIdentity('A'));
    final old = coordinator.state.session!;
    final cleanup = Completer<void>();
    old.registerCleanup(() => cleanup.future);
    final switching = coordinator.activate(const SessionIdentity('B'));
    expect(old.isActive, isFalse);
    expect(coordinator.state.status, SessionStatus.transitioning);
    expect(old.requireActive, throwsA(isA<AppFailure>()));
    await Future<void>.delayed(Duration.zero);
    expect(coordinator.state.session, isNull);
    cleanup.complete();
    await switching;
    expect(coordinator.state.session!.key.identity.accountId, 'B');
  });

  test('same account and tenant changes get distinct session keys', () async {
    final coordinator = SessionCoordinator();
    addTearDown(coordinator.dispose);
    const identity = SessionIdentity('A', tenantId: 'one');
    await coordinator.activate(identity);
    final first = coordinator.state.session!.key;
    await coordinator.signOut();
    await coordinator.activate(identity);
    final second = coordinator.state.session!.key;
    await coordinator.activate(const SessionIdentity('A', tenantId: 'two'));
    expect(first, isNot(second));
    expect(second, isNot(coordinator.state.session!.key));
  });

  test('late preparation cannot publish an obsolete session', () async {
    final coordinator = SessionCoordinator();
    addTearDown(coordinator.dispose);
    final entered = Completer<void>();
    final release = Completer<void>();
    final readyAccounts = <String>[];
    final sub = coordinator.watch().listen((state) {
      if (state.session case final session?) {
        readyAccounts.add(session.key.identity.accountId);
      }
    });
    addTearDown(sub.cancel);
    final first = coordinator.activate(
      const SessionIdentity('A'),
      prepare: (session) async {
        entered.complete();
        await release.future;
        expect(session.isActive, isFalse);
      },
    );
    await entered.future;
    final second = coordinator.activate(const SessionIdentity('B'));
    release.complete();
    await Future.wait([first, second]);
    await Future<void>.delayed(Duration.zero);
    expect(readyAccounts, ['B']);
  });

  test('failed cleanup prevents account exposure and is retryable', () async {
    final coordinator = SessionCoordinator();
    addTearDown(coordinator.dispose);
    await coordinator.activate(const SessionIdentity('A'));
    var attempts = 0;
    var otherCleanup = 0;
    coordinator.state.session!.registerCleanup(() {
      if (++attempts == 1) throw StateError('private storage unavailable');
    });
    coordinator.state.session!.registerCleanup(() => otherCleanup++);
    await expectLater(
      coordinator.activate(const SessionIdentity('B')),
      throwsA(isA<AppFailure>()),
    );
    expect(coordinator.state.status, SessionStatus.failed);
    expect(coordinator.state.session, isNull);
    await coordinator.activate(const SessionIdentity('B'));
    expect(coordinator.state.status, SessionStatus.ready);
    expect(attempts, 2);
    expect(otherCleanup, 1);
  });

  test('dispose revokes pending work and closes subscriptions', () async {
    final coordinator = SessionCoordinator();
    await coordinator.activate(const SessionIdentity('A'));
    final handle = coordinator.state.session!;
    var cleaned = 0;
    handle.registerCleanup(() => cleaned++);
    final done = Completer<void>();
    coordinator.watch().listen((_) {}, onDone: done.complete);
    final closing = coordinator.dispose();
    expect(handle.isActive, isFalse);
    await closing;
    await done.future;
    await coordinator.dispose();
    expect(cleaned, 1);
    expect(
      () => coordinator.activate(const SessionIdentity('B')),
      throwsStateError,
    );
  });
}
