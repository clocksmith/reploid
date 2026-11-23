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
      send: (text) => run((r) => r.send(conversationId, text)),
      stop: () => run((r) => r.stop(conversationId)),
      retry: () => run((r) => r.retry(conversationId)),
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
    required this.send,
    required this.stop,
    required this.retry,
    required this.remove,
  });
  final Conversation? conversation;
  final NetworkResource? network;
  final VoidCallback openModels;
  final ValueChanged<String> setDraft;
  final Future<void> Function(String) send;
  final Future<void> Function() stop;
  final Future<void> Function() retry;
  final VoidCallback remove;

  @override
  Widget build(BuildContext context) {
    final input = useTextEditingController(text: conversation?.draft ?? '');
    final hydrated = useRef(conversation != null);
    final refusal = useState<FailureKind?>(null);
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
              .where((c) => c.modelId == chosen.id && c.ready && !c.busy)
              .toList();
    final lastRecipient = turns
        .where((t) => t.role == TurnRole.assistant && t.recipient != null)
        .lastOrNull
        ?.recipient;
    final disclosedPeer =
        readyPeers
            .where(
              (c) => lastRecipient != null && c.participantId == lastRecipient,
            )
            .firstOrNull ??
        readyPeers.where((c) => c.participantId != null).firstOrNull;

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
          ],
        ),
        note: !allowed
            ? Strings.discloseOff
            : desktop != null
            ? desktop.status == DesktopStatus.online
                  ? Strings.discloseDesktop(desktop.label)
                  : Strings.desktopOffline(desktop.label)
            : chosen != null && !chosen.available
            ? Strings.noComputer
            : disclosedPeer != null
            ? readyPeers.length > 1
                  ? Strings.disclosePool(
                      readyPeers.length,
                      disclosedPeer.participantId!,
                    )
                  : Strings.discloseComputer(disclosedPeer.participantId!)
            : Strings.discloseRemote,
        onSend: input.text.trim().isEmpty || !allowed
            ? null
            : () {
                final text = input.text;
                input.clear();
                unawaited(
                  guard(() async {
                    try {
                      await send(text);
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
            MessageBubble(text: turn.text, author: Strings.you, outgoing: true)
          else
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
                    (conversation?.canRetry ?? false))
                  SecondaryAction(
                    label: Strings.retryAnswer,
                    onPressed: () => unawaited(guard(retry)),
                  ),
              ],
            ),
        if (refusal.value case final kind?)
          Notice(text: Strings.failure(kind), tone: NoticeTone.warning),
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
                            label: !computer.ready
                                ? Strings.notReady
                                : computer.busy
                                ? Strings.busy
                                : Strings.ready,
                            highlighted: computer.ready && !computer.busy,
                          ),
                          LabeledValue(
                            label: Strings.identity,
                            value: computer.participantId ?? Strings.unproven,
                          ),
                          LabeledValue(
                            label: Strings.model,
                            value: names[computer.modelId] ?? computer.modelId,
                          ),
                        ],
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({
    super.key,
    required this.session,
    required this.forget,
    this.networkPreference = const NetworkPreference(),
    this.onSaveNetwork,
  });
  final SessionHandle session;
  final VoidCallback forget;
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
        if (onSaveNetwork case final save?)
          _NetworkSettingsCard(initial: networkPreference, onSave: save),
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
