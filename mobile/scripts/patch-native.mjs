/* Applied after 'cap add', leaving the canonical web application untouched.
   Android WebRTC getUserMedia needs explicit Android microphone/camera
   declarations. File selection uses Capacitor's WebChromeClient picker. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const mobile=resolve(import.meta.dirname,'..');
const manifest=resolve(mobile,'android/app/src/main/AndroidManifest.xml');
if(existsSync(manifest)){
 let xml=readFileSync(manifest,'utf8');
 const perms=['android.permission.CAMERA','android.permission.RECORD_AUDIO',
   'android.permission.MODIFY_AUDIO_SETTINGS','android.permission.INTERNET',
   'android.permission.ACCESS_NETWORK_STATE','android.permission.WAKE_LOCK'];
 for(const permission of perms){
  if(!xml.includes('android:name="'+permission+'"')){
   xml=xml.replace('<application','<uses-permission android:name="'+permission+'" />\n    <application');
  }
 }
 // No unrestricted world-readable file/storage permissions.
 // A manual deep-link works without claiming another host's HTTPS URL.
 if(!xml.includes('android:scheme="marmaladeplayer"')){
  const filter='\n            <intent-filter>\n'+
    '                <action android:name="android.intent.action.VIEW" />\n'+
    '                <category android:name="android.intent.category.DEFAULT" />\n'+
    '                <category android:name="android.intent.category.BROWSABLE" />\n'+
    '                <data android:scheme="marmaladeplayer" android:host="join" />\n'+
    '            </intent-filter>';
  xml=xml.replace('</activity>',filter+'\n        </activity>');
 }
 xml=xml.replace('android:usesCleartextTraffic="true"','android:usesCleartextTraffic="false"');
 writeFileSync(manifest,xml);
 console.log('Android: WebRTC runtime permissions, URI handling, and HTTPS-only policy configured.');
}
const plist=resolve(mobile,'ios/App/App/Info.plist');
if(existsSync(plist)){
 let xml=readFileSync(plist,'utf8');
 if(!xml.includes('<key>NSMicrophoneUsageDescription</key>')){
  xml=xml.replace('</dict>\n</plist>', `    <key>NSCameraUsageDescription</key>
    <string>Camera permission is requested only when sharing media that needs the camera.</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>Microphone permission allows audio capture while hosting a watch room.</string>
    <key>NSPhotoLibraryUsageDescription</key>
    <string>Choose a local movie file to play or synchronize with a host.</string>
    <key>CFBundleURLTypes</key>
    <array><dict>
      <key>CFBundleURLSchemes</key><array><string>marmaladeplayer</string></array>
    </dict></array>
</dict>
</plist>`);
 }
 writeFileSync(plist,xml);
 console.log('iOS: media permission descriptions and app-specific room links configured.');
}
