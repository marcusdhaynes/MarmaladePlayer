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
 // True OS Picture-in-Picture without overlay or special accessibility rights.
 xml=xml.replace(/<activity\b([^>]*?)>/,(_original,attributes)=>{
   let flags=attributes;
   if(!flags.includes('android:supportsPictureInPicture='))flags+=' android:supportsPictureInPicture="true"';
   if(!flags.includes('android:resizeableActivity='))flags+=' android:resizeableActivity="true"';
   return '<activity'+flags+'>';
 });
 xml=xml.replace('android:usesCleartextTraffic="true"','android:usesCleartextTraffic="false"');
 writeFileSync(manifest,xml);
 console.log('Android: WebRTC runtime permissions, URI handling, and HTTPS-only policy configured.');
}
// Capacitor's native Android project is generated fresh during each build.
const nativeDir=resolve(mobile,'android/app/src/main/java/app/marmaladeplayer/mobile');
const activity=resolve(nativeDir,'MainActivity.java');
if(existsSync(activity)){
  const plugin=`package app.marmaladeplayer.mobile;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Rational;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MarmaladePictureInPicture")
public class MarmaladePictureInPicturePlugin extends Plugin {
    @PluginMethod
    public void enter(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("System Picture-in-Picture requires Android 8 or later.");
            return;
        }
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9)).build();
                if (activity.enterPictureInPictureMode(params)) call.resolve();
                else call.reject("System Picture-in-Picture was declined.");
            } catch (Exception error) {
                call.reject("System Picture-in-Picture unavailable on this device.", error);
            }
        });
    }
}
`;
  writeFileSync(resolve(nativeDir,'MarmaladePictureInPicturePlugin.java'),plugin);
  writeFileSync(activity,`package app.marmaladeplayer.mobile;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MarmaladePictureInPicturePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean active, Configuration config) {
        super.onPictureInPictureModeChanged(active, config);
        if (bridge != null && bridge.getWebView() != null) {
            String script = "window.dispatchEvent(new CustomEvent('marmalade:native-pip',{detail:{active:"+
                (active ? "true" : "false") + "}}));";
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
        }
    }
}
`);
  console.log('Android: System Picture-in-Picture enabled.');
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
