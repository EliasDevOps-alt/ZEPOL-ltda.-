' Lanza iniciar_backend.bat sin ventana de consola visible.
'
' Es la accion de la tarea programada "Zepol Backend" del servidor (disparador:
' al iniciar sesion). Sin este envoltorio, la tarea deja una ventana de cmd
' abierta en pantalla toda la jornada, que cualquiera puede cerrar sin querer y
' dejar a la planta sin backend.
'
' El 0 del segundo parametro de Run es el modo de ventana (oculta) y el False
' del tercero hace que no espere a que el .bat termine - uvicorn no termina.
'
' Resuelve la ruta del .bat a partir de la de este mismo archivo, asi el par
' sigue funcionando si la carpeta del repo se mueve.
Set objShell = CreateObject("WScript.Shell")
objShell.Run "cmd /c """ & Replace(WScript.ScriptFullName, "iniciar_backend_oculto.vbs", "iniciar_backend.bat") & """", 0, False
