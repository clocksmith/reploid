import 'package:flutter/material.dart';

import 'theme.dart';

/// Retains same-session content during refresh and recoverable errors.
/// Apps map their repository state to these inputs and localize all labels.
class AsyncContent extends StatelessWidget {
  const AsyncContent({
    super.key,
    required this.loadingLabel,
    required this.emptyLabel,
    required this.retryLabel,
    this.content,
    this.loading = false,
    this.errorMessage,
    this.onRetry,
  });

  final Widget? content;
  final bool loading;
  final String loadingLabel;
  final String emptyLabel;
  final String retryLabel;
  final String? errorMessage;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (loading) ...[
        LinearProgressIndicator(semanticsLabel: loadingLabel),
        SizedBox(height: UiSpacing.of(context).gap),
      ],
      if (content != null)
        content!
      else if (!loading && errorMessage == null)
        Text(emptyLabel),
      if (errorMessage != null) ...[
        SizedBox(height: UiSpacing.of(context).gap),
        Semantics(
          liveRegion: true,
          child: Text(
            errorMessage!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
        if (onRetry != null)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(onPressed: onRetry, child: Text(retryLabel)),
          ),
      ],
    ],
  );
}
