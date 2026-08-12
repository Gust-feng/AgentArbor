package dev.gustfeng.agentarbor;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install before BridgeActivity calls super so Android 28–30 use the
        // same starting-window contract as Android 12+.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // The required Android starting window is intentionally unbranded and
        // shares the WebView surface, so remove its exit animation immediately.
        splashScreen.setOnExitAnimationListener(splashScreenViewProvider -> splashScreenViewProvider.remove());
        super.onCreate(savedInstanceState);
    }
}
