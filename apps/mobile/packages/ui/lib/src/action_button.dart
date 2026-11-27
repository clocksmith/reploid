import 'package:flutter/material.dart';

/// The caller owns pending state and command execution.
class ActionButton extends StatelessWidget {
  const ActionButton({
    super.key,
    required this.label,
    required this.pendingLabel,
    required this.onPressed,
    this.pending = false,
  });

  final String label;
  final String pendingLabel;
  final VoidCallback? onPressed;
  final bool pending;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: pending,
    child: FilledButton(
      onPressed: pending ? null : onPressed,
      child: Text(pending ? pendingLabel : label, textAlign: TextAlign.center),
    ),
  );
}
