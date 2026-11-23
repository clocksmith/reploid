import 'dart:async';

import 'package:core/core.dart';

import '../domain/chat.dart';
import 'conversation_archive.dart';
import 'requester_api.dart';

final class _Thread {
  _Thread(this.id);
  final String id;
  String title = '';
  String? modelId;
  AnswerTarget? target;
  final List<Turn> turns = [];
  Answer? answer;
  StreamSubscription<AnswerEvent>? subscription;
  Completer<void>? running;
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
    this.diagnostics = const Diagnostics(),
  }) {
    session.registerCleanup(close);
    if (archive != null) _restoring = _restore();
  }

  final SessionHandle session;
  final RequesterApi api;
  final String Function() newId;

  /// Where conversations are kept between runs; none keeps them in memory.
  final ConversationArchive? archive;
  final Diagnostics diagnostics;
  Future<void>? _restoring;
  bool _restored = false;
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

  /// Brings back this identity's conversations. Ones made while loading
  /// stay, after the restored ones.
  Future<void> _restore() async {
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
        ..target = conversation.target
        ..turns.addAll(conversation.turns);
    }
    _threads.addAll(made);
    _emit();
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
    final computers = _network.computers;
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
                .where((c) => c.modelId == model.id && c.ready && !c.busy)
                .length,
            busyComputers: computers
                .where((c) => c.modelId == model.id && c.ready && c.busy)
                .length,
          ),
      ],
      computers: computers,
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
    _allowed = allowed;
    _emit();
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
  );

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
    thread.modelId = modelId;
    _persist();
    _emit();
  }

  _Thread _require(String id) =>
      _threads[id] ?? (throw const AppFailure(FailureKind.validation));

  String? _defaultModel() {
    final models = _networkResource().models;
    return (models.where((m) => m.available).firstOrNull ?? models.firstOrNull)
        ?.id;
  }

  @override
  Future<void> send(String id, String text) {
    _checkActive();
    final thread = _require(id);
    // A second tap joins the answer already under way; it never sends twice.
    if (thread.running case final running?) return running.future;
    final prompt = text.trim();
    if (prompt.isEmpty) throw const AppFailure(FailureKind.validation);
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    // The destination is fixed when the prompt is sent and kept with the
    // conversation; pairing or unpairing later does not move it.
    thread.target ??= _target(thread);
    final modelId = thread.modelId ??= _defaultModel();
    if (modelId == null) throw const AppFailure(FailureKind.unavailable);
    if (thread.title.isEmpty) {
      thread.title = prompt.length > 48
          ? '${prompt.substring(0, 48)}…'
          : prompt;
    }
    thread.turns.add(Turn(id: newId(), role: TurnRole.user, text: prompt));
    return _start(thread, modelId);
  }

  @override
  Future<void> retry(String id) {
    _checkActive();
    final thread = _require(id);
    if (thread.running case final running?) return running.future;
    if (!_conversation(thread).canRetry) {
      throw const AppFailure(FailureKind.validation);
    }
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    thread.turns.removeLast();
    return _start(thread, thread.modelId!);
  }

  Future<void> _start(_Thread thread, String modelId) {
    _ensureOpen();
    final messages = [
      for (final turn in thread.turns)
        if (turn.role == TurnRole.user ||
            (turn.phase == AnswerPhase.complete && turn.text.isNotEmpty))
          PromptMessage(turn.role, turn.text),
    ];
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
      target: _target(thread),
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
        PromptSent() => () {
          update(
            (turn) =>
                turn.copyWith(promptSent: true, phase: AnswerPhase.streaming),
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
