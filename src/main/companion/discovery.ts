import * as dgram from "node:dgram";
import * as os from "node:os";
import {
  COMPANION_DISCOVERY_MAGIC,
  COMPANION_DISCOVERY_PORT,
  COMPANION_PROTOCOL_VERSION,
} from "./protocol";

/**
 * How the phone finds A-X-M without anyone typing an IP address.
 *
 * A UDP socket sits on a fixed port and answers probes that carry our magic
 * string. The phone broadcasts one probe, every A-X-M on the subnet replies with
 * its name and control port, and the phone shows the list.
 *
 * Plain UDP rather than mDNS on purpose: mDNS needs a native dependency that has to
 * be rebuilt for each Electron ABI and is the usual casualty of a packaging change,
 * while dgram ships with Node. The trade is that discovery does not cross subnets -
 * which is fine, because neither does anything else the companion does.
 *
 * The reply is deliberately dull: a name, a version and a port. It says nothing
 * about the library, the user or what is running, because anything on the network
 * can ask. Everything interesting is behind pairing on the control socket.
 */

export interface DiscoveryInfo {
  hostName: string;
  hostVersion: string;
  controlPort: number;
}

export class CompanionDiscovery {
  private socket: dgram.Socket | null = null;
  private info: DiscoveryInfo;
  private onError: (message: string) => void;

  constructor(info: DiscoveryInfo, onError: (message: string) => void = () => {}) {
    this.info = info;
    this.onError = onError;
  }

  /** Updates what replies say, without restarting the socket. */
  setInfo(info: Partial<DiscoveryInfo>): void {
    this.info = { ...this.info, ...info };
  }

  start(): void {
    if (this.socket) return;

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;

    socket.on("error", (err) => {
      // A port clash or a firewall refusal must not take the menu down; the
      // companion is optional, so it reports and stays off.
      this.onError(`Companion discovery could not start: ${err.message}`);
      this.stop();
    });

    socket.on("message", (data, remote) => {
      const text = data.toString("utf-8");
      // Ignore anything that is not aimed at us. Broadcast ports see a lot.
      if (!text.includes(COMPANION_DISCOVERY_MAGIC)) return;

      const reply = Buffer.from(
        JSON.stringify({
          magic: COMPANION_DISCOVERY_MAGIC,
          protocol: COMPANION_PROTOCOL_VERSION,
          hostName: this.info.hostName,
          hostVersion: this.info.hostVersion,
          controlPort: this.info.controlPort,
        }),
        "utf-8"
      );
      socket.send(reply, remote.port, remote.address, (err) => {
        if (err) this.onError(`Companion discovery reply failed: ${err.message}`);
      });
    });

    socket.bind(COMPANION_DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // Only needed for sending broadcasts; replies are unicast, so carry on.
      }
    });
  }

  stop(): void {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
  }

  isRunning(): boolean {
    return this.socket !== null;
  }
}

/**
 * The addresses a phone could reach this machine on, best first. Shown in the
 * settings screen so someone on a network where broadcast is blocked has something
 * to type, and used in nothing else.
 */
export function localAddresses(): string[] {
  const out: { address: string; score: number }[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      // Wi-Fi and Ethernet first; virtual adapters from VMs and VPNs are usually
      // the wrong answer and are pushed to the bottom rather than hidden.
      const virtual = /virtual|vmware|hyper-v|loopback|vethernet|tailscale|zerotier/i.test(name);
      out.push({ address: addr.address, score: virtual ? 1 : 0 });
    }
  }
  return out.sort((a, b) => a.score - b.score).map((a) => a.address);
}
