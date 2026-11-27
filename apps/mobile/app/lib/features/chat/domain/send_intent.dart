/// A Send that waits for a permitted route (`reploid.send-intent/1`), matching
/// `packages/reploid/src/chat/send-intent.js`. Holding an intent creates no
/// turn, attempt, grant or disclosure.
enum SendIntentRefusal {
  expired('expired'),
  selectionChanged('selection-changed'),
  artifactMismatch('artifact-mismatch'),
  threadChanged('thread-changed');

  const SendIntentRefusal(this.wireName);
  final String wireName;
}

/// Exact model artifact identity: sha256 weights digest and ordered sha256
/// adapter identities, never a display name or selection id.
final class SendIntentArtifact {
  SendIntentArtifact({
    required this.identity,
    List<String> adapterIdentities = const [],
  }) : adapterIdentities = List.unmodifiable(adapterIdentities) {
    if (!isValidDigest(identity) ||
        this.adapterIdentities.length > 8 ||
        !this.adapterIdentities.every(isValidDigest)) {
      throw ArgumentError.value(
        identity,
        'identity',
        'A pin names a sha256 weights identity and sha256 adapter identities',
      );
    }
  }

  static final _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');

  static bool isValidDigest(String? value) =>
      value != null && _digestPattern.hasMatch(value);

  final String identity;
  final List<String> adapterIdentities;

  bool matches(SendIntentArtifact? other) {
    if (other == null ||
        identity != other.identity ||
        adapterIdentities.length != other.adapterIdentities.length) {
      return false;
    }
    for (var i = 0; i < adapterIdentities.length; i++) {
      if (adapterIdentities[i] != other.adapterIdentities[i]) return false;
    }
    return true;
  }
}

sealed class SendIntentSelection {
  const SendIntentSelection();
}

final class AutoSendSelection extends SendIntentSelection {
  const AutoSendSelection();
}

final class PinnedSendSelection extends SendIntentSelection {
  const PinnedSendSelection(this.artifact);
  final SendIntentArtifact artifact;
}

/// Versioned Send-intent record (`reploid.send-intent/1`).
final class SendIntent {
  SendIntent({
    required this.schema,
    required this.intentId,
    required this.threadId,
    required this.selection,
    required this.selectionRevision,
    required this.createdAtMs,
    required this.ttlMs,
  }) : expiresAtMs = createdAtMs + ttlMs {
    if (intentId.isEmpty || intentId.length > 128) {
      throw ArgumentError.value(intentId, 'intentId');
    }
    if (selectionRevision < 0) {
      throw ArgumentError.value(selectionRevision, 'selectionRevision');
    }
    if (createdAtMs < 0 || ttlMs <= 0) {
      throw ArgumentError.value(createdAtMs, 'createdAtMs');
    }
  }

  final String schema;
  final String intentId;
  final String? threadId;
  final SendIntentSelection selection;
  final int selectionRevision;
  final int createdAtMs;
  final int ttlMs;
  final int expiresAtMs;

  bool permits(SendIntentArtifact? candidate) => switch (selection) {
    AutoSendSelection() => true,
    PinnedSendSelection(artifact: final pinned) => pinned.matches(candidate),
  };

  /// Re-checked right before dispatch; null means dispatch is permitted.
  SendIntentRefusal? refusal({
    required int nowMs,
    required int selectionRevision,
    SendIntentArtifact? artifact,
    String? threadId,
  }) {
    if (nowMs >= expiresAtMs) return SendIntentRefusal.expired;
    if (selectionRevision != this.selectionRevision) {
      return SendIntentRefusal.selectionChanged;
    }
    if (!permits(artifact)) return SendIntentRefusal.artifactMismatch;
    if (threadId != null &&
        this.threadId != null &&
        threadId != this.threadId) {
      return SendIntentRefusal.threadChanged;
    }
    return null;
  }
}

/// View of a Send-intent currently waiting for a permitted route.
final class HeldSend {
  const HeldSend({
    required this.intentId,
    required this.expiresAtMs,
    required this.ttlSeconds,
    this.pinnedModelName,
    this.pinnedIdentity,
  });

  final String intentId;
  final int expiresAtMs;
  final int ttlSeconds;
  final String? pinnedModelName;
  final String? pinnedIdentity;
}
