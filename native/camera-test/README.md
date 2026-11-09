# StopMo — Stage 1 camera test

This is the first milestone from the project brief: prove that a normal, double-clickable macOS app can control a **Canon EOS 5D Mark II** over USB. That means live view, remote shutter, full-resolution capture and safe saving, all **before** any timeline, onion-skin or export work is built on top.

Status: **untested on hardware**. This code has not yet been compiled or run against a real camera. The test below is what verifies it.

## How it talks to the camera

- **Apple ImageCaptureCore**, which is built into macOS. It finds the camera, opens a session and handles hot-plug.
- **Canon EOS PTP commands** are sent through ImageCaptureCore's PTP pass-through. These are the same vendor commands libgphoto2 uses:
  - remote mode `0x9114`
  - event mode `0x9115`
  - event polling `0x9116`
  - live view to the PC: property `0xD1B0` = 2, then frames come from `0x9153`
  - shutter release `0x910F` (or `0x9128`/`0x9129` on newer bodies)
  - file download: GetObjectInfo/GetObject
- Why not libgphoto2? On macOS 14.1+, the system's `ptpcamerad` grabs the camera, so gphoto2 has to run with `sudo`. That rules it out for a double-click app.
- Why not Canon EDSDK? It does still support the 5D Mk II and Apple Silicon, but it requires your own free Canon developer registration. It can be added later as a second backend.

## Build

```bash
./build_app.sh        # → "StopMo Stage 1.app"
```
You need Xcode or the Command Line Tools (`xcode-select --install`). The script produces an ad-hoc-signed app for Apple Silicon or Intel (whichever Mac builds it).

## Camera prep (5D Mark II)

- Charged battery or AC adapter, and a CF card in the camera.
- Mode dial on **M**, lens switch on **MF**.
- *Live View/Movie func. set.* must not be disabled.
- *Auto power off*: **Off**.
- Mini-USB cable plugged directly into the Mac (no hub).
- Quit EOS Utility, Image Capture and Photos.
- Click **Allow** if macOS asks about the accessory.

## Test

1. Launch the app. The status dot should turn green and show "Connected: Canon EOS 5D Mark II".
2. Click **Run Stage 1 Test**. It runs these checks automatically:
   - detection and model check
   - macOS-native capture (fallback path)
   - Canon remote mode
   - 8 s of live view with a frame-rate measurement
   - 3 captures with live view running, checking 5616×3744 and that live view comes back after each one
   - the no-overwrite check
3. Unplug and replug the cable. The app should go red, then green again, without restarting.
4. Try **Save to Mac only**, then press Space to capture.

All output goes to `~/Pictures/StopMo/Camera_Test/`:
- `frame_NNNN.JPG` / `.CR2`: captured frames. Existing files are never overwritten.
- `stage1_report.txt`: PASS/FAIL summary.
- `stage1_log.txt`: full protocol log. Send this back if anything fails.

## Known unknowns this test resolves

- The exact layout of ImageCaptureCore's pass-through completion data (the code accepts either order).
- Whether the 5D Mk II accepts raw out-data for SetDevicePropValueEx. If live view won't start, run `defaults write com.stopmo.stage1 wrapOutData -bool YES` and relaunch.
- The CaptureDestination value for "card". The app restores whatever value the camera reported, rather than guessing one.
