import express from 'express';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

app.use(express.json());

// Define a type for user data
interface User {
  walletAddress: string;
  nodeMCUAddress: string;
  socketId?: string;
}

// Store user data (in a real application, this should be in a database)
let users: User[] = [];

// Connect to Solana devnet (change to mainnet-beta for production)
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Function to get the current exchange rate
async function getExchangeRate(currency: string): Promise<number> {
  const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=${currency}`);
  return response.data.solana[currency.toLowerCase()];
}

// Function to check for transactions for a specific user
async function checkForTransactions(user: User) {
  try {
    const publicKey = new PublicKey(user.walletAddress);
    const balance = await connection.getBalance(publicKey);
    
    connection.onLogs(publicKey, async (logs, context) => {
      if (logs.logs.some(log => log.includes('success'))) {
        const newBalance = await connection.getBalance(publicKey);
        const difference = (newBalance - balance) / LAMPORTS_PER_SOL;
        
        const [usdRate, inrRate] = await Promise.all([
          getExchangeRate('usd'),
          getExchangeRate('inr')
        ]);

        const amountUsd = difference * usdRate;
        const amountInr = difference * inrRate;

        const paymentData = {
          type: 'PAYMENT',
          amountSOL: difference.toFixed(4),
          amountUSD: amountUsd.toFixed(2),
          amountINR: amountInr.toFixed(2)
        };

        console.log(`New transaction for ${user.walletAddress}: ${JSON.stringify(paymentData)}`);

        // Send transaction details to NodeMCU via Socket.IO
        if (user.socketId) {
          io.to(user.socketId).emit('newTransaction', paymentData);
          console.log(`Transaction details sent to NodeMCU at ${user.nodeMCUAddress}`);
        } else {
          console.error(`No active socket connection for NodeMCU at ${user.nodeMCUAddress}`);
        }
      }
    }, 'confirmed');

    console.log(`Listening for transactions for wallet ${user.walletAddress}...`);
  } catch (error) {
    console.error(`Error setting up transaction listener for wallet ${user.walletAddress}:`, error);
  }
}

// Route to register NodeMCU
app.post('/register', (req, res) => {
  const { walletAddress, nodeMCUAddress } = req.body;
  const existingUserIndex = users.findIndex(user => user.walletAddress === walletAddress);

  if (existingUserIndex !== -1) {
    users[existingUserIndex].nodeMCUAddress = nodeMCUAddress;
  } else {
    users.push({ walletAddress, nodeMCUAddress });
    checkForTransactions(users[users.length - 1]);
  }

  res.status(200).json({ message: 'NodeMCU registered successfully' });
});

// Socket.IO connection handler
io.on('connection', (socket:any) => {
  console.log('New client connected');

  socket.on('registerNodeMCU', (data:any) => {
    const { walletAddress, nodeMCUAddress } = data;
    const user = users.find(u => u.walletAddress === walletAddress && u.nodeMCUAddress === nodeMCUAddress);

    if (user) {
      user.socketId = socket.id;
      console.log(`NodeMCU registered with socket ID: ${socket.id}`);
    } else {
      console.error('NodeMCU not found in users list');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    const userIndex = users.findIndex(u => u.socketId === socket.id);
    if (userIndex !== -1) {
      users[userIndex].socketId = undefined;
    }
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// NodeMCU ESP8266 Arduino code (to be uploaded separately):
/*
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
*/
