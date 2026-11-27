import 'package:core/core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/app/providers.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';
import 'package:reploid_mobile/infrastructure/identity_store.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart';
import 'package:ui/ui.dart';

const _step = Duration(milliseconds: 20);

MemoryNetwork _network() => MemoryNetwork(latency: _step, chunkDelay: _step);

Future<void> _launch(
  WidgetTester tester,
  MemoryNetwork network, {
  MemorySecretStore? store,
  MemoryFileStore? files,
  List<Override> extraOverrides = const [],
  Size size = const Size(390, 844),
}) async {
  // A phone-sized surface; the test default is a wide desktop window.
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ReploidRoot(
      key: UniqueKey(),
      secrets: store ?? MemorySecretStore(),
      files: files ?? MemoryFileStore(),
      overrides: [
        memoryNetworkProvider.overrideWithValue(network),
        ...extraOverrides,
      ],
    ),
  );
  await tester.pump();
}

/// Lets identity generation, which is real asynchronous work, finish.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 40; i++) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump(_step);
  }
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

Future<void> _start(WidgetTester tester) async {
  await _tap(tester, find.text(Strings.start));
  await _settle(tester);
  expect(find.text(Strings.chatsHeading), findsOneWidget);
}

Future<void> _openNewChat(WidgetTester tester) async {
  await _tap(tester, find.text(Strings.newChat).first);
  await tester.pumpAndSettle(_step);
  expect(find.text(Strings.composerHint), findsOneWidget);
}

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
}

Future<void> _close(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('ask, see who will read it, and get a verified answer', (
    tester,
  ) async {
    final network = MemoryNetwork(
      latency: const Duration(milliseconds: 100),
      chunkDelay: _step,
    );
    await _launch(tester, network);
    expect(find.text(Strings.demoNetwork), findsOneWidget);
    await _start(tester);
    await _openNewChat(tester);
    expect(
      find.text(Strings.discloseComputer('peer:00000000000000000000000a')),
      findsOneWidget,
      reason: 'names the concrete answering computer before Send',
    );

    await _type(tester, 'hello there');
    await _tap(tester, find.text(Strings.send));
    await tester.pump();
    expect(find.text(Strings.finding), findsOneWidget);
    expect(find.text(Strings.stop), findsOneWidget);
    expect(network.delivered, isEmpty);

    await tester.pump(const Duration(milliseconds: 130));
    await tester.pump();
    expect(
      find.text(Strings.checking('peer:00000000000000000000000a')),
      findsOneWidget,
    );
    expect(network.delivered, isEmpty, reason: 'named before anything is sent');

    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('You asked: hello there'), findsOneWidget);
    expect(
      find.text(
        Strings.answeredBy(
          'peer:00000000000000000000000a',
          verified: true,
          model: 'Qwen 3.5 2B',
        ),
      ),
      findsOneWidget,
    );
    expect(find.text(Strings.send), findsOneWidget);
    expect(network.delivered, hasLength(1));

    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    expect(find.text('hello there'), findsOneWidget);
    await _close(tester);
  });

  testWidgets('a declined request says the prompt was not sent, then retries', (
    tester,
  ) async {
    final network = _network();
    await _launch(tester, network);
    await _start(tester);
    await _openNewChat(tester);
    network.simulateNext(AnswerBehavior.decline);
    await _type(tester, 'private question');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.textContaining(Strings.promptNotSent), findsOneWidget);
    expect(network.delivered, isEmpty);

    await tester.tap(find.text(Strings.retryAnswer));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('You asked: private question'), findsOneWidget);
    expect(find.byType(MessageBubble), findsNWidgets(2), reason: 'one prompt');
    expect(network.delivered, hasLength(1));
    await _close(tester);
  });

  testWidgets('stop keeps the text that had arrived', (tester) async {
    final network = MemoryNetwork(
      latency: _step,
      chunkDelay: const Duration(milliseconds: 200),
    );
    await _launch(tester, network);
    await _start(tester);
    await _openNewChat(tester);
    await _type(tester, 'a b c d e f');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(find.text(Strings.answering), findsOneWidget);
    await tester.tap(find.text(Strings.stop));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text(Strings.stopped), findsOneWidget);
    expect(find.textContaining('You asked'), findsOneWidget);
    expect(find.text('You asked: a b c d e f'), findsNothing);
    expect(network.cancels, 1);
    await _close(tester);
  });

  testWidgets('with network answers off nothing is sent and the draft stays', (
    tester,
  ) async {
    final network = _network();
    await _launch(tester, network);
    await _start(tester);
    await _tap(tester, find.text(Strings.settings));
    await tester.pumpAndSettle(_step);
    await _tap(tester, find.text(Strings.allowNetwork));
    await tester.pump(_step);
    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    await _openNewChat(tester);
    expect(find.text(Strings.discloseOff), findsOneWidget);
    await _type(tester, 'keep me');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('keep me'), findsOneWidget);
    expect(network.requests, 0);
    await _close(tester);
  });

  testWidgets('computers lists proven identities and readiness', (
    tester,
  ) async {
    await _launch(tester, _network());
    await _start(tester);
    await _tap(tester, find.text(Strings.computers));
    await tester.pumpAndSettle(_step);
    expect(find.text(Strings.computers), findsOneWidget);
    expect(find.text('peer:00000000000000000000000a'), findsOneWidget);
    expect(find.text(Strings.ready), findsOneWidget);
    expect(find.text(Strings.busy), findsOneWidget);
    await _close(tester);
  });

  testWidgets('network answers off persists across an app restart', (
    tester,
  ) async {
    final network = _network();
    final store = MemorySecretStore();
    final files = MemoryFileStore();
    await _launch(tester, network, store: store, files: files);
    await _start(tester);
    await _tap(tester, find.text(Strings.settings));
    await tester.pumpAndSettle(_step);
    await _tap(tester, find.text(Strings.allowNetwork));
    await _settle(tester);
    await _close(tester);

    await _launch(tester, network, store: store, files: files);
    await _settle(tester);
    await _openNewChat(tester);
    expect(find.text(Strings.discloseOff), findsOneWidget);
    await _type(tester, 'must stay off');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    expect(network.requests, 0);
    await _close(tester);
  });

  testWidgets(
    'unsent draft survives back navigation and avoids duplicate title',
    (tester) async {
      final network = _network();
      await _launch(tester, network);
      await _start(tester);
      await _openNewChat(tester);

      // Empty chat shows distinct Empty badge, never New chat twice.
      await tester.pageBack();
      await tester.pumpAndSettle(_step);
      expect(find.text(Strings.emptyChat), findsOneWidget);
      expect(
        find.text(Strings.untitled),
        findsNWidgets(2),
      ); // button + tile title

      await _tap(tester, find.text(Strings.emptyChat));
      await tester.pumpAndSettle(_step);
      await _type(tester, 'saved unsent draft');
      await tester.pageBack();
      await tester.pumpAndSettle(_step);
      expect(find.text(Strings.draft), findsOneWidget);

      await _tap(tester, find.text(Strings.draft));
      await tester.pumpAndSettle(_step);
      expect(find.text('saved unsent draft'), findsOneWidget);
      await _close(tester);
    },
  );

  testWidgets('runtime network selection switches out of demo and persists', (
    tester,
  ) async {
    final network = _network();
    final store = MemorySecretStore();
    final files = MemoryFileStore();
    final apiOverride = [
      requesterApiFactoryProvider.overrideWithValue(
        (identity, _) => network.forIdentity(SessionIdentity(identity.peerId)),
      ),
    ];
    await _launch(
      tester,
      network,
      store: store,
      files: files,
      extraOverrides: apiOverride,
    );
    await _start(tester);
    expect(find.text(Strings.demoNetwork), findsOneWidget);

    await _tap(tester, find.text(Strings.settings));
    await tester.pumpAndSettle(_step);
    await _tap(tester, find.text(Strings.networkModePublic));
    await _settle(tester);
    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    expect(find.text(Strings.demoNetwork), findsNothing);
    await _close(tester);

    await _launch(
      tester,
      network,
      store: store,
      files: files,
      extraOverrides: apiOverride,
    );
    await _settle(tester);
    expect(find.text(Strings.demoNetwork), findsNothing);
    await _close(tester);
  });

  testWidgets(
    'corrupt stored identity fails closed on Start without overwrite',
    (tester) async {
      final store = MemorySecretStore();
      await IdentityStore(store).write('{corrupt');
      await _launch(tester, _network(), store: store);
      await _settle(tester);
      expect(find.text(Strings.sessionFailure), findsOneWidget);
      expect(await IdentityStore(store).read(), '{corrupt');
      await _close(tester);
    },
  );

  testWidgets('forgetting this device removes conversations and the key', (
    tester,
  ) async {
    final network = _network();
    final store = MemorySecretStore();
    final files = MemoryFileStore();
    await _launch(tester, network, store: store, files: files);
    await _start(tester);
    final first = await IdentityStore(store).read();
    expect(first, isNotNull);
    await _openNewChat(tester);
    await _type(tester, 'remember me');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    expect(find.text('remember me'), findsOneWidget);

    await _tap(tester, find.text(Strings.settings));
    await tester.pumpAndSettle(_step);
    await _tap(tester, find.text(Strings.forget));
    await _settle(tester);
    expect(find.text(Strings.start), findsOneWidget);
    expect(find.text('remember me'), findsNothing);
    expect(await IdentityStore(store).read(), isNull);
    expect(files.files, isEmpty, reason: 'the saved history is erased');

    await _start(tester);
    expect(find.text('remember me'), findsNothing);
    expect(find.text(Strings.noChats), findsOneWidget);
    expect(await IdentityStore(store).read(), isNot(first));
    await _close(tester);
  });

  testWidgets('a device with a stored identity resumes without a tap', (
    tester,
  ) async {
    final store = MemorySecretStore();
    await _launch(tester, _network(), store: store);
    await _start(tester);
    final identity = await IdentityStore(store).read();
    await _close(tester);

    await _launch(tester, _network(), store: store);
    await _settle(tester);
    expect(find.text(Strings.chatsHeading), findsOneWidget);
    expect(await IdentityStore(store).read(), identity);
    await _close(tester);
  });

  testWidgets('pair with a desktop, ask it, and see it go offline', (
    tester,
  ) async {
    final network = _network();
    await _launch(tester, network);
    await _start(tester);
    await _tap(tester, find.text(Strings.computers));
    await tester.pumpAndSettle(_step);
    expect(find.text(Strings.yourDesktop), findsOneWidget);
    expect(find.text(Strings.thisPhone), findsOneWidget);

    // A link that is not one is refused before anything is sent.
    await tester.enterText(
      find.byType(TextField).first,
      'https://example.com/',
    );
    await tester.pump();
    await _tap(tester, find.text(Strings.pairCheck));
    await tester.pump();
    expect(find.text(Strings.invalidLink), findsOneWidget);

    // A real link first shows which desktop it names.
    await tester.enterText(
      find.byType(TextField).first,
      MemoryNetwork.pairingLink,
    );
    await tester.pump();
    await _tap(tester, find.text(Strings.pairCheck));
    await tester.pump();
    expect(
      find.text(Strings.connectTo(MemoryNetwork.desktopLabel)),
      findsOneWidget,
    );
    expect(find.text(MemoryNetwork.desktopId), findsOneWidget);
    expect(network.pairingRequests, 0, reason: 'nothing sent before Connect');

    await _tap(tester, find.text(Strings.connect));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(network.pairingRequests, 1);
    expect(find.text(Strings.unpair), findsOneWidget);
    expect(find.text(MemoryNetwork.desktopId), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    await _openNewChat(tester);
    expect(
      find.text('${Strings.answerOn}: ${MemoryNetwork.desktopLabel}'),
      findsOneWidget,
    );
    expect(
      find.text(Strings.discloseDesktop(MemoryNetwork.desktopLabel)),
      findsOneWidget,
    );
    await _type(tester, 'for my desk');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(
      find.text(
        Strings.answeredBy(
          MemoryNetwork.desktopId,
          verified: true,
          model: 'Qwen 3.5 2B',
        ),
      ),
      findsOneWidget,
    );
    expect(network.delivered.single.$2, MemoryNetwork.desktopId);

    // The desktop goes away: the composer says so, and a prompt sent now
    // goes to no one, although a contributor is ready.
    network.setDesktopOnline(false);
    await tester.pump(_step);
    await tester.pump();
    expect(
      find.text(Strings.desktopOffline(MemoryNetwork.desktopLabel)),
      findsOneWidget,
    );
    await _type(tester, 'are you there');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.textContaining(Strings.promptNotSent), findsOneWidget);
    expect(network.delivered, hasLength(1));
    await _close(tester);
  });

  testWidgets('conversations are still there after the app restarts', (
    tester,
  ) async {
    final network = _network();
    final store = MemorySecretStore();
    final files = MemoryFileStore();
    await _launch(tester, network, store: store, files: files);
    await _start(tester);
    await _openNewChat(tester);
    await _type(tester, 'keep this one');
    await _tap(tester, find.text(Strings.send));
    await tester.pump(const Duration(seconds: 1));
    await _settle(tester);
    await _close(tester);
    await _settle(tester);
    expect(files.files, hasLength(1));

    await _launch(tester, network, store: store, files: files);
    await _settle(tester);
    expect(find.text(Strings.chatsHeading), findsOneWidget);
    expect(find.text('keep this one'), findsOneWidget);
    await _tap(tester, find.text('keep this one'));
    await tester.pumpAndSettle(_step);
    expect(find.text('You asked: keep this one'), findsOneWidget);
    expect(network.requests, 1, reason: 'reopening a thread sends nothing');
    await _close(tester);
  });

  for (final dark in [false, true]) {
    testWidgets(
      'a narrow phone with large text shows the thread without overflow '
      '(${dark ? 'dark' : 'light'})',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearAllTestValues);
        final network = _network();
        await _launch(tester, network, size: const Size(320, 640));
        await _start(tester);
        await _openNewChat(tester);
        await _type(tester, 'a rather long question that wraps on a phone');
        await _tap(tester, find.text(Strings.send));
        await tester.pump(const Duration(seconds: 2));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.textContaining('You asked'), findsOneWidget);
        await _close(tester);
      },
    );
  }
}
