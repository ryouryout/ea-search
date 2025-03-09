const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const { searchCompanyInfo } = require('./searchService');
const { convertToCSV } = require('./csvService');

// Load environment variables
dotenv.config();

const app = express();
// Renderではポート番号を環境変数から取得
const PORT = process.env.PORT || 3001;

// HTTPサーバーを作成
const server = http.createServer(app);

// WebSocketサーバーを作成
const wss = new WebSocket.Server({ server });

// WebSocketのクライアント接続を管理
const clients = new Set();

// WebSocketの接続を処理
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // 接続確認メッセージを送信
  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'WebSocket connection established'
  }));
  
  clients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// 検索プロセスの更新をブロードキャスト
function broadcastSearchProgress(data) {
  console.log('Broadcasting message:', JSON.stringify(data));
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    }
  });
}

// グローバルに検索プログレス通知関数をエクスポート
global.notifySearchProgress = (companyName, step, stepNumber) => {
  console.log(`Search progress: ${companyName} - ${step} (${stepNumber})`);
  broadcastSearchProgress({
    type: 'search_progress',
    company: companyName,
    step: step,
    stepNumber: stepNumber
  });
};

// グローバルに検索完了通知関数をエクスポート
global.notifySearchComplete = (companyName, success, error) => {
  console.log(`Search complete: ${companyName} - Success: ${success} ${error ? `Error: ${error}` : ''}`);
  broadcastSearchProgress({
    type: 'search_complete',
    company: companyName,
    success: success,
    error: error || null
  });
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// テスト用のエンドポイントを追加
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running correctly' });
});

// API endpoint for company search
app.post('/api/search', async (req, res) => {
  try {
    const { companies } = req.body;
    
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input. Please provide an array of company names.' 
      });
    }
    
    if (companies.length > 500) {
      return res.status(400).json({ 
        error: 'Too many companies. Maximum limit is 500.' 
      });
    }
    
    // 検索開始を通知
    broadcastSearchProgress({
      type: 'search_start',
      totalCompanies: companies.length
    });
    
    const results = await searchCompanyInfo(companies);
    
    // 全体の検索完了を通知
    broadcastSearchProgress({
      type: 'all_search_complete',
      totalCompanies: companies.length,
      successCount: results.filter(r => !r.errorOccurred).length,
      errorCount: results.filter(r => r.errorOccurred).length
    });
    
    res.json({ results });
  } catch (error) {
    console.error('Error searching companies:', error);
    res.status(500).json({ 
      error: 'An error occurred while searching for company information.' 
    });
  }
});

// API endpoint for CSV export
app.post('/api/export-csv', async (req, res) => {
  try {
    const { results } = req.body;
    
    if (!results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input. Please provide an array of company results.' 
      });
    }
    
    const csv = convertToCSV(results);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=company_info.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting to CSV:', error);
    res.status(500).json({ 
      error: 'An error occurred while exporting to CSV.' 
    });
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
}); 