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

// クライアントへの応答タイムアウト時間
const PING_TIMEOUT = 5000;

// WebSocketの接続を処理
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // クライアント状態の拡張
  ws.isAlive = true;
  
  // 接続確認メッセージを送信
  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'WebSocket connection established'
  }));
  
  clients.add(ws);

  // 接続が切断された時の処理
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  // エラー処理
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    // エラーログを詳細に記録
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    try {
      // クライアントにエラーを通知
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'サーバーでエラーが発生しました'
        }));
      }
    } catch (sendError) {
      console.error('エラー通知の送信に失敗:', sendError);
    }
  });
  
  // メッセージ受信の処理
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // pingメッセージに対するpong応答
      if (data.type === 'ping') {
        // クライアントの生存確認
        ws.isAlive = true;
        console.log('Pingを受信しました', data);
        // pongメッセージを返す
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
          receivedAt: data.timestamp
        }));
        return;
      }
      
      // クライアント接続メッセージ
      if (data.type === 'client_connected') {
        console.log('クライアント情報を受信:', data.clientInfo);
      }
      
    } catch (error) {
      console.error('メッセージの解析エラー:', error, message);
    }
  });
});

// 定期的な接続確認
const interval = setInterval(() => {
  console.log(`接続されているクライアント数: ${clients.size}`);
  
  clients.forEach((ws) => {
    // クライアントが応答しない場合は切断
    if (ws.isAlive === false) {
      console.log('無応答クライアントを切断します');
      ws.terminate();
      clients.delete(ws);
      return;
    }
    
    // 次の確認のためにフラグをリセット
    ws.isAlive = false;
    
    // ヘルスチェックのpingを送信
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'health_check',
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('ヘルスチェックの送信エラー:', error);
      ws.terminate();
      clients.delete(ws);
    }
  });
}, 30000);

// サーバー終了時にタイマーをクリア
server.on('close', () => {
  clearInterval(interval);
});

// 検索プロセスの更新をブロードキャスト
function broadcastSearchProgress(data) {
  console.log('Broadcasting message:', JSON.stringify(data));
  const message = JSON.stringify(data);
  let successCount = 0;
  let errorCount = 0;
  
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        errorCount++;
      }
    }
  });
  
  // ブロードキャスト結果のログ
  if (errorCount > 0) {
    console.warn(`ブロードキャスト結果: 成功=${successCount}, 失敗=${errorCount}`);
  }
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

// エラーハンドリングミドルウェア
app.use((err, req, res, next) => {
  console.error('Express エラー:', err);
  res.status(500).json({
    error: 'サーバーエラーが発生しました',
    message: process.env.NODE_ENV === 'production' ? 'サーバー内部エラー' : err.message
  });
});

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