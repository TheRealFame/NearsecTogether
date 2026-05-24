# Host Usage & Dashboard Guide

The Host Dashboard is your control center for managing streams, viewers, and system audio.

## Video & Audio Capture
When you start a session, Nearsec hooks into your native OS APIs (Wayland/X11 or Windows Graphics Capture).
* **Audio Routing:** On Linux, Nearsec automatically creates a `NearsecAppAudio` virtual sink. Use your system's volume mixer (`pavucontrol`) to route specific games into this sink. This prevents your personal Discord/desktop audio from broadcasting to the stream.
* **Volume Control:** The virtual sink is capped at 70% volume automatically to protect your local hearing.

## Player Roster & Input Permissions
Viewers will appear in the Roster as they join. You have complete control over their input modes:
* **Gamepad:** Emulates a native Xbox 360 or DualShock 4 controller.
* **Raw KBM:** 1:1 mouse and keyboard passthrough.
* **Emulated KBM:** Maps keyboard inputs to a virtual gamepad (perfect for retro or fighting games lacking native keyboard support).
* **Lock Slots:** Click the padlock icon to prevent random viewers from taking over an active player's controller slot.

## Voice Chat Management
Viewers can send their microphone audio directly to the Host.
* **Red Mic Icon:** Locally muted. You will not hear them, but their audio is still arriving at the server.
* **Grey Mic Icon:** Force-muted. The server drops their audio packets entirely, saving bandwidth for all users.
