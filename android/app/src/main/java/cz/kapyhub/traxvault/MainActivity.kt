package cz.kapyhub.traxvault

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONTokener
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var errorLayout: LinearLayout
    private lateinit var errorText: TextView

    private val prefsName = "TraxVaultPrefs"
    private val prefServerUrl = "server_url"

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val filePickerLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (filePathCallback != null) {
            val results = if (result.resultCode == RESULT_OK) {
                val data = result.data
                val clipData = data?.clipData
                val uri = data?.data
                when {
                    clipData != null -> Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                    uri != null -> arrayOf(uri)
                    else -> null
                }
            } else null
            filePathCallback?.onReceiveValue(results)
            filePathCallback = null
        }
    }

    private var backPressedTime: Long = 0

    private val offlineShellFileName = "player_offline_cache.html"

    private fun isNetworkConnected(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }

    private fun getOfflineShellFile(): File {
        return File(filesDir, offlineShellFileName)
    }

    private fun saveOfflineShell(htmlContent: String) {
        if (htmlContent.isBlank() || htmlContent.length < 500) return
        Thread {
            try {
                val file = getOfflineShellFile()
                FileOutputStream(file).use { out ->
                    out.write(htmlContent.toByteArray(Charsets.UTF_8))
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun loadOfflineShellDirectly(): Boolean {
        val file = getOfflineShellFile()
        if (file.exists() && file.length() > 500) {
            try {
                val html = file.readText(Charsets.UTF_8)
                val serverUrl = getServerUrl() ?: "https://traxvault.local"
                val baseUrl = if (serverUrl.contains("/player")) serverUrl else "$serverUrl/player"
                runOnUiThread {
                    errorLayout.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                    webView.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", baseUrl)
                }
                return true
            } catch (_: Exception) {}
        }
        return false
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Configure edge-to-edge dark system UI
        window.statusBarColor = Color.parseColor("#0a0a0a")
        window.navigationBarColor = Color.parseColor("#0a0a0a")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        // Root container
        rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0a0a0a"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Initialize WebView
        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0a0a0a"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        // Error / Offline Screen Layout
        errorLayout = createErrorView()
        errorLayout.visibility = View.GONE

        rootContainer.addView(webView)
        rootContainer.addView(errorLayout)
        setContentView(rootContainer)

        setupWebViewSettings()
        setupBackHandler()

        val savedUrl = getServerUrl()
        if (savedUrl.isNullOrBlank()) {
            showServerUrlDialog(isInitial = true)
        } else {
            loadServerUrl(savedUrl)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebViewSettings() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Append custom user-agent flag for native app detection
        val defaultUserAgent = settings.userAgentString
        settings.userAgentString = "$defaultUserAgent TraxVaultAndroid/1.7.57"

        // Cookie management
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // Delegate Service Worker requests to PWA cache
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val swController = android.webkit.ServiceWorkerController.getInstance()
            swController.setServiceWorkerClient(object : android.webkit.ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest?): android.webkit.WebResourceResponse? {
                    return null
                }
            })
        }

        // JavaScript interface
        webView.addJavascriptInterface(TraxNativeInterface(), "TraxNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                val currentServer = getServerUrl() ?: ""

                // Allow internal navigation within the configured server host
                if (currentServer.isNotEmpty() && url.startsWith(currentServer, ignoreCase = true)) {
                    return false
                }

                // If external link, open in device browser
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    false
                }
            }

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null
                // If main frame navigation to player occurs while offline, serve persistent offline shell
                if (request.isForMainFrame && (url.contains("/player") || url.endsWith("/"))) {
                    if (!isNetworkConnected()) {
                        val file = getOfflineShellFile()
                        if (file.exists() && file.length() > 500) {
                            try {
                                return WebResourceResponse("text/html", "UTF-8", FileInputStream(file))
                            } catch (_: Exception) {}
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    // If network fails, boot directly from the persistent offline shell
                    if (loadOfflineShellDirectly()) {
                        return
                    }
                    showOfflineError(error?.description?.toString() ?: "Network connection failed")
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Restore cache mode to default for future navigation
                view?.settings?.cacheMode = WebSettings.LOAD_DEFAULT
                if (url?.contains("/player") == true) {
                    // Clear intermediate login/redirect history so back gesture never leaves the player to /login
                    view?.clearHistory()

                    // Cache rendered HTML shell for offline launch
                    view?.evaluateJavascript("document.documentElement.outerHTML") { result ->
                        if (result != null && result != "null" && result.length > 500) {
                            try {
                                val html = JSONTokener(result).nextValue() as? String ?: result
                                saveOfflineShell(html)
                            } catch (_: Exception) {
                                saveOfflineShell(result)
                            }
                        }
                    }
                }
                errorLayout.visibility = View.GONE
                webView.visibility = View.VISIBLE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                }

                try {
                    filePickerLauncher.launch(intent)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }
        }
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // If error screen is displayed, handle double back exit directly
                if (webView.visibility != View.VISIBLE) {
                    handleExitDoubleBack()
                    return
                }

                // Query web player client whether Svelte UI consumed the back action (dialog, drawer, tab, or now-playing)
                webView.evaluateJavascript("window.__traxHandleBack ? window.__traxHandleBack() : false") { result ->
                    val handled = result?.trim()?.equals("true", ignoreCase = true) == true
                    if (handled) {
                        return@evaluateJavascript
                    }

                    // Not handled by web player: check if on secondary page or root
                    val currentUrl = webView.url ?: ""
                    val isPlayerPage = currentUrl.contains("/player")

                    if (!isPlayerPage && webView.canGoBack()) {
                        webView.goBack()
                    } else if (!isPlayerPage) {
                        val serverUrl = getServerUrl()
                        if (!serverUrl.isNullOrBlank()) {
                            loadServerUrl(serverUrl)
                        } else {
                            handleExitDoubleBack()
                        }
                    } else {
                        // At root library: require double back press within 2 seconds to exit app
                        handleExitDoubleBack()
                    }
                }
            }

            private fun handleExitDoubleBack() {
                val currentTime = System.currentTimeMillis()
                if (currentTime - backPressedTime < 2000) {
                    finish()
                } else {
                    backPressedTime = currentTime
                    Toast.makeText(this@MainActivity, "Press back again to exit", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun createErrorView(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0a0a0a"))
            setPadding(48, 48, 48, 48)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )

            // Title
            addView(TextView(this@MainActivity).apply {
                text = "Trax Vault Offline"
                setTextColor(Color.parseColor("#10b981"))
                textSize = 22f
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, 16)
            })

            // Error Description
            errorText = TextView(this@MainActivity).apply {
                text = getString(R.string.connection_error)
                setTextColor(Color.parseColor("#a3a3a3"))
                textSize = 14f
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, 32)
            }
            addView(errorText)

            // Retry Button
            addView(Button(this@MainActivity).apply {
                text = getString(R.string.retry)
                setBackgroundColor(Color.parseColor("#10b981"))
                setTextColor(Color.parseColor("#0a0a0a"))
                setOnClickListener {
                    val url = getServerUrl()
                    if (!url.isNullOrBlank()) {
                        errorLayout.visibility = View.GONE
                        webView.visibility = View.VISIBLE
                        webView.loadUrl(url)
                    }
                }
            })

            // Open Offline Player Button
            addView(Button(this@MainActivity).apply {
                text = "Play Offline Music"
                setBackgroundColor(Color.parseColor("#065f46"))
                setTextColor(Color.WHITE)
                setOnClickListener {
                    if (!loadOfflineShellDirectly()) {
                        val url = getServerUrl()
                        if (!url.isNullOrBlank()) {
                            errorLayout.visibility = View.GONE
                            webView.visibility = View.VISIBLE
                            val targetUrl = if (url.contains("/player")) url else "$url/player"
                            webView.loadUrl(targetUrl)
                        } else {
                            Toast.makeText(this@MainActivity, "No offline shell found. Connect once online to download music.", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            })

            // Change Server Button
            addView(Button(this@MainActivity).apply {
                text = getString(R.string.change_server)
                setBackgroundColor(Color.TRANSPARENT)
                setTextColor(Color.parseColor("#10b981"))
                setOnClickListener {
                    showServerUrlDialog(isInitial = false)
                }
            })
        }
    }

    private fun showOfflineError(description: String) {
        errorText.text = "$description\n\n${getString(R.string.check_network_message)}"
        webView.visibility = View.GONE
        errorLayout.visibility = View.VISIBLE
    }

    private fun showServerUrlDialog(isInitial: Boolean) {
        val currentUrl = getServerUrl() ?: ""
        val input = EditText(this).apply {
            hint = "https://trax.example.com"
            setText(currentUrl)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setSingleLine()
            setPadding(32, 24, 32, 24)
        }

        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(getString(R.string.server_url_dialog_title))
            .setMessage(getString(R.string.server_url_dialog_message))
            .setView(input)
            .setPositiveButton(getString(R.string.save_and_connect)) { _, _ ->
                var url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        url = "https://$url"
                    }
                    if (url.endsWith("/")) {
                        url = url.substring(0, url.length - 1)
                    }
                    saveServerUrl(url)
                    loadServerUrl(url)
                }
            }
            .setNegativeButton(if (isInitial) "Exit" else getString(R.string.cancel)) { dialog, _ ->
                dialog.dismiss()
                if (isInitial && getServerUrl().isNullOrBlank()) {
                    finish()
                }
            }
            .setCancelable(!isInitial)
            .show()
    }

    private fun loadServerUrl(serverUrl: String) {
        val targetUrl = if (serverUrl.contains("/player")) serverUrl else "$serverUrl/player"
        errorLayout.visibility = View.GONE
        webView.visibility = View.VISIBLE

        // If offline on app launch and cached shell exists, boot directly into offline player
        if (!isNetworkConnected() && loadOfflineShellDirectly()) {
            return
        }

        webView.loadUrl(targetUrl)
    }

    private fun getServerUrl(): String? {
        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        return prefs.getString(prefServerUrl, null)
    }

    private fun saveServerUrl(url: String) {
        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        prefs.edit().putString(prefServerUrl, url).apply()
    }

    inner class TraxNativeInterface {
        @JavascriptInterface
        fun changeServerUrl() {
            runOnUiThread {
                showServerUrlDialog(isInitial = false)
            }
        }

        @JavascriptInterface
        fun getServerUrl(): String {
            return this@MainActivity.getServerUrl() ?: ""
        }

        @JavascriptInterface
        fun getVersion(): String {
            return "1.7.57"
        }

        @JavascriptInterface
        fun showToast(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
