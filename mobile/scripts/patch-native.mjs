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
   'android.permission.ACCESS_NETWORK_STATE','android.permission.WAKE_LOCK','android.permission.SYSTEM_ALERT_WINDOW'];
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
   // Bring the *same* active WebView back when the floating window closes.
   if(!flags.includes('android:launchMode='))flags+=' android:launchMode="singleTask"';
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
import android.content.Context;
import android.net.Uri;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.app.RemoteAction;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import java.util.Arrays;
import android.os.Build;
import android.util.Rational;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MarmaladePictureInPicture")
public class MarmaladePictureInPicturePlugin extends Plugin {
    // App-owned always-on-top window. Unlike system PiP, the live WebView
    // receives real touch events, so subtitles and HTML controls are interactive.
    private static WindowManager floatingManager;
    private static WindowManager.LayoutParams floatingParams;
    private static FloatingFrame floatingFrame;
    private static View floatedWeb;
    private static ViewGroup originalParent;
    private static ViewGroup.LayoutParams originalLayout;
    private static int originalIndex;
    private static Activity originalActivity;
    private static final Handler floatingHeartbeat=new Handler(Looper.getMainLooper());
    private static final Runnable refreshCaptions=new Runnable(){
        @Override public void run(){
            if(floatingFrame!=null&&floatedWeb instanceof android.webkit.WebView){
                ((android.webkit.WebView)floatedWeb).evaluateJavascript(
                    "window.MarmaladeSubtitleRefresh?.();",null);
                floatingHeartbeat.postDelayed(this,200);
            }
        }
    };
    private static int dp(Activity activity,float n){
        return Math.round(n*activity.getResources().getDisplayMetrics().density);
    }
    private static class FloatingFrame extends FrameLayout {
        private float downX,downY;
        private int startX,startY,startWidth;
        private boolean dragging,resizing;
        FloatingFrame(Activity activity){super(activity);setClipChildren(false);}
        @Override public boolean onInterceptTouchEvent(MotionEvent e){
            if(e.getActionMasked()==MotionEvent.ACTION_DOWN){
                downX=e.getRawX();downY=e.getRawY();
                startX=floatingParams.x;startY=floatingParams.y;startWidth=floatingParams.width;
                // The upper edge is a drag handle; the lower-right corner
                // resizes while preserving the movie's aspect ratio.
                dragging=e.getY()<dp(originalActivity,28) &&
                    e.getX()<getWidth()-dp(originalActivity,32);
                resizing=e.getY()>getHeight()-dp(originalActivity,35) &&
                    e.getX()>getWidth()-dp(originalActivity,35);
                if(dragging||resizing)return true;
            }
            return super.onInterceptTouchEvent(e);
        }
        @Override public boolean onTouchEvent(MotionEvent e){
            if(!dragging&&!resizing)return super.onTouchEvent(e);
            if(e.getActionMasked()==MotionEvent.ACTION_MOVE&&floatingParams!=null){
                final int dx=Math.round(e.getRawX()-downX);
                final int dy=Math.round(e.getRawY()-downY);
                DisplayMetrics display=getResources().getDisplayMetrics();
                if(resizing){
                    int width=Math.max(dp(originalActivity,200),
                        Math.min(display.widthPixels-dp(originalActivity,12),startWidth+dx));
                    floatingParams.width=width;
                    floatingParams.height=Math.round(width*9f/16f);
                    floatingParams.y=Math.max(0,Math.min(startY+dy,
                        display.heightPixels-floatingParams.height));
                }else{
                    floatingParams.x=Math.max(0,Math.min(display.widthPixels-floatingParams.width,startX+dx));
                    floatingParams.y=Math.max(0,Math.min(display.heightPixels-floatingParams.height,startY+dy));
                }
                try{floatingManager.updateViewLayout(this,floatingParams);}catch(Exception ignored){}
                return true;
            }
            if(e.getActionMasked()==MotionEvent.ACTION_UP||
               e.getActionMasked()==MotionEvent.ACTION_CANCEL){
                dragging=false;resizing=false;return true;
            }
            return true;
        }
    }
    private static void notifyWeb(boolean active){
        if(floatedWeb instanceof android.webkit.WebView){
            ((android.webkit.WebView)floatedWeb).evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('marmalade:native-floating',{detail:{active:"+
                (active?"true":"false")+"}}));",null);
        }
    }
    public static boolean restoreFloating(Activity activity){
        if(floatingFrame==null||floatedWeb==null)return false;
        floatingHeartbeat.removeCallbacks(refreshCaptions);
        try{
            ViewGroup actual=(ViewGroup)floatedWeb.getParent();
            if(actual!=null)actual.removeView(floatedWeb);
        }catch(Exception error){android.util.Log.e("MarmaladeFloat","Detach failed",error);}
        try{
            if(floatingManager!=null)floatingManager.removeViewImmediate(floatingFrame);
        }catch(Exception error){android.util.Log.w("MarmaladeFloat","Overlay already closed",error);}
        floatingFrame=null;floatingParams=null;floatingManager=null;
        try{
            if(originalParent!=null)originalParent.addView(floatedWeb,
                Math.min(originalIndex,originalParent.getChildCount()),originalLayout);
        }catch(Exception error){android.util.Log.e("MarmaladeFloat","Reattach failed",error);}
        notifyWeb(false);
        originalParent=null;originalLayout=null;originalActivity=null;floatedWeb=null;
        return true;
    }
    @PluginMethod
    public void enterFloating(PluginCall call){
        Activity activity=getActivity();
        if(android.os.Build.VERSION.SDK_INT<23||!Settings.canDrawOverlays(activity)){
            Intent permission=new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:"+activity.getPackageName()));
            activity.startActivity(permission);
            call.reject("Grant 'Display over other apps' for the interactive mini-player, then tap Pop-Out again.");
            return;
        }
        activity.runOnUiThread(()->{
            if(floatingFrame!=null){call.resolve();return;}
            try{
                View web=getBridge().getWebView();
                if(web==null||!(web.getParent() instanceof ViewGroup)){
                    call.reject("Player view unavailable");return;
                }
                originalActivity=activity;
                floatedWeb=web;
                originalParent=(ViewGroup)web.getParent();
                originalIndex=originalParent.indexOfChild(web);
                originalLayout=web.getLayoutParams();
                floatingManager=(WindowManager)activity.getApplicationContext()
                    .getSystemService(Context.WINDOW_SERVICE);
                DisplayMetrics metrics=activity.getResources().getDisplayMetrics();
                int width=Math.min(dp(activity,340),metrics.widthPixels-dp(activity,24));
                floatingParams=new WindowManager.LayoutParams(width,Math.round(width*9f/16f),
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
                floatingParams.gravity=Gravity.TOP|Gravity.START;
                floatingParams.x=Math.max(0,metrics.widthPixels-width-dp(activity,12));
                floatingParams.y=Math.max(0,metrics.heightPixels-floatingParams.height-dp(activity,70));
                originalParent.removeView(web);
                floatingFrame=new FloatingFrame(activity);
                float radius=dp(activity,12);
                GradientDrawable background=new GradientDrawable();
                background.setColor(0xff05030d);
                background.setCornerRadius(radius);
                floatingFrame.setBackground(background);
                floatingFrame.setClipToOutline(true);
                floatingFrame.addView(web,new FrameLayout.LayoutParams(-1,-1));
                floatingManager.addView(floatingFrame,floatingParams);
                notifyWeb(true);
                floatingHeartbeat.removeCallbacks(refreshCaptions);
                floatingHeartbeat.post(refreshCaptions);
                call.resolve();
                activity.moveTaskToBack(true);
            }catch(Exception error){
                restoreFloating(activity);
                call.reject("Interactive mini-player could not open",error);
            }
        });
    }
    private RemoteAction mediaAction(Activity activity,String action,int requestCode,
                                     int iconId,String title) {
        Intent message=new Intent(action);
        message.setPackage(activity.getPackageName());
        PendingIntent pending=PendingIntent.getBroadcast(activity,requestCode,message,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new RemoteAction(Icon.createWithResource(activity,iconId),title,title,pending);
    }
    @PluginMethod
    public void shareInvite(PluginCall call){
        String link=call.getString("url","");
        if(!link.startsWith("https://") || link.length()>2048){
            call.reject("Invalid watch-room invitation");return;
        }
        Activity activity=getActivity();
        activity.runOnUiThread(()->{
            try{
                Intent send=new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT,"Join my Marmalade Player watch room: "+link);
                send.putExtra(Intent.EXTRA_SUBJECT,"Marmalade Player Invitation");
                activity.startActivity(Intent.createChooser(send,"Share watch-room invitation"));
                call.resolve();
            }catch(Exception error){call.reject("Could not open Android share sheet",error);}
        });
    }
    @PluginMethod
    public void returnToApp(PluginCall call) {
        Activity activity=getActivity();
        activity.runOnUiThread(()->{
            try {
                restoreFloating(activity);
                Intent resume=new Intent(activity,MainActivity.class);
                resume.setAction("app.marmaladeplayer.RETURN_FROM_PIP");
                resume.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                activity.startActivity(resume);
                call.resolve();
            } catch(Exception error) { call.reject("Unable to return to full player",error); }
        });
    }
    @PluginMethod
    public void enter(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("System Picture-in-Picture requires Android 8 or later.");
            return;
        }
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                // Android owns the actual mini-window resizing and touch controls.
                // Add 10s rewind, play/pause, and 10s forward as native PiP actions;
                // the same icons are also drawn in the WebView at bottom-left.
                Intent resume = new Intent(activity, MainActivity.class);
                resume.setAction("app.marmaladeplayer.RETURN_FROM_PIP");
                resume.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent returnIntent = PendingIntent.getActivity(activity, 88, resume,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                RemoteAction rewindAction=mediaAction(activity,"app.marmaladeplayer.PIP_REWIND",
                    89,android.R.drawable.ic_media_rew,"Rewind 10 seconds");
                RemoteAction playAction=mediaAction(activity,"app.marmaladeplayer.PIP_PLAY_TOGGLE",
                    90,android.R.drawable.ic_media_play,"Play / Pause");
                RemoteAction forwardAction=mediaAction(activity,"app.marmaladeplayer.PIP_FORWARD",
                    91,android.R.drawable.ic_media_ff,"Forward 10 seconds");
                PictureInPictureParams.Builder builder=new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9))
                    .setActions(Arrays.asList(rewindAction,playAction,forwardAction));
                // Android 13+ can intercept the PiP X button and bring the
                // existing activity back instead of leaving a fullscreen WebView.
                if(Build.VERSION.SDK_INT>=33) {
                    builder.setCloseAction(new RemoteAction(
                        Icon.createWithResource(activity,android.R.drawable.ic_menu_revert),
                        "Return to Marmalade Player","Reopen the full player",returnIntent));
                }
                PictureInPictureParams params=builder.build();
                if (!activity.getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
                    call.reject("Android reports Picture-in-Picture disabled on this device.");return;
                }
                if (activity.enterPictureInPictureMode(params)) call.resolve();
                else call.reject("System Picture-in-Picture was declined.");
            } catch (Exception error) {
                call.reject("System Picture-in-Picture unavailable on this device.", error);
            }
        });
    }

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode=call.getString("mode","lock");
        Activity activity=getActivity();
        activity.runOnUiThread(()->{
            try {
                if ("landscape".equals(mode)) {
                    activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                } else if ("portrait".equals(mode)) {
                    activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                } else if ("auto".equals(mode)) {
                    activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
                } else if ("restore".equals(mode)) {
                    activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                } else {
                    int orient=activity.getResources().getConfiguration().orientation;
                    int rotation=activity.getWindowManager().getDefaultDisplay().getRotation();
                    boolean landscape=orient==android.content.res.Configuration.ORIENTATION_LANDSCAPE;
                    int desired=landscape ?
                        (rotation==android.view.Surface.ROTATION_270 ?
                         android.content.pm.ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE :
                         android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) :
                        (rotation==android.view.Surface.ROTATION_180 ?
                         android.content.pm.ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT :
                         android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    activity.setRequestedOrientation(desired);
                }
                call.resolve();
            } catch(Exception error) {call.reject("Could not change orientation",error);}
        });
    }

    @PluginMethod
    public void enterFullscreen(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController control = activity.getWindow().getInsetsController();
                    if (control != null) {
                        control.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        control.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    }
                } else {
                    activity.getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                }
                if(activity instanceof MainActivity)((MainActivity)activity).setVideoFullscreen(true);
                View content=activity.findViewById(android.R.id.content);
                if(content!=null){content.setPadding(0,0,0,0);content.requestApplyInsets();}
                call.resolve();
            } catch (Exception error) { call.reject("Immersive fullscreen unavailable.", error); }
        });
    }

    @PluginMethod
    public void exitFullscreen(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController control = activity.getWindow().getInsetsController();
                    if (control != null)
                        control.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else activity.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                if(activity instanceof MainActivity)((MainActivity)activity).setVideoFullscreen(false);
                View content=activity.findViewById(android.R.id.content);
                if(content!=null)content.requestApplyInsets();
                call.resolve();
            } catch (Exception error) { call.reject("Could not restore system bars.", error); }
        });
    }
}
`;
  writeFileSync(resolve(nativeDir,'MarmaladePictureInPicturePlugin.java'),plugin);
  writeFileSync(activity,`package app.marmaladeplayer.mobile;

import android.content.res.Configuration;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.view.View;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean videoFullscreen=false;
    public void setVideoFullscreen(boolean value){videoFullscreen=value;}
    // Refresh WebVTT/SRT text even when Android throttles JS timers in PiP.
    private final Handler subtitleHandler=new Handler(Looper.getMainLooper());
    private final Runnable subtitleRefresh=new Runnable(){
        @Override public void run(){
            if(android.os.Build.VERSION.SDK_INT>=26 && isInPictureInPictureMode()){
                if(bridge!=null && bridge.getWebView()!=null)
                    bridge.getWebView().evaluateJavascript(
                        "window.MarmaladeSubtitleRefresh&&window.MarmaladeSubtitleRefresh();",null);
                subtitleHandler.postDelayed(this,200);
            }
        }
    };
    private final BroadcastReceiver pipMediaReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (bridge != null && bridge.getWebView() != null) {
                final String type;
                String action=intent.getAction();
                if("app.marmaladeplayer.PIP_REWIND".equals(action))type="rewind";
                else if("app.marmaladeplayer.PIP_FORWARD".equals(action))type="forward";
                else type="playpause";
                bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('marmalade:pip-command',{detail:{type:'"+
                      type+"'}}));",null));
            }
        }
    };
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MarmaladePictureInPicturePlugin.class);
        super.onCreate(savedInstanceState);
        // Dedicated movie-player WebView: native host permission permits
        // audible autoplay without another in-video gesture on Android.
        if (getBridge() != null && getBridge().getWebView() != null)
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        IntentFilter pipFilter = new IntentFilter("app.marmaladeplayer.PIP_PLAY_TOGGLE");
        pipFilter.addAction("app.marmaladeplayer.PIP_REWIND");
        pipFilter.addAction("app.marmaladeplayer.PIP_FORWARD");
        if (Build.VERSION.SDK_INT >= 33)
            registerReceiver(pipMediaReceiver, pipFilter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(pipMediaReceiver, pipFilter);
        // Edge-to-edge Android 15 must inset the actual CONTENT ROOT, not
        // the WebView contents. This keeps the title bar below the clock,
        // battery and camera cutout while respecting the bottom gesture bar.
        getWindow().setStatusBarColor(Color.rgb(13,7,34));
        View root = findViewById(android.R.id.content);
        if (root != null) {
            root.setBackgroundColor(Color.rgb(13,7,34));
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int top, bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
                    android.graphics.Insets bars = insets.getInsets(types);
                    top = bars.top;
                    bottom = bars.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                if (videoFullscreen ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode())) {
                    top = 0; bottom = 0;
                }
                view.setPadding(0, top, 0, bottom);
                return insets;
            });
            root.requestApplyInsets();
        }
    }

    private void notifyRestored() {
        if(bridge!=null && bridge.getWebView()!=null)
            bridge.getWebView().post(()->bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('marmalade:native-pip',{detail:{active:false}}));",null));
    }
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if("app.marmaladeplayer.RETURN_FROM_PIP".equals(intent.getAction())) {
            notifyRestored();
        }
    }
    @Override
    public void onResume() {
        super.onResume();
        // Reopening the main application via its launcher restores the same
        // live WebView from the overlay instead of leaving the activity blank.
        if(MarmaladePictureInPicturePlugin.restoreFloating(this))notifyRestored();
        else if(Build.VERSION.SDK_INT>=26 && !isInPictureInPictureMode())notifyRestored();
    }
    @Override
    public void onDestroy() {
        subtitleHandler.removeCallbacks(subtitleRefresh);
        try { unregisterReceiver(pipMediaReceiver); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean active, Configuration config) {
        super.onPictureInPictureModeChanged(active, config);
        subtitleHandler.removeCallbacks(subtitleRefresh);
        if(active) subtitleHandler.post(subtitleRefresh);
        View root = findViewById(android.R.id.content);
        if (root != null) root.requestApplyInsets();
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
