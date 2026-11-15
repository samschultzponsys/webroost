; WebRoost: on uninstall, also remove the per-app Start menu shortcuts and
; startup entries that WebRoost created (src/windows.ts). Settings and logins
; in %APPDATA%\WebRoost are kept.
!macro customUnInstall
  RMDir /r "$SMPROGRAMS\WebRoost apps"
  Delete "$SMSTARTUP\* (WebRoost).lnk"
!macroend
