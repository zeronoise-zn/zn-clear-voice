::=============================================================================
:: $Header:   J:/sw/Tools/FlashLoader/FL7/Projects/Pc/FL7Exe/vcs/FL.bat_v   1.2   22 Apr 2010 09:37:42   lb  $ 
::
:: Fl6 look a like 
::
::=============================================================================
@echo off
@echo
@if '%1'=='' goto NoParm
@Call FL7.exe @FL7.cfg /i=%1
@goto End
:NoParm
@echo Syntax:
@echo .
@echo      FL.BAT [Intel hex file] 
@echo .
@echo .    Configuration is done in FL7.cfg
@echo .

:End