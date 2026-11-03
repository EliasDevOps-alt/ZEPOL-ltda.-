package com.zepol.zepol_tablet

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    // Puente con la parte de actualizaciones (lib/actualizacion/): la app baja el
    // APK nuevo del servidor y acá se le pide a Android que lo instale.
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "zepol/actualizador").setMethodCallHandler { llamada, resultado ->
            try {
                when (llamada.method) {
                    "version" -> {
                        val info = packageManager.getPackageInfo(packageName, 0)
                        val codigo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
                        resultado.success(mapOf("codigo" to codigo, "nombre" to (info.versionName ?: "")))
                    }
                    "puedeInstalar" -> resultado.success(
                        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()
                    )
                    "pedirPermiso" -> {
                        // Una sola vez: "permitir instalar apps de esta fuente" para ZEPOL.
                        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        resultado.success(null)
                    }
                    "instalar" -> {
                        val ruta = llamada.argument<String>("ruta") ?: throw IllegalArgumentException("falta la ruta")
                        val archivo = File(ruta)
                        if (!archivo.exists()) throw IllegalStateException("el archivo ya no existe")
                        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", archivo)
                        val intent = Intent(Intent.ACTION_VIEW)
                        intent.setDataAndType(uri, "application/vnd.android.package-archive")
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(intent)
                        resultado.success(null)
                    }
                    else -> resultado.notImplemented()
                }
            } catch (e: Exception) {
                resultado.error("actualizador", e.message, null)
            }
        }
    }
}
