import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, VoidCallback, ValueChanged;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';
import 'chat_providers.dart';
import 'screen_helpers.dart';

class ConversationListScreen extends ConsumerWidget {
  const ConversationListScreen({
    super.key,
    required this.session,
    required this.openConversation,
    required this.openComputers,
    required this.openSettings,
    this.banner,
  });
  final SessionHandle session;
  final ValueChanged<String> openConversation;
  final VoidCallback openComputers;
  final VoidCallback openSettings;

  /// A standing notice from composition, such as a demo-build label.
  final String? banner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(conversationListProvider);
    final data = ownSession(async.asData?.value, (v) => v.sessionKey, session);
    final network = ownSession(
      ref.watch(networkProvider).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    return PageSurface(
      title: Strings.chats,
      children: [
        const SectionHeading(
          title: Strings.chatsHeading,
          description: Strings.chatsDetail,
        ),
        if (banner != null) Notice(text: banner!),
        ActionGroup(
          children: [
            StatusBadge(
              label: networkLabel(network?.status ?? NetworkStatus.offline),
              highlighted: network?.status == NetworkStatus.online,
            ),
            SecondaryAction(label: Strings.computers, onPressed: openComputers),
            SecondaryAction(label: Strings.settings, onPressed: openSettings),
          ],
        ),
        ActionButton(
          label: Strings.newChat,
          pendingLabel: Strings.newChat,
          onPressed: () {
            final repository = ref.read(chatRepositoryProvider);
            if (repository == null || !session.isActive) return;
            openConversation(repository.create());
          },
        ),
        AsyncContent(
          loadingLabel: Strings.loading,
          emptyLabel: Strings.noChats,
          retryLabel: Strings.retry,
          loading: data == null && async.isLoading,
          errorMessage: async.hasError
              ? Strings.failure(FailureKind.unexpected)
              : null,
          content: data == null || data.conversations.isEmpty
              ? null
              : Section(
                  children: [
                    for (final conversation in data.conversations)
                      ActionTile(
                        title: conversation.title.isEmpty
                            ? Strings.untitled
                            : conversation.title,
                        highlighted: conversation.busy,
                        status: StatusBadge(
                          label: _listStatus(conversation),
                          highlighted: conversation.busy,
                        ),
                        onPressed: () => openConversation(conversation.id),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

String _listStatus(Conversation conversation) {
  if (conversation.turns.isEmpty) {
    return conversation.draft.trim().isNotEmpty
        ? Strings.draft
        : Strings.emptyChat;
  }
  final last = conversation.turns.last;
  return switch (last.phase) {
    AnswerPhase.complete => Strings.assistant,
    AnswerPhase.stopped => Strings.stop,
    AnswerPhase.failed => Strings.retry,
    null => Strings.you,
    _ => Strings.answering,
  };
}
