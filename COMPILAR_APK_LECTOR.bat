@echo off
echo ======================================================
echo    SIGA-Comunitario - Compilador de APK para Lector
echo ======================================================
echo.
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo Sincronizando activos web a la app Android...
xcopy /E /I /Y "demo\*" "android-lector\app\src\main\assets\www\"

cd /d "android-lector"
echo.
echo Compilando APK nativo Android...
call gradlew.bat assembleDebug

if %ERRORLEVEL% equ 0 (
    echo.
    echo ======================================================
    echo    APK GENERADO CON EXITO:
    echo    ..\SIGA.apk
    echo ======================================================
    copy /Y "app\build\outputs\apk\debug\app-debug.apk" "..\SIGA.apk"
    copy /Y "app\build\outputs\apk\debug\app-debug.apk" "..\SIGA_Lector_Android.apk"
) else (
    echo [ERROR] No se pudo compilar el APK.
)
cd /d ".."
pause

