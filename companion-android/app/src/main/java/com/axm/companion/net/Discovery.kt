package com.axm.companion.net

import com.axm.companion.protocol.DiscoveredHost
import com.axm.companion.protocol.Protocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * Finds A-X-M on the local network, so nobody has to type an IP address.
 *
 * One UDP probe goes out to every broadcast address the phone has, and each A-X-M
 * on the subnet unicasts a reply naming itself and the port to connect on. The
 * socket keeps listening for the whole window rather than stopping at the first
 * answer, because a household can have more than one.
 *
 * Deliberately not mDNS: this is a handful of lines against a platform socket,
 * where mDNS would mean a library and multicast locks for the same result on the
 * one network topology this app is ever used on.
 */
object Discovery {

    /**
     * Broadcasts a probe and collects replies for [timeoutMs]. Returns the hosts
     * found, most recently answered first, with duplicates from multiple
     * interfaces collapsed by address.
     */
    suspend fun probe(timeoutMs: Int = 1500): List<DiscoveredHost> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, DiscoveredHost>()
        var socket: DatagramSocket? = null
        try {
            socket = DatagramSocket().apply {
                broadcast = true
                soTimeout = 250
            }

            val payload = Protocol.DISCOVERY_MAGIC.toByteArray()
            for (target in broadcastAddresses()) {
                try {
                    socket.send(DatagramPacket(payload, payload.size, target, Protocol.DISCOVERY_PORT))
                } catch (_: Exception) {
                    // One dead interface should not stop the others being probed.
                }
            }

            val deadline = System.currentTimeMillis() + timeoutMs
            val buffer = ByteArray(2048)
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue          // nothing yet; keep waiting out the window
                }

                val text = String(packet.data, 0, packet.length)
                if (!text.contains(Protocol.DISCOVERY_MAGIC)) continue

                val host = try {
                    val o = JSONObject(text)
                    DiscoveredHost(
                        address = packet.address.hostAddress ?: continue,
                        controlPort = o.optInt("controlPort", Protocol.CONTROL_PORT),
                        hostName = o.optString("hostName", "A-X-M"),
                        hostVersion = o.optString("hostVersion", ""),
                        protocol = o.optInt("protocol", -1),
                    )
                } catch (_: Exception) {
                    continue          // a malformed reply is just not a host
                }
                found[host.address] = host
            }
        } catch (_: Exception) {
            // No network, or the socket was refused: an empty list, not a crash.
        } finally {
            socket?.close()
        }
        found.values.toList()
    }

    /**
     * Every interface's broadcast address, plus the global one as a backstop. Some
     * networks drop 255.255.255.255 while passing the per-subnet address, and some
     * do the reverse, so both go out.
     */
    private fun broadcastAddresses(): List<InetAddress> {
        val out = mutableListOf<InetAddress>()
        try {
            for (nic in NetworkInterface.getNetworkInterfaces()) {
                if (!nic.isUp || nic.isLoopback) continue
                for (address in nic.interfaceAddresses) {
                    val broadcast = address.broadcast ?: continue
                    if (address.address is Inet4Address) out.add(broadcast)
                }
            }
        } catch (_: Exception) {
            // Fall through to the global broadcast below.
        }
        try {
            out.add(InetAddress.getByName("255.255.255.255"))
        } catch (_: Exception) {
            // Nothing else to try.
        }
        return out.distinct()
    }
}
