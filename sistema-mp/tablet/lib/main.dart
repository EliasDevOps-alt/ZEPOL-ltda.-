import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'actualizacion/actualizador.dart';
import 'estado/repositorio.dart';
import 'estado/sesion.dart';
import 'pantallas/configuracion_servidor.dart';
import 'pantallas/inicio.dart';
import 'pantallas/login.dart';
import 'tema.dart';
import 'widgets/barra_conexion.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Se usa en horizontal (como la pantalla de una PC) y también en vertical.
  await SystemChrome.setPreferredOrientations(DeviceOrientation.values);
  await pantallaCompleta();
  final sesion = Sesion(almacen: AlmacenArchivos(), sincronizacionAutomatica: true, plataforma: PlataformaReal());
  await sesion.cargar();
  runApp(ChangeNotifierProvider.value(value: sesion, child: const ZepolTablet()));
}

/// Toda la pantalla para la app: sin la barra de abajo (atrás, inicio,
/// ventanas) ni la de arriba (hora, batería). Deslizando desde el borde
/// aparecen un momento y se vuelven a ocultar solas.
Future<void> pantallaCompleta() => SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

class ZepolTablet extends StatefulWidget {
  const ZepolTablet({super.key});

  @override
  State<ZepolTablet> createState() => _ZepolTabletState();
}

class _ZepolTabletState extends State<ZepolTablet> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Al volver a la app (después de ir al inicio de Android, apagar la pantalla
  // o abrir otra app) Android vuelve a mostrar las barras: se ocultan de nuevo.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      pantallaCompleta();
      // Al volver a la app (por ejemplo tras instalar o después de un rato en otra) se busca de nuevo.
      unawaited(context.read<Sesion>().actualizador.revisar());
    }
  }

  @override
  Widget build(BuildContext context) {
    final sesion = context.watch<Sesion>();
    final Widget pantalla;
    if (sesion.servidor == null) {
      pantalla = const ConfiguracionServidor();
    } else if (sesion.usuario == null) {
      pantalla = const Login();
    } else {
      pantalla = const Inicio();
    }
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: sesion.repo),
        ChangeNotifierProvider.value(value: sesion.actualizador),
        ChangeNotifierProvider.value(value: sesion.conexion),
      ],
      child: MaterialApp(
        title: 'ZEPOL',
        debugShowCheckedModeBanner: false,
        theme: temaZepol(),
        // La barra roja / verde de conexión queda arriba de todas las pantallas.
        builder: (context, child) => Column(children: [const BarraConexion(), Expanded(child: child ?? const SizedBox())]),
        home: pantalla,
      ),
    );
  }
}
