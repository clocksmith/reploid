import 'package:flutter/widgets.dart';

/// Observes application lifecycle transitions so composition can flush local
/// state when backgrounded and reconnect when resumed.
class LifecycleScope extends StatefulWidget {
  const LifecycleScope({
    super.key,
    required this.child,
    this.onPause,
    this.onResume,
  });

  final Widget child;
  final VoidCallback? onPause;
  final VoidCallback? onResume;

  @override
  State<LifecycleScope> createState() => _LifecycleScopeState();
}

class _LifecycleScopeState extends State<LifecycleScope> {
  late final AppLifecycleListener _listener;

  @override
  void initState() {
    super.initState();
    _listener = AppLifecycleListener(
      onPause: () => widget.onPause?.call(),
      onHide: () => widget.onPause?.call(),
      onDetach: () => widget.onPause?.call(),
      onResume: () => widget.onResume?.call(),
    );
  }

  @override
  void dispose() {
    _listener.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
