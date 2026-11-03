# MarmaladePlayer — Android & iOS
Both native apps embed the **same** web player shipped by GitHub Pages.

## Android APK (installable unsigned-store preview)
CI: GitHub Actions → **MarmaladePlayer Android APK** → latest successful run → `MarmaladePlayer-Android-APK` artifact.
It contains `app-debug.apk`, which Android can install after enabling installation from the chosen file manager. The APK is debug-signed, **not Google Play production signed**; separate CI runs may use different debug keys and require reinstalling.

## Local Android build
```sh
cd mobile
npm install
npm run verify
npm run prepare:web
npx cap add android
node scripts/patch-native.mjs
npx cap sync android
cd android
./gradlew assembleDebug
```
The APK is at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## iOS
On macOS with Xcode installed:
```sh
cd mobile
npm install
npm run prepare:web
npx cap add ios
node scripts/patch-native.mjs
npx cap sync ios
npx cap open ios
```
Choose an Apple development team in Xcode for signing before deployment to a device. App Store distribution requires Apple's signing and review process.

## Limits
- Android/iOS use their system WebView implementations. WebRTC, playback capture, browser file decoding, and screen sharing support differ by OS; host-capture features need real-device tests.
- Room signaling, metadata and external scripts still need internet access.
- The WebView native permission prompts require explicit user consent.
- The standalone app shares public room invitations using the GitHub Pages URL. Device-specific `marmaladeplayer://join/CODE` routes are supported when a native app opens that URI.
- Do **not** claim perfect streaming, zero-latency synchronization, or compatibility with every video codec without hardware/network validation.
