import 'dart:async';
import 'dart:convert';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, VoidCallback, ValueChanged, ValueKey;
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';
import 'chat_providers.dart';

/// Values from another session are never rendered, even for one frame.
T? _own<T>(T? value, SessionKey Function(T) key, SessionHandle session) =>
    value != null && key(value) == session.key ? value : null;

String _networkLabel(NetworkStatus status) => switch (status) {
  NetworkStatus.online => Strings.online,
  NetworkStatus.connecting => Strings.connecting,
  NetworkStatus.offline => Strings.offline,
};

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
    final data = _own(async.asData?.value, (v) => v.sessionKey, session);
    final network = _own(
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
              label: _networkLabel(network?.status ?? NetworkStatus.offline),
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
    final resource = _own(
      ref.watch(conversationProvider(conversationId)).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    final network = _own(
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
        note: attachRefused.value
            ? Strings.attachLimits
            : !allowed
            ? Strings.discloseOff
            : files.isNotEmpty && desktop == null && disclosed != null
            ? '${Strings.discloseComputer(disclosed)} '
                  '${Strings.attachDisclosure}'
            : desktop != null
            ? desktop.status == DesktopStatus.online
                  ? Strings.discloseDesktop(desktop.label)
                  : Strings.desktopOffline(desktop.label)
            : chosen != null && !chosen.available
            ? Strings.noComputer
            : disclosed != null
            ? readyPeers.length > 1
                  ? Strings.disclosePool(readyPeers.length, disclosed)
                  : Strings.discloseComputer(disclosed)
            : Strings.discloseRemote,
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
              caption: _turnCaption(turn),
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
                  if (conversation?.modelId case final model?)
                    LabeledValue(
                      label: Strings.model,
                      value:
                          models
                              .where((m) => m.id == model)
                              .firstOrNull
                              ?.name ??
                          model,
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

String? _turnCaption(Turn turn) {
  final recipient = turn.recipient;
  if (recipient == null) return null;
  if (turn.phase == AnswerPhase.complete) {
    return Strings.answeredBy(recipient, verified: turn.receiptVerified);
  }
  return turn.promptSent ? Strings.sentTo(recipient) : null;
}

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
    final network = _own(
      ref.watch(networkProvider).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    final conversation = _own(
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

/// The paired desktop, or the way to pair one.
class _DesktopSection extends ConsumerWidget {
  const _DesktopSection({required this.session, required this.network});
  final SessionHandle session;
  final NetworkResource? network;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final desktop = network?.desktop;
    Future<void> run(Future<void> Function(ChatRepository) command) async {
      final repository = ref.read(chatRepositoryProvider);
      if (repository == null || !session.isActive) return;
      try {
        await command(repository);
      } on AppFailure {
        // The repository publishes why; the section shows it.
      }
    }

    return ContentCard(
      children: [
        const SectionHeading(title: Strings.yourDesktop),
        if (desktop != null && desktop.paired) ...[
          StatusBadge(
            label: desktop.status == DesktopStatus.online
                ? Strings.online
                : Strings.offline,
            highlighted: desktop.status == DesktopStatus.online,
          ),
          BodyCopy(desktop.label),
          LabeledValue(label: Strings.identity, value: desktop.participantId),
          if (desktop.status == DesktopStatus.offline)
            Notice(text: Strings.desktopOffline(desktop.label)),
          const BodyCopy(Strings.unpairDetail),
          SecondaryAction(
            label: Strings.unpair,
            onPressed: () => unawaited(run((r) => r.unpair())),
          ),
        ] else if (desktop != null) ...[
          BodyCopy(desktop.label),
          LabeledValue(label: Strings.identity, value: desktop.participantId),
          Notice(
            text: desktop.status == DesktopStatus.awaitingApproval
                ? Strings.approveOnDesktop
                : Strings.findingDesktop,
          ),
          LabeledValue(
            label: Strings.thisPhone,
            value: session.key.identity.accountId,
          ),
        ] else ...[
          const BodyCopy(Strings.pairIntro),
          if (network?.pairingFailure case final kind?)
            Notice(text: Strings.pairFailure(kind), tone: NoticeTone.warning),
          _PairForm(
            readInvite: (link) =>
                ref.read(chatRepositoryProvider)?.readInvite(link),
            pair: (link) => unawaited(run((r) => r.pair(link))),
          ),
          LabeledValue(
            label: Strings.thisPhone,
            value: session.key.identity.accountId,
          ),
          const BodyCopy(Strings.thisPhoneDetail),
        ],
      ],
    );
  }
}

/// Owns the pasted link. The person first sees which desktop the link
/// names, and only Connect sends anything.
class _PairForm extends HookWidget {
  const _PairForm({required this.readInvite, required this.pair});
  final DesktopInvite? Function(String link) readInvite;
  final ValueChanged<String> pair;

  @override
  Widget build(BuildContext context) {
    final input = useTextEditingController();
    final invite = useState<DesktopInvite?>(null);
    final invalid = useState(false);
    useListenable(input);
    final found = invite.value;
    if (found != null) {
      return Section(
        children: [
          SectionHeading(title: Strings.connectTo(found.label)),
          LabeledValue(label: Strings.identity, value: found.participantId),
          const BodyCopy(Strings.pairWarn),
          ActionGroup(
            children: [
              ActionButton(
                label: Strings.connect,
                pendingLabel: Strings.connect,
                onPressed: () {
                  final link = input.text;
                  // The code is single use; it is not kept on screen.
                  input.clear();
                  invite.value = null;
                  pair(link);
                },
              ),
              SecondaryAction(
                label: Strings.cancel,
                onPressed: () {
                  input.clear();
                  invite.value = null;
                },
              ),
            ],
          ),
        ],
      );
    }
    return Section(
      children: [
        NoteInput(
          controller: input,
          label: Strings.pairingLink,
          hint: Strings.pairingLinkHint,
        ),
        if (invalid.value)
          const Notice(text: Strings.invalidLink, tone: NoticeTone.warning),
        ActionButton(
          label: Strings.pairCheck,
          pendingLabel: Strings.pairCheck,
          onPressed: input.text.trim().isEmpty
              ? null
              : () {
                  final read = readInvite(input.text);
                  invalid.value = read == null;
                  invite.value = read;
                },
        ),
      ],
    );
  }
}

class ComputersScreen extends ConsumerWidget {
  const ComputersScreen({super.key, required this.session});
  final SessionHandle session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(networkProvider);
    final network = _own(async.asData?.value, (v) => v.sessionKey, session);
    final names = {
      for (final model in network?.models ?? const <ModelOption>[])
        model.id: model.name,
    };
    return PageSurface(
      title: Strings.computers,
      children: [
        _DesktopSection(session: session, network: network),
        const SectionHeading(
          title: Strings.networkHeading,
          description: Strings.networkDetail,
        ),
        ActionGroup(
          children: [
            StatusBadge(
              label: _networkLabel(network?.status ?? NetworkStatus.offline),
              highlighted: network?.status == NetworkStatus.online,
            ),
            SecondaryAction(
              label: Strings.reconnect,
              onPressed: network?.status == NetworkStatus.connecting
                  ? null
                  : () => unawaited(
                      ref.read(chatRepositoryProvider)?.reconnect(),
                    ),
            ),
          ],
        ),
        AsyncContent(
          loadingLabel: Strings.loading,
          emptyLabel: Strings.noComputers,
          retryLabel: Strings.reconnect,
          loading: network == null && async.isLoading,
          errorMessage: network?.failure == null
              ? null
              : Strings.failure(network!.failure!),
          onRetry: () =>
              unawaited(ref.read(chatRepositoryProvider)?.reconnect()),
          content: network == null || network.computers.isEmpty
              ? null
              : Section(
                  children: [
                    for (final computer in network.computers)
                      ContentCard(
                        children: [
                          StatusBadge(
                            label: computer.blocked
                                ? Strings.blockedLabel
                                : !computer.ready
                                ? Strings.notReady
                                : computer.busy
                                ? Strings.busy
                                : Strings.ready,
                            highlighted:
                                computer.ready &&
                                !computer.busy &&
                                !computer.blocked,
                          ),
                          if (computer.label case final label?) BodyCopy(label),
                          LabeledValue(
                            label: Strings.identity,
                            value: computer.participantId ?? Strings.unproven,
                          ),
                          LabeledValue(
                            label: Strings.model,
                            value: names[computer.modelId] ?? computer.modelId,
                          ),
                          if (computer.participantId case final id?)
                            _NameForm(
                              key: ValueKey('name-$id'),
                              initial: computer.label ?? '',
                              save: (name) => unawaited(
                                ref
                                    .read(chatRepositoryProvider)
                                    ?.renameComputer(id, name)
                                    .catchError((Object _) {}),
                              ),
                            ),
                          SecondaryAction(
                            label: computer.blocked
                                ? Strings.unblock
                                : Strings.block,
                            onPressed: () {
                              final repository = ref.read(
                                chatRepositoryProvider,
                              );
                              unawaited(
                                computer.blocked
                                    ? repository?.unblockComputer(
                                        computer.participantId ??
                                            computer.address,
                                      )
                                    : repository?.blockComputer(computer),
                              );
                            },
                          ),
                        ],
                      ),
                  ],
                ),
        ),
        if (network != null && network.blockedComputers.isNotEmpty) ...[
          const SectionHeading(
            title: Strings.blockedHeading,
            description: Strings.blockedDetail,
          ),
          for (final blocked in network.blockedComputers)
            ContentCard(
              children: [
                if (blocked.label case final label?) BodyCopy(label),
                LabeledValue(label: Strings.identity, value: blocked.id),
                SecondaryAction(
                  label: Strings.unblock,
                  onPressed: () => unawaited(
                    ref
                        .read(chatRepositoryProvider)
                        ?.unblockComputer(blocked.id),
                  ),
                ),
              ],
            ),
        ],
      ],
    );
  }
}

class _NameForm extends HookWidget {
  const _NameForm({super.key, required this.initial, required this.save});
  final String initial;
  final ValueChanged<String> save;

  @override
  Widget build(BuildContext context) {
    final input = useTextEditingController(text: initial);
    useListenable(input);
    return Section(
      children: [
        NoteInput(
          controller: input,
          label: Strings.computerName,
          hint: Strings.computerNameHint,
        ),
        SecondaryAction(
          label: Strings.saveName,
          onPressed: input.text.trim() == initial.trim()
              ? null
              : () => save(input.text),
        ),
      ],
    );
  }
}

/// Export and import of this phone's conversations and computer preferences.
class _DataCard extends HookWidget {
  const _DataCard({required this.session, required this.ref});
  final SessionHandle session;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final status = useState<String?>(null);
    final preview = useState<ImportPreview?>(null);

    Future<void> guarded(Future<void> Function() work) async {
      status.value = null;
      try {
        await work();
      } on AppFailure catch (failure) {
        if (context.mounted) {
          status.value = failure.kind == FailureKind.validation
              ? Strings.importInvalid
              : Strings.dataFailed;
        }
      } catch (_) {
        if (context.mounted) status.value = Strings.dataFailed;
      }
    }

    final plan = preview.value;
    return ContentCard(
      children: [
        const SectionHeading(
          title: Strings.yourData,
          description: Strings.yourDataDetail,
        ),
        if (plan != null) ...[
          BodyCopy(
            Strings.importSummary(
              plan.conversations,
              plan.names,
              plan.blocked,
              plan.conversationsSkipped +
                  plan.namesSkipped +
                  plan.blockedSkipped,
            ),
          ),
          const BodyCopy(Strings.importNote),
          ActionGroup(
            children: [
              ActionButton(
                label: Strings.importConfirm,
                pendingLabel: Strings.importConfirm,
                onPressed: () => unawaited(
                  guarded(() async {
                    final repository = ref.read(chatRepositoryProvider);
                    if (repository == null || !session.isActive) return;
                    final done = await repository.confirmImport();
                    if (!context.mounted) return;
                    preview.value = null;
                    status.value = Strings.imported(
                      done.conversations,
                      done.names,
                      done.blocked,
                    );
                  }),
                ),
              ),
              SecondaryAction(
                label: Strings.cancel,
                onPressed: () {
                  ref.read(chatRepositoryProvider)?.cancelImport();
                  preview.value = null;
                },
              ),
            ],
          ),
        ] else
          ActionGroup(
            children: [
              SecondaryAction(
                label: Strings.exportData,
                onPressed: () => unawaited(
                  guarded(() async {
                    final repository = ref.read(chatRepositoryProvider);
                    if (repository == null || !session.isActive) return;
                    final file = await repository.exportData();
                    final saved = await ref
                        .read(documentPickerProvider)
                        .save('reploid-data.json', file.text);
                    if (saved && context.mounted) {
                      status.value = Strings.exported(
                        file.conversations,
                        file.omitted,
                      );
                    }
                  }),
                ),
              ),
              SecondaryAction(
                label: Strings.importData,
                onPressed: () => unawaited(
                  guarded(() async {
                    final picked = await ref
                        .read(documentPickerProvider)
                        .pickDataFile();
                    if (picked == null) return;
                    final repository = ref.read(chatRepositoryProvider);
                    if (repository == null || !session.isActive) return;
                    final String text;
                    try {
                      text = utf8.decode(picked.bytes);
                    } on FormatException {
                      throw const AppFailure(FailureKind.validation);
                    }
                    final next = await repository.previewImport(text);
                    if (!context.mounted) return;
                    if (next.empty) {
                      repository.cancelImport();
                      status.value = Strings.importNothing;
                    } else {
                      preview.value = next;
                    }
                  }),
                ),
              ),
            ],
          ),
        if (status.value case final text?) Notice(text: text),
      ],
    );
  }
}

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({
    super.key,
    required this.session,
    required this.forget,
    this.appearance = Appearance.system,
    this.onAppearance,
    this.networkPreference = const NetworkPreference(),
    this.onSaveNetwork,
  });
  final SessionHandle session;
  final VoidCallback forget;
  final Appearance appearance;
  final ValueChanged<Appearance>? onAppearance;
  final NetworkPreference networkPreference;
  final ValueChanged<NetworkPreference>? onSaveNetwork;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final network = _own(
      ref.watch(networkProvider).asData?.value,
      (v) => v.sessionKey,
      session,
    );
    return PageSurface(
      title: Strings.settings,
      children: [
        ContentCard(
          children: [
            SwitchRow(
              label: Strings.allowNetwork,
              description: Strings.allowNetworkDetail,
              value: network?.networkAnswersAllowed ?? true,
              onChanged: network == null
                  ? null
                  : (value) => unawaited(
                      ref
                          .read(chatRepositoryProvider)
                          ?.setNetworkAnswersAllowed(value),
                    ),
            ),
          ],
        ),
        if (onAppearance case final choose?)
          ContentCard(
            children: [
              const SectionHeading(title: Strings.appearance),
              for (final (choice, label) in const [
                (Appearance.system, Strings.appearanceSystem),
                (Appearance.light, Strings.appearanceLight),
                (Appearance.dark, Strings.appearanceDark),
              ])
                ChoiceTile(
                  title: label,
                  selected: appearance == choice,
                  onPressed: () => choose(choice),
                ),
            ],
          ),
        if (onSaveNetwork case final save?)
          _NetworkSettingsCard(initial: networkPreference, onSave: save),
        _DataCard(session: session, ref: ref),
        ContentCard(
          children: [
            const SectionHeading(title: Strings.thisDevice),
            const BodyCopy(Strings.thisDeviceDetail),
            LabeledValue(
              label: Strings.identity,
              value: session.key.identity.accountId,
            ),
            const BodyCopy(Strings.forgetDetail),
            SecondaryAction(label: Strings.forget, onPressed: forget),
          ],
        ),
      ],
    );
  }
}

class _NetworkSettingsCard extends HookWidget {
  const _NetworkSettingsCard({required this.initial, required this.onSave});
  final NetworkPreference initial;
  final ValueChanged<NetworkPreference> onSave;

  @override
  Widget build(BuildContext context) {
    final mode = useState(initial.mode);
    final url = useTextEditingController(text: initial.signalingUrl);
    final room = useTextEditingController(text: initial.roomId);
    final token = useTextEditingController(text: initial.token);
    final rtcUrl = useTextEditingController(text: initial.rtcConfigUrl);
    final invalid = useState(false);

    useEffect(() {
      mode.value = initial.mode;
      if (url.text != initial.signalingUrl) url.text = initial.signalingUrl;
      if (room.text != initial.roomId) room.text = initial.roomId;
      if (token.text != initial.token) token.text = initial.token;
      if (rtcUrl.text != initial.rtcConfigUrl) {
        rtcUrl.text = initial.rtcConfigUrl;
      }
      invalid.value = false;
      return null;
    }, [initial]);

    void apply(NetworkPreference candidate) {
      if (!candidate.isValid) {
        invalid.value = true;
        return;
      }
      invalid.value = false;
      onSave(candidate);
    }

    return ContentCard(
      children: [
        const SectionHeading(
          title: Strings.networkSettings,
          description: Strings.networkSettingsDetail,
        ),
        ChoiceTile(
          title: Strings.networkModeDemo,
          detail: Strings.networkModeDemoDetail,
          selected: mode.value == NetworkMode.demo,
          onPressed: () {
            mode.value = NetworkMode.demo;
            apply(const NetworkPreference(mode: NetworkMode.demo));
          },
        ),
        ChoiceTile(
          title: Strings.networkModePublic,
          detail: Strings.networkModePublicDetail,
          selected: mode.value == NetworkMode.public,
          onPressed: () {
            mode.value = NetworkMode.public;
            apply(const NetworkPreference(mode: NetworkMode.public));
          },
        ),
        ChoiceTile(
          title: Strings.networkModeRoom,
          detail: Strings.networkModeRoomDetail,
          selected: mode.value == NetworkMode.room,
          onPressed: () {
            mode.value = NetworkMode.room;
            invalid.value = false;
          },
        ),
        if (mode.value == NetworkMode.room) ...[
          NoteInput(
            controller: url,
            label: Strings.signalingUrl,
            hint: Strings.signalingUrlHint,
          ),
          NoteInput(
            controller: room,
            label: Strings.roomId,
            hint: Strings.roomIdHint,
          ),
          NoteInput(
            controller: token,
            label: Strings.roomToken,
            hint: Strings.roomTokenHint,
          ),
          NoteInput(
            controller: rtcUrl,
            label: Strings.rtcConfigUrl,
            hint: Strings.rtcConfigUrlHint,
          ),
          if (invalid.value)
            const Notice(
              text: Strings.networkInvalid,
              tone: NoticeTone.warning,
            ),
          ActionButton(
            label: Strings.applyNetwork,
            pendingLabel: Strings.applyNetwork,
            onPressed: () => apply(
              NetworkPreference(
                mode: NetworkMode.room,
                signalingUrl: url.text.trim(),
                roomId: room.text.trim(),
                token: token.text.trim(),
                origin: initial.origin,
                rtcConfigUrl: rtcUrl.text.trim(),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
