# Product Network Modes

The goal is for an external client to transfer data through Flipper One
under the selected mode's addressing, routing, and traffic restrictions.
Use the [product scenarios](https://docs.flipper.net/one/general/features)
as the source.
[Connectivity and USB](connectivity.md) covers basic interfaces;
this page assesses traffic paths and mode restrictions.

## Initial checks for declared functions

| Mode | Expected outcome |
| --- | --- |
| Router / AP | ETH0 as WAN, client addressing and DNS, NAT, and transfer through selected LAN interfaces |
| STA + AP | Client access through a Wi-Fi uplink; both roles remain operational |
| USB network adapter | Transfer through the selected Ethernet/Wi-Fi uplink using a bridge or MAC proxy without NAT |
| VPN gateway | Client traffic, DNS, and IPv6 use the specified path; tunnel loss behavior matches requirements |
| Ethernet MitM / Sniffer | Transparent transfer through two ports, accurate capture, and saved PCAP |
| Discovery | Known hosts and services found through the selected passive or active method |

Retain topology, interface roles, clients, routes, and reference traffic.
Check transfer in both directions, interruption, and recovery.
Set the initial configuration for each mode to avoid effects from the previous one.

## Conditions and failures

For STA+AP, test shared and multiple channel operation separately
according to the available implementation.
Measure transfer for both roles under concurrent load.
Two bands do not imply independent throughput.
If captive portal access is declared, test client authentication
and subsequent operation of devices behind the router.

For the USB adapter, check addressing and access to local services,
including required multicast/discovery protocols.
A connection through NAT does not verify the declared transparency of this mode.

For VPN, check startup, tunnel establishment and loss, external network changes,
and reconnection while observing traffic outside the tunnel.

For passive Discovery, verify the device sends no discovery queries.
Test the transition to active actions separately.
For the Ethernet sniffer, compare traffic on both sides,
packet loss, and the declared invisibility of its own MAC addresses.

## Extended coverage and evidence

Add multiple clients, DNS/IPv6, settings persistence,
extended operation, and available capture export methods.
Use a network with known hosts, services, and traffic for discovery and capture.

Retain settings, client observations, traces and captures,
the actual path, and recovery results.
Record carrier capabilities and radio conditions when using
a [cellular modem](cellular.md).
Link profile and control checks to [Linux profiles](linux/profiles.md)
and [FlipCTL](flipctl.md).
