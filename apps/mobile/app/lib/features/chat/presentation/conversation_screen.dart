import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, VoidCallback, ValueChanged;
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';
import 'chat_providers.dart';
import 'screen_helpers.dart';

class ConversationScreen extends ConsumerWidget {
  const ConversationScreen({
    super.key,
    required this.session,
    required this.conversationId,
    required this.openModels,
    required this.closed,
  });
  final SessionHandle session;
  final String conversationId;
  final VoidCallback openModels;

  /// Called after this conversation is deleted from here.
  final VoidCallback closed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final resource = ownSession(
      ref.watch(conversationProvider(conversationId)).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    final network = ownSession(
      ref.watch(networkProvider).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    if (resource != null && resource.conversation == null) {
      return const PageSurface(
        title: Strings.chats,
        children: [BodyCopy(Strings.missing)],
      );
    }

    /// Runs a command for this session; an [AppFailure] reaches the caller.
    Future<void> run(Future<void> Function(ChatRepository) command) async {
      final repository = ref.read(chatRepositoryProvider);
      if (repository == null || !session.isActive) return;
      await command(repository);
    }

    return _Thread(
      conversation: resource?.conversation,
      network: network,
      openModels: openModels,
      setDraft: (text) {
        final repository = ref.read(chatRepositoryProvider);
        if (repository == null || !session.isActive) return;
        repository.setDraft(conversationId, text);
      },
      attach: () async {
        final picked = await ref.read(documentPickerProvider).pickAttachments();
        if (picked.isEmpty) return;
        ref
            .read(chatRepositoryProvider)
            ?.addAttachments(conversationId, picked);
      },
      removeFile: (index) => ref
          .read(chatRepositoryProvider)
          ?.removeAttachment(conversationId, index),
      send: (text, disclosed) => run(
        (r) => r.send(conversationId, text, disclosedRecipient: disclosed),
      ),
      stop: () => run((r) => r.stop(conversationId)),
      retry: (disclosed) =>
          run((r) => r.retry(conversationId, disclosedRecipient: disclosed)),
      recover: () async {
        final repository = ref.read(chatRepositoryProvider);
        if (repository == null || !session.isActive) {
          return RecoverResult.notYet;
        }
        return repository.recover(conversationId);
      },
      remove: () {
        ref.read(chatRepositoryProvider)?.remove(conversationId);
        closed();
      },
    );
  }
}

/// Persists unsent drafts in the repository so they survive navigation within
/// the session and are cleared on send, delete, or session end.
class _Thread extends HookWidget {
  const _Thread({
    required this.conversation,
    required this.network,
    required this.openModels,
    required this.setDraft,
    required this.attach,
    required this.removeFile,
    required this.send,
    required this.stop,
    required this.retry,
    required this.recover,
    required this.remove,
  });
  final Conversation? conversation;
  final NetworkResource? network;
  final VoidCallback openModels;
  final ValueChanged<String> setDraft;
  final Future<void> Function() attach;
  final ValueChanged<int> removeFile;
  final Future<void> Function(String text, String? disclosed) send;
  final Future<void> Function() stop;
  final Future<void> Function(String? disclosed) retry;
  final Future<RecoverResult> Function() recover;
  final VoidCallback remove;

  @override
  Widget build(BuildContext context) {
    final input = useTextEditingController(text: conversation?.draft ?? '');
    final hydrated = useRef(conversation != null);
    final refusal = useState<FailureKind?>(null);
    final attachRefused = useState(false);
    final detailsOpen = useState<String?>(null);
    final recovery = useState<RecoverResult?>(null);
    final recovering = useState(false);
    useListenable(input);
    useEffect(() {
      if (!hydrated.value && conversation != null) {
        hydrated.value = true;
        if (input.text.isEmpty && conversation!.draft.isNotEmpty) {
          input.text = conversation!.draft;
        }
      }
      return null;
    }, [conversation?.id, conversation != null]);
    useEffect(() {
      void syncDraft() {
        if (hydrated.value) setDraft(input.text);
      }

      input.addListener(syncDraft);
      return () => input.removeListener(syncDraft);
    }, [input]);
    final turns = conversation?.turns ?? const <Turn>[];
    final files = conversation?.draftFiles ?? const <AttachedFile>[];

    final allowed = network?.networkAnswersAllowed ?? true;
    final models = network?.models ?? const <ModelOption>[];
    final chosen =
        models.where((m) => m.id == conversation?.modelId).firstOrNull ??
        models.where((m) => m.available).firstOrNull;
    final busy = conversation?.busy ?? false;
    // A conversation aimed at the desktop names it, online or not; it is
    // never quietly answered by someone else.
    final desktop = conversation?.target == AnswerTarget.desktop
        ? network?.desktop
        : null;
    final readyPeers = chosen == null
        ? const <Computer>[]
        : (network?.computers ?? const <Computer>[])
              .where(
                (c) =>
                    c.modelId == chosen.id && c.ready && !c.busy && !c.blocked,
              )
              .toList();
    // Named by the same rule that places the request, and bound to it.
    final disclosed = desktop == null ? conversation?.nextRecipient : null;

    /// A command refused before any attempt shows why, in place.
    Future<void> guard(Future<void> Function() command) async {
      refusal.value = null;
      try {
        await command();
      } on AppFailure catch (failure) {
        if (context.mounted) refusal.value = failure.kind;
      }
    }

    return ThreadSurface(
      title: conversation == null || conversation!.title.isEmpty
          ? Strings.untitled
          : conversation!.title,
      actions: [
        SecondaryAction(label: Strings.remove, onPressed: busy ? null : remove),
      ],
      footer: Composer(
        controller: input,
        hint: Strings.composerHint,
        sendLabel: Strings.send,
        stopLabel: Strings.stop,
        busy: busy,
        leading: ActionGroup(
          children: [
            SecondaryAction(
              label: desktop != null
                  ? '${Strings.answerOn}: ${desktop.label}'
                  : chosen == null
                  ? Strings.answerOn
                  : '${Strings.answerOn}: ${chosen.name}',
              onPressed: busy ? null : openModels,
            ),
            SecondaryAction(
              label: Strings.attach,
              onPressed: busy
                  ? null
                  : () => unawaited(() async {
                      attachRefused.value = false;
                      try {
                        await attach();
                      } on AppFailure {
                        if (context.mounted) attachRefused.value = true;
                      }
                    }()),
            ),
            for (final (index, file) in files.indexed)
              SecondaryAction(
                label: Strings.removeFile(file.name),
                onPressed: busy ? null : () => removeFile(index),
              ),
          ],
        ),
        note: _composerNote(
          attachRefused: attachRefused.value,
          allowed: allowed,
          hasFiles: files.isNotEmpty,
          desktop: desktop,
          chosen: chosen,
          disclosed: disclosed,
          readyCount: readyPeers.length,
        ),
        onSend: input.text.trim().isEmpty || !allowed
            ? null
            : () {
                final text = input.text;
                input.clear();
                unawaited(
                  guard(() async {
                    try {
                      await send(text, disclosed);
                    } on AppFailure {
                      // Refused before any attempt: give the draft back.
                      if (input.text.isEmpty) input.text = text;
                      rethrow;
                    }
                  }),
                );
              },
        onStop: () => unawaited(guard(stop)),
      ),
      children: [
        for (final turn in turns)
          if (turn.role == TurnRole.user)
            MessageBubble(
              text: turn.shownText,
              author: Strings.you,
              outgoing: true,
              caption: turn.attachments == null
                  ? null
                  : Strings.attached(turn.attachments!.names),
            )
          else ...[
            MessageBubble(
              text: turn.text,
              author: Strings.assistant,
              failed: turn.phase == AnswerPhase.failed,
              status:
                  turn.phase == AnswerPhase.failed &&
                      turn.failure == FailureKind.forbidden &&
                      desktop != null &&
                      turn.recipient == desktop.participantId
                  ? '${Strings.pairAgain} ${Strings.promptNotSent}'
                  : _turnStatus(turn),
              caption: _turnCaption(turn, models),
              actions: [
                if (identical(turn, turns.last) &&
                    (conversation?.canRecover ?? false))
                  SecondaryAction(
                    label: Strings.checkAnswer,
                    onPressed: recovering.value
                        ? null
                        : () => unawaited(() async {
                            recovering.value = true;
                            recovery.value = null;
                            try {
                              final found = await recover();
                              if (context.mounted) recovery.value = found;
                            } on AppFailure {
                              if (context.mounted) {
                                recovery.value = RecoverResult.notYet;
                              }
                            } finally {
                              if (context.mounted) recovering.value = false;
                            }
                          }()),
                  ),
                if (identical(turn, turns.last) &&
                    (conversation?.canRetry ?? false))
                  SecondaryAction(
                    label: Strings.retryAnswer,
                    onPressed: () => unawaited(guard(() => retry(disclosed))),
                  ),
                if (!turn.inProgress)
                  SecondaryAction(
                    label: detailsOpen.value == turn.id
                        ? Strings.hideDetails
                        : Strings.details,
                    onPressed: () => detailsOpen.value =
                        detailsOpen.value == turn.id ? null : turn.id,
                  ),
              ],
            ),
            if (detailsOpen.value == turn.id)
              ContentCard(
                children: [
                  LabeledValue(
                    label: Strings.identity,
                    value: turn.recipient ?? Strings.unproven,
                  ),
                  // Name the model recorded on this execution attempt, never
                  // whatever the conversation happens to have selected now.
                  if (turn.requestModelId case final model?)
                    LabeledValue(
                      label: Strings.model,
                      value: modelDisplayName(models, model),
                    ),
                  if (turn.attemptId case final attempt?)
                    LabeledValue(label: Strings.attempt, value: attempt),
                  LabeledValue(
                    label: Strings.promptLeft,
                    value: turn.promptSent ? Strings.yes : Strings.no,
                  ),
                  LabeledValue(
                    label: Strings.receipt,
                    value: turn.receiptVerified
                        ? Strings.receiptOk
                        : Strings.receiptNone,
                  ),
                ],
              ),
          ],
        if (recovery.value case final found?
            when found != RecoverResult.answered)
          Notice(
            text: found == RecoverResult.ended
                ? Strings.recoverEnded
                : Strings.recoverNotYet,
          ),
        if (refusal.value case final kind?)
          Notice(
            // Here a conflict can only mean the named computer changed.
            text: kind == FailureKind.conflict
                ? Strings.recipientChanged
                : Strings.failure(kind),
            tone: NoticeTone.warning,
          ),
      ],
    );
  }
}

String _composerNote({
  required bool attachRefused,
  required bool allowed,
  required bool hasFiles,
  required Desktop? desktop,
  required ModelOption? chosen,
  required String? disclosed,
  required int readyCount,
}) {
  if (attachRefused) return Strings.attachLimits;
  if (!allowed) return Strings.discloseOff;
  final String base;
  if (desktop != null) {
    base = desktop.status == DesktopStatus.online
        ? Strings.discloseDesktop(desktop.label)
        : Strings.desktopOffline(desktop.label);
  } else if (chosen != null && !chosen.available) {
    base = Strings.noComputer;
  } else if (disclosed != null) {
    base = readyCount > 1 && !hasFiles
        ? Strings.disclosePool(readyCount, disclosed)
        : Strings.discloseComputer(disclosed);
  } else {
    base = Strings.discloseRemote;
  }
  if (hasFiles &&
      (desktop?.status == DesktopStatus.online || disclosed != null)) {
    return '$base ${Strings.attachDisclosure}';
  }
  return base;
}

String? _turnStatus(Turn turn) => switch (turn.phase) {
  AnswerPhase.finding || AnswerPhase.verifying => Strings.finding,
  AnswerPhase.admitting => Strings.checking(turn.recipient ?? ''),
  AnswerPhase.streaming => Strings.answering,
  AnswerPhase.stopped => Strings.stopped,
  AnswerPhase.failed =>
    '${Strings.failure(turn.failure ?? FailureKind.unexpected)} '
        '${turn.promptSent ? Strings.promptWasSent : Strings.promptNotSent}',
  AnswerPhase.complete || null => null,
};

String? _turnCaption(Turn turn, List<ModelOption> models) {
  final recipient = turn.recipient;
  if (recipient == null) return null;
  if (turn.phase == AnswerPhase.complete) {
    final model = turn.requestModelId == null
        ? null
        : modelDisplayName(models, turn.requestModelId!);
    return Strings.answeredBy(
      recipient,
      verified: turn.receiptVerified,
      model: model,
    );
  }
  return turn.promptSent ? Strings.sentTo(recipient) : null;
}
