import 'package:core/core.dart';
import 'package:flutter/widgets.dart' show BuildContext, Widget, VoidCallback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';
import 'chat_providers.dart';
import 'screen_helpers.dart';

class ModelsScreen extends ConsumerWidget {
  const ModelsScreen({
    super.key,
    required this.session,
    required this.conversationId,
    required this.done,
  });
  final SessionHandle session;
  final String conversationId;
  final VoidCallback done;

  void _choose(WidgetRef ref, AnswerTarget target) {
    final repository = ref.read(chatRepositoryProvider);
    if (repository == null || !session.isActive) return;
    try {
      repository.selectTarget(conversationId, target);
      if (target == AnswerTarget.desktop) done();
    } on AppFailure {
      // An answer started meanwhile, or the desktop was unpaired.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final network = ownSession(
      ref.watch(networkProvider).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    final conversation = ownSession(
      ref.watch(conversationProvider(conversationId)).asData?.value,
      (v) => v.sessionKey,
      session,
    )?.conversation;
    return PageSurface(
      title: Strings.answerOn,
      children: [
        if (network?.desktop case final desktop? when desktop.paired) ...[
          const SectionHeading(title: Strings.whereToAnswer),
          ChoiceTile(
            title: Strings.targetDesktop(desktop.label),
            detail: desktop.status == DesktopStatus.online
                ? Strings.desktopDetailOnline
                : Strings.desktopOffline(desktop.label),
            selected: conversation?.target == AnswerTarget.desktop,
            onPressed: () => _choose(ref, AnswerTarget.desktop),
          ),
          ChoiceTile(
            title: Strings.targetContributors,
            detail: Strings.contributorsDetail,
            selected: conversation?.target == AnswerTarget.contributors,
            onPressed: () => _choose(ref, AnswerTarget.contributors),
          ),
        ],
        const SectionHeading(
          title: Strings.models,
          description: Strings.modelsDetail,
        ),
        AsyncContent(
          loadingLabel: Strings.loading,
          emptyLabel: Strings.noComputers,
          retryLabel: Strings.retry,
          loading: network == null,
          content: network == null
              ? null
              : Section(
                  children: [
                    for (final model in network.models)
                      ChoiceTile(
                        title: model.name,
                        detail: Strings.modelDetail(
                          model.readyComputers,
                          model.busyComputers,
                        ),
                        selected: model.id == conversation?.modelId,
                        onPressed: () {
                          final repository = ref.read(chatRepositoryProvider);
                          if (repository == null || !session.isActive) return;
                          try {
                            repository.selectModel(conversationId, model.id);
                            done();
                          } on AppFailure {
                            // An answer started meanwhile; the choice stands.
                          }
                        },
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
