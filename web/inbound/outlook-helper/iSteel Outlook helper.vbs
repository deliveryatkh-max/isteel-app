' iSteel Outlook helper (Kim, 6 Nov 2026)
' Lets the iSteel Inbound app open an Outlook draft with the PDF report attached, like an Excel macro.
'  - Double-click this file once: it installs itself for this Windows user (no admin needed).
'  - Double-click the installed copy again to remove it.
' The app puts the email on the clipboard (To, Subject, PDF, body) and opens isteel-outlook:draft;
' Windows then runs this script, which builds the draft in Outlook (classic) and clears the clipboard.
Option Explicit
Const PROTO = "isteel-outlook"
Const APP_URL = "https://isteel-app.pages.dev/inbound/"
Dim sh, fso, home, target
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
home = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\iSteel\Outlook"
target = home & "\iSteel Outlook helper.vbs"

If WScript.Arguments.Count > 0 Then
  MakeDraft
ElseIf LCase(WScript.ScriptFullName) = LCase(target) Then
  If MsgBox("Remove the iSteel Outlook helper from this computer?", 36, "iSteel") = 6 Then Remove
Else
  Install
End If

Sub Folder(p)
  If Not fso.FolderExists(fso.GetParentFolderName(p)) Then Folder fso.GetParentFolderName(p)
  If Not fso.FolderExists(p) Then fso.CreateFolder p
End Sub

Sub Install()
  Dim k
  Folder home
  fso.CopyFile WScript.ScriptFullName, target, True
  k = "HKCU\Software\Classes\" & PROTO & "\"
  sh.RegWrite k, "URL:iSteel Outlook helper", "REG_SZ"
  sh.RegWrite k & "URL Protocol", "", "REG_SZ"
  sh.RegWrite k & "shell\open\command\", "wscript.exe """ & target & """ ""%1""", "REG_SZ"
  MsgBox "The iSteel Outlook helper is installed." & vbCrLf & vbCrLf & _
    "In the Inbound app, Open in Outlook now opens the draft with the PDF attached." & vbCrLf & _
    "The first time, Chrome asks to open the helper: tick Always allow, then click Open.", 64, "iSteel"
  sh.Run APP_URL & "?olhelper=1"
End Sub

Sub Remove()
  Dim k
  k = "HKCU\Software\Classes\" & PROTO & "\"
  On Error Resume Next
  sh.RegDelete k & "shell\open\command\"
  sh.RegDelete k & "shell\open\"
  sh.RegDelete k & "shell\"
  sh.RegDelete k
  fso.DeleteFile target, True
  On Error GoTo 0
  MsgBox "The iSteel Outlook helper was removed.", 64, "iSteel"
  sh.Run APP_URL & "?olhelper=0"
End Sub

Function Clip()
  Dim x
  x = ""
  On Error Resume Next
  x = CreateObject("htmlfile").ParentWindow.ClipboardData.GetData("text")
  On Error GoTo 0
  If IsNull(x) Or IsEmpty(x) Then x = ""
  If x = "" Then x = ClipPS()
  Clip = x
End Function

' Second way to read the clipboard (when Windows blocks the first): PowerShell, hidden, through a UTF-8 file
Function ClipPS()
  Dim f, st
  ClipPS = ""
  f = sh.ExpandEnvironmentStrings("%TEMP%") & "\iSteel-clip.txt"
  On Error Resume Next
  sh.Run "powershell -NoProfile -WindowStyle Hidden -Command ""Get-Clipboard -Raw | Out-File -Encoding utf8 -LiteralPath '" & f & "'""", 0, True
  If fso.FileExists(f) Then
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2
    st.Charset = "utf-8"
    st.Open
    st.LoadFromFile f
    ClipPS = st.ReadText
    st.Close
    fso.DeleteFile f, True
  End If
  On Error GoTo 0
End Function

Sub SaveB64(b64, path)
  Dim el, st
  Set el = CreateObject("MSXML2.DOMDocument").createElement("b")
  el.dataType = "bin.base64"
  el.text = b64
  Set st = CreateObject("ADODB.Stream")
  st.Type = 1
  st.Open
  st.Write el.nodeTypedValue
  st.SaveToFile path, 2
  st.Close
End Sub

Function SafeName(s)
  Dim c
  SafeName = s
  For Each c In Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    SafeName = Replace(SafeName, c, "-")
  Next
  If SafeName = "" Then SafeName = "report.pdf"
End Function

Sub MakeDraft()
  Dim txt, p, tmp, pdf, ol, m, html, i, n
  ' The app may still be writing the clipboard: wait up to 3 s for it
  For n = 1 To 15
    txt = Replace(Clip(), vbCr, "")
    If Left(txt, 1) = ChrW(65279) Then txt = Mid(txt, 2)
    If Left(txt, 12) = "ISTEEL-DRAFT" Then Exit For
    WScript.Sleep 200
  Next
  If Left(txt, 12) <> "ISTEEL-DRAFT" Then
    MsgBox "No email from the iSteel app was found." & vbCrLf & "Click Open in Outlook in the app again.", 48, "iSteel"
    Exit Sub
  End If
  p = Split(txt, vbLf & "#ISTEEL#" & vbLf)   ' 0 tag, 1 To, 2 Subject, 3 PDF name, 4 PDF base64, 5 HTML body
  If UBound(p) < 5 Then
    MsgBox "The email from the iSteel app is incomplete. Click Open in Outlook again.", 48, "iSteel"
    Exit Sub
  End If
  tmp = sh.ExpandEnvironmentStrings("%TEMP%") & "\iSteel"
  Folder tmp
  pdf = ""
  If Len(p(4)) > 0 Then
    pdf = tmp & "\" & SafeName(p(3))
    SaveB64 p(4), pdf
  End If
  On Error Resume Next
  Set ol = CreateObject("Outlook.Application")
  If Err.Number <> 0 Then
    On Error GoTo 0
    MsgBox "Outlook could not be opened. The helper needs the classic Outlook desktop app.", 48, "iSteel"
    Exit Sub
  End If
  On Error GoTo 0
  Set m = ol.CreateItem(0)
  m.To = p(1)
  m.Subject = p(2)
  If pdf <> "" Then m.Attachments.Add pdf
  m.Display
  ' Put the app's text above the user's Outlook signature
  html = m.HTMLBody
  i = InStr(1, html, "<body", 1)
  If i > 0 Then i = InStr(i, html, ">")
  If i > 0 Then
    m.HTMLBody = Left(html, i) & p(5) & Mid(html, i + 1)
  Else
    m.HTMLBody = p(5) & html
  End If
  On Error Resume Next
  m.GetInspector.Activate
  CreateObject("htmlfile").ParentWindow.ClipboardData.ClearData
End Sub
