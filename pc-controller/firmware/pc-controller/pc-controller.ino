// pc-controller ESP32 firmware
//
// Wiring: GPIO RELAY_PIN -> relay module IN. Relay COM/NO wired in parallel
// across the motherboard's front-panel POWER SW header pins (same two pins
// the physical momentary power button connects to). Closing the relay for
// HOLD_MS mimics a human pressing the power button — enough to power on a
// cold PC or send a soft-shutdown request to a running one, but NOT long
// enough for a force-shutdown of a hung PC (that needs a ~4s+ hold on most
// motherboards; bump HOLD_MS if you need that too).
//
// First boot (or after a "forget wifi" reset): the board opens its own
// access point named AP_NAME. Connect a phone to it, a captive-portal
// setup page pops up automatically (or open http://192.168.4.1). Fill in
// home wifi, a device ID, the PC's LAN IP, and a Discord webhook URL used
// to send notifications. Values are persisted to flash; the board then
// reboots and connects to the configured wifi + broker directly on every
// subsequent boot.
//
// MQTT broker: broker.emqx.io, EMQX's public test broker. It is free and
// requires no account or credentials at all — trading a little privacy
// (anyone who guesses your device ID could publish to your topics) for a
// much simpler setup. Pick a long, random-looking device ID to mitigate
// that, the same way you'd pick an unguessable ntfy.sh topic name.
//
// Required libraries (Arduino Library Manager):
//   - WiFiManager (tzapu/WiFiManager)
//   - PubSubClient (knolleary/PubSubClient)
//   - ESPping (dvarrel/ESPping — successor to the original ESP32Ping)
// Board: "ESP32 Dev Module" (esp32 core by Espressif)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ESPping.h>
#include <Preferences.h>
#include <HTTPClient.h>
extern "C" {
#include "lwip/etharp.h"
#include "lwip/netif.h"
}

// ---------- config ----------

static const char* AP_NAME = "PC-Controller-Setup";
static const int RELAY_PIN = 23;
static const bool RELAY_ACTIVE_HIGH = false; // most low-cost single-channel relay modules trigger on LOW, not HIGH
static const unsigned long HOLD_MS = 1000; // relay contact-closure duration (not the app's hold-to-confirm gesture, that's separate in src/main.ts)

static const unsigned long PING_INTERVAL_MS = 60000;
static const unsigned long PING_TIMEOUT_MS = 1000;

static const char* MQTT_HOST = "broker.emqx.io";
static const int MQTT_PORT = 8883; // TLS, no credentials needed

// ---------- persisted settings (via WiFiManager custom params) ----------

char cfgDeviceId[32] = ""; // must be filled in during setup — long/random for privacy
char cfgPcIp[16] = "192.168.1.100";
char cfgDiscordWebhook[192] = ""; // e.g. https://discord.com/api/webhooks/<id>/<token>

String topicStatus, topicAvailability, topicCmd;

WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);

bool pcOnlineLast = false;
bool pcOnlineKnown = false;
unsigned long lastPingAt = 0;

bool relayHoldActive = false;
unsigned long relayHoldUntil = 0;

// ---------- relay ----------

void relaySet(bool closed) {
  digitalWrite(RELAY_PIN, closed == RELAY_ACTIVE_HIGH ? HIGH : LOW);
}

void triggerRelayPulse() {
  Serial.println("[relay] pulse triggered");
  relaySet(true);
  relayHoldActive = true;
  relayHoldUntil = millis() + HOLD_MS;
}

void serviceRelay() {
  if (relayHoldActive && millis() >= relayHoldUntil) {
    relaySet(false);
    relayHoldActive = false;
  }
}

// ---------- notifications (Discord webhook) ----------

String jsonEscape(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out;
}

void notify(const String& message) {
  if (strlen(cfgDiscordWebhook) == 0) return;
  WiFiClientSecure client;
  client.setInsecure(); // Discord's public CA chain; fine for a best-effort notification
  HTTPClient http;
  if (!http.begin(client, cfgDiscordWebhook)) return;
  http.addHeader("Content-Type", "application/json");
  String body = "{\"content\":\"" + jsonEscape(message) + "\"}";
  http.POST(body);
  http.end();
}

// ---------- PC status via ARP (works even when the PC's firewall blocks ICMP ping) ----------

void publishRetained(const String& topic, const char* payload);

// A device can silently drop ICMP (Windows does, by default) but it cannot opt
// out of ARP — replying to "who has this IP" is required just to receive any
// traffic at all. So: trigger ARP resolution (Ping.ping() does this as a side
// effect regardless of whether the ICMP reply itself gets through), then check
// the ARP table directly instead of trusting the ping result.
bool arpCheckOnline(IPAddress ip) {
  Ping.ping(ip, 1); // return value ignored on purpose — ICMP may be blocked
  delay(100);
  struct netif* ni = netif_default;
  if (!ni) return false;
  ip4_addr_t target;
  target.addr = (uint32_t)ip;
  struct eth_addr* ethRet;
  const ip4_addr_t* ipRet;
  bool found = etharp_find_addr(ni, &target, &ethRet, &ipRet) >= 0;
  Serial.printf("[arp] check %s -> %s\n", ip.toString().c_str(), found ? "online" : "offline");
  return found;
}

void checkPcStatus() {
  IPAddress ip;
  if (!ip.fromString(cfgPcIp)) return;
  bool online = arpCheckOnline(ip);
  if (!pcOnlineKnown || online != pcOnlineLast) {
    publishRetained(topicStatus, online ? "online" : "offline");
    if (pcOnlineKnown) {
      notify(String(cfgDeviceId) + (online ? " เปิดสำเร็จ ✅" : " ปิดสำเร็จ ⏻"));
    }
    pcOnlineLast = online;
    pcOnlineKnown = true;
  }
}

// ---------- MQTT ----------

void publishRetained(const String& topic, const char* payload) {
  mqtt.publish(topic.c_str(), payload, true);
}

unsigned long lastToggleAt = 0;
static const unsigned long TOGGLE_DEBOUNCE_MS = 2000; // ignore a second "toggle" this soon after the last one

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  Serial.printf("[mqtt] message on %s: %s\n", topic, msg.c_str());
  if (String(topic) == topicCmd && msg == "toggle") {
    // Debounced: a duplicate/retried MQTT delivery of the same command would
    // otherwise press the power button a second time — which most
    // motherboards read as "shut down" if the PC just turned on. One real
    // button hold should never produce two toggles within 2 seconds.
    unsigned long now = millis();
    if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) {
      Serial.println("[relay] duplicate toggle ignored (debounce)");
      return;
    }
    lastToggleAt = now;
    triggerRelayPulse();
  }
}

bool wasConnected = true;

void mqttConnect() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);

  String clientId = "esp32-" + String(cfgDeviceId);
  // No username/password: broker.emqx.io is a public broker that accepts
  // anonymous connections.
  bool ok = mqtt.connect(
      clientId.c_str(),
      topicAvailability.c_str(), 1, true, "offline");

  if (ok) {
    Serial.println("[mqtt] connected");
    publishRetained(topicAvailability, "online");
    mqtt.subscribe(topicCmd.c_str());
    if (!wasConnected) {
      // Best-effort only: we can't send anything while actually offline,
      // so this fires the moment we're back, not the moment we dropped.
      notify(String(cfgDeviceId) + " หลุด wifi/MQTT ไปช่วงหนึ่ง ตอนนี้กลับมาออนไลน์แล้ว ⚠️");
    }
    wasConnected = true;
  } else {
    Serial.printf("[mqtt] connect failed, state=%d\n", mqtt.state());
    wasConnected = false;
  }
}

// ---------- wifi + provisioning ----------

void setupWifi() {
  WiFiManager wm;

  // Captured before we pre-fill cfgDeviceId below, so this reflects whether
  // pc-controller's setup has actually been completed before (see the
  // resetSettings() call further down).
  bool firstRun = (strlen(cfgDeviceId) == 0);

  if (firstRun) {
    // Pre-fill a random-looking, unique-per-board ID from the chip's MAC
    // address so the user can just accept the default instead of having to
    // invent and type one themselves.
    uint64_t mac = ESP.getEfuseMac();
    snprintf(cfgDeviceId, sizeof(cfgDeviceId), "pc-%04x%04x", (uint16_t)(mac >> 16), (uint16_t)mac);
  }

  WiFiManagerParameter pDevice("device", "Device ID (already filled in — just copy this into the web app too)", cfgDeviceId, sizeof(cfgDeviceId));
  WiFiManagerParameter pPcIp("pcip", "PC's LAN IP address", cfgPcIp, sizeof(cfgPcIp));
  WiFiManagerParameter pDiscord("discord", "Discord webhook URL", cfgDiscordWebhook, sizeof(cfgDiscordWebhook));

  wm.addParameter(&pDevice);
  wm.addParameter(&pPcIp);
  wm.addParameter(&pDiscord);

  wm.setConfigPortalTimeout(300); // 5 min, then reboot and retry rather than block forever

  // If our own config (device ID) was never saved, this board has not
  // completed pc-controller's setup yet — force the portal open even if
  // the board already has wifi credentials saved from some earlier,
  // unrelated project. Without this, autoConnect() silently reconnects to
  // that old network and skips the portal entirely, leaving cfgDeviceId
  // etc. blank with no visible error.
  if (firstRun) {
    Serial.println("[wifi] no saved pc-controller config found — forcing setup portal");
    wm.resetSettings();
  }

  Serial.println("[wifi] starting autoConnect...");
  bool connected = wm.autoConnect(AP_NAME);
  Serial.printf("[wifi] autoConnect result: %s\n", connected ? "connected" : "failed");
  if (!connected) {
    delay(3000);
    ESP.restart();
  }

  strlcpy(cfgDeviceId, pDevice.getValue(), sizeof(cfgDeviceId));
  strlcpy(cfgPcIp, pPcIp.getValue(), sizeof(cfgPcIp));
  strlcpy(cfgDiscordWebhook, pDiscord.getValue(), sizeof(cfgDiscordWebhook));

  // WiFiManager only persists the wifi SSID/password itself. The custom
  // params above are read back into cfg* here and saved to NVS via
  // savePrefs() (called once in setup(), right after this function runs).
}

Preferences prefs;

void loadPrefs() {
  prefs.begin("pc-ctrl", true);
  prefs.getString("device", cfgDeviceId, sizeof(cfgDeviceId));
  prefs.getString("pcip", cfgPcIp, sizeof(cfgPcIp));
  prefs.getString("discord", cfgDiscordWebhook, sizeof(cfgDiscordWebhook));
  prefs.end();
}

void savePrefs() {
  prefs.begin("pc-ctrl", false);
  prefs.putString("device", cfgDeviceId);
  prefs.putString("pcip", cfgPcIp);
  prefs.putString("discord", cfgDiscordWebhook);
  prefs.end();
}

void setup() {
  Serial.begin(115200);
  delay(300); // let the USB-serial bridge settle before the first print
  Serial.println("\n[boot] pc-controller starting");

  pinMode(RELAY_PIN, OUTPUT);
  relaySet(false);

  loadPrefs();
  setupWifi();
  savePrefs();

  topicStatus = "pc-controller/" + String(cfgDeviceId) + "/status";
  topicAvailability = "pc-controller/" + String(cfgDeviceId) + "/availability";
  topicCmd = "pc-controller/" + String(cfgDeviceId) + "/cmd";

  tlsClient.setInsecure(); // broker.emqx.io uses a public CA; pin it properly if you want stricter TLS

  Serial.printf("[boot] device=%s ip=%s pcip=%s mqtt=%s:%d\n", cfgDeviceId, WiFi.localIP().toString().c_str(), cfgPcIp, MQTT_HOST, MQTT_PORT);
}

void loop() {
  if (!mqtt.connected()) {
    static unsigned long lastAttempt = 0;
    if (millis() - lastAttempt > 5000) {
      lastAttempt = millis();
      mqttConnect();
    }
  } else {
    mqtt.loop();
  }

  if (millis() - lastPingAt > PING_INTERVAL_MS) {
    lastPingAt = millis();
    checkPcStatus();
  }

  serviceRelay();
}
