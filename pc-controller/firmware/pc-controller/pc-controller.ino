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

static const unsigned long PING_INTERVAL_MS = 10000;
static const unsigned long PING_TIMEOUT_MS = 1000;

// GPIO0 is the built-in "BOOT" button on every ESP32-WROOM-32 dev board,
// already wired to an on-board pull-up + pushbutton to GND — no extra
// wiring needed. It only affects boot mode (flash vs run) at power-on/reset;
// reading it as a plain input during loop() has no special meaning and is
// safe to reuse for this.
static const int WIFI_RESET_PIN = 0;
static const unsigned long WIFI_RESET_HOLD_MS = 5000; // hold BOOT this long to forget wifi + all saved settings

static const char* MQTT_HOST = "broker.emqx.io";
static const int MQTT_PORT = 8883; // TLS, no credentials needed

// Must match the actual deployed Vercel domain (see ../../README.md) — used
// only to build the post-setup link shown on the "Credentials saved" page,
// pre-filled with this board's Device ID so the buyer never has to
// copy/type it into the web app themselves.
static const char* WEBAPP_URL = "https://pc-controller-eight.vercel.app/";

// ---------- persisted settings (via WiFiManager custom params) ----------

char cfgDeviceId[32] = ""; // must be filled in during setup — long/random for privacy
char cfgPcIp[16] = "192.168.1.100";
char cfgDiscordWebhook[192] = ""; // e.g. https://discord.com/api/webhooks/<id>/<token>

String topicStatus, topicAvailability, topicCmd;

WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
Preferences prefs;

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

// ---------- wifi reset button (hold BOOT, no reflash needed) ----------

unsigned long wifiResetPressStart = 0;
bool wifiResetTriggered = false;

void serviceWifiResetButton() {
  bool pressed = digitalRead(WIFI_RESET_PIN) == LOW;
  if (!pressed) {
    wifiResetPressStart = 0;
    return;
  }
  if (wifiResetPressStart == 0) {
    wifiResetPressStart = millis();
    return;
  }
  if (!wifiResetTriggered && millis() - wifiResetPressStart >= WIFI_RESET_HOLD_MS) {
    wifiResetTriggered = true;
    Serial.println("[wifi] BOOT held for reset threshold - forgetting wifi + settings");
    notify(String(cfgDeviceId) + " กำลังรีเซ็ต wifi (มีคนกดปุ่ม BOOT ค้าง) กรุณาตั้งค่าใหม่ผ่าน " + String(AP_NAME) + " 🔄");
    prefs.begin("pc-ctrl", false);
    prefs.clear();
    prefs.end();
    WiFi.disconnect(true, true); // erase WiFiManager's saved SSID/password too
    delay(500);
    ESP.restart();
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

// Restyles every WiFiManager portal page (colors/fonts/rounded corners) to
// match the web app's own look (see src/style.css) via a plain CSS override
// injected through WiFiManager's public setCustomHeadElement() hook, which
// splices raw HTML into <head> on every page. WiFiManager's own English
// copy ("Config ESP", "SSID", "Credentials saved", ...) is left as-is —
// translating it would mean forking the library, not just skinning it.
// Applies unconditionally (every portal page), unlike the save-page block
// below which is gated to one specific page.
String buildPortalBrandingHeadElement() {
  String html;
  html += "<style>";
  html += ":root{--bg:#0f1115;--surface:#161a23;--text:#eef1f6;--muted:#8b93a3;--accent:#35d07f;--danger:#ff5c5c}";
  html += "html,body{background:var(--bg)!important;color:var(--text)!important;font-family:system-ui,-apple-system,'Segoe UI',sans-serif!important;margin:0}";
  html += ".wrap{max-width:420px;margin:0 auto;padding:24px 20px}";
  html += "h1{font-size:1.4rem;margin:0 0 4px}";
  html += "h3{color:var(--muted)!important;font-weight:400;font-size:0.9rem;margin:0 0 16px}";
  html += "hr{border:none;border-top:1px solid #2a2f3a;margin:16px 0}";
  html += "a{color:var(--accent)!important}";
  html += "label{color:var(--muted);font-size:0.85rem}";
  html += "input,select{background:var(--surface)!important;border:1px solid #2a2f3a!important;border-radius:10px!important;color:var(--text)!important}";
  html += "button,input[type=button],input[type=submit]{background:var(--accent)!important;color:#06210f!important;border-radius:12px!important;font-weight:600!important;font-size:1rem!important;line-height:2.6rem!important}";
  html += "button.D{background:var(--danger)!important;color:#fff!important}";
  html += ".msg{background:var(--surface)!important;border:1px solid #2a2f3a!important;border-left-width:5px!important;border-radius:10px!important;color:var(--text)!important}";
  html += ".msg.S{border-left-color:var(--accent)!important}.msg.S h4{color:var(--accent)!important}";
  html += ".msg.D{border-left-color:var(--danger)!important}.msg.D h4{color:var(--danger)!important}";
  html += "#pcc-brand{display:flex;align-items:center;gap:8px;margin-bottom:18px;font-weight:600;font-size:1.05rem}";
  html += "#pcc-brand .dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}";
  html += "</style>";
  html += "<script>window.addEventListener('load',function(){";
  html += "var w=document.querySelector('.wrap');if(!w)return;";
  html += "var b=document.createElement('div');b.id='pcc-brand';";
  html += "b.innerHTML='<span class=\"dot\"></span> PC Controller — ตั้งค่าอุปกรณ์';";
  html += "w.insertBefore(b, w.firstChild);";
  html += "});</script>";
  return html;
}

// WiFiManager's "Credentials saved" page (shown right after the setup form
// is submitted, while the phone is still on the ESP32's own AP) is the last
// screen we get to talk to the phone on directly. At the moment it loads,
// the phone typically still has no real internet (it hasn't reconnected to
// home wifi/mobile data yet) — a plain JS redirect fired immediately would
// just fail. So instead of a single attempt, this polls: every 2s it tries
// a no-cors fetch of the web app's own URL (succeeds once the phone can
// actually reach it, regardless of AP/wifi switching in between) and only
// then navigates. The Device ID is embedded via ?device= either way, and
// the same URL stays visible as a tappable link the whole time — if the
// auto-redirect never fires (probe blocked, browser tab backgrounded,
// whatever), the buyer can still just tap it manually, so this can only
// improve on the old plain-link behavior, never regress it.
//
// Gated on document.title so it only runs on the actual "Credentials
// saved" page, not on every other portal page this head element also
// loads on.
String buildPostSaveLinkHeadElement() {
  String url = String(WEBAPP_URL) + "?device=" + String(cfgDeviceId);
  String html;
  html += "<script>window.addEventListener('load',function(){";
  html += "if(document.title!=='Credentials saved')return;";
  html += "var url='" + url + "';";
  html += "var d=document.createElement('div');";
  html += "d.style.cssText='margin:16px 0;padding:12px;background:var(--surface,#161a23);border:1px solid #2a2f3a;border-radius:10px;font-size:14px';";
  html += "d.innerHTML='<b>ตั้งค่าเสร็จแล้ว</b><br>กำลังรอมือถือต่อเน็ตกลับ แล้วจะพาไปเว็บแอปให้อัตโนมัติ...<br>ถ้ารอนานเกินไป กดลิงก์นี้เอง: <a href=\\'' + url + '\\'>' + url + '</a>';";
  html += "document.body.insertBefore(d, document.body.firstChild);";
  html += "var tries=0;";
  html += "(function tryRedirect(){";
  html += "tries++;";
  html += "fetch(url,{mode:'no-cors',cache:'no-store'}).then(function(){window.location.href=url;}).catch(function(){";
  html += "if(tries<60)setTimeout(tryRedirect,2000);";
  html += "});";
  html += "})();";
  html += "});</script>";
  return html;
}

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

  wm.setCustomHeadElement((buildPortalBrandingHeadElement() + buildPostSaveLinkHeadElement()).c_str());

  // If the user actually edits the pre-filled Device ID field before
  // submitting, the head element above (built from the old default) would
  // point the post-save link at the wrong topic. Rebuild it here, right
  // after the form is submitted but before the "Credentials saved" page is
  // rendered, using whatever was actually typed.
  wm.setSaveParamsCallback([&]() {
    String submittedId = String(pDevice.getValue());
    submittedId.trim();
    if (submittedId.length() > 0) {
      strlcpy(cfgDeviceId, submittedId.c_str(), sizeof(cfgDeviceId));
    }
    wm.setCustomHeadElement((buildPortalBrandingHeadElement() + buildPostSaveLinkHeadElement()).c_str());
  });

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

  pinMode(WIFI_RESET_PIN, INPUT_PULLUP);

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
  serviceWifiResetButton();
}
