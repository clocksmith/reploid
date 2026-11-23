import 'package:flutter/material.dart';
import 'package:ui/ui.dart';

ThemeData appTheme({bool dark = false}) => createUiTheme(
  seedColor: const Color(0xff315b54),
  brightness: dark ? Brightness.dark : Brightness.light,
  fontFamily: 'Manrope',
);
