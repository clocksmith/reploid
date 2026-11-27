import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, ValueChanged, ValueKey;
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';
import 'chat_providers.dart';
import 'screen_helpers.dart';

class ComputersScreen extends ConsumerWidget {
  const ComputersScreen({super.key, required this.session});
  final SessionHandle session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(networkProvider);
    final network = ownSession(
      async.asData?.value,
      (v) => v.sessionKey,
      session,
    );
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
              label: networkLabel(network?.status ?? NetworkStatus.offline),
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
