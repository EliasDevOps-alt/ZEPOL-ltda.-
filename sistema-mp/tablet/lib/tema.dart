import 'package:flutter/material.dart';

/// Colores del escritorio (frontend/src/renderer/src/index.css). Solo modo
/// claro, a propósito: es una app de planta y no debe oscurecerse según cómo
/// esté configurada cada tablet.
class Colores {
  static const fondo = Color(0xFFF4F7FB);
  static const texto = Color(0xFF101A2B);
  static const tarjeta = Colors.white;
  static const borde = Color(0xFFDBE3EE);
  static const apagado = Color(0xFFEEF2F8);
  static const textoApagado = Color(0xFF5C6B80);
  static const primario = Color(0xFF0E7490);
  static const exito = Color(0xFF16A34A);
  static const aviso = Color(0xFFD97706);
  static const peligro = Color(0xFFDC2626);

  static const acentos = [
    Color(0xFFE0393E),
    Color(0xFFEF6C35),
    Color(0xFFF4C542),
    primario,
    Color(0xFF2F5FD1),
    Color(0xFFC23B7A),
  ];
}

ThemeData temaZepol() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: Colores.primario,
      primary: Colores.primario,
      error: Colores.peligro,
      surface: Colores.tarjeta,
      brightness: Brightness.light,
    ),
    scaffoldBackgroundColor: Colores.fondo,
  );
  final bordeCampo = OutlineInputBorder(
    borderRadius: BorderRadius.circular(8),
    borderSide: const BorderSide(color: Colores.borde),
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: Colores.texto, displayColor: Colores.texto),
    cardTheme: CardThemeData(
      color: Colores.tarjeta,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colores.borde),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: bordeCampo,
      enabledBorder: bordeCampo,
      focusedBorder: bordeCampo.copyWith(borderSide: const BorderSide(color: Colores.primario, width: 2)),
    ),
    // Botones grandes: se tocan con el dedo, no con el mouse.
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 52),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        side: const BorderSide(color: Colores.borde),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
  );
}
