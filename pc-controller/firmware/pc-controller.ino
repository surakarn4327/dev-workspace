// pc-controller ESP32 firmware
//
// Wiring: GPIO RELAY_PIN -> relay module IN. Relay COM/NO wired in parallel
// across the motherboard's front-panel POWER SW header pins (same two pins
// the physical momentary power button connects to). Closing the relay for
// a few seconds mimics a human holding the power button — long enough to
// both power on a cold PC and force-shutdown a hung one.
//
// First boot (or after a "forget wifi" reset): the board opens its own
// access point named AP_NAME. Connect a phone to it, a captive-portal
// setup page pops up automatically (or open http://192.168.4.1). Fill in
// home wifi, HiveMQ Cloud credentials, device id/name and ntfy.sh topic.
// Values are persisted to flash; the board then reboots and connects to
// the configured wifi + broker directly on every subsequent boot.
//
// Required libraries (Arduino Library Manager):
//   - WiFiManager (tzapu/WiFiManager)
//   - PubSubClient (knolleary/PubSubClient)
// Board: "ESP32 Dev Module" (esp32 core by Espressif)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <ESP32Ping.h> // library: "ESP32Ping" by marian-craciunescu
#include <Preferences.h>

// ---------- config ----------

static const char* AP_NAME = "PC-Controller-Setup";
static const int RELAY_PIN = 26;
static const bool RELAY_ACTIVE_HIGH = true;
static const unsigned long HOLD_MS = 3000;

static const unsigned long PING_INTERVAL_MS = 60000;
static const unsigned long PING_TIMEOUT_MS = 1000;

// ---------- persisted settings (via WiFiManager custom params) ----------

char cfgMqttHost[64] = "";
char cfgMqttPort[6] = "8883";
char cfgMqttUser[64] = "";
char cfgMqttPass[64] = "";
char cfgDeviceId[32] = "pc01";
char cfgPcIp[16] = "192.168.1.100";
char cfgNtfyTopic[64] = "";

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

// ---------- ntfy.sh ----------

void notify(const String& message) {
  if (strlen(cfgNtfyTopic) == 0) return;
  WiFiClientSecure client;
  client.setInsecure(); // ntfy.sh's public CA chain; fine for a best-effort notification
  HTTPClient http;
  String url = "https://ntfy.sh/" + String(cfgNtfyTopic);
  if (http.begin(client, url)) {
    http.POST(message);
    http.end();
  }
}

// ---------- PC status via ping ----------

void publishRetained(const String& topic, const char* payload);

void checkPcStatus() {
  IPAddress ip;
  if (!ip.fromString(cfgPcIp)) return;
  bool online = Ping.ping(ip, 1);
  if (!pcOnlineKnown || online != pcOnlineLast) {
    publishRetained(topicStatus, online ? "online" : "offline");
    if (pcOnlineKnown) {
      notify(online ? "PC เปิดสำเร็จ" : "PC ปิดสำเร็จ");
    }
    pcOnlineLast = online;
    pcOnlineKnown = true;
  }
}

// ---------- MQTT ----------

void publishRetained(const String& topic, const char* payload) {
  mqtt.publish(topic.c_str(), payload, true);
}

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  if (String(topic) == topicCmd && msg == "toggle") {
    triggerRelayPulse();
  }
}

bool wasConnected = true;

void mqttConnect() {
  mqtt.setServer(cfgMqttHost, atoi(cfgMqttPort));
  mqtt.setCallback(onMqttMessage);

  String clientId = "esp32-" + String(cfgDeviceId);
  bool ok = mqtt.connect(
      clientId.c_str(), cfgMqttUser, cfgMqttPass,
      topicAvailability.c_str(), 1, true, "offline");

  if (ok) {
    publishRetained(topicAvailability, "online");
    mqtt.subscribe(topicCmd.c_str());
    if (!wasConnected) {
      // Best-effort only: we can't send anything while actually offline,
      // so this fires the moment we're back, not the moment we dropped.
      notify("ESP32 กลับมาออนไลน์แล้ว (เพิ่งหลุด wifi/MQTT ก่อนหน้านี้)");
    }
    wasConnected = true;
  } else {
    wasConnected = false;
  }
}

// ---------- wifi + provisioning ----------

void setupWifi() {
  WiFiManager wm;

  WiFiManagerParameter pHost("host", "HiveMQ host", cfgMqttHost, sizeof(cfgMqttHost));
  WiFiManagerParameter pPort("port", "MQTT port (TLS, usually 8883)", cfgMqttPort, sizeof(cfgMqttPort));
  WiFiManagerParameter pUser("user", "MQTT username", cfgMqttUser, sizeof(cfgMqttUser));
  WiFiManagerParameter pPass("pass", "MQTT password", cfgMqttPass, sizeof(cfgMqttPass));
  WiFiManagerParameter pDevice("device", "Device ID (a-z0-9, no spaces)", cfgDeviceId, sizeof(cfgDeviceId));
  WiFiManagerParameter pPcIp("pcip", "PC's LAN IP address", cfgPcIp, sizeof(cfgPcIp));
  WiFiManagerParameter pNtfy("ntfy", "ntfy.sh topic name", cfgNtfyTopic, sizeof(cfgNtfyTopic));

  wm.addParameter(&pHost);
  wm.addParameter(&pPort);
  wm.addParameter(&pUser);
  wm.addParameter(&pPass);
  wm.addParameter(&pDevice);
  wm.addParameter(&pPcIp);
  wm.addParameter(&pNtfy);

  wm.setConfigPortalTimeout(300); // 5 min, then reboot and retry rather than block forever

  bool connected = wm.autoConnect(AP_NAME);
  if (!connected) {
    delay(3000);
    ESP.restart();
  }

  strlcpy(cfgMqttHost, pHost.getValue(), sizeof(cfgMqttHost));
  strlcpy(cfgMqttPort, pPort.getValue(), sizeof(cfgMqttPort));
  strlcpy(cfgMqttUser, pUser.getValue(), sizeof(cfgMqttUser));
  strlcpy(cfgMqttPass, pPass.getValue(), sizeof(cfgMqttPass));
  strlcpy(cfgDeviceId, pDevice.getValue(), sizeof(cfgDeviceId));
  strlcpy(cfgPcIp, pPcIp.getValue(), sizeof(cfgPcIp));
  strlcpy(cfgNtfyTopic, pNtfy.getValue(), sizeof(cfgNtfyTopic));

  // WiFiManager only persists the wifi SSID/password itself. The custom
  // params above are read back into cfg* here and saved to NVS via
  // savePrefs() (called once in setup(), right after this function runs).
}

Preferences prefs;

void loadPrefs() {
  prefs.begin("pc-ctrl", true);
  prefs.getString("host", cfgMqttHost, sizeof(cfgMqttHost));
  prefs.getString("port", cfgMqttPort, sizeof(cfgMqttPort));
  prefs.getString("user", cfgMqttUser, sizeof(cfgMqttUser));
  prefs.getString("pass", cfgMqttPass, sizeof(cfgMqttPass));
  prefs.getString("device", cfgDeviceId, sizeof(cfgDeviceId));
  prefs.getString("pcip", cfgPcIp, sizeof(cfgPcIp));
  prefs.getString("ntfy", cfgNtfyTopic, sizeof(cfgNtfyTopic));
  prefs.end();
}

void savePrefs() {
  prefs.begin("pc-ctrl", false);
  prefs.putString("host", cfgMqttHost);
  prefs.putString("port", cfgMqttPort);
  prefs.putString("user", cfgMqttUser);
  prefs.putString("pass", cfgMqttPass);
  prefs.putString("device", cfgDeviceId);
  prefs.putString("pcip", cfgPcIp);
  prefs.putString("ntfy", cfgNtfyTopic);
  prefs.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  relaySet(false);

  loadPrefs();
  setupWifi();
  savePrefs();

  topicStatus = "pc-controller/" + String(cfgDeviceId) + "/status";
  topicAvailability = "pc-controller/" + String(cfgDeviceId) + "/availability";
  topicCmd = "pc-controller/" + String(cfgDeviceId) + "/cmd";

  tlsClient.setInsecure(); // HiveMQ Cloud uses a public CA; pin it properly if you want stricter TLS
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
