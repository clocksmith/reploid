import 'dart:async';
import 'dart:convert';

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
    final network = ownSession(
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
