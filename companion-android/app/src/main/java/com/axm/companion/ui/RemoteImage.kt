package com.axm.companion.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Artwork from the host's URLs (Jellyfin posters, cover art) without pulling an
 * image library in for it. Small in-memory cache, background fetch, a plain
 * panel while it loads or when there is nothing.
 */
private val cache = HashMap<String, Bitmap>()

@Composable
fun RemoteImage(url: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    var bitmap by remember(url) { mutableStateOf(url?.let { cache[it] }) }
    LaunchedEffect(url) {
        if (url == null || bitmap != null) return@LaunchedEffect
        bitmap = withContext(Dispatchers.IO) {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 8000
                conn.instanceFollowRedirects = true
                conn.inputStream.use { BitmapFactory.decodeStream(it) }?.also { cache[url] = it }
            } catch (e: Exception) {
                null
            }
        }
    }
    val bmp = bitmap
    if (bmp != null) {
        Image(bmp.asImageBitmap(), contentDescription = null, modifier = modifier, contentScale = contentScale)
    } else {
        Box(modifier.background(Axm.PanelRaised))
    }
}
