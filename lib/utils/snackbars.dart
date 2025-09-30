import 'package:flutter/material.dart';

const double kBadgeSafeGap = 80;

SnackBar badgeAwareSnackBar(
  BuildContext context, {
  required Widget content,
  Color? backgroundColor,
  Duration? duration,
  SnackBarAction? action,
  DismissDirection dismissDirection = DismissDirection.up,
}) {
  final mediaQuery = MediaQuery.maybeOf(context);
  final bottomInset =
      mediaQuery?.viewPadding.bottom ?? mediaQuery?.padding.bottom ?? 0.0;
  final topInset = mediaQuery?.padding.top ?? 0.0;

  return SnackBar(
    content: content,
    backgroundColor: backgroundColor,
    duration: duration ?? const Duration(seconds: 4),
    action: action,
    behavior: SnackBarBehavior.floating,
    dismissDirection: dismissDirection,
    margin: EdgeInsets.fromLTRB(
      16,
      topInset + 16,
      16,
      bottomInset + kBadgeSafeGap,
    ),
  );
}
