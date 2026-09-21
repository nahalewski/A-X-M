package com.axm.companion.net

import android.media.AudioAttributes
import android.media.MediaPlayer

/**
 * Plays the menu's current track on the phone itself, from the stream the host
 * offers, so the audio comes out of the phone - and of whatever the phone is
 * routed to: headphones, a Bluetooth speaker, a car. The host pauses its own
 * output while the phone has it and takes over again from the phone's position.
 *
 * One MediaPlayer, kept between tracks; the URL and the position come from the
 * host's media.state, so there is nothing to configure.
 */
class PhonePlayer {
    private var player: MediaPlayer? = null
    private var url: String? = null
    var playing = false
        private set

    fun play(streamUrl: String, positionSeconds: Double) {
        if (url != streamUrl || player == null) {
            release()
            url = streamUrl
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                setDataSource(streamUrl)
                setOnPreparedListener {
                    it.seekTo((positionSeconds * 1000).toInt())
                    it.start()
                    playing = true
                }
                setOnCompletionListener { playing = false }
                setOnErrorListener { _, _, _ -> playing = false; true }
                prepareAsync()
            }
        } else {
            player?.start()
            playing = true
        }
    }

    fun pause() {
        player?.takeIf { it.isPlaying }?.pause()
        playing = false
    }

    fun seekTo(seconds: Double) {
        player?.seekTo((seconds * 1000).toInt())
    }

    /** Seconds into the track, for handing playback back to the host. */
    fun position(): Double = (player?.currentPosition ?: 0) / 1000.0

    fun release() {
        player?.release()
        player = null
        url = null
        playing = false
    }
}
