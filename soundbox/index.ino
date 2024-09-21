#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <SocketIoClient.h>

const char* ssid = "YourWiFiSSID";
const char* password = "YourWiFiPassword";
const char* serverAddress = "http://your-server-ip:3000";
const char* walletAddress = "YourWalletAddress";

SocketIoClient webSocket;
WiFiClient wifiClient;

void setup() {
  Serial.begin(115200);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("Connected to WiFi");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // Register NodeMCU with the server
  registerNodeMCU();

  // Connect to WebSocket server
  webSocket.begin(serverAddress);
  webSocket.on("connect", handleSocketConnect);
  webSocket.on("newTransaction", handleNewTransaction);
}

void loop() {
  webSocket.loop();
}

void registerNodeMCU() {
  HTTPClient http;
  http.begin(wifiClient, String(serverAddress) + "/register");
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(1024);
  doc["walletAddress"] = walletAddress;
  doc["nodeMCUAddress"] = WiFi.localIP().toString();

  String requestBody;
  serializeJson(doc, requestBody);

  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("Server response: " + response);
  } else {
    Serial.println("Error registering NodeMCU");
  }

  http.end();
}

void handleSocketConnect(const char* payload, size_t length) {
  Serial.println("Socket.IO Connected");
  
  // Register NodeMCU with Socket.IO
  DynamicJsonDocument doc(1024);
  doc["walletAddress"] = walletAddress;
  doc["nodeMCUAddress"] = WiFi.localIP().toString();

  String registerMessage;
  serializeJson(doc, registerMessage);
  webSocket.emit("registerNodeMCU", registerMessage.c_str());
}

void handleNewTransaction(const char* payload, size_t length) {
  DynamicJsonDocument doc(1024);
  deserializeJson(doc, payload);
  
  float amountSOL = doc["amountSOL"].as<float>();
  float amountUSD = doc["amountUSD"].as<float>();
  float amountINR = doc["amountINR"].as<float>();

  Serial.println("You got a payment");
  Serial.print(amountSOL);
  Serial.println(" SOL");
  Serial.print("which is approximately ");
  Serial.print(amountUSD);
  Serial.println(" US dollars");
  Serial.print("or ");
  Serial.print(amountINR);
  Serial.println(" Indian Rupees");
}