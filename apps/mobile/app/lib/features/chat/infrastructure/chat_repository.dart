import 'dart:async';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/contract.g.dart';
import '../domain/chat.dart';
import 'attachments.dart';
import 'computer_preferences.dart';
import 'conversation_archive.dart';
import 'local_data.dart';
import 'preferences_store.dart';
import 'requester_api.dart';

final class _Thread {
  _Thread(this.id);
  final String id;
  String title = '';
  String draft = '';
  String? modelId;
  String? modelName;
  String? modelIdentity;
  AnswerTarget? target;
  List<AttachedFile> draftFiles = const [];
  final List<Turn> turns = [];
  Answer? answer;
  StreamSubscription<AnswerEvent>? subscription;
  Completer<void>? running;
  Future<RecoverResult>? recovering;
  bool stopping = false;
}

/// Conversations and network state for one session, kept in memory only.
///
/// The network connection opens with the first reader or the first prompt
/// and then stays open for the session: an answer needs peers that were
/// already discovered, so dropping it between screens would cost every
/// prompt a fresh discovery. It closes with the session.
final class SessionChatRepository implements ChatRepository {
  SessionChatRepository({
    required this.session,
    required this.api,
    required this.newId,
    this.archive,
    this.preferences,
    this.computerPreferences,
    this.participantId = '',
    DateTime Function()? now,
    this.diagnostics = const Diagnostics(),
  }) : _now = now ?? DateTime.now {
    session.registerCleanup(close);
    if (archive != null || preferences != null || computerPreferences != null) {
      _restoring = _restore();
    }
  }

  final SessionHandle session;
  final RequesterApi api;
  final String Function() newId;

  /// Where conversations are kept between runs; none keeps them in memory.
  final ConversationArchive? archive;

  /// Where per-identity settings (such as Allow network answers) persist.
  final DevicePreferencesStore? preferences;

  /// Where names and blocks for computers persist.
  final ComputerPreferencesStore? computerPreferences;

  /// This device's identity, written into exported data files.
  final String participantId;
  final DateTime Function() _now;
  final Diagnostics diagnostics;
  Future<void>? _restoring;
  bool _restored = false;
  bool _prefsRestored = false;
  bool _allowedExplicitlySet = false;
  ComputerPreferences _computers = const ComputerPreferences();

  /// A stored block list that cannot be read must not become an empty one:
  /// contributors are refused until this device is forgotten.
  bool _blocksUnreadable = false;
  LocalDataPlan? _pendingImport;
  Future<void> _saved = Future.value();
  bool _saveQueued = false;

  final _events = StreamController<void>.broadcast();
  final Map<String, _Thread> _threads = {};
  NetworkSnapshot _network = NetworkSnapshot(
    status: NetworkStatus.offline,
    computers: const [],
  );
  StreamSubscription<NetworkSnapshot>? _networkSubscription;
  FailureKind? _networkFailure;
  FailureKind? _pairingFailure;
  bool _connecting = false;
  bool _allowed = true;
  bool _closed = false;
  Future<void>? _closing;
  int _subscribers = 0;

  int get subscriberCount => _subscribers;
  bool get isClosed => _closed;
  bool get _active => !_closed && session.isActive;

  void _checkActive() {
    session.requireActive();
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
  }

  void _emit() {
    if (_active) _events.add(null);
  }

  Stream<T> _watch<T>(T Function() snapshot, [void Function()? ensure]) =>
      Stream.multi((controller) {
        if (!_active) {
          controller.closeSync();
          return;
        }
        _subscribers++;
        final subscription = _events.stream.listen((_) {
          if (_active) controller.addSync(snapshot());
        }, onDone: controller.closeSync);
        controller.onCancel = () async {
          _subscribers--;
          await subscription.cancel();
        };
        ensure?.call();
        controller.addSync(snapshot());
      });

  // Persistence ---------------------------------------------------------------

  /// Brings back this identity's settings and conversations. Ones made while
  /// loading stay, after the restored ones.
  Future<void> _restore() async {
    if (computerPreferences != null) {
      try {
        final stored = await computerPreferences!.read();
        if (_active) {
          _computers = ComputerPreferences(
            names: {...stored.names, ..._computers.names},
            blocked: {...stored.blocked, ..._computers.blocked}.toList(),
          );
          api.setBlocked(_computers.blocked.toSet());
          _emit();
        }
      } catch (_) {
        _blocksUnreadable = true;
      }
    }
    if (preferences != null) {
      try {
        final allowed = await preferences!.readNetworkAnswersAllowed();
        if (_active && !_allowedExplicitlySet) {
          _allowed = allowed;
          _emit();
        }
      } catch (_) {
        // Fail closed when persisted privacy setting cannot be read.
        if (_active && !_allowedExplicitlySet) {
          _allowed = false;
          _emit();
        }
      } finally {
        _prefsRestored = true;
      }
    } else {
      _prefsRestored = true;
    }
    if (archive == null) return;
    final List<ArchivedConversation> stored;
    try {
      stored = await archive!.load();
    } catch (_) {
      return; // unreadable storage: nothing is written over it this run
    }
    if (!_active) return;
    _restored = true;
    if (stored.isEmpty) return;
    final made = Map.of(_threads);
    _threads.clear();
    for (final conversation in stored) {
      if (made.containsKey(conversation.id)) continue;
      _threads[conversation.id] = _Thread(conversation.id)
        ..title = conversation.title
        ..modelId = conversation.modelId
        ..modelName = conversation.modelName
        ..modelIdentity = conversation.modelIdentity
        ..target = conversation.target
        ..turns.addAll(conversation.turns.map(_withDisplay));
    }
    _threads.addAll(made);
    _emit();
  }

  static Turn _withDisplay(Turn turn) {
    if (turn.role != TurnRole.user) return turn;
    final shown = readAttachmentDisplay(turn.text);
    return shown == null ? turn : turn.copyWith(attachments: shown);
  }

  /// Writes the current conversations, once, after any write under way.
  /// Text still streaming in is written when its answer ends.
  void _persist() {
    if (archive == null || _saveQueued || _closed) return;
    _saveQueued = true;
    _saved = _saved.then((_) async {
      await _restoring;
      _saveQueued = false;
      if (!_closed) await _write(_snapshot());
    });
  }

  List<ArchivedConversation> _snapshot() => [
    for (final thread in _threads.values)
      if (thread.turns.isNotEmpty)
        ArchivedConversation(
          id: thread.id,
          title: thread.title,
          modelId: thread.modelId,
          modelName: thread.modelName,
          modelIdentity: thread.modelIdentity,
          target: thread.target,
          turns: List.of(thread.turns),
        ),
  ];

  /// Never writes before the stored conversations were read: an early
  /// write would replace them with whatever this run has so far.
  Future<void> _write(List<ArchivedConversation> conversations) async {
    if (archive == null || !_restored) return;
    try {
      await archive!.save(conversations);
    } catch (_) {
      // A failed write loses durability, not the conversation in memory.
    }
  }

  /// Completes when everything queued so far is on disk. For tests and for
  /// an orderly shutdown.
  Future<void> get saved => _saved;

  // Network -----------------------------------------------------------------

  NetworkResource _networkResource() {
    final computers = [
      for (final computer in _network.computers)
        computer.withPreferences(
          label: _computers.names[computer.participantId],
          blocked:
              _computers.blocked.contains(computer.address) ||
              _computers.blocked.contains(computer.participantId),
        ),
    ];
    return NetworkResource(
      sessionKey: session.key,
      status: _connecting && _network.status == NetworkStatus.offline
          ? NetworkStatus.connecting
          : _network.status,
      models: [
        for (final model in api.catalog)
          ModelOption(
            id: model.id,
            name: model.name,
            readyComputers: computers
                .where(
                  (c) =>
                      c.modelId == model.id && c.ready && !c.busy && !c.blocked,
                )
                .length,
            busyComputers: computers
                .where(
                  (c) =>
                      c.modelId == model.id && c.ready && c.busy && !c.blocked,
                )
                .length,
          ),
      ],
      computers: computers,
      blockedComputers: [
        for (final id in _computers.blocked)
          BlockedComputer(id: id, label: _computers.names[id]),
      ],
      networkAnswersAllowed: _allowed,
      desktop: _network.desktop,
      pairingFailure: _pairingFailure,
      failure: _networkFailure,
    );
  }

  void _ensureOpen() {
    if (_networkSubscription != null || !_active) return;
    _networkSubscription = api.watch().listen((snapshot) {
      if (!_active) return;
      _network = snapshot;
      _emit();
    });
    unawaited(reconnect());
  }

  @override
  Stream<NetworkResource> watchNetwork() =>
      _watch(_networkResource, _ensureOpen);

  @override
  Future<void> reconnect() async {
    _checkActive();
    if (_connecting) return;
    _connecting = true;
    _networkFailure = null;
    _emit();
    try {
      await api.open();
    } catch (error) {
      if (_active) _networkFailure = _kind(error);
    } finally {
      _connecting = false;
      _emit();
    }
  }

  @override
  Future<void> setNetworkAnswersAllowed(bool allowed) async {
    _checkActive();
    _allowedExplicitlySet = true;
    _allowed = allowed;
    _emit();
    await preferences?.writeNetworkAnswersAllowed(allowed);
  }

  // The paired desktop -------------------------------------------------------

  @override
  DesktopInvite? readInvite(String link) => api.readInvite(link);

  @override
  Future<void> pair(String link) async {
    _checkActive();
    _pairingFailure = null;
    _ensureOpen();
    _emit();
    try {
      await api.pair(link);
    } catch (error) {
      if (_active) _pairingFailure = _kind(error);
      rethrow;
    } finally {
      await _refreshNetwork();
    }
  }

  @override
  Future<void> unpair() async {
    _checkActive();
    _pairingFailure = null;
    await api.unpair();
    await _refreshNetwork();
  }

  /// Reads the adapter's state now, so a caller that awaited a pairing
  /// sees its result at once and not one event later.
  Future<void> _refreshNetwork() async {
    if (!_active) return;
    final snapshot = await api.watch().first;
    if (!_active) return;
    _network = snapshot;
    _emit();
  }

  /// A conversation with no choice of its own answers on the desktop when
  /// one is paired. A conversation whose desktop is gone falls back only
  /// because there is no desktop to ask, never while one is merely offline.
  AnswerTarget _target(_Thread thread) {
    final paired = _network.desktop?.paired ?? false;
    final chosen = thread.target;
    if (!paired) return AnswerTarget.contributors;
    return chosen ?? AnswerTarget.desktop;
  }

  @override
  void selectTarget(String id, AnswerTarget target) {
    _checkActive();
    final thread = _require(id);
    if (thread.running != null) throw const AppFailure(FailureKind.conflict);
    if (target == AnswerTarget.desktop &&
        !(_network.desktop?.paired ?? false)) {
      throw const AppFailure(FailureKind.validation);
    }
    thread.target = target;
    _persist();
    _emit();
  }

  // Conversations -----------------------------------------------------------

  Conversation _conversation(_Thread thread) => Conversation(
    id: thread.id,
    title: thread.title,
    modelId: thread.modelId,
    turns: thread.turns,
    target: _target(thread),
    draft: thread.draft,
    nextRecipient: _nextRecipient(thread),
    draftFiles: thread.draftFiles,
  );

  /// The conversation's model, or the default when an imported conversation
  /// names one this app does not offer. The screen shows the same choice.
  String? _usableModel(_Thread thread) {
    final id = thread.modelId;
    return id != null && api.catalog.any((model) => model.id == id)
        ? id
        : _defaultModel();
  }

  String? _nextRecipient(_Thread thread) {
    if (_target(thread) != AnswerTarget.contributors) return null;
    final modelId = _usableModel(thread);
    return modelId == null
        ? null
        : api.nextRecipient(modelId: modelId, contextId: thread.id);
  }

  /// The prompt goes only to the computer the person was shown.
  void _requireDisclosed(_Thread thread, String? disclosed) {
    if (disclosed != null && _nextRecipient(thread) != disclosed) {
      throw const AppFailure(FailureKind.conflict);
    }
  }

  @override
  Stream<ConversationListResource> watchList() => _watch(
    () => ConversationListResource(
      sessionKey: session.key,
      conversations: _threads.values
          .map(_conversation)
          .toList()
          .reversed
          .toList(),
    ),
  );

  @override
  Stream<ConversationResource> watch(String id) => _watch(() {
    final thread = _threads[id];
    return ConversationResource(
      sessionKey: session.key,
      conversation: thread == null ? null : _conversation(thread),
    );
  }, _ensureOpen);

  @override
  String create() {
    _checkActive();
    final thread = _Thread(newId());
    _threads[thread.id] = thread;
    _emit();
    return thread.id;
  }

  @override
  void remove(String id) {
    _checkActive();
    final thread = _threads.remove(id);
    if (thread == null) return;
    unawaited(_cancel(thread));
    _persist();
    _emit();
  }

  @override
  void selectModel(String id, String modelId) {
    _checkActive();
    final thread = _require(id);
    if (thread.running != null) throw const AppFailure(FailureKind.conflict);
    if (!api.catalog.any((model) => model.id == modelId)) {
      throw const AppFailure(FailureKind.validation);
    }
    thread
      ..modelId = modelId
      ..modelName = null
      ..modelIdentity = null;
    _persist();
    _emit();
  }

  @override
  void setDraft(String id, String text) {
    _checkActive();
    final thread = _threads[id];
    if (thread == null || thread.draft == text) return;
    thread.draft = text;
    _emit();
  }

  @override
  void addAttachments(String id, List<PickedFile> files) {
    _checkActive();
    final thread = _require(id);
    if (thread.running != null) throw const AppFailure(FailureKind.conflict);
    thread.draftFiles = [
      ...thread.draftFiles,
      ...readAttachments(files, thread.draftFiles),
    ];
    _emit();
  }

  @override
  void removeAttachment(String id, int index) {
    _checkActive();
    final thread = _require(id);
    if (index < 0 || index >= thread.draftFiles.length) return;
    thread.draftFiles = [...thread.draftFiles]..removeAt(index);
    _emit();
  }

  // Computers -----------------------------------------------------------------

  Future<void> _saveComputers(ComputerPreferences next) async {
    _computers = next;
    api.setBlocked(next.blocked.toSet());
    _emit();
    await computerPreferences?.write(next);
  }

  @override
  Future<void> renameComputer(String participantId, String name) async {
    _checkActive();
    await _restoring;
    final trimmed = name.trim();
    final names = {..._computers.names};
    if (trimmed.isEmpty) {
      names.remove(participantId);
    } else {
      if (!validComputerName(participantId, trimmed) ||
          (!names.containsKey(participantId) &&
              names.length >= Contract.localDataMaxComputerNames)) {
        throw const AppFailure(FailureKind.validation);
      }
      names[participantId] = trimmed;
    }
    await _saveComputers(
      ComputerPreferences(names: names, blocked: _computers.blocked),
    );
  }

  @override
  Future<void> blockComputer(Computer computer) async {
    _checkActive();
    await _restoring;
    // The signing identity survives a reconnect; a connection name does not.
    final id = computer.participantId ?? computer.address;
    if (_computers.blocked.contains(id)) return;
    if (!validComputerId(id) ||
        _computers.blocked.length >= Contract.localDataMaxBlocked) {
      throw const AppFailure(FailureKind.validation);
    }
    await _saveComputers(
      ComputerPreferences(
        names: _computers.names,
        blocked: [..._computers.blocked, id],
      ),
    );
  }

  @override
  Future<void> unblockComputer(String id) async {
    _checkActive();
    await _restoring;
    await _saveComputers(
      ComputerPreferences(
        names: _computers.names,
        blocked: [
          for (final item in _computers.blocked)
            if (item != id) item,
        ],
      ),
    );
  }

  // Your data -----------------------------------------------------------------

  @override
  Future<DataExport> exportData() async {
    _checkActive();
    await _restoring;
    _checkActive();
    final conversations = _snapshot();
    final encoded = encodeLocalData(
      participantId: participantId,
      conversations: conversations,
      catalog: api.catalog,
      names: _computers.names,
      blocked: _computers.blocked,
      now: _now(),
    );
    return DataExport(
      text: encoded.file,
      conversations: conversations.length - encoded.omitted,
      omitted: encoded.omitted,
    );
  }

  @override
  Future<ImportPreview> previewImport(String text) async {
    _checkActive();
    await _restoring;
    _checkActive();
    // History that could not be read must not be overwritten by a save.
    if (archive != null && !_restored) {
      throw const AppFailure(FailureKind.unavailable);
    }
    final plan = readLocalData(
      text,
      knownConversations: _threads.keys.toSet(),
      knownNames: _computers.names,
      knownBlocked: _computers.blocked.toSet(),
    );
    _pendingImport = plan;
    return plan.preview;
  }

  @override
  void cancelImport() => _pendingImport = null;

  @override
  Future<ImportPreview> confirmImport() async {
    _checkActive();
    final plan = _pendingImport;
    if (plan == null) throw const AppFailure(FailureKind.validation);
    _pendingImport = null;
    for (final conversation in plan.conversations) {
      if (_threads.containsKey(conversation.id)) continue;
      _threads[conversation.id] = _Thread(conversation.id)
        ..title = conversation.title
        ..modelId = conversation.modelId
        ..modelName = conversation.modelName
        ..modelIdentity = conversation.modelIdentity
        ..turns.addAll(conversation.turns.map(_withDisplay));
    }
    if (plan.names.isNotEmpty || plan.blocked.isNotEmpty) {
      await _saveComputers(
        ComputerPreferences(
          names: {...plan.names, ..._computers.names},
          blocked: {..._computers.blocked, ...plan.blocked}.toList(),
        ),
      );
    }
    _persist();
    _emit();
    await _saved;
    return plan.preview;
  }

  @override
  Future<void> flush() async {
    if (_closed) return;
    _persist();
    await _saved;
  }

  _Thread _require(String id) =>
      _threads[id] ?? (throw const AppFailure(FailureKind.validation));

  String? _defaultModel() {
    final models = _networkResource().models;
    return (models.where((m) => m.available).firstOrNull ?? models.firstOrNull)
        ?.id;
  }

  @override
  Future<void> send(String id, String text, {String? disclosedRecipient}) {
    _checkActive();
    final thread = _require(id);
    // A second tap joins the answer already under way; it never sends twice.
    if (thread.running case final running?) return running.future;
    if (thread.recovering != null) {
      throw const AppFailure(FailureKind.unavailable);
    }
    final prompt = text.trim();
    if (prompt.isEmpty) throw const AppFailure(FailureKind.validation);
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    if ((preferences != null || computerPreferences != null) &&
        !_prefsRestored) {
      return _sendAfterRestore(thread, prompt, disclosedRecipient);
    }
    return _acceptPrompt(thread, prompt, disclosedRecipient);
  }

  Future<void> _sendAfterRestore(
    _Thread thread,
    String prompt,
    String? disclosed,
  ) async {
    await _restoring;
    _checkActive();
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    return _acceptPrompt(thread, prompt, disclosed);
  }

  void _requireReadableBlocks(_Thread thread) {
    if (_blocksUnreadable && _target(thread) == AnswerTarget.contributors) {
      throw const AppFailure(FailureKind.forbidden);
    }
  }

  Future<void> _acceptPrompt(_Thread thread, String prompt, String? disclosed) {
    _requireReadableBlocks(thread);
    _requireDisclosed(thread, disclosed);
    // The destination is fixed when the prompt is sent and kept with the
    // conversation; pairing or unpairing later does not move it.
    thread.target ??= _target(thread);
    final modelId = _usableModel(thread);
    if (modelId == null) throw const AppFailure(FailureKind.unavailable);
    thread.modelId = modelId;
    thread.draft = '';
    final content = attachmentInput(prompt, thread.draftFiles);
    thread.draftFiles = const [];
    if (thread.title.isEmpty) {
      thread.title = prompt.length > 48
          ? '${prompt.substring(0, 48)}…'
          : prompt;
    }
    thread.turns.add(
      _withDisplay(Turn(id: newId(), role: TurnRole.user, text: content)),
    );
    return _start(thread, modelId, disclosed);
  }

  @override
  Future<void> retry(String id, {String? disclosedRecipient}) {
    _checkActive();
    final thread = _require(id);
    if (thread.running case final running?) return running.future;
    if (thread.recovering != null) {
      throw const AppFailure(FailureKind.unavailable);
    }
    if (!_conversation(thread).canRetry) {
      throw const AppFailure(FailureKind.validation);
    }
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    _requireReadableBlocks(thread);
    _requireDisclosed(thread, disclosedRecipient);
    final modelId = _usableModel(thread);
    if (modelId == null) throw const AppFailure(FailureKind.unavailable);
    thread.modelId = modelId;
    thread.turns.removeLast();
    return _start(thread, modelId, disclosedRecipient);
  }

  /// The prompt messages for an answer that follows [turns].
  static List<PromptMessage> _promptMessages(Iterable<Turn> turns) => [
    for (final turn in turns)
      if (turn.role == TurnRole.user ||
          (turn.phase == AnswerPhase.complete && turn.text.isNotEmpty))
        PromptMessage(turn.role, turn.text),
  ];

  @override
  Future<RecoverResult> recover(String id) {
    _checkActive();
    final thread = _require(id);
    if (thread.recovering case final recovering?) return recovering;
    if (thread.running != null || !_conversation(thread).canRecover) {
      throw const AppFailure(FailureKind.validation);
    }
    final lost = thread.turns.last;
    _ensureOpen();
    Future<RecoverResult> ask() async {
      try {
        final found = await api.recover(
          requestId: lost.requestId!,
          modelId: lost.requestModelId!,
          messages: _promptMessages(thread.turns.take(thread.turns.length - 1)),
          recipient: lost.recipient!,
        );
        if (!_active || thread.turns.lastOrNull?.id != lost.id) {
          return RecoverResult.notYet;
        }
        switch (found.result) {
          case RecoverResult.answered:
            thread.turns.last = lost.recovered(found.text!);
          case RecoverResult.ended:
            thread.turns.last = lost.copyWith(recoverable: false);
          case RecoverResult.notYet:
            break;
        }
        if (found.result != RecoverResult.notYet) _persist();
        return found.result;
      } finally {
        thread.recovering = null;
        _emit();
      }
    }

    return thread.recovering = ask();
  }

  Future<void> _start(_Thread thread, String modelId, String? disclosed) {
    _ensureOpen();
    final messages = _promptMessages(thread.turns);
    final answerId = newId();
    thread.turns.add(
      Turn(
        id: answerId,
        role: TurnRole.assistant,
        text: '',
        phase: AnswerPhase.finding,
        attemptId: newId(),
      ),
    );
    _persist();
    final running = thread.running = Completer<void>();
    thread.stopping = false;
    final answer = thread.answer = api.ask(
      modelId: modelId,
      messages: messages,
      contextId: thread.id,
      target: _target(thread),
      expectedRecipient: _target(thread) == AnswerTarget.contributors
          ? disclosed
          : null,
    );
    _emit();

    void update(Turn Function(Turn) change) {
      if (!_active || !identical(thread.running, running)) return;
      final index = thread.turns.indexWhere((turn) => turn.id == answerId);
      if (index < 0) return;
      thread.turns[index] = change(thread.turns[index]);
      _emit();
    }

    void finish(AnswerPhase phase, {FailureKind? failure}) {
      if (!identical(thread.running, running)) return;
      update((turn) => turn.copyWith(phase: phase, failure: failure));
      thread.running = null;
      thread.answer = null;
      thread.subscription = null;
      diagnostics.record(
        DiagnosticEvent(
          operation: DiagnosticOperation.submit,
          outcome: switch (phase) {
            AnswerPhase.complete => DiagnosticOutcome.succeeded,
            AnswerPhase.stopped => DiagnosticOutcome.cancelled,
            _ => DiagnosticOutcome.failed,
          },
          failure: failure,
        ),
      );
      _persist();
      _emit();
      running.complete();
    }

    var completed = false;
    thread.subscription = answer.events.listen(
      (event) => switch (event) {
        RecipientProven(:final participantId) => update(
          (turn) => turn.copyWith(
            recipient: participantId,
            phase: AnswerPhase.admitting,
          ),
        ),
        AnswerLost() => update((turn) => turn.copyWith(recoverable: true)),
        PromptSent(:final requestId, :final modelId) => () {
          update(
            (turn) => turn.copyWith(
              promptSent: true,
              phase: AnswerPhase.streaming,
              requestId: requestId,
              requestModelId: modelId,
            ),
          );
          // Recorded at once: after a crash the person must still be told
          // that this prompt had left the device.
          _persist();
        }(),
        AnswerChunk(:final text) => update(
          (turn) => turn.copyWith(text: turn.text + text),
        ),
        AnswerCompleted(:final text, :final receiptVerified) => () {
          completed = true;
          update(
            (turn) =>
                turn.copyWith(text: text, receiptVerified: receiptVerified),
          );
        }(),
      },
      onError: (Object error) =>
          finish(AnswerPhase.failed, failure: _kind(error)),
      // A stream that ends without a result and without a stop request is a
      // lost connection, not a choice the person made.
      onDone: () => completed
          ? finish(AnswerPhase.complete)
          : thread.stopping
          ? finish(AnswerPhase.stopped)
          : finish(AnswerPhase.failed, failure: FailureKind.unavailable),
      cancelOnError: true,
    );
    return running.future;
  }

  Future<void> _cancel(_Thread thread) async {
    final answer = thread.answer;
    if (answer == null) return;
    thread.stopping = true;
    await answer.cancel();
  }

  @override
  Future<void> stop(String id) async {
    _checkActive();
    await _cancel(_require(id));
  }

  FailureKind _kind(Object error) =>
      error is AppFailure ? error.kind : FailureKind.unexpected;

  Future<void> close() {
    if (_closing != null) return _closing!;
    // An answer cut off by closing is written as it stands; the next run
    // shows it as ended, with what had arrived.
    final last = _snapshot();
    final pending = _saved;
    _closed = true;
    final threads = _threads.values.toList();
    return _closing = () async {
      await pending;
      await _write(last);
      _threads.clear();
      for (final thread in threads) {
        await thread.subscription?.cancel();
        await thread.answer?.cancel();
        if (thread.running case final running? when !running.isCompleted) {
          running.complete();
        }
      }
      await _networkSubscription?.cancel();
      await api.close();
      await _events.close();
    }();
  }
}
