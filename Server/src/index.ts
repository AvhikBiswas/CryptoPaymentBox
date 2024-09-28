import express from 'express';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import axios from 'axios';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

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
