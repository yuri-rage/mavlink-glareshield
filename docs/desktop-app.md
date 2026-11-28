# The Desktop App (Linux and Windows)

The desktop app is the same Glareshield as the web app, installed on your computer. It can also talk to the vehicle
directly, which a browser can't do:

- **UDP:** listens on port 14550 (or one you choose) for the vehicle, as Mission Planner does. That covers SITL, a
  companion computer, or a radio's network bridge sending to this computer.
- **TCP:** connects to the vehicle, for example SITL on `127.0.0.1:5760` or a serial-to-TCP adapter.
- **USB serial:** a telemetry radio or a flight controller's USB port, chosen from a list of the computer's serial
  ports.
- **WebSocket:** the Docker bridge or Mission Planner, as in the web app.
- **NTRIP:** the RTK widget's caster (HTTP Streaming) is reached by the app itself, on any link, so RTK corrections
  don't need the bridge either. It sends the vehicle's position to the caster every 10 s when **Send NMEA GGA VRS Feedback** is on (VRS casters).

You don't need the bridge, Docker, certificates or browser settings. For phones and tablets, the desktop app can be
the bridge itself (below).

macOS isn't built, because running without warnings there needs a paid Apple Developer ID. On a Mac, use the web app.

## Install

Download it from the [latest release](https://github.com/yuri-rage/mavlink-glareshield/releases/latest).

**Linux (AppImage):** download `Glareshield-<version>-x86_64.AppImage`, make it executable and run it:

```bash
chmod +x Glareshield-*.AppImage
./Glareshield-*.AppImage
```

- Some distributions need FUSE 2 for AppImages (Ubuntu 22.04 and later: `sudo apt install libfuse2`).
- On NixOS, use `appimage-run`.
- On first run, it adds itself to your app launcher (`~/.local/share/applications/glareshield.desktop` and its icon), which is also where Wayland desktops get the window's icon. The entry follows the AppImage if you move it; delete those two files to remove it.
- For USB serial, your user must be allowed to open serial ports. On most distributions that means the `dialout` group
  (`uucp` on Arch): `sudo usermod -aG dialout $USER`, then log out and back in.

**Windows:** download `Glareshield-Setup-<version>.exe` and run it. It installs for your user, with no administrator
rights needed. The installer isn't signed yet, so Windows SmartScreen may say it "protected your PC". Choose **More
info**, then **Run anyway**.

## Connect

Open **Settings → Link** and choose the **Link type**:

| Link type | Set | For |
|---|---|---|
| UDP | The port to listen on (14550) | SITL (`--serial1 udpclient:<this computer>:14550`), a companion computer or radio bridge sending here |
| TCP | The vehicle's `host:port` (`127.0.0.1:5760`) | SITL's first port, a serial-to-TCP adapter |
| USB serial | The port (from the list; ⟳ lists them again after plugging in) and the baud rate (57600 for SiK radios) | A radio or flight controller plugged into this computer. Opened by its name (`COM5`, `/dev/ttyACM0`), so it reconnects by itself after a replug or when the app starts again |
| WebSocket | The bridge's address | The Docker bridge or Mission Planner, as in the web app |

Over UDP, Glareshield replies to whatever address last sent to it, as Mission Planner does. Only one copy of the app
runs at a time: opening it again brings the open window forward, so two copies never compete for the UDP port.

## Bridge for phones and tablets

Settings → Link → **Bridge for other devices**: **Off** (the default: nothing listens on the network) or **On**. On,
phones and tablets on the same network connect to this computer as they would to the Docker bridge, and share its
UDP, TCP or serial link to the vehicle: everyone hears the vehicle, and the vehicle hears everyone. (A WebSocket link
isn't relayed: connect the desktop to the vehicle directly.)

- **Pair a device**: **Pair another device…** shows a QR code. Scan it with the phone's camera: it opens this
  computer's address first, where the phone accepts the bridge's certificate once, then Glareshield, connected. Chrome
  may ask to let Glareshield reach devices on your local network: allow it.
- **Port**: 56781 by default, as the Docker bridge (change it if both run on this computer).
- **New pairing token…**: shuts out every device paired so far (a lost phone, a QR code shared by mistake); pair the
  ones you want again.
- Paired devices can use **RTK / NTRIP** through it, as with the Docker bridge (to caster ports 2101 to 2105).

The certificate is made for this computer's name and network addresses and kept, so a device accepts it once; a new
address (another network) makes a new one, which devices accept again.

## Title bar

Settings → Display → **Title bar**: **Standard** (the system's) or **Auto-hide**. With Auto-hide the window has no
title bar until the pointer reaches its top edge; then a slim one slides down over the top of the app (the app doesn't
move or resize) with the window's minimize, maximize and close, and you can drag the window by it. It slides away once
the pointer moves below it. The change applies when the app restarts (**Restart now**, which waits while the vehicle is
armed).

## Updates

The app checks for a newer release when it starts and downloads it in the background. When it's ready, an **Update**
button appears in the top bar. Click it to restart into the new version. While the vehicle is armed the button waits,
because a restart drops the link for a few seconds.

After an update, a short banner says what's new in that version (the release's changes, from GitHub) and closes on its
own after half a minute. It shows once per version, never on a first install. **Don't show these** turns it off;
Settings → About turns it back on, and links to the version's release notes either way.

## Building it yourself

```bash
npm install
npm run desktop          # build the app and run it in Electron
npm run desktop:dist     # build the installer for this platform into release/
```

Pushing a version tag (`git tag v0.2.0 && git push --tags`) builds the AppImage and the Windows installer on GitHub
Actions (`.github/workflows/desktop-release.yml`) and publishes them to that tag's release, where installed apps find
the update. A last job writes the release notes with `scripts/release-notes.sh`: the pull requests merged since the
previous release (GitHub's note generator, as `- Title (#N)`), and the SmartScreen hint while Windows builds are
unsigned. Text you add to the notes by hand, outside the generated block, is kept when the script runs again; run it
yourself (`scripts/release-notes.sh v0.2.1` to print, `--apply` to write) to backfill or refresh a release. Running
the workflow by hand builds both without publishing and keeps them as workflow artifacts.

How it fits together:

- `desktop/main.ts` (Electron's main process) serves the built web app (`dist/`) from `app://glareshield/`, with the
  web deploy's Content-Security-Policy, so the service worker and offline map tiles work as on the web. It also opens
  the UDP, TCP and serial links (serial with the prebuilt `@serialport/bindings-cpp`, the app's only runtime
  dependency), lists the serial ports, and runs the updater.
- `desktop/preload.ts` gives the page a small API (`src/desktop/api.ts`) and nothing else of Electron or Node.
- On the page, `src/mavlink/transport/nativeLinkTransport.ts` is the UDP/TCP transport, alongside WebSocket and Web
  Serial.

### Signing the Windows installer

Unsigned, the installer and app show "Unknown publisher", and SmartScreen stops the first run. The release workflow
signs both with [Azure Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/) (formerly Trusted
Signing) once it's set up. Until then, it builds unsigned. One-time setup in Azure:

1. **A paid subscription.** Pay-as-you-go is fine; free, trial and sponsored subscriptions aren't accepted. Register
   the `Microsoft.CodeSigning` resource provider on it.
2. **An Artifact Signing account** (Basic tier, $9.99/month at the time of writing). Note its region's endpoint, e.g.
   `https://eus.codesigning.azure.net/`.
3. **Identity validation, Public trust.** Individual developers are accepted in the USA and Canada and verify with a
   government ID; it can take several business days. The validated name becomes the publisher name Windows shows, so
   it's public.
4. **A certificate profile**, Public Trust, on that validated identity.
5. **An app registration** (Microsoft Entra ID) with a client secret, given the **Artifact Signing Certificate
   Profile Signer** role on the signing account.

Then, in the GitHub repository (Settings → Secrets and variables → Actions):

| Secrets | Variables |
|---|---|
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (the app registration) | `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT` (the signing account's name), `AZURE_SIGN_PROFILE` (the certificate profile's name), `AZURE_SIGN_PUBLISHER` (the certificate's subject name, exactly as validated) |

The next build is signed: the workflow's log says so, or notes that the build is unsigned. A new publisher still
builds SmartScreen reputation over its first downloads, so early users may still see a warning, now naming the
publisher.
