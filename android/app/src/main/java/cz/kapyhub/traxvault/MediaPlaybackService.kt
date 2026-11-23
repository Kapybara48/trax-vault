package cz.kapyhub.traxvault

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class MediaPlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "traxvault_media_playback"
        const val NOTIFICATION_ID = 2001

        const val ACTION_START_OR_UPDATE = "cz.kapyhub.traxvault.ACTION_UPDATE_PLAYBACK"
        const val ACTION_STOP = "cz.kapyhub.traxvault.ACTION_STOP_PLAYBACK"
        const val ACTION_PLAY = "cz.kapyhub.traxvault.ACTION_PLAY"
        const val ACTION_PAUSE = "cz.kapyhub.traxvault.ACTION_PAUSE"
        const val ACTION_PREV = "cz.kapyhub.traxvault.ACTION_PREV"
        const val ACTION_NEXT = "cz.kapyhub.traxvault.ACTION_NEXT"
        const val ACTION_SEEK = "cz.kapyhub.traxvault.ACTION_SEEK"

        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_ARTIST = "extra_artist"
        const val EXTRA_ALBUM = "extra_album"
        const val EXTRA_COVER_URL = "extra_cover_url"
        const val EXTRA_IS_PLAYING = "extra_is_playing"
        const val EXTRA_POSITION_MS = "extra_position_ms"
        const val EXTRA_DURATION_MS = "extra_duration_ms"
        const val EXTRA_SEEK_POSITION = "extra_seek_pos"

        var actionListener: MediaActionListener? = null
        var isServiceRunning = false
            private set
    }

    interface MediaActionListener {
        fun onTogglePlay()
        fun onPlayNext()
        fun onPlayPrevious()
        fun onSeekTo(positionSeconds: Double)
        fun onStopPlayback()
    }

    private lateinit var mediaSession: MediaSessionCompat
    private var currentTitle = "Trax Vault"
    private var currentArtist = "Playing Music"
    private var currentAlbum = ""
    private var currentCoverUrl = ""
    private var currentCoverBitmap: Bitmap? = null
    private var isPlaying = false
    private var positionMs = 0L
    private var durationMs = 0L

    override fun onCreate() {
        super.onCreate()
        isServiceRunning = true
        createNotificationChannel()

        mediaSession = MediaSessionCompat(this, "TraxVaultPlaybackSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    actionListener?.onTogglePlay()
                }

                override fun onPause() {
                    actionListener?.onTogglePlay()
                }

                override fun onSkipToNext() {
                    actionListener?.onPlayNext()
                }

                override fun onSkipToPrevious() {
                    actionListener?.onPlayPrevious()
                }

                override fun onSeekTo(pos: Long) {
                    val sec = (pos.coerceAtLeast(0L) / 1000.0)
                    actionListener?.onSeekTo(sec)
                }

                override fun onStop() {
                    actionListener?.onStopPlayback()
                    stopPlaybackService()
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY

        when (action) {
            ACTION_START_OR_UPDATE -> {
                currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: "Trax Vault"
                currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: "Music Player"
                currentAlbum = intent.getStringExtra(EXTRA_ALBUM) ?: ""
                val newCoverUrl = intent.getStringExtra(EXTRA_COVER_URL) ?: ""
                isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false)
                positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L)
                durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)

                if (newCoverUrl.isNotEmpty() && newCoverUrl != currentCoverUrl) {
                    currentCoverUrl = newCoverUrl
                    loadCoverArtAsync(newCoverUrl)
                } else if (newCoverUrl.isEmpty()) {
                    currentCoverUrl = ""
                    currentCoverBitmap = null
                }

                updateMediaSessionState()
                val notification = buildMediaNotification()

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            }
            ACTION_PLAY, ACTION_PAUSE -> {
                actionListener?.onTogglePlay()
            }
            ACTION_NEXT -> {
                actionListener?.onPlayNext()
            }
            ACTION_PREV -> {
                actionListener?.onPlayPrevious()
            }
            ACTION_SEEK -> {
                val seekMs = intent.getLongExtra(EXTRA_SEEK_POSITION, 0L)
                actionListener?.onSeekTo(seekMs / 1000.0)
            }
            ACTION_STOP -> {
                actionListener?.onStopPlayback()
                stopPlaybackService()
            }
        }

        return START_NOT_STICKY
    }

    private fun updateMediaSessionState() {
        val stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                positionMs,
                if (isPlaying) 1.0f else 0.0f,
                SystemClock.elapsedRealtime()
            )

        mediaSession.setPlaybackState(stateBuilder.build())

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)

        if (currentCoverBitmap != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentCoverBitmap)
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, currentCoverBitmap)
        }

        mediaSession.setMetadata(metaBuilder.build())
    }

    private fun buildMediaNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, MediaPlaybackService::class.java).apply { action = ACTION_PREV },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseAction = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
        val playPauseIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, MediaPlaybackService::class.java).apply { action = playPauseAction },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nextIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, MediaPlaybackService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = PendingIntent.getService(
            this,
            4,
            Intent(this, MediaPlaybackService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying) {
            android.R.drawable.ic_media_pause
        } else {
            android.R.drawable.ic_media_play
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum.ifEmpty { null })
            .setContentIntent(contentIntent)
            .setDeleteIntent(stopIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "Previous", prevIntent)
            .addAction(playPauseIcon, if (isPlaying) "Pause" else "Play", playPauseIntent)
            .addAction(android.R.drawable.ic_media_next, "Next", nextIntent)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(stopIntent)
            )

        if (currentCoverBitmap != null) {
            builder.setLargeIcon(currentCoverBitmap)
        }

        return builder.build()
    }

    private fun loadCoverArtAsync(urlStr: String) {
        Thread {
            try {
                var stream: InputStream? = null
                if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
                    val url = URL(urlStr)
                    val conn = url.openConnection() as HttpURLConnection
                    conn.connectTimeout = 4000
                    conn.readTimeout = 4000
                    conn.doInput = true
                    conn.connect()
                    stream = conn.inputStream
                }
                if (stream != null) {
                    val bitmap = BitmapFactory.decodeStream(stream)
                    stream.close()
                    if (bitmap != null) {
                        currentCoverBitmap = bitmap
                        updateMediaSessionState()
                        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                        nm?.notify(NOTIFICATION_ID, buildMediaNotification())
                    }
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Trax Vault Music Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Lock screen playback controls, track information, and artwork"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(channel)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        stopPlaybackService()
    }

    private fun stopPlaybackService() {
        try {
            mediaSession.isActive = false
            mediaSession.release()
        } catch (_: Exception) {}
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        isServiceRunning = false
    }

    override fun onDestroy() {
        isServiceRunning = false
        try {
            mediaSession.isActive = false
            mediaSession.release()
        } catch (_: Exception) {}
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
