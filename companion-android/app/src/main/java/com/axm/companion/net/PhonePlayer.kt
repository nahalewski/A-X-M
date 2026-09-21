package com.axm.companion.net

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer

/**
 * Plays the menu's current track on the phone itself, from the stream the host
 * offers, so the audio comes out of the phone - and of whatever the phone is
 * routed to: headphones, a Bluetooth speaker, a car. The host pauses its own
 * output while the phone has it and takes over again from the phone's position.
 *
 * ExoPlayer rather than MediaPlayer: it reads well ahead over HTTP (a minute of
 * audio buffered before it starts, more as it goes) and rides out Wi-Fi hiccups
 * that made MediaPlayer's progressive playback skip and cut out.
 */
class PhonePlayer(context: Context) {
    private val player: ExoPlayer = ExoPlayer.Builder(context)
        .setLoadControl(
            DefaultLoadControl.Builder()
                // Buffer generously: a song is a few MB and the LAN is fast, so
                // holding a minute or two costs nothing and survives a dropout.
                .setBufferDurationsMs(30_000, 120_000, 5_000, 10_000)
                .build()
        )
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true,
        )
        .setHandleAudioBecomingNoisy(true)
        .build()

    private var url: String? = null
    val playing: Boolean get() = player.isPlaying

    fun play(streamUrl: String, positionSeconds: Double) {
        if (url != streamUrl) {
            url = streamUrl
            player.setMediaItem(MediaItem.fromUri(streamUrl), (positionSeconds * 1000).toLong().coerceAtLeast(0))
            player.prepare()
        }
        player.playWhenReady = true
    }

    fun pause() {
        player.playWhenReady = false
    }

    fun seekTo(seconds: Double) {
        player.seekTo((seconds * 1000).toLong().coerceAtLeast(0))
    }

    /** Seconds into the track, for handing playback back to the host. */
    fun position(): Double = player.currentPosition / 1000.0

    /** Stops and forgets the track; the player itself stays for the next one. */
    fun release() {
        player.stop()
        player.clearMediaItems()
        url = null
    }

    fun destroy() {
        player.release()
    }

    fun isEnded(): Boolean = player.playbackState == Player.STATE_ENDED
}
