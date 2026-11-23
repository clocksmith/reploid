import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/chat.dart';

final chatRepositoryProvider = Provider<ChatRepository?>(
  (ref) => throw StateError('Composition must supply the session repository'),
);

final networkProvider = StreamProvider.autoDispose<NetworkResource>(
  (ref) =>
      ref.watch(chatRepositoryProvider)?.watchNetwork() ?? const Stream.empty(),
);

final conversationListProvider =
    StreamProvider.autoDispose<ConversationListResource>(
      (ref) =>
          ref.watch(chatRepositoryProvider)?.watchList() ??
          const Stream.empty(),
    );

final conversationProvider = StreamProvider.autoDispose
    .family<ConversationResource, String>(
      (ref, id) =>
          ref.watch(chatRepositoryProvider)?.watch(id) ?? const Stream.empty(),
    );
