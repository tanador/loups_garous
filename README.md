# loup_garou_flutter

A new Flutter project.

## Launch parameters

The application can accept a default nickname and an optional
auto-create flag when launching with `flutter run`.

```bash
flutter run \
  --dart-define=NICK=MonPseudo \
  --dart-define=AUTO_CREATE=true
```

`NICK` pre-fills the pseudonym field, and when `AUTO_CREATE` is set to
`true` the app connects to the server and starts a 4-player game
automatically.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
