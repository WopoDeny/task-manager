Option Explicit
Dim shell, fso, appDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
If Not fso.FolderExists(appDir & "\data") Then fso.CreateFolder(appDir & "\data")
shell.Run "cmd.exe /c node server\index.js >> data\service.log 2>&1", 0, False
