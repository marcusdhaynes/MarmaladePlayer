# Safari Marmalade Library extension

The Safari target uses the same seven-file independent WebExtension source.
It is not a Safari app until packaged and signed by Apple tooling.

On macOS, after extracting the Safari source ZIP, run:

    xcrun safari-web-extension-packager --copy-resources --app-name "Marmalade Library" /path/to/safari

Open the generated Xcode project, select a signing team, and build.
For iOS/iPadOS or general distribution, use Xcode or Apple's App Store Connect
Safari Web Extension Packager.

The catalog persists within the signed extension's profile storage, and
survives normal website site-data clearing. Original local media bytes are
not copied into the extension. Safari may require selecting the files again
after restarting the browser; an extension cannot silently renew OS file
permissions. No Minternet code or native Marmaladeum server is required.
